use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use crate::adapters::claude::ClaudeAdapter;
use crate::adapters::codex::CodexAdapter;
use crate::adapters::ValidatedCommand;
use crate::adapters::compatibility::CompatibilityRegistry;
use crate::adapters::Adapter;
use crate::db::Database;
use crate::errors::{AppError, AppResult};
use crate::models::{
    AcceptedResponse, AppSettings, BooleanResponse, CapabilitySnapshot, ExportResponse, ListRunsFilters, Profile,
    Provider, RerunResponse, RunDetail, RunMode, RunStatus, SaveProfilePayload, SchedulerJob, StartInteractiveSessionResponse,
    StartRunPayload, StartRunResponse, StreamEnvelope, WorkspaceGrant,
};
use crate::policy::PolicyEngine;
use crate::redaction::Redactor;
use crate::scheduler::{ScheduledRun, Scheduler};
use crate::session::SessionManager;
use chrono::Utc;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild as ShellCommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{timeout, Duration};
use uuid::Uuid;

static ANSI_ESCAPE_RE: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").expect("valid ansi escape regex")
});

const MAX_BUFFERED_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_BUFFERED_OUTPUT_LINES: usize = 4_000;

#[derive(Default)]
struct OutputBuffer {
    lines: VecDeque<String>,
    total_bytes: usize,
}

impl OutputBuffer {
    fn push(&mut self, line: String) {
        let line_len = line.len();
        self.lines.push_back(line);
        self.total_bytes = self.total_bytes.saturating_add(line_len);

        while self.lines.len() > MAX_BUFFERED_OUTPUT_LINES
            || self.total_bytes > MAX_BUFFERED_OUTPUT_BYTES
        {
            if let Some(removed) = self.lines.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            } else {
                break;
            }
        }
    }

    fn joined(&self) -> String {
        self.lines
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

struct PendingRun {
    payload: StartRunPayload,
    capability: crate::models::CapabilityProfile,
    binary_path: String,
    execution_path: RunExecutionPath,
    session_input: Option<tokio::sync::mpsc::Receiver<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RunExecutionPath {
    ScopedShellAlias,
    VerifiedAbsolutePath,
}

struct ActiveChild {
    process: ActiveProcess,
    canceled: Arc<AtomicBool>,
}

enum ActiveProcess {
    Tokio(Arc<Mutex<Child>>),
    Shell(Arc<Mutex<Option<ShellCommandChild>>>),
    Pty(Arc<StdMutex<Box<dyn portable_pty::ChildKiller + Send + Sync>>>),
}

#[derive(Clone)]
pub struct RunnerCore {
    db: Arc<Database>,
    scheduler: Scheduler,
    policy: PolicyEngine,
    redactor: Arc<RwLock<Redactor>>,
    compatibility: CompatibilityRegistry,
    codex: Arc<dyn Adapter>,
    claude: Arc<dyn Adapter>,
    sessions: SessionManager,
    pending_runs: Arc<Mutex<HashMap<String, PendingRun>>>,
    run_payload_cache: Arc<Mutex<HashMap<String, StartRunPayload>>>,
    active_children: Arc<Mutex<HashMap<String, ActiveChild>>>,
    keyring_lock: Arc<Mutex<()>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    app_data_dir: PathBuf,
}

impl RunnerCore {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Arc<Self>> {
        let db_path = app_data_dir.join("state.sqlite");
        let db = Arc::new(Database::new(&db_path)?);
        let scheduler = Scheduler::new(2, 1, 512);

        let this = Arc::new(Self {
            db,
            scheduler: scheduler.clone(),
            policy: PolicyEngine::new(),
            redactor: Arc::new(RwLock::new(Redactor::new(true))),
            compatibility: CompatibilityRegistry::new(),
            codex: Arc::new(CodexAdapter::default()),
            claude: Arc::new(ClaudeAdapter::default()),
            sessions: SessionManager::new(),
            pending_runs: Arc::new(Mutex::new(HashMap::new())),
            run_payload_cache: Arc::new(Mutex::new(HashMap::new())),
            active_children: Arc::new(Mutex::new(HashMap::new())),
            keyring_lock: Arc::new(Mutex::new(())),
            app_handle: Arc::new(RwLock::new(None)),
            app_data_dir,
        });

        if let Err(error) = this.db.ensure_bootstrap_workspace_grant() {
            tracing::warn!(error = %error, "failed to create bootstrap workspace grant");
        }

        if let Ok(interrupted) = this.db.mark_orphan_runs_interrupted() {
            if interrupted > 0 {
                tracing::warn!(count = interrupted, "marked orphaned runs as interrupted on startup");
            }
        }

        let weak = Arc::downgrade(&this);
        scheduler.set_executor(Arc::new(move |run_id: String| {
            let weak = weak.clone();
            Box::pin(async move {
                if let Some(strong) = weak.upgrade() {
                    strong.execute_queued_run(run_id).await
                } else {
                    true
                }
            })
        }));

        Ok(this)
    }

    pub fn start_scheduler(&self) {
        self.scheduler.start();
    }

    pub async fn attach_app_handle(&self, app_handle: AppHandle) {
        let mut writer = self.app_handle.write().await;
        *writer = Some(app_handle);
    }

    pub async fn start_run(&self, payload: StartRunPayload) -> AppResult<StartRunResponse> {
        let run_id = self.queue_run(payload, false).await?.0;
        Ok(StartRunResponse { run_id })
    }

    pub async fn start_interactive_session(
        &self,
        mut payload: StartRunPayload,
    ) -> AppResult<StartInteractiveSessionResponse> {
        payload.mode = RunMode::Interactive;
        let (run_id, session_id) = self.queue_run(payload, true).await?;
        let session_id = session_id.ok_or_else(|| AppError::Internal("Session id missing".to_string()))?;
        Ok(StartInteractiveSessionResponse { run_id, session_id })
    }

    pub async fn queue_run(
        &self,
        payload: StartRunPayload,
        create_session: bool,
    ) -> AppResult<(String, Option<String>)> {
        let settings = self.db.get_settings()?;
        self.apply_runtime_settings(&settings).await;

        let effective_payload = self.apply_profile_if_selected(payload)?;

        let configured_binary = match effective_payload.provider {
            Provider::Codex => settings.codex_path.clone(),
            Provider::Claude => settings.claude_path.clone(),
        };
        let (binary_path, execution_path) =
            self.resolve_binary_path(effective_payload.provider, &configured_binary, &settings)?;

        let capability = self
            .compatibility
            .detect_profile(effective_payload.provider, &binary_path)
            .await;

        let snapshot = CapabilitySnapshot {
            id: Uuid::new_v4().to_string(),
            provider: effective_payload.provider,
            cli_version: capability.cli_version.clone(),
            profile: capability.clone(),
            detected_at: Utc::now(),
        };
        self.db.insert_capability_snapshot(&snapshot)?;

        let grants = self.db.list_workspace_grants()?;
        self.policy
            .validate(&effective_payload, &settings, &grants, &capability)?;
        self.adapter_for(effective_payload.provider).validate(&effective_payload)?;

        if !self.scheduler.has_capacity().await {
            return Err(AppError::Policy(
                "Queue is at capacity. Wait for active jobs to complete before enqueueing more runs."
                    .to_string(),
            ));
        }

        let run_id = Uuid::new_v4().to_string();
        let warnings = capability.disabled_reasons.clone();
        let queue_priority = effective_payload.queue_priority.unwrap_or_default();
        let scheduled_at = effective_payload.scheduled_at.unwrap_or_else(Utc::now);
        let max_retries = effective_payload.max_retries.unwrap_or(0);
        let retry_backoff_ms = effective_payload.retry_backoff_ms.unwrap_or(1_000);

        self.db.insert_run(
            &run_id,
            effective_payload.provider,
            &effective_payload.prompt,
            effective_payload.model.as_deref(),
            effective_payload.mode,
            effective_payload.output_format.as_deref(),
            &effective_payload.cwd,
            queue_priority,
            effective_payload.profile_id.as_deref(),
            Some(&snapshot.id),
            &warnings,
        )?;
        self.db.insert_scheduler_job(
            &run_id,
            queue_priority,
            Some(scheduled_at),
            max_retries,
            retry_backoff_ms,
        )?;
        self.run_payload_cache
            .lock()
            .await
            .insert(run_id.clone(), effective_payload.clone());

        let (session_id, session_input) =
            if create_session || effective_payload.mode == RunMode::Interactive {
            let (session_id, receiver) = self.sessions.open_session(&run_id).await;
            (Some(session_id), Some(receiver))
        } else {
            (None, None)
        };

        let pending = PendingRun {
            payload: effective_payload.clone(),
            capability,
            binary_path,
            execution_path,
            session_input,
        };
        self.pending_runs.lock().await.insert(run_id.clone(), pending);

        if let Err(error) = self
            .scheduler
            .enqueue(ScheduledRun {
                run_id: run_id.clone(),
                provider: effective_payload.provider,
                priority: queue_priority,
                queued_at: Utc::now(),
                not_before: scheduled_at,
            })
            .await
        {
            self.pending_runs.lock().await.remove(&run_id);
            self.run_payload_cache.lock().await.remove(&run_id);
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Failed, None, Some(&error));
            let _ = self.db.mark_job_finished(&run_id, true);
            return Err(AppError::Policy(error));
        }

        Ok((run_id, session_id))
    }

    pub async fn execute_queued_run(&self, run_id: String) -> bool {
        let pending = {
            let mut guard = self.pending_runs.lock().await;
            guard.remove(&run_id)
        };
        let Some(pending) = pending else {
            return true;
        };

        if let Err(error) = self.db.mark_job_running(&run_id) {
            tracing::error!(run_id = %run_id, error = %error, "failed to mark job running");
        }

        if let Err(error) = self.db.update_run_status(&run_id, RunStatus::Running, None, None) {
            tracing::error!(run_id = %run_id, error = %error, "failed to set run status");
        }

        let _ = self
            .emit_event(&run_id, "run.started", json!({ "provider": pending.payload.provider }))
            .await;
        let _ = self
            .emit_event(&run_id, "run.progress", json!({ "stage": "spawn_preparing" }))
            .await;

        for warning in &pending.capability.disabled_reasons {
            let _ = self.db.add_compatibility_warning(&run_id, warning);
            let _ = self
                .emit_event(
                    &run_id,
                    "run.compatibility_warning",
                    json!({ "message": warning }),
                )
                .await;
        }

        let settings = match self.db.get_settings() {
            Ok(settings) => settings,
            Err(error) => {
                let message = format!("Settings load failed: {}", error);
                if self
                    .schedule_retry_if_eligible(&run_id, &pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return false;
                }
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                return true;
            }
        };

        let adapter = self.adapter_for(pending.payload.provider);
        let command_spec = match adapter.build_command(
            &pending.payload,
            &pending.capability,
            &pending.binary_path,
        ) {
            Ok(spec) => spec,
            Err(error) => {
                let message = error.to_string();
                if self
                    .schedule_retry_if_eligible(&run_id, &pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return false;
                }
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                return true;
            }
        };

        let audited_flags = match self.policy.validate_resolved_args(
            pending.payload.provider,
            &command_spec.args,
            &settings,
            &pending.capability,
        ) {
            Ok(flags) => flags,
            Err(error) => {
                let message = error.to_string();
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                return true;
            }
        };

        let _ = self
            .emit_event(
                &run_id,
                "run.policy_audit",
                json!({
                    "provider": pending.payload.provider,
                    "binary": command_spec.program.clone(),
                    "executionPath": match pending.execution_path {
                        RunExecutionPath::ScopedShellAlias => "scoped-shell-alias",
                        RunExecutionPath::VerifiedAbsolutePath => "verified-absolute-path"
                    },
                    "cwd": command_spec.cwd.clone(),
                    "flags": audited_flags,
                    "advancedPolicy": settings.allow_advanced_policy,
                    "profileId": pending.payload.profile_id.clone(),
                    "capabilityVersion": pending.capability.cli_version
                }),
            )
            .await;

        if pending.payload.mode == RunMode::Interactive {
            return self
                .execute_interactive_pty_run(run_id, pending, settings, adapter, command_spec)
                .await;
        }

        let execution = match pending.execution_path {
            RunExecutionPath::ScopedShellAlias => {
                self.execute_noninteractive_shell_run(
                    run_id.clone(),
                    &pending,
                    &settings,
                    adapter.clone(),
                    &command_spec,
                )
                .await
                .map_err(|error| format!("Shell execution failed: {}", error))
            }
            RunExecutionPath::VerifiedAbsolutePath => {
                self.execute_noninteractive_tokio_run(
                    run_id.clone(),
                    &pending,
                    &settings,
                    adapter.clone(),
                    &command_spec,
                )
                .await
                .map_err(|error| format!("Absolute-path execution failed: {}", error))
            }
        };

        match execution {
            Ok(result) => result,
            Err(message) => {
                if self
                    .schedule_retry_if_eligible(&run_id, &pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return false;
                }
                let _ = self
                    .fail_run(&run_id, None, &message, pending.payload.mode == RunMode::Interactive)
                    .await;
                true
            }
        }
    }

    async fn execute_interactive_pty_run(
        &self,
        run_id: String,
        mut pending: PendingRun,
        settings: AppSettings,
        adapter: Arc<dyn Adapter>,
        command_spec: ValidatedCommand,
    ) -> bool {
        let pty_system = native_pty_system();
        let pair = match pty_system.openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(pair) => pair,
            Err(error) => {
                let _ = self
                    .fail_run(&run_id, None, &format!("Failed to open PTY: {}", error), true)
                    .await;
                return true;
            }
        };

        let mut builder = CommandBuilder::new(command_spec.program.clone());
        builder.args(command_spec.args.clone());
        builder.cwd(&command_spec.cwd);
        for (key, value) in &command_spec.env {
            builder.env(key, value);
        }
        if !command_spec.env.contains_key("TERM") {
            builder.env("TERM", "xterm-256color");
        }
        if !command_spec.env.contains_key("COLORTERM") {
            builder.env("COLORTERM", "truecolor");
        }

        let mut child = match pair.slave.spawn_command(builder) {
            Ok(child) => child,
            Err(error) => {
                let _ = self
                    .fail_run(
                        &run_id,
                        None,
                        &format!("Failed to spawn PTY process: {}", error),
                        true,
                    )
                    .await;
                return true;
            }
        };

        let killer = Arc::new(StdMutex::new(child.clone_killer()));
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(error) => {
                let _ = self
                    .fail_run(
                        &run_id,
                        None,
                        &format!("Failed to open PTY reader: {}", error),
                        true,
                    )
                    .await;
                return true;
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(error) => {
                let _ = self
                    .fail_run(
                        &run_id,
                        None,
                        &format!("Failed to open PTY writer: {}", error),
                        true,
                    )
                    .await;
                return true;
            }
        };
        let writer = Arc::new(StdMutex::new(writer));

        let buffered_output = Arc::new(Mutex::new(OutputBuffer::default()));
        let canceled = Arc::new(AtomicBool::new(false));
        self.active_children.lock().await.insert(
            run_id.clone(),
            ActiveChild {
                process: ActiveProcess::Pty(killer.clone()),
                canceled: canceled.clone(),
            },
        );

        let (output_tx, mut output_rx) = tokio::sync::mpsc::unbounded_channel::<Result<String, String>>();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let text = String::from_utf8_lossy(&buffer[..size]).to_string();
                        if output_tx.send(Ok(text)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = output_tx.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });

        let output_task = {
            let run_id = run_id.clone();
            let core = self.clone();
            let adapter = adapter.clone();
            let buffered_output = buffered_output.clone();
            tokio::spawn(async move {
                while let Some(chunk_result) = output_rx.recv().await {
                    match chunk_result {
                        Ok(chunk) => {
                            let text = sanitize_terminal_chunk(&chunk);
                            if text.is_empty() {
                                continue;
                            }
                            if let Ok(redacted) = core
                                .emit_redacted_stream(
                                    &run_id,
                                    "run.chunk.stdout",
                                    text,
                                    adapter.as_ref(),
                                    "stdout",
                                )
                                .await
                            {
                                buffered_output.lock().await.push(redacted);
                            }
                        }
                        Err(error) => {
                            let _ = core
                                .emit_event(
                                    &run_id,
                                    "run.progress",
                                    json!({ "stage": "pty_read_error", "message": error }),
                                )
                                .await;
                        }
                    }
                }
            })
        };

        if pending.payload.mode == RunMode::Interactive {
            if let Some(session_id) = self.sessions.session_id(&run_id).await {
                let _ = self
                    .emit_event(
                        &run_id,
                        "session.opened",
                        json!({ "session_id": session_id }),
                    )
                    .await;
            }
        }

        let initial_prompt = pending.payload.prompt.trim().to_string();
        if !initial_prompt.is_empty() {
            let writer = writer.clone();
            let initial_prompt_clone = initial_prompt.clone();
            let _ = tokio::task::spawn_blocking(move || -> AppResult<()> {
                let mut writer = writer
                    .lock()
                    .map_err(|_| AppError::Internal("PTY writer lock poisoned".to_string()))?;
                writer
                    .write_all(initial_prompt_clone.as_bytes())
                    .map_err(|error| AppError::Io(error.to_string()))?;
                writer
                    .write_all(b"\n")
                    .map_err(|error| AppError::Io(error.to_string()))?;
                writer.flush().map_err(|error| AppError::Io(error.to_string()))?;
                Ok(())
            })
            .await;
            let _ = self
                .emit_event(
                    &run_id,
                    "session.input_accepted",
                    json!({ "bytes": initial_prompt.len(), "kind": "initial_prompt" }),
                )
                .await;
        }

        let stdin_task = match pending.session_input.take() {
            Some(mut receiver) => {
                let run_id = run_id.clone();
                let core = self.clone();
                let writer = writer.clone();
                Some(tokio::spawn(async move {
                    while let Some(input) = receiver.recv().await {
                        let bytes = input.len();
                        let writer = writer.clone();
                        let write_result = tokio::task::spawn_blocking(move || -> AppResult<()> {
                            let mut writer = writer
                                .lock()
                                .map_err(|_| AppError::Internal("PTY writer lock poisoned".to_string()))?;
                            writer
                                .write_all(input.as_bytes())
                                .map_err(|error| AppError::Io(error.to_string()))?;
                            writer
                                .write_all(b"\n")
                                .map_err(|error| AppError::Io(error.to_string()))?;
                            writer.flush().map_err(|error| AppError::Io(error.to_string()))?;
                            Ok(())
                        })
                        .await;

                        match write_result {
                            Ok(Ok(())) => {
                                let _ = core
                                    .emit_event(
                                        &run_id,
                                        "session.input_accepted",
                                        json!({ "bytes": bytes }),
                                    )
                                    .await;
                            }
                            _ => break,
                        }
                    }
                }))
            }
            None => None,
        };

        let timeout_seconds = pending.payload.timeout_seconds.unwrap_or(300);
        let wait_task = tokio::task::spawn_blocking(move || child.wait());
        let wait_result = timeout(Duration::from_secs(timeout_seconds), wait_task).await;
        let status = match wait_result {
            Ok(joined) => match joined {
                Ok(Ok(status)) => status,
                Ok(Err(error)) => {
                    self.active_children.lock().await.remove(&run_id);
                    let message = format!("Process wait failed: {}", error);
                    let _ = self.fail_run(&run_id, None, &message, true).await;
                    return true;
                }
                Err(error) => {
                    self.active_children.lock().await.remove(&run_id);
                    let message = format!("Process wait join failed: {}", error);
                    let _ = self.fail_run(&run_id, None, &message, true).await;
                    return true;
                }
            },
            Err(_) => {
                canceled.store(true, Ordering::SeqCst);
                let _ = self
                    .terminate_active_process(ActiveProcess::Pty(killer.clone()))
                    .await;
                self.active_children.lock().await.remove(&run_id);
                let _ = self
                    .fail_run(&run_id, None, "Run timed out", true)
                    .await;
                return true;
            }
        };

        if let Some(task) = stdin_task {
            task.abort();
        }
        let _ = output_task.await;
        self.active_children.lock().await.remove(&run_id);

        let exit_code = i32::try_from(status.exit_code()).ok();
        let was_canceled = canceled.load(Ordering::SeqCst);
        let buffered_text = buffered_output.lock().await.joined();
        let summary = adapter.parse_final(exit_code, &buffered_text);
        let _ = self
            .db
            .insert_artifact(&run_id, "parsed_summary", "", &summary);
        let _ = self.persist_session_transcript_artifact(&run_id, &buffered_text);
        if settings.store_encrypted_raw_artifacts {
            let _ = self
                .persist_encrypted_raw_artifact(&run_id, &buffered_text)
                .await;
        }

        if was_canceled {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Canceled, exit_code, Some("Canceled by user"));
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.canceled", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.emit_event(&run_id, "session.closed", json!({})).await;
            self.sessions.close_session(&run_id).await;
            return false;
        }

        if status.success() {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Completed, exit_code, None);
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.completed", json!({ "exit_code": exit_code }))
                .await;
            let _ = self.emit_event(&run_id, "session.closed", json!({})).await;
            self.sessions.close_session(&run_id).await;
            false
        } else {
            let error_message = format!("Process exited with {:?}", exit_code);
            let _ = self
                .fail_run(&run_id, exit_code, &error_message, true)
                .await;
            true
        }
    }

    async fn execute_noninteractive_shell_run(
        &self,
        run_id: String,
        pending: &PendingRun,
        settings: &AppSettings,
        adapter: Arc<dyn Adapter>,
        command_spec: &ValidatedCommand,
    ) -> AppResult<bool> {
        let app_handle = self
            .app_handle
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Internal("App handle unavailable".to_string()))?;

        let mut command = app_handle
            .shell()
            .command(&command_spec.program)
            .args(command_spec.args.clone())
            .current_dir(command_spec.cwd.clone());
        for (key, value) in &command_spec.env {
            command = command.env(key, value);
        }

        let (mut events, child) = command
            .spawn()
            .map_err(|error| AppError::Io(format!("shell spawn unavailable: {}", error)))?;
        let child_handle = Arc::new(Mutex::new(Some(child)));

        let buffered_output = Arc::new(Mutex::new(OutputBuffer::default()));
        let canceled = Arc::new(AtomicBool::new(false));

        self.active_children.lock().await.insert(
            run_id.clone(),
            ActiveChild {
                process: ActiveProcess::Shell(child_handle.clone()),
                canceled: canceled.clone(),
            },
        );

        let timeout_seconds = pending.payload.timeout_seconds.unwrap_or(300);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_seconds);
        let mut exit_code: Option<i32> = None;

        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                canceled.store(true, Ordering::SeqCst);
                let _ = self
                    .terminate_active_process(ActiveProcess::Shell(child_handle.clone()))
                    .await;
                self.active_children.lock().await.remove(&run_id);
                let message = "Run timed out".to_string();
                if self
                    .schedule_retry_if_eligible(&run_id, pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return Ok(false);
                }
                let _ = self.fail_run(&run_id, None, &message, false).await;
                return Ok(true);
            }

            let remaining = deadline.saturating_duration_since(now);
            let next_event = timeout(remaining, events.recv()).await;
            match next_event {
                Ok(Some(CommandEvent::Stdout(bytes))) => {
                    let text = sanitize_terminal_chunk(&String::from_utf8_lossy(&bytes));
                    if !text.is_empty() {
                        if let Ok(redacted) = self
                            .emit_redacted_stream(
                                &run_id,
                                "run.chunk.stdout",
                                text,
                                adapter.as_ref(),
                                "stdout",
                            )
                            .await
                        {
                            buffered_output.lock().await.push(redacted);
                        }
                    }
                }
                Ok(Some(CommandEvent::Stderr(bytes))) => {
                    let text = sanitize_terminal_chunk(&String::from_utf8_lossy(&bytes));
                    if !text.is_empty() {
                        if let Ok(redacted) = self
                            .emit_redacted_stream(
                                &run_id,
                                "run.chunk.stderr",
                                text,
                                adapter.as_ref(),
                                "stderr",
                            )
                            .await
                        {
                            buffered_output.lock().await.push(redacted);
                        }
                    }
                }
                Ok(Some(CommandEvent::Error(message))) => {
                    let _ = self
                        .emit_event(
                            &run_id,
                            "run.progress",
                            json!({ "stage": "shell_error", "message": message }),
                        )
                        .await;
                }
                Ok(Some(CommandEvent::Terminated(payload))) => {
                    exit_code = payload.code;
                    break;
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(_) => {
                    canceled.store(true, Ordering::SeqCst);
                    let _ = self
                        .terminate_active_process(ActiveProcess::Shell(child_handle.clone()))
                        .await;
                    self.active_children.lock().await.remove(&run_id);
                    let message = "Run timed out".to_string();
                    if self
                        .schedule_retry_if_eligible(&run_id, pending, &message)
                        .await
                        .unwrap_or(false)
                    {
                        return Ok(false);
                    }
                    let _ = self.fail_run(&run_id, None, &message, false).await;
                    return Ok(true);
                }
            }
        }

        self.active_children.lock().await.remove(&run_id);

        let was_canceled = canceled.load(Ordering::SeqCst);
        let buffered_text = buffered_output.lock().await.joined();
        let summary = adapter.parse_final(exit_code, &buffered_text);
        let _ = self
            .db
            .insert_artifact(&run_id, "parsed_summary", "", &summary);
        if settings.store_encrypted_raw_artifacts {
            let _ = self
                .persist_encrypted_raw_artifact(&run_id, &buffered_text)
                .await;
        }

        if was_canceled {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Canceled, exit_code, Some("Canceled by user"));
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.canceled", json!({ "exit_code": exit_code }))
                .await;
            return Ok(false);
        }

        if exit_code == Some(0) {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Completed, exit_code, None);
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.completed", json!({ "exit_code": exit_code }))
                .await;
            Ok(false)
        } else {
            let error_message = format!("Process exited with {:?}", exit_code);
            if self
                .schedule_retry_if_eligible(&run_id, pending, &error_message)
                .await
                .unwrap_or(false)
            {
                Ok(false)
            } else {
                let _ = self
                    .fail_run(&run_id, exit_code, &error_message, false)
                    .await;
                Ok(true)
            }
        }
    }

    async fn execute_noninteractive_tokio_run(
        &self,
        run_id: String,
        pending: &PendingRun,
        settings: &AppSettings,
        adapter: Arc<dyn Adapter>,
        command_spec: &ValidatedCommand,
    ) -> AppResult<bool> {
        let mut command = Command::new(&command_spec.program);
        command
            .args(command_spec.args.clone())
            .current_dir(command_spec.cwd.clone())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (key, value) in &command_spec.env {
            command.env(key, value);
        }

        let mut child = command
            .spawn()
            .map_err(|error| AppError::Io(format!("failed to spawn process: {}", error)))?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let child_handle = Arc::new(Mutex::new(child));
        let buffered_output = Arc::new(Mutex::new(OutputBuffer::default()));
        let canceled = Arc::new(AtomicBool::new(false));

        self.active_children.lock().await.insert(
            run_id.clone(),
            ActiveChild {
                process: ActiveProcess::Tokio(child_handle.clone()),
                canceled: canceled.clone(),
            },
        );

        let stdout_task = stdout.map(|stream| {
            let run_id = run_id.clone();
            let core = self.clone();
            let adapter = adapter.clone();
            let buffered_output = buffered_output.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stream).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            let text = sanitize_terminal_chunk(&line);
                            if text.is_empty() {
                                continue;
                            }
                            if let Ok(redacted) = core
                                .emit_redacted_stream(
                                    &run_id,
                                    "run.chunk.stdout",
                                    text,
                                    adapter.as_ref(),
                                    "stdout",
                                )
                                .await
                            {
                                buffered_output.lock().await.push(redacted);
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            let _ = core
                                .emit_event(
                                    &run_id,
                                    "run.progress",
                                    json!({ "stage": "stdout_read_error", "message": error.to_string() }),
                                )
                                .await;
                            break;
                        }
                    }
                }
            })
        });

        let stderr_task = stderr.map(|stream| {
            let run_id = run_id.clone();
            let core = self.clone();
            let adapter = adapter.clone();
            let buffered_output = buffered_output.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stream).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            let text = sanitize_terminal_chunk(&line);
                            if text.is_empty() {
                                continue;
                            }
                            if let Ok(redacted) = core
                                .emit_redacted_stream(
                                    &run_id,
                                    "run.chunk.stderr",
                                    text,
                                    adapter.as_ref(),
                                    "stderr",
                                )
                                .await
                            {
                                buffered_output.lock().await.push(redacted);
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            let _ = core
                                .emit_event(
                                    &run_id,
                                    "run.progress",
                                    json!({ "stage": "stderr_read_error", "message": error.to_string() }),
                                )
                                .await;
                            break;
                        }
                    }
                }
            })
        });

        let timeout_seconds = pending.payload.timeout_seconds.unwrap_or(300);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_seconds);
        let exit_code = loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                canceled.store(true, Ordering::SeqCst);
                let _ = self
                    .terminate_active_process(ActiveProcess::Tokio(child_handle.clone()))
                    .await;
                self.active_children.lock().await.remove(&run_id);
                let message = "Run timed out".to_string();
                if self
                    .schedule_retry_if_eligible(&run_id, pending, &message)
                    .await
                    .unwrap_or(false)
                {
                    return Ok(false);
                }
                let _ = self.fail_run(&run_id, None, &message, false).await;
                return Ok(true);
            }

            let status = {
                let mut child = child_handle.lock().await;
                child
                    .try_wait()
                    .map_err(|error| AppError::Io(format!("failed to poll process status: {}", error)))?
            };
            if let Some(status) = status {
                break status.code();
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        };

        if let Some(task) = stdout_task {
            let _ = task.await;
        }
        if let Some(task) = stderr_task {
            let _ = task.await;
        }
        self.active_children.lock().await.remove(&run_id);

        let was_canceled = canceled.load(Ordering::SeqCst);
        let buffered_text = buffered_output.lock().await.joined();
        let summary = adapter.parse_final(exit_code, &buffered_text);
        let _ = self
            .db
            .insert_artifact(&run_id, "parsed_summary", "", &summary);
        if settings.store_encrypted_raw_artifacts {
            let _ = self
                .persist_encrypted_raw_artifact(&run_id, &buffered_text)
                .await;
        }

        if was_canceled {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Canceled, exit_code, Some("Canceled by user"));
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.canceled", json!({ "exit_code": exit_code }))
                .await;
            return Ok(false);
        }

        if exit_code == Some(0) {
            let _ = self
                .db
                .update_run_status(&run_id, RunStatus::Completed, exit_code, None);
            let _ = self.db.mark_job_finished(&run_id, false);
            let _ = self
                .emit_event(&run_id, "run.completed", json!({ "exit_code": exit_code }))
                .await;
            Ok(false)
        } else {
            let error_message = format!("Process exited with {:?}", exit_code);
            if self
                .schedule_retry_if_eligible(&run_id, pending, &error_message)
                .await
                .unwrap_or(false)
            {
                Ok(false)
            } else {
                let _ = self
                    .fail_run(&run_id, exit_code, &error_message, false)
                    .await;
                Ok(true)
            }
        }
    }

    pub async fn cancel_run(&self, run_id: &str) -> AppResult<BooleanResponse> {
        if self.pending_runs.lock().await.remove(run_id).is_some() {
            self.db
                .update_run_status(run_id, RunStatus::Canceled, None, Some("Canceled before execution"))?;
            self.db.mark_job_finished(run_id, false)?;
            self.emit_event(run_id, "run.canceled", json!({ "queued": true }))
                .await?;
            return Ok(BooleanResponse { success: true });
        }

        let active = self.active_children.lock().await.remove(run_id);
        if let Some(active) = active {
            active.canceled.store(true, Ordering::SeqCst);
            let _ = self.terminate_active_process(active.process).await;

            self.db
                .update_run_status(run_id, RunStatus::Canceled, None, Some("Canceled by user"))?;
            self.db.mark_job_finished(run_id, false)?;
            self.emit_event(run_id, "run.canceled", json!({ "queued": false }))
                .await?;
            self.sessions.close_session(run_id).await;
            return Ok(BooleanResponse { success: true });
        }

        Ok(BooleanResponse { success: false })
    }

    async fn terminate_then_kill(&self, child: &mut Child) -> AppResult<()> {
        #[cfg(unix)]
        {
            use nix::sys::signal::{kill, Signal};
            use nix::unistd::Pid;
            if let Some(pid) = child.id() {
                let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
            }
        }

        #[cfg(windows)]
        {
            if let Some(pid) = child.id() {
                let _ = Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .spawn();
            }
        }

        if timeout(Duration::from_millis(1500), child.wait())
            .await
            .is_ok()
        {
            return Ok(());
        }

        let _ = child.start_kill();
        let _ = timeout(Duration::from_secs(2), child.wait()).await;
        Ok(())
    }

    async fn terminate_active_process(&self, process: ActiveProcess) -> AppResult<()> {
        match process {
            ActiveProcess::Tokio(child) => {
                let mut child = child.lock().await;
                self.terminate_then_kill(&mut child).await
            }
            ActiveProcess::Shell(child) => {
                let mut child = child.lock().await;
                if let Some(active) = child.take() {
                    let _ = active.kill();
                }
                Ok(())
            }
            ActiveProcess::Pty(killer) => {
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(mut killer) = killer.lock() {
                        let _ = killer.kill();
                    }
                })
                .await;
                Ok(())
            }
        }
    }

    pub async fn rerun(&self, run_id: &str, overrides: serde_json::Value) -> AppResult<RerunResponse> {
        let base = if let Some(payload) = self.run_payload_cache.lock().await.get(run_id).cloned() {
            payload
        } else {
            let run = self
                .db
                .get_run(run_id)?
                .ok_or_else(|| AppError::NotFound(format!("Run {} not found", run_id)))?;
            StartRunPayload {
                provider: run.provider,
                prompt: run.prompt,
                model: run.model,
                mode: run.mode,
                output_format: run.output_format,
                cwd: run.cwd,
                optional_flags: Default::default(),
                profile_id: run.profile_id,
                queue_priority: Some(run.queue_priority),
                timeout_seconds: Some(300),
                scheduled_at: None,
                max_retries: Some(0),
                retry_backoff_ms: Some(1_000),
            }
        };

        let mut merged = serde_json::to_value(base)?;
        merge_json(&mut merged, overrides);
        let payload: StartRunPayload = serde_json::from_value(merged)?;

        let response = self.start_run(payload).await?;
        Ok(RerunResponse {
            new_run_id: response.run_id,
        })
    }

    pub async fn send_session_input(&self, run_id: &str, data: String) -> AppResult<AcceptedResponse> {
        self.sessions.send_input(run_id, data).await?;
        Ok(AcceptedResponse { accepted: true })
    }

    pub async fn end_session(&self, run_id: &str) -> AppResult<BooleanResponse> {
        self.cancel_run(run_id).await
    }

    pub async fn resume_session(&self, run_id: &str) -> AppResult<StartInteractiveSessionResponse> {
        let run = self
            .db
            .get_run(run_id)?
            .ok_or_else(|| AppError::NotFound(format!("Run {} not found", run_id)))?;
        if run.mode != RunMode::Interactive {
            return Err(AppError::Policy("Run is not interactive".to_string()));
        }
        if let Some(snapshot_id) = run.capability_snapshot_id.as_deref() {
            if let Some(snapshot) = self.db.get_capability_snapshot_by_id(snapshot_id)? {
                if !snapshot.profile.supported_modes.contains(&RunMode::Interactive) {
                    return Err(AppError::Policy(format!(
                        "Interactive resume is disabled for CLI capability version {}",
                        snapshot.cli_version
                    )));
                }
            }
        }
        let session_id = self
            .sessions
            .session_id(run_id)
            .await
            .ok_or_else(|| AppError::NotFound("No active resumable session".to_string()))?;

        let replay = self
            .db
            .get_run_detail(run_id)?
            .map(|detail| {
                let mut lines = detail
                    .events
                    .into_iter()
                    .rev()
                    .filter_map(|event| {
                        if !matches!(event.event_type.as_str(), "run.chunk.stdout" | "run.chunk.stderr") {
                            return None;
                        }
                        event
                            .payload
                            .get("text")
                            .and_then(|value| value.as_str())
                            .map(ToString::to_string)
                    })
                    .take(50)
                    .collect::<Vec<_>>();
                lines.reverse();
                lines
            })
            .unwrap_or_default();

        self.emit_event(
            run_id,
            "run.progress",
            json!({
                "stage": "session_resumed",
                "sessionId": session_id,
                "replayLines": replay.len()
            }),
        )
        .await?;
        if !replay.is_empty() {
            for line in &replay {
                self.emit_event(
                    run_id,
                    "run.chunk.stdout",
                    json!({ "text": line, "replay": true }),
                )
                .await?;
            }
            self.emit_event(run_id, "run.progress", json!({ "stage": "session_replay_ready" }))
                .await?;
        }
        Ok(StartInteractiveSessionResponse {
            run_id: run_id.to_string(),
            session_id,
        })
    }

    pub fn get_run(&self, run_id: &str) -> AppResult<Option<RunDetail>> {
        self.db.get_run_detail(run_id)
    }

    pub fn list_runs(&self, filters: ListRunsFilters) -> AppResult<Vec<crate::models::RunRecord>> {
        self.db.list_runs(&filters)
    }

    pub fn list_profiles(&self) -> AppResult<Vec<Profile>> {
        self.db.list_profiles()
    }

    pub fn save_profile(&self, payload: SaveProfilePayload) -> AppResult<Profile> {
        self.db.save_profile(payload)
    }

    pub fn list_capabilities(&self) -> AppResult<Vec<CapabilitySnapshot>> {
        self.db.list_capability_snapshots()
    }

    pub async fn refresh_capabilities(&self) -> AppResult<Vec<CapabilitySnapshot>> {
        let settings = self.db.get_settings()?;
        let mut snapshots = Vec::with_capacity(2);
        for (provider, binary) in [
            (Provider::Codex, settings.codex_path.as_str()),
            (Provider::Claude, settings.claude_path.as_str()),
        ] {
            let profile = self.compatibility.detect_profile(provider, binary).await;
            let snapshot = CapabilitySnapshot {
                id: Uuid::new_v4().to_string(),
                provider,
                cli_version: profile.cli_version.clone(),
                profile,
                detected_at: Utc::now(),
            };
            self.db.insert_capability_snapshot(&snapshot)?;
            snapshots.push(snapshot);
        }
        Ok(snapshots)
    }

    pub fn list_queue_jobs(&self) -> AppResult<Vec<SchedulerJob>> {
        self.db.list_queue_jobs()
    }

    pub fn get_settings(&self) -> AppResult<AppSettings> {
        self.db.get_settings()
    }

    pub async fn update_settings(&self, settings: serde_json::Value) -> AppResult<AppSettings> {
        let updated = self.db.update_settings(settings)?;
        self.apply_runtime_settings(&updated).await;
        Ok(updated)
    }

    pub fn list_workspace_grants(&self) -> AppResult<Vec<WorkspaceGrant>> {
        self.db.list_workspace_grants()
    }

    pub fn grant_workspace(&self, path: &str) -> AppResult<WorkspaceGrant> {
        let canonical = canonicalize_absolute(path)?;
        self.db.grant_workspace(&canonical, "local-user")
    }

    pub fn export_run(&self, run_id: &str, format: &str) -> AppResult<ExportResponse> {
        let detail = self
            .db
            .get_run_detail(run_id)?
            .ok_or_else(|| AppError::NotFound(format!("Run {} not found", run_id)))?;

        let export_dir = self.app_data_dir.join("exports");
        std::fs::create_dir_all(&export_dir).map_err(|error| AppError::Io(error.to_string()))?;

        let format = match format {
            "md" | "json" | "txt" => format,
            _ => return Err(AppError::Io(format!("Unsupported export format {}", format))),
        };

        let safe_run_id = sanitize_filename_component(run_id);
        let output_path = export_dir.join(format!("{}.{}", safe_run_id, format));
        if !output_path.starts_with(&export_dir) {
            return Err(AppError::Io("Resolved export path escaped export directory".to_string()));
        }
        let contents = match format {
            "json" => serde_json::to_string_pretty(&detail)?,
            "md" => render_markdown_export(&detail),
            "txt" => render_text_export(&detail),
            _ => unreachable!(),
        };

        std::fs::write(&output_path, contents).map_err(|error| AppError::Io(error.to_string()))?;
        Ok(ExportResponse {
            path: output_path.to_string_lossy().to_string(),
        })
    }

    pub fn run_retention(&self) -> AppResult<()> {
        let settings = self.db.get_settings()?;
        self.db.run_retention_prune(&settings)
    }

    pub async fn save_provider_token(&self, provider: Provider, token: String) -> AppResult<BooleanResponse> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", provider.as_str())
            .map_err(|error| AppError::Io(error.to_string()))?;
        entry
            .set_password(&token)
            .map_err(|error| AppError::Io(error.to_string()))?;
        Ok(BooleanResponse { success: true })
    }

    pub async fn clear_provider_token(&self, provider: Provider) -> AppResult<BooleanResponse> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", provider.as_str())
            .map_err(|error| AppError::Io(error.to_string()))?;
        match entry.delete_credential() {
            Ok(_) => Ok(BooleanResponse { success: true }),
            Err(keyring::Error::NoEntry) => Ok(BooleanResponse { success: true }),
            Err(error) => Err(AppError::Io(error.to_string())),
        }
    }

    pub async fn has_provider_token(&self, provider: Provider) -> AppResult<BooleanResponse> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", provider.as_str())
            .map_err(|error| AppError::Io(error.to_string()))?;
        match entry.get_password() {
            Ok(value) => Ok(BooleanResponse {
                success: !value.is_empty(),
            }),
            Err(keyring::Error::NoEntry) => Ok(BooleanResponse { success: false }),
            Err(error) => Err(AppError::Io(error.to_string())),
        }
    }

    async fn schedule_retry_if_eligible(
        &self,
        run_id: &str,
        pending: &PendingRun,
        message: &str,
    ) -> AppResult<bool> {
        if pending.payload.mode == RunMode::Interactive {
            return Ok(false);
        }

        let Some(job) = self.db.get_queue_job(run_id)? else {
            return Ok(false);
        };

        if job.max_retries == 0 {
            return Ok(false);
        }

        // attempts is incremented in mark_job_running; retries are permitted while attempts <= max_retries
        if job.attempts > job.max_retries {
            return Ok(false);
        }

        let shift = job.attempts.saturating_sub(1);
        let multiplier: u64 = 1_u64.checked_shl(shift).unwrap_or(u64::MAX);
        let delay_ms = job.retry_backoff_ms.saturating_mul(multiplier).max(100);
        let next_run_at = Utc::now()
            + chrono::Duration::milliseconds(
                i64::try_from(delay_ms).unwrap_or(i64::MAX.saturating_sub(1)),
            );

        self.db.mark_job_retry(run_id, next_run_at, message)?;
        self.db.update_run_status(
            run_id,
            RunStatus::Queued,
            None,
            Some(&format!(
                "retry scheduled (attempt {}/{}) after failure: {}",
                job.attempts, job.max_retries, message
            )),
        )?;

        self.pending_runs.lock().await.insert(
            run_id.to_string(),
            PendingRun {
                payload: pending.payload.clone(),
                capability: pending.capability.clone(),
                binary_path: pending.binary_path.clone(),
                execution_path: pending.execution_path,
                session_input: None,
            },
        );

        if let Err(error) = self
            .scheduler
            .enqueue(ScheduledRun {
                run_id: run_id.to_string(),
                provider: pending.payload.provider,
                priority: pending.payload.queue_priority.unwrap_or_default(),
                queued_at: Utc::now(),
                not_before: next_run_at,
            })
            .await
        {
            self.pending_runs.lock().await.remove(run_id);
            return Err(AppError::Policy(error));
        }

        self.emit_event(
            run_id,
            "run.progress",
            json!({
                "stage": "retry_scheduled",
                "attempt": job.attempts,
                "maxRetries": job.max_retries,
                "nextRunAt": next_run_at,
                "message": message
            }),
        )
        .await?;

        Ok(true)
    }

    async fn fail_run(
        &self,
        run_id: &str,
        exit_code: Option<i32>,
        message: &str,
        close_session: bool,
    ) -> AppResult<()> {
        self.db
            .update_run_status(run_id, RunStatus::Failed, exit_code, Some(message))?;
        self.db.mark_job_finished(run_id, true)?;
        self.emit_event(
            run_id,
            "run.failed",
            json!({ "exit_code": exit_code, "message": message }),
        )
        .await?;
        if close_session {
            self.emit_event(run_id, "session.closed", json!({})).await?;
            self.sessions.close_session(run_id).await;
        }
        Ok(())
    }

    fn adapter_for(&self, provider: Provider) -> Arc<dyn Adapter> {
        match provider {
            Provider::Codex => self.codex.clone(),
            Provider::Claude => self.claude.clone(),
        }
    }

    async fn emit_redacted_stream(
        &self,
        run_id: &str,
        event_type: &str,
        raw_line: String,
        adapter: &dyn Adapter,
        stream: &str,
    ) -> AppResult<String> {
        let redactor = self.redactor.read().await;
        let redacted = redactor.redact(&raw_line);
        let redacted_text = redacted.content;

        let payload = json!({
            "text": redacted_text,
            "redaction_count": redacted.redaction_count,
        });

        self.emit_event(run_id, event_type, payload).await?;

        if let Some(progress) = adapter.parse_chunk(stream, &redacted_text) {
            self.emit_event(run_id, "run.progress", progress).await?;
        }
        if let Some((severity, message)) = detect_diagnostic_line(&redacted_text) {
            self.emit_event(
                run_id,
                "run.progress",
                json!({
                    "stage": "stream_diagnostic",
                    "severity": severity,
                    "stream": stream,
                    "message": message
                }),
            )
            .await?;
        }

        Ok(redacted_text)
    }

    async fn emit_event(&self, run_id: &str, event_type: &str, payload: serde_json::Value) -> AppResult<()> {
        let event = self.db.insert_event(run_id, event_type, &payload)?;

        let envelope = StreamEnvelope {
            run_id: run_id.to_string(),
            r#type: event_type.to_string(),
            payload,
            timestamp: event.created_at,
            event_id: event.id,
            seq: event.seq,
        };

        let app = self.app_handle.read().await;
        if let Some(handle) = app.as_ref() {
            let _ = handle.emit("run_event", envelope);
        }

        Ok(())
    }

    async fn apply_runtime_settings(&self, settings: &AppSettings) {
        let mut redactor = self.redactor.write().await;
        *redactor = Redactor::new(settings.redact_aggressive);
    }

    async fn get_or_create_artifact_key(&self) -> AppResult<[u8; 32]> {
        let _guard = self.keyring_lock.lock().await;
        let entry = keyring::Entry::new("local-cli-command-center", "artifact-encryption-key")
            .map_err(|error| AppError::Io(error.to_string()))?;

        if let Ok(value) = entry.get_password() {
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|error| AppError::Io(error.to_string()))?;
            if decoded.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&decoded);
                return Ok(key);
            }
        }

        let key: [u8; 32] = rand::random();
        let encoded = base64::engine::general_purpose::STANDARD.encode(key);
        entry
            .set_password(&encoded)
            .map_err(|error| AppError::Io(error.to_string()))?;
        Ok(key)
    }

    async fn persist_encrypted_raw_artifact(&self, run_id: &str, content: &str) -> AppResult<()> {
        if content.is_empty() {
            return Ok(());
        }

        let key = self.get_or_create_artifact_key().await?;
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|error| AppError::Io(error.to_string()))?;
        let nonce_bytes: [u8; 12] = rand::random();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let encrypted = cipher
            .encrypt(nonce, content.as_bytes())
            .map_err(|error| AppError::Io(error.to_string()))?;

        let artifact_dir = self.app_data_dir.join("artifacts");
        std::fs::create_dir_all(&artifact_dir).map_err(|error| AppError::Io(error.to_string()))?;
        let file_path = artifact_dir.join(format!("{}.enc.json", sanitize_filename_component(run_id)));
        let payload = serde_json::json!({
            "alg": "aes-256-gcm",
            "nonce": base64::engine::general_purpose::STANDARD.encode(nonce_bytes),
            "ciphertext": base64::engine::general_purpose::STANDARD.encode(encrypted)
        });
        std::fs::write(&file_path, serde_json::to_vec_pretty(&payload)?)
            .map_err(|error| AppError::Io(error.to_string()))?;

        self.db.insert_artifact(
            run_id,
            "raw_encrypted",
            &file_path.to_string_lossy(),
            &serde_json::json!({
                "algorithm": "aes-256-gcm",
                "bytes": content.len()
            }),
        )?;
        Ok(())
    }

    fn persist_session_transcript_artifact(&self, run_id: &str, content: &str) -> AppResult<()> {
        if content.is_empty() {
            return Ok(());
        }

        let artifact_dir = self.app_data_dir.join("artifacts");
        std::fs::create_dir_all(&artifact_dir).map_err(|error| AppError::Io(error.to_string()))?;
        let file_path = artifact_dir.join(format!(
            "{}-session.txt",
            sanitize_filename_component(run_id)
        ));
        std::fs::write(&file_path, content).map_err(|error| AppError::Io(error.to_string()))?;

        self.db.insert_artifact(
            run_id,
            "session_transcript",
            &file_path.to_string_lossy(),
            &serde_json::json!({
                "bytes": content.len()
            }),
        )?;
        Ok(())
    }

    fn apply_profile_if_selected(&self, payload: StartRunPayload) -> AppResult<StartRunPayload> {
        let Some(profile_id) = payload.profile_id.clone() else {
            return Ok(payload);
        };

        let profile = self
            .db
            .get_profile_by_id(&profile_id)?
            .ok_or_else(|| AppError::NotFound(format!("Profile {} not found", profile_id)))?;
        if profile.provider != payload.provider {
            return Err(AppError::Policy(format!(
                "Profile '{}' targets provider '{}' but run requested '{}'",
                profile.name,
                profile.provider.as_str(),
                payload.provider.as_str()
            )));
        }

        if !profile.config.is_object() {
            return Err(AppError::Policy(format!(
                "Profile '{}' config must be a JSON object",
                profile.name
            )));
        }

        let mut merged = profile.config.clone();
        merge_json_skip_null(&mut merged, serde_json::to_value(payload)?);
        let payload: StartRunPayload = serde_json::from_value(merged)?;
        Ok(payload)
    }

    fn resolve_binary_path(
        &self,
        provider: Provider,
        binary_path: &str,
        settings: &AppSettings,
    ) -> AppResult<(String, RunExecutionPath)> {
        let expected = match provider {
            Provider::Codex => "codex",
            Provider::Claude => "claude",
        };

        let candidate = Path::new(binary_path);
        if candidate.components().count() == 1 {
            if binary_path != expected {
                return Err(AppError::Policy(format!(
                    "Binary alias '{}' is not allowed for provider {}. Use '{}'.",
                    binary_path,
                    provider.as_str(),
                    expected
                )));
            }
            return Ok((expected.to_string(), RunExecutionPath::ScopedShellAlias));
        }

        if !candidate.is_absolute() {
            return Err(AppError::Policy(format!(
                "Binary path '{}' must be either '{}' alias or an absolute path",
                binary_path, expected
            )));
        }
        if !settings.allow_advanced_policy {
            return Err(AppError::Policy(
                "Absolute binary paths require advanced policy mode".to_string(),
            ));
        }

        let canonical = candidate.canonicalize().map_err(|error| {
            AppError::Policy(format!("Invalid binary path '{}': {}", binary_path, error))
        })?;
        if !canonical.is_file() {
            return Err(AppError::Policy(format!(
                "Binary path '{}' is not a file",
                binary_path
            )));
        }

        let basename = canonical
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if basename != expected {
            return Err(AppError::Policy(format!(
                "Binary path '{}' basename '{}' does not match provider expected '{}'",
                binary_path, basename, expected
            )));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = std::fs::metadata(&canonical)
                .map_err(|error| AppError::Policy(format!("Cannot read binary metadata: {}", error)))?;
            if metadata.permissions().mode() & 0o111 == 0 {
                return Err(AppError::Policy(format!(
                    "Binary path '{}' is not executable",
                    binary_path
                )));
            }
        }

        #[cfg(windows)]
        {
            let extension = canonical
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "exe" | "cmd" | "bat") {
                return Err(AppError::Policy(format!(
                    "Binary path '{}' must resolve to an .exe, .cmd, or .bat file",
                    binary_path
                )));
            }
        }

        Ok((
            canonical.to_string_lossy().to_string(),
            RunExecutionPath::VerifiedAbsolutePath,
        ))
    }
}

fn merge_json(target: &mut serde_json::Value, update: serde_json::Value) {
    match (target, update) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(update_map)) => {
            for (key, value) in update_map {
                merge_json(target_map.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (target, update) => {
            *target = update;
        }
    }
}

fn merge_json_skip_null(target: &mut serde_json::Value, update: serde_json::Value) {
    match (target, update) {
        (serde_json::Value::Object(target_map), serde_json::Value::Object(update_map)) => {
            for (key, value) in update_map {
                merge_json_skip_null(
                    target_map.entry(key).or_insert(serde_json::Value::Null),
                    value,
                );
            }
        }
        (_, serde_json::Value::Null) => {}
        (target, update) => {
            *target = update;
        }
    }
}

fn canonicalize_absolute(path: &str) -> AppResult<String> {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return Err(AppError::Policy(
            "Workspace grants require absolute paths".to_string(),
        ));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| AppError::Policy(format!("Unable to resolve workspace path: {}", error)))?;
    Ok(canonical.to_string_lossy().to_string())
}

fn sanitize_filename_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let candidate: String = out.trim_matches('_').chars().take(120).collect();
    if candidate.is_empty() {
        "run".to_string()
    } else {
        candidate
    }
}

fn sanitize_terminal_chunk(value: &str) -> String {
    let stripped = ANSI_ESCAPE_RE.replace_all(value, "");
    stripped.replace('\r', "")
}

fn detect_diagnostic_line(line: &str) -> Option<(&'static str, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.contains(" error") || lower.starts_with("error:") || lower.starts_with("fatal:") {
        return Some(("error", trimmed.to_string()));
    }
    if lower.contains(" warn") || lower.starts_with("warning:") || lower.starts_with("warn:") {
        return Some(("warning", trimmed.to_string()));
    }

    None
}

fn render_markdown_export(detail: &RunDetail) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Run {}\n\n", detail.run.id));
    out.push_str(&format!("- provider: {:?}\n", detail.run.provider));
    out.push_str(&format!("- status: {:?}\n", detail.run.status));
    out.push_str(&format!("- prompt: {}\n\n", detail.run.prompt));
    out.push_str("## Events\n\n");
    for event in &detail.events {
        out.push_str(&format!(
            "- `{}` `{}` `{}`\n",
            event.created_at,
            event.event_type,
            event.payload
        ));
    }
    out
}

fn render_text_export(detail: &RunDetail) -> String {
    let mut out = String::new();
    out.push_str(&format!("Run {}\n", detail.run.id));
    out.push_str(&format!("Status: {:?}\n", detail.run.status));
    out.push_str(&format!("Prompt: {}\n", detail.run.prompt));
    out.push_str("\nEvents:\n");
    for event in &detail.events {
        out.push_str(&format!("{} | {} | {}\n", event.created_at, event.event_type, event.payload));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{detect_diagnostic_line, RunExecutionPath, RunnerCore};
    use crate::models::{AppSettings, Provider, RunMode, SaveProfilePayload, StartRunPayload};
    use std::collections::BTreeMap;

    fn base_payload(provider: Provider) -> StartRunPayload {
        StartRunPayload {
            provider,
            prompt: "test prompt".to_string(),
            model: None,
            mode: RunMode::NonInteractive,
            output_format: Some("text".to_string()),
            cwd: std::env::temp_dir().to_string_lossy().to_string(),
            optional_flags: BTreeMap::new(),
            profile_id: None,
            queue_priority: Some(1),
            timeout_seconds: Some(300),
            scheduled_at: None,
            max_retries: Some(0),
            retry_backoff_ms: Some(1_000),
        }
    }

    #[tokio::test]
    async fn profile_merge_applies_defaults_without_overwriting_with_nulls() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");

        let profile = runner
            .save_profile(SaveProfilePayload {
                id: None,
                name: "codex-defaults".to_string(),
                provider: Provider::Codex,
                config: serde_json::json!({
                    "model": "gpt-5",
                    "timeoutSeconds": 42,
                    "queuePriority": -2,
                    "optionalFlags": {
                        "json": true
                    }
                }),
            })
            .expect("save profile");

        let mut payload = base_payload(Provider::Codex);
        payload.profile_id = Some(profile.id);
        payload.queue_priority = Some(3);
        payload.timeout_seconds = None;

        let merged = runner
            .apply_profile_if_selected(payload)
            .expect("profile merge");
        assert_eq!(merged.model.as_deref(), Some("gpt-5"));
        assert_eq!(merged.timeout_seconds, Some(42));
        assert_eq!(merged.queue_priority, Some(3));
        assert_eq!(merged.optional_flags.get("json"), Some(&serde_json::json!(true)));
    }

    #[tokio::test]
    async fn profile_provider_mismatch_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");

        let profile = runner
            .save_profile(SaveProfilePayload {
                id: None,
                name: "claude-profile".to_string(),
                provider: Provider::Claude,
                config: serde_json::json!({ "model": "claude-sonnet" }),
            })
            .expect("save profile");

        let mut payload = base_payload(Provider::Codex);
        payload.profile_id = Some(profile.id);

        let result = runner.apply_profile_if_selected(payload);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn binary_alias_uses_scoped_shell_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let settings = AppSettings::default();

        let (path, mode) = runner
            .resolve_binary_path(Provider::Codex, "codex", &settings)
            .expect("resolve");
        assert_eq!(path, "codex");
        assert_eq!(mode, RunExecutionPath::ScopedShellAlias);
    }

    #[tokio::test]
    async fn absolute_binary_requires_advanced_policy_mode() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let settings = AppSettings::default();
        let absolute = std::env::temp_dir().join("codex");
        let absolute = absolute.to_string_lossy().to_string();

        let result = runner.resolve_binary_path(Provider::Codex, &absolute, &settings);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn verified_absolute_binary_path_is_allowed_in_advanced_mode() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerCore::new(dir.path().to_path_buf()).expect("runner");
        let mut settings = AppSettings::default();
        settings.allow_advanced_policy = true;

        #[cfg(unix)]
        let binary = {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.path().join("codex");
            std::fs::write(&path, "#!/usr/bin/env bash\nexit 0\n").expect("write binary");
            let mut perms = std::fs::metadata(&path).expect("metadata").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms).expect("set perms");
            path
        };

        #[cfg(windows)]
        let binary = {
            let path = dir.path().join("codex.exe");
            std::fs::write(&path, "@echo off\r\nexit /B 0\r\n").expect("write binary");
            path
        };

        let binary_raw = binary.to_string_lossy().to_string();
        let (resolved, mode) = runner
            .resolve_binary_path(Provider::Codex, &binary_raw, &settings)
            .expect("resolve");

        assert_eq!(mode, RunExecutionPath::VerifiedAbsolutePath);
        assert_eq!(
            std::path::Path::new(&resolved),
            binary.canonicalize().expect("canonical").as_path()
        );
    }

    #[test]
    fn detects_warning_and_error_diagnostic_lines() {
        let warning = detect_diagnostic_line("Warning: model fell back");
        assert!(warning.is_some());
        assert_eq!(warning.expect("warning").0, "warning");

        let error = detect_diagnostic_line("ERROR: stream disconnected");
        assert!(error.is_some());
        assert_eq!(error.expect("error").0, "error");

        let none = detect_diagnostic_line("regular informational output");
        assert!(none.is_none());
    }
}
