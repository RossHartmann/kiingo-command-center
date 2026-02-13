import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getRun } from "../lib/tauriClient";
import type { Provider, RunDetail, RunRecord, StartRunPayload } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  kind?: "loading";
}

const MODEL_OPTIONS: Record<Provider, string[]> = {
  codex: ["gpt-5.3-codex", "gpt-5-codex", "gpt-5.3", "gpt-5"],
  claude: ["sonnet", "opus", "haiku"]
};

const DEFAULT_CHAT_MODEL: Record<Provider, string> = {
  codex: "gpt-5.3-codex",
  claude: "sonnet"
};

type CodexReasoningLevel = "default" | "low" | "medium" | "high" | "xhigh";

function codexModelSupportsXhigh(model: string): boolean {
  return model.trim().toLowerCase() !== "gpt-5-codex";
}

function detectCodexModelWarning(text: string): string | undefined {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("does not exist or you do not have access") ||
    (normalized.includes("model") && normalized.includes("does not exist")) ||
    normalized.includes("you do not have access to it")
  ) {
    return "Selected model may not be enabled for this account. Try updating Codex CLI or switch models.";
  }
  return undefined;
}

function detailTextCorpus(detail: RunDetail): string {
  const chunks: string[] = [];
  for (const event of detail.events) {
    if (typeof event.payload.text === "string") {
      chunks.push(event.payload.text);
    }
    if (typeof event.payload.message === "string") {
      chunks.push(event.payload.message);
    }
    if (event.eventType === "run.semantic" && typeof event.payload.detail === "object" && event.payload.detail) {
      try {
        chunks.push(JSON.stringify(event.payload.detail));
      } catch {
        // ignore
      }
    }
  }
  return chunks.join("\n");
}

function codexModelWarningForRun(run: RunRecord, detail?: RunDetail): string | undefined {
  const summaryWarning = run.errorSummary ? detectCodexModelWarning(run.errorSummary) : undefined;
  if (summaryWarning) {
    return summaryWarning;
  }
  if (!detail) {
    return undefined;
  }
  return detectCodexModelWarning(detailTextCorpus(detail));
}

function semanticText(detail: RunDetail): string {
  const semanticEvents = detail.events
    .filter((event) => event.eventType === "run.semantic")
    .slice()
    .sort((a, b) => a.seq - b.seq);

  let complete = "";
  let deltas = "";
  for (const event of semanticEvents) {
    const type = event.payload.type;
    const text = event.payload.text;
    if (typeof text !== "string" || text.length === 0) {
      continue;
    }
    if (type === "text_complete") {
      complete = text;
      continue;
    }
    if (type === "text_delta") {
      deltas += text;
    }
  }
  return (complete || deltas).trim();
}

function stdoutText(detail: RunDetail): string {
  const joined = detail.events
    .filter((event) => event.eventType === "run.chunk.stdout")
    .map((event) => event.payload.text)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!joined) {
    return "";
  }

  const half = Math.floor(joined.length / 2);
  if (half > 100) {
    const left = joined.slice(0, half).trim();
    const right = joined.slice(half).trim();
    if (left.length > 0 && left === right) {
      return left;
    }
  }

  return joined;
}

function collapseAssistant(detail: RunDetail): string {
  return semanticText(detail) || stdoutText(detail);
}

function failureFromDetail(detail: RunDetail): string | undefined {
  const failedEvent = detail.events.find((event) => event.eventType === "run.failed");
  const message = failedEvent?.payload.message;
  if (typeof message === "string" && message.trim()) {
    return `Error: ${message}`;
  }
  return undefined;
}

export function LegacyChatScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [provider, setProvider] = useState<Provider>("codex");
  const [draft, setDraft] = useState("");
  const [modelsByProvider, setModelsByProvider] = useState<Record<Provider, string>>({
    codex: DEFAULT_CHAT_MODEL.codex,
    claude: DEFAULT_CHAT_MODEL.claude
  });
  const [codexReasoning, setCodexReasoning] = useState<CodexReasoningLevel>("default");
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [details, setDetails] = useState<Record<string, RunDetail>>({});

  const grantedWorkspaces = useMemo(() => {
    return state.workspaceGrants.filter((grant) => !grant.revokedAt).map((grant) => grant.path);
  }, [state.workspaceGrants]);
  const workspace = grantedWorkspaces[0] ?? "";

  const runs = useMemo(() => {
    return state.runs
      .filter((run) => run.provider === provider && run.mode === "non-interactive")
      .slice()
      .sort((a, b) => new Date(a.startedAt).valueOf() - new Date(b.startedAt).valueOf())
      .slice(-80);
  }, [provider, state.runs]);

  const latestRun = runs[runs.length - 1];
  const awaitingHarness = Boolean(latestRun && (latestRun.status === "queued" || latestRun.status === "running"));
  const codexModelWarning = useMemo(() => {
    if (provider !== "codex") {
      return undefined;
    }
    const selectedModel = modelsByProvider.codex.trim().toLowerCase();
    for (const run of [...runs].reverse()) {
      if (run.status !== "failed") {
        continue;
      }
      const runModel = (run.model ?? "").trim().toLowerCase();
      if (selectedModel && runModel && runModel !== selectedModel) {
        continue;
      }
      const detail = state.runDetails[run.id] ?? details[run.id];
      const warning = codexModelWarningForRun(run, detail);
      if (warning) {
        return warning;
      }
    }
    return undefined;
  }, [details, modelsByProvider.codex, provider, runs, state.runDetails]);

  useEffect(() => {
    const recent = runs.slice(-20);
    const missing = recent.map((run) => run.id).filter((runId) => !state.runDetails[runId] && !details[runId]);
    if (!missing.length) {
      return;
    }
    let cancelled = false;
    void Promise.all(missing.map((runId) => getRun(runId).then((loaded) => [runId, loaded] as const))).then((results) => {
      if (cancelled) {
        return;
      }
      setDetails((previous) => {
        const next = { ...previous };
        for (const [runId, loaded] of results) {
          if (loaded) {
            next[runId] = loaded;
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [details, runs, state.runDetails]);

  useEffect(() => {
    if (provider !== "codex") {
      return;
    }
    if (codexReasoning !== "xhigh") {
      return;
    }
    if (codexModelSupportsXhigh(modelsByProvider.codex)) {
      return;
    }
    setCodexReasoning("high");
  }, [codexReasoning, modelsByProvider.codex, provider]);

  const messages = useMemo(() => {
    const timeline: ChatMessage[] = [];
    for (const run of runs) {
      timeline.push({
        id: `prompt-${run.id}`,
        role: "user",
        text: run.prompt,
        timestamp: run.startedAt
      });
      const detail = state.runDetails[run.id] ?? details[run.id];
      const assistant = detail ? collapseAssistant(detail) : "";
      if (assistant) {
        timeline.push({
          id: `assistant-${run.id}`,
          role: "assistant",
          text: assistant,
          timestamp: run.endedAt ?? run.startedAt
        });
        continue;
      }
      if (run.status === "failed") {
        timeline.push({
          id: `failed-${run.id}`,
          role: "assistant",
          text: (detail ? failureFromDetail(detail) : undefined) ?? `Error: ${run.errorSummary ?? "Run failed"}`,
          timestamp: run.endedAt ?? run.startedAt
        });
        continue;
      }
      if (run.status === "queued" || run.status === "running") {
        timeline.push({
          id: `pending-${run.id}`,
          role: "assistant",
          text: "",
          timestamp: run.startedAt,
          kind: "loading"
        });
      }
    }
    return timeline;
  }, [details, runs, state.runDetails]);

  const submitCurrentDraft = useCallback(async (): Promise<void> => {
    if (sending) {
      return;
    }
    const text = draft.trim();
    if (!text) {
      return;
    }
    if (!workspace) {
      setError("No workspace grant found. Add one in Settings.");
      return;
    }

    setSending(true);
    setError(undefined);
    try {
      const optionalFlags: Record<string, unknown> = {};
      if (provider === "codex" && codexReasoning !== "default") {
        const modelName = modelsByProvider[provider].trim();
        if (codexReasoning === "xhigh" && !codexModelSupportsXhigh(modelName)) {
          throw new Error("x high reasoning is not supported by gpt-5-codex. Choose high or switch models.");
        }
        optionalFlags["reasoning-effort"] = codexReasoning;
      }

      await actions.startRun({
        provider,
        prompt: text,
        model: modelsByProvider[provider].trim() || undefined,
        mode: "non-interactive",
        outputFormat: "text" as StartRunPayload["outputFormat"],
        cwd: workspace,
        optionalFlags,
        queuePriority: 0,
        timeoutSeconds: 300,
        maxRetries: 0,
        retryBackoffMs: 1000
      });
      setDraft("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSending(false);
    }
  }, [actions, codexReasoning, draft, modelsByProvider, provider, sending, workspace]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await submitCurrentDraft();
  }

  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey) {
        setCtrlHeld(true);
      }
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey) || event.repeat || event.isComposing) {
        return;
      }
      event.preventDefault();
      void submitCurrentDraft();
    }

    function onWindowKeyUp(event: KeyboardEvent): void {
      if (event.key === "Control" || event.key === "Meta" || (!event.ctrlKey && !event.metaKey)) {
        setCtrlHeld(false);
      }
    }

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("keyup", onWindowKeyUp);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("keyup", onWindowKeyUp);
    };
  }, [submitCurrentDraft]);

  return (
    <section className="screen chat-screen legacy-chat-screen">
      <div className="chat-main">
        <div className="chat-header-row">
          <div>
            <strong>Classic chat mode</strong>
            <span className="workspace-label">conversation threads are disabled</span>
          </div>
        </div>

        <div className="chat-messages" aria-live="polite">
          {!messages.length && (
            <div className="chat-empty">
              <p>Send a message to get started.</p>
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`chat-bubble ${message.role}${message.kind ? ` ${message.kind}` : ""}`}>
              <header>
                <strong>{message.role === "user" ? "You" : provider === "codex" ? "Codex" : "Claude"}</strong>
                <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
              </header>
              {message.kind === "loading" ? (
                <div className="harness-loading inline" role="status" aria-live="polite">
                  <div className="harness-loading-head">
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    <span>Thinking...</span>
                  </div>
                  <div className="harness-progress" aria-hidden="true">
                    <span />
                  </div>
                </div>
              ) : (
                <p>{message.text}</p>
              )}
            </article>
          ))}
        </div>

        {error && <div className="banner error">{error}</div>}
        {!workspace && <div className="banner info">No workspace configured. Add one in Settings.</div>}

        <form className="chat-input" onSubmit={(event) => void submit(event)}>
          <div className="chat-input-row">
            <select className="model-select" value={provider} onChange={(event) => setProvider(event.target.value as Provider)} aria-label="Provider">
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
            <input
              className="model-select model-input"
              type="text"
              list={`legacy-model-options-${provider}`}
              value={modelsByProvider[provider]}
              onChange={(event) =>
                setModelsByProvider((previous) => ({
                  ...previous,
                  [provider]: event.target.value
                }))
              }
              placeholder={DEFAULT_CHAT_MODEL[provider]}
              aria-label="Model"
              spellCheck={false}
              autoComplete="off"
            />
            {provider === "codex" && codexModelWarning && (
              <span className="model-warning-sign" title={codexModelWarning} aria-label={codexModelWarning}>
                ⚠
              </span>
            )}
            <datalist id={`legacy-model-options-${provider}`}>
              {MODEL_OPTIONS[provider].map((modelName) => (
                <option key={modelName} value={modelName} />
              ))}
            </datalist>
            {provider === "codex" && (
              <select
                className="model-select reasoning-select"
                value={codexReasoning}
                onChange={(event) => setCodexReasoning(event.target.value as CodexReasoningLevel)}
                aria-label="Codex reasoning level"
              >
                <option value="default">reasoning: default</option>
                <option value="low">reasoning: low</option>
                <option value="medium">reasoning: medium</option>
                <option value="high">reasoning: high</option>
                <option
                  value="xhigh"
                  disabled={!codexModelSupportsXhigh(modelsByProvider.codex)}
                >
                  reasoning: x high
                </option>
              </select>
            )}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                const composing = (event.nativeEvent as { isComposing?: boolean }).isComposing === true;
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.repeat && !composing) {
                  event.preventDefault();
                  void submitCurrentDraft();
                }
              }}
              onBlur={() => setCtrlHeld(false)}
              rows={2}
              placeholder="Message..."
            />
            <button type="submit" className="primary send-btn" disabled={sending || !workspace || awaitingHarness}>
              {sending ? "..." : awaitingHarness ? "..." : "\u2191"}
            </button>
          </div>
          <div className="chat-input-meta">
            <span className="workspace-label">model: {modelsByProvider[provider].trim() || "default"}</span>
            {provider === "codex" && (
              <span className="workspace-label">reasoning: {codexReasoning === "default" ? "default" : codexReasoning}</span>
            )}
            {provider === "codex" && codexModelWarning && (
              <span className="workspace-label warning-chip">{codexModelWarning}</span>
            )}
            <span className="workspace-label">{ctrlHeld ? "Release Ctrl/Cmd to type newline" : "Ctrl/Cmd + Enter sends"}</span>
            {workspace && <span className="workspace-label">{workspace.split("/").pop()}</span>}
          </div>
        </form>
      </div>
    </section>
  );
}
