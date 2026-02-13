use crate::models::Provider;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::RwLock;
use tokio::sync::{Mutex, Notify};
use tokio::time::Duration;

#[derive(Debug, Clone)]
pub struct ScheduledRun {
    pub run_id: String,
    pub provider: Provider,
    pub priority: i32,
    pub queued_at: DateTime<Utc>,
    pub not_before: DateTime<Utc>,
}

type ExecutorFuture = Pin<Box<dyn Future<Output = bool> + Send>>;
type Executor = Arc<dyn Fn(String) -> ExecutorFuture + Send + Sync>;

#[derive(Clone)]
pub struct Scheduler {
    queue: Arc<Mutex<Vec<ScheduledRun>>>,
    running_global: Arc<Mutex<usize>>,
    running_provider: Arc<Mutex<HashMap<Provider, usize>>>,
    notify: Arc<Notify>,
    executor: Arc<RwLock<Option<Executor>>>,
    global_limit: usize,
    per_provider_limit: usize,
    max_queue_size: usize,
}

impl Scheduler {
    pub fn new(global_limit: usize, per_provider_limit: usize, max_queue_size: usize) -> Self {
        Self {
            queue: Arc::new(Mutex::new(Vec::new())),
            running_global: Arc::new(Mutex::new(0)),
            running_provider: Arc::new(Mutex::new(HashMap::new())),
            notify: Arc::new(Notify::new()),
            executor: Arc::new(RwLock::new(None)),
            global_limit,
            per_provider_limit,
            max_queue_size,
        }
    }

    pub fn set_executor(&self, executor: Executor) {
        let mut writer = self
            .executor
            .write()
            .expect("scheduler executor write lock");
        *writer = Some(executor);
    }

    pub async fn enqueue(&self, run: ScheduledRun) -> Result<(), String> {
        {
            let mut queue = self.queue.lock().await;
            if queue.iter().any(|queued| queued.run_id == run.run_id) {
                return Ok(());
            }
            if queue.len() >= self.max_queue_size {
                return Err(format!(
                    "Queue capacity exceeded (max {}).",
                    self.max_queue_size
                ));
            }
            queue.push(run);
        }
        self.notify.notify_one();
        Ok(())
    }

    pub async fn has_capacity(&self) -> bool {
        let queue = self.queue.lock().await;
        queue.len() < self.max_queue_size
    }

    pub fn start(&self) {
        let scheduler = self.clone();
        tokio::spawn(async move {
            scheduler.run_loop().await;
        });
    }

    async fn run_loop(self) {
        loop {
            self.notify.notified().await;
            let mut blocked_attempts = 0usize;
            loop {
                let (maybe_run, next_delay) = self.pick_next_run().await;
                let Some(run) = maybe_run else {
                    if let Some(delay) = next_delay {
                        let notify = self.notify.clone();
                        tokio::spawn(async move {
                            tokio::time::sleep(delay).await;
                            notify.notify_one();
                        });
                    }
                    break;
                };

                if !self.try_reserve_slot(run.provider).await {
                    let mut queue = self.queue.lock().await;
                    queue.push(run);
                    blocked_attempts += 1;
                    if blocked_attempts >= queue.len() {
                        break;
                    }
                    continue;
                }
                blocked_attempts = 0;

                let scheduler = self.clone();
                tokio::spawn(async move {
                    let failed = scheduler.execute(run.run_id.clone()).await;
                    scheduler.release_slot(run.provider).await;
                    if failed {
                        tracing::warn!(run_id = %run.run_id, "scheduled run finished in failed state");
                    }
                    scheduler.notify.notify_one();
                });
            }
        }
    }

    async fn execute(&self, run_id: String) -> bool {
        let executor = self
            .executor
            .read()
            .expect("scheduler executor read lock")
            .clone();
        match executor {
            Some(executor) => executor(run_id).await,
            None => true,
        }
    }

    async fn pick_next_run(&self) -> (Option<ScheduledRun>, Option<Duration>) {
        let mut queue = self.queue.lock().await;
        if queue.is_empty() {
            return (None, None);
        }

        let now = Utc::now();
        let ready_indices = queue
            .iter()
            .enumerate()
            .filter(|(_, run)| run.not_before <= now)
            .collect::<Vec<_>>();

        if ready_indices.is_empty() {
            let next_ready_at = queue.iter().map(|run| run.not_before).min();
            let delay = next_ready_at.and_then(|at| {
                let diff = at.signed_duration_since(now).num_milliseconds();
                if diff <= 0 {
                    Some(Duration::from_millis(0))
                } else {
                    Some(Duration::from_millis(diff as u64))
                }
            });
            return (None, delay);
        }

        let best_index = ready_indices
            .into_iter()
            .max_by_key(|(_, run)| effective_priority(run, now))
            .map(|(index, _)| index)
            .expect("ready run index");

        (Some(queue.remove(best_index)), None)
    }

    async fn try_reserve_slot(&self, provider: Provider) -> bool {
        let mut global = self.running_global.lock().await;
        if *global >= self.global_limit {
            return false;
        }

        let mut provider_map = self.running_provider.lock().await;
        let entry = provider_map.entry(provider).or_insert(0);
        if *entry >= self.per_provider_limit {
            return false;
        }

        *global += 1;
        *entry += 1;
        true
    }

    async fn release_slot(&self, provider: Provider) {
        let mut global = self.running_global.lock().await;
        if *global > 0 {
            *global -= 1;
        }

        let mut provider_map = self.running_provider.lock().await;
        if let Some(entry) = provider_map.get_mut(&provider) {
            if *entry > 0 {
                *entry -= 1;
            }
        }
    }
}

fn effective_priority(run: &ScheduledRun, now: DateTime<Utc>) -> i64 {
    let waited = (now - run.queued_at).num_seconds().max(0);
    i64::from(run.priority) * 100 + waited / 15
}

#[cfg(test)]
mod tests {
    use super::{effective_priority, ScheduledRun, Scheduler};
    use crate::models::Provider;
    use chrono::{Duration, Utc};

    #[test]
    fn aging_increases_priority() {
        let now = Utc::now();
        let old = ScheduledRun {
            run_id: "a".to_string(),
            provider: Provider::Codex,
            priority: 0,
            queued_at: now - Duration::seconds(120),
            not_before: now - Duration::seconds(120),
        };
        let fresh = ScheduledRun {
            run_id: "b".to_string(),
            provider: Provider::Codex,
            priority: 0,
            queued_at: now,
            not_before: now,
        };
        assert!(effective_priority(&old, now) > effective_priority(&fresh, now));
    }

    #[tokio::test]
    async fn queue_capacity_is_enforced() {
        let scheduler = Scheduler::new(1, 1, 1);
        let now = Utc::now();
        let first = ScheduledRun {
            run_id: "first".to_string(),
            provider: Provider::Codex,
            priority: 0,
            queued_at: now,
            not_before: now,
        };
        let second = ScheduledRun {
            run_id: "second".to_string(),
            provider: Provider::Claude,
            priority: 0,
            queued_at: now,
            not_before: now,
        };

        scheduler.enqueue(first).await.expect("first enqueue");
        let err = scheduler.enqueue(second).await.expect_err("second enqueue should fail");
        assert!(err.contains("Queue capacity exceeded"));
    }
}
