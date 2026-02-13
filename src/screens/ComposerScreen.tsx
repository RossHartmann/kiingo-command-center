import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAppActions, useAppState } from "../state/appState";
import type { Provider, RunMode, StartRunPayload } from "../lib/types";

const INITIAL_FLAGS = "{}";

export function ComposerScreen(): JSX.Element {
  const actions = useAppActions();
  const state = useAppState();

  const [provider, setProvider] = useState<Provider>("codex");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<RunMode>("non-interactive");
  const [outputFormat, setOutputFormat] = useState<"text" | "json" | "stream-json">("text");
  const [cwd, setCwd] = useState("");
  const [priority, setPriority] = useState(0);
  const [timeoutSeconds, setTimeoutSeconds] = useState(300);
  const [scheduledAt, setScheduledAt] = useState("");
  const [maxRetries, setMaxRetries] = useState(0);
  const [retryBackoffMs, setRetryBackoffMs] = useState(1000);
  const [flagsText, setFlagsText] = useState(INITIAL_FLAGS);
  const [profileId, setProfileId] = useState<string>("");
  const [error, setError] = useState<string>();

  const suggestedWorkspaces = useMemo(() => {
    return state.workspaceGrants.filter((grant) => !grant.revokedAt).map((grant) => grant.path);
  }, [state.workspaceGrants]);
  const selectedProfile = useMemo(
    () => state.profiles.find((profile) => profile.id === profileId && profile.provider === provider),
    [profileId, provider, state.profiles]
  );

  useEffect(() => {
    if (!cwd.trim() && suggestedWorkspaces.length) {
      setCwd(suggestedWorkspaces[0]);
    }
  }, [cwd, suggestedWorkspaces]);

  useEffect(() => {
    if (!selectedProfile) {
      return;
    }
    const config = selectedProfile.config;
    if (typeof config.model === "string") {
      setModel(config.model);
    }
    if (config.mode === "non-interactive" || config.mode === "interactive") {
      setMode(config.mode);
    }
    if (config.outputFormat === "text" || config.outputFormat === "json" || config.outputFormat === "stream-json") {
      setOutputFormat(config.outputFormat);
    }
    if (typeof config.cwd === "string") {
      setCwd(config.cwd);
    }
    if (typeof config.queuePriority === "number") {
      setPriority(config.queuePriority);
    }
    if (typeof config.timeoutSeconds === "number") {
      setTimeoutSeconds(config.timeoutSeconds);
    }
    if (typeof config.scheduledAt === "string") {
      const parsed = new Date(config.scheduledAt);
      if (!Number.isNaN(parsed.valueOf())) {
        setScheduledAt(parsed.toISOString().slice(0, 16));
      }
    }
    if (typeof config.maxRetries === "number") {
      setMaxRetries(config.maxRetries);
    }
    if (typeof config.retryBackoffMs === "number") {
      setRetryBackoffMs(config.retryBackoffMs);
    }
    if (config.optionalFlags && typeof config.optionalFlags === "object") {
      setFlagsText(JSON.stringify(config.optionalFlags, null, 2));
    }
  }, [selectedProfile]);

  useEffect(() => {
    if (profileId && !state.profiles.some((profile) => profile.id === profileId && profile.provider === provider)) {
      setProfileId("");
    }
  }, [profileId, provider, state.profiles]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);

    let optionalFlags: Record<string, unknown> = {};
    try {
      optionalFlags = JSON.parse(flagsText);
    } catch {
      setError("Optional flags must be valid JSON.");
      return;
    }

    if (!prompt.trim()) {
      setError("Prompt is required.");
      return;
    }
    if (!cwd.trim()) {
      setError("Workspace path is required.");
      return;
    }

    const payload: StartRunPayload = {
      provider,
      prompt,
      model: model.trim() || undefined,
      mode,
      outputFormat,
      cwd,
      optionalFlags: optionalFlags as StartRunPayload["optionalFlags"],
      profileId: profileId || undefined,
      queuePriority: priority,
      timeoutSeconds,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      maxRetries,
      retryBackoffMs
    };

    if (mode === "interactive") {
      await actions.startInteractiveSession(payload);
    } else {
      await actions.startRun(payload);
    }
    await actions.refreshAll();
    setPrompt("");
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Run Composer</h2>
        <p>Run through adapters only. Arbitrary shell commands are never sent from the UI.</p>
      </div>

      <form className="card composer-grid" onSubmit={(event) => void submit(event)}>
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>

        <label>
          Model
          <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5 / claude-sonnet" />
        </label>

        <label>
          Run mode
          <select value={mode} onChange={(event) => setMode(event.target.value as RunMode)}>
            <option value="non-interactive">non-interactive</option>
            <option value="interactive">interactive</option>
          </select>
        </label>

        <label>
          Output format
          <select
            value={outputFormat}
            onChange={(event) => setOutputFormat(event.target.value as "text" | "json" | "stream-json")}
          >
            <option value="text">text</option>
            <option value="json">json</option>
            <option value="stream-json">stream-json</option>
          </select>
        </label>

        <label className="span-2">
          Workspace path
          <input
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            list="workspace-suggestions"
            placeholder="/path/to/workspace"
          />
          <datalist id="workspace-suggestions">
            {suggestedWorkspaces.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        </label>

        <label>
          Queue priority
          <input
            type="number"
            value={priority}
            min={-10}
            max={10}
            onChange={(event) => setPriority(Number(event.target.value))}
          />
        </label>

        <label>
          Timeout (seconds)
          <input
            type="number"
            value={timeoutSeconds}
            min={5}
            max={10800}
            onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
          />
        </label>

        <label>
          Scheduled start (optional)
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </label>

        <label>
          Max retries
          <input
            type="number"
            value={maxRetries}
            min={0}
            max={10}
            onChange={(event) => setMaxRetries(Number(event.target.value))}
          />
        </label>

        <label>
          Retry backoff (ms)
          <input
            type="number"
            value={retryBackoffMs}
            min={100}
            max={600000}
            onChange={(event) => setRetryBackoffMs(Number(event.target.value))}
          />
        </label>

        <label className="span-2">
          Profile override
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            <option value="">none</option>
            {state.profiles
              .filter((profile) => profile.provider === provider)
              .map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
          </select>
        </label>

        <label className="span-2">
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={8}
            placeholder="Describe what Codex/Claude should do"
          />
        </label>

        <label className="span-2">
          Optional allowlisted flags (JSON)
          <textarea value={flagsText} onChange={(event) => setFlagsText(event.target.value)} rows={5} />
        </label>

        {error && <div className="banner error span-2">{error}</div>}

        <div className="actions span-2">
          <button type="submit" className="primary">
            {mode === "interactive" ? "Start interactive session" : "Start queued run"}
          </button>
          <button type="button" onClick={() => void actions.refreshAll()}>
            Refresh state
          </button>
        </div>
      </form>
    </section>
  );
}
