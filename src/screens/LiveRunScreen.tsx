import { FormEvent, useMemo, useState } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { exportRun } from "../lib/tauriClient";

export function LiveRunScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [sessionInput, setSessionInput] = useState("");
  const [exportPath, setExportPath] = useState<string>();
  const [sessionInfo, setSessionInfo] = useState<string>();

  const selectedRun = useMemo(() => {
    if (state.selectedRunId) {
      return state.runs.find((run) => run.id === state.selectedRunId);
    }
    return state.runs[0];
  }, [state.runs, state.selectedRunId]);

  const detail = selectedRun ? state.runDetails[selectedRun.id] : undefined;
  const capability = useMemo(() => {
    if (!selectedRun?.capabilitySnapshotId) {
      return undefined;
    }
    return state.capabilities.find((snapshot) => snapshot.id === selectedRun.capabilitySnapshotId);
  }, [selectedRun?.capabilitySnapshotId, state.capabilities]);

  async function sendInput(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedRun) {
      return;
    }
    const text = sessionInput.trim();
    if (!text) {
      return;
    }
    await actions.sendSessionInput(selectedRun.id, text);
    setSessionInfo(`Sent ${text.length} chars to session input.`);
    setSessionInput("");
  }

  async function onExport(format: "md" | "json" | "txt"): Promise<void> {
    if (!selectedRun) {
      return;
    }
    const result = await exportRun(selectedRun.id, format);
    setExportPath(result.path);
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Live Run View</h2>
        <p>Streaming output, cancellation, retries, and interactive session IO.</p>
      </div>

      <div className="card live-layout">
        <label>
          Active run
          <select
            value={selectedRun?.id ?? ""}
            onChange={(event) => void actions.selectRun(event.target.value || undefined)}
          >
            {state.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.provider} | {run.status} | {run.prompt.slice(0, 48)}
              </option>
            ))}
          </select>
        </label>

        {!selectedRun && <div className="banner info">No runs available.</div>}

        {selectedRun && (
          <>
            <div className="meta-grid">
              <div>
                <strong>Status</strong>
                <span>{selectedRun.status}</span>
              </div>
              <div>
                <strong>Provider</strong>
                <span>{selectedRun.provider}</span>
              </div>
              <div>
                <strong>Mode</strong>
                <span>{selectedRun.mode}</span>
              </div>
              <div>
                <strong>Exit code</strong>
                <span>{selectedRun.exitCode ?? "-"}</span>
              </div>
              <div>
                <strong>Profile</strong>
                <span>{selectedRun.profileId ?? "-"}</span>
              </div>
              <div>
                <strong>Capability</strong>
                <span>{capability ? `${capability.provider} ${capability.cliVersion}` : "-"}</span>
              </div>
            </div>

            <div className="actions">
              <button type="button" onClick={() => void actions.cancelRun(selectedRun.id)}>
                Cancel run
              </button>
              <button type="button" onClick={() => void actions.rerun(selectedRun.id, {})}>
                Retry run
              </button>
              <button type="button" onClick={() => void onExport("md")}>Export .md</button>
              <button type="button" onClick={() => void onExport("json")}>Export .json</button>
              <button type="button" onClick={() => void onExport("txt")}>Export .txt</button>
            </div>

            {exportPath && <div className="banner info">Exported to {exportPath}</div>}

            <div className="terminal-panel" aria-live="polite">
              {(detail?.events ?? []).map((event) => (
                <div key={event.id} className={`terminal-line ${event.eventType.includes("stderr") ? "stderr" : "stdout"}`}>
                  <span className="timestamp">{new Date(event.createdAt).toLocaleTimeString()}</span>
                  <span>{event.eventType}</span>
                  <EventPayload eventType={event.eventType} payload={event.payload} />
                </div>
              ))}
              {!detail?.events?.length && <div className="terminal-line">No stream events yet.</div>}
            </div>

            {selectedRun.mode === "interactive" && (
              <form className="session-form" onSubmit={(event) => void sendInput(event)}>
                <label>
                  Session input
                  <textarea
                    value={sessionInput}
                    onChange={(event) => setSessionInput(event.target.value)}
                    rows={4}
                    placeholder="Send input to interactive process"
                  />
                </label>
                <div className="actions">
                  <button type="submit" className="primary">
                    Send input
                  </button>
                  <button type="button" onClick={() => void actions.resumeSession(selectedRun.id)}>
                    Resume session
                  </button>
                  <button type="button" onClick={() => void actions.endSession(selectedRun.id)}>
                    End session
                  </button>
                </div>
              </form>
            )}

            {sessionInfo && <div className="banner info">{sessionInfo}</div>}
          </>
        )}
      </div>
    </section>
  );
}

function EventPayload(props: { eventType: string; payload: Record<string, unknown> }): JSX.Element {
  const text = typeof props.payload.text === "string" ? props.payload.text : undefined;
  const stage = typeof props.payload.stage === "string" ? props.payload.stage : undefined;
  const structured = props.payload.structured;
  const semanticType = typeof props.payload.type === "string" ? props.payload.type : undefined;
  const semanticMessage = typeof props.payload.message === "string" ? props.payload.message : undefined;

  if (text && props.eventType.startsWith("run.chunk")) {
    return <pre>{text}</pre>;
  }
  if (props.eventType === "run.semantic") {
    return (
      <pre>
        {semanticType ?? "semantic"}{semanticMessage ? `: ${semanticMessage}` : ""}
        {"\n"}
        {JSON.stringify(props.payload, null, 2)}
      </pre>
    );
  }
  if (props.eventType === "run.warning" || props.eventType === "run.cli_missing" || props.eventType === "run.cwd_missing") {
    return <code>{JSON.stringify(props.payload)}</code>;
  }
  if (props.eventType === "run.runner_metrics") {
    return <pre>{JSON.stringify(props.payload, null, 2)}</pre>;
  }
  if (structured && typeof structured === "object") {
    return <pre>{JSON.stringify(structured, null, 2)}</pre>;
  }
  if (stage && props.eventType === "run.progress") {
    const message = typeof props.payload.message === "string" ? props.payload.message : undefined;
    return (
      <code>
        {stage}
        {message ? `: ${message}` : ""}
      </code>
    );
  }
  if (text) {
    return <code>{text}</code>;
  }
  return <code>{JSON.stringify(props.payload)}</code>;
}
