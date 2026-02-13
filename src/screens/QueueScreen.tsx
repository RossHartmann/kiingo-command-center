import { useMemo } from "react";
import { useAppState } from "../state/appState";

export function QueueScreen(): JSX.Element {
  const state = useAppState();

  const grouped = useMemo(() => {
    return {
      queued: state.queueJobs.filter((job) => job.state === "queued"),
      running: state.queueJobs.filter((job) => job.state === "running"),
      terminal: state.queueJobs.filter((job) => job.state === "completed" || job.state === "failed")
    };
  }, [state.queueJobs]);

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Queue and Concurrency</h2>
        <p>Weighted priority scheduling, bounded queue visibility, and active resource usage.</p>
      </div>

      <div className="queue-columns">
        <div className="card">
          <h3>Queued</h3>
          {grouped.queued.map((job) => (
            <QueueRow job={job} label="queued" at={job.nextRunAt ?? job.queuedAt} />
          ))}
          {!grouped.queued.length && <small>No queued jobs.</small>}
        </div>

        <div className="card">
          <h3>Running</h3>
          {grouped.running.map((job) => (
            <QueueRow job={job} label="running" at={job.startedAt ?? job.queuedAt} />
          ))}
          {!grouped.running.length && <small>No active jobs.</small>}
        </div>

        <div className="card">
          <h3>Completed / Failed</h3>
          {grouped.terminal.map((job) => (
            <QueueRow job={job} label={job.state} at={job.finishedAt ?? job.queuedAt} />
          ))}
          {!grouped.terminal.length && <small>No terminal jobs yet.</small>}
        </div>
      </div>
    </section>
  );
}

function QueueRow(props: { label: string; at: string; job: { runId: string; priority: number; attempts: number; maxRetries: number; lastError?: string } }): JSX.Element {
  return (
    <article className="queue-row">
      <header>
        <strong>{props.label}</strong>
        <span>prio {props.job.priority}</span>
      </header>
      <code>{props.job.runId}</code>
      <small>
        attempts {props.job.attempts}/{props.job.maxRetries + 1}
      </small>
      {props.job.lastError && <small>last error: {props.job.lastError}</small>}
      <small>{new Date(props.at).toLocaleString()}</small>
    </article>
  );
}
