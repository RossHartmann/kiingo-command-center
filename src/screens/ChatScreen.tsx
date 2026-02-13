import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getRun, startRun as startRunDirect } from "../lib/tauriClient";
import type { Provider, RunDetail, StartRunPayload } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  kind?: "loading";
}

function nowIso(): string {
  return new Date().toISOString();
}

function getMessageText(payload: Record<string, unknown>): string | undefined {
  const value = payload.text;
  return typeof value === "string" ? value : undefined;
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function extractCodexSessionId(detail: RunDetail): string | undefined {
  const stdoutEvents = detail.events.filter((event) => event.eventType === "run.chunk.stdout");
  for (const event of stdoutEvents) {
    const text = getMessageText(event.payload);
    if (!text) {
      continue;
    }
    for (const line of text.split("\n")) {
      const parsed = parseJsonLine(line);
      if (!parsed || parsed.type !== "thread.started") {
        continue;
      }
      const threadId = parsed.thread_id;
      if (typeof threadId === "string" && threadId.trim()) {
        return threadId.trim();
      }
    }
  }

  const stderrEvents = detail.events.filter((event) => event.eventType === "run.chunk.stderr");
  for (const event of stderrEvents) {
    const text = getMessageText(event.payload);
    if (!text) {
      continue;
    }
    const matched = text.match(/session id:\s*([0-9a-fA-F-]{36})/);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  return undefined;
}

function extractClaudeSessionId(detail: RunDetail): string | undefined {
  const stdoutEvents = detail.events.filter((event) => event.eventType === "run.chunk.stdout");
  for (const event of stdoutEvents) {
    const text = getMessageText(event.payload);
    if (!text) {
      continue;
    }
    for (const line of text.split("\n")) {
      const parsed = parseJsonLine(line);
      if (!parsed) {
        continue;
      }
      const sessionId = parsed.session_id;
      if (typeof sessionId === "string" && sessionId.trim()) {
        return sessionId.trim();
      }
    }
  }
  return undefined;
}

function collapseCodexStdout(detail: RunDetail): string {
  const stdoutEvents = detail.events.filter((event) => event.eventType === "run.chunk.stdout");
  const agentMessages: string[] = [];
  for (const event of stdoutEvents) {
    const text = getMessageText(event.payload);
    if (!text) {
      continue;
    }
    for (const line of text.split("\n")) {
      const parsed = parseJsonLine(line);
      if (!parsed || parsed.type !== "item.completed") {
        continue;
      }
      const item = parsed.item;
      if (!item || typeof item !== "object") {
        continue;
      }
      const typedItem = item as Record<string, unknown>;
      if (typedItem.type !== "agent_message") {
        continue;
      }
      const message = typedItem.text;
      if (typeof message === "string" && message.trim()) {
        agentMessages.push(message.trim());
      }
    }
  }
  if (agentMessages.length) {
    return [...new Set(agentMessages)].join("\n\n");
  }

  const rawChunks = stdoutEvents
    .map((event) => getMessageText(event.payload)?.trimEnd() ?? "")
    .filter((text) => text.trim().length > 0);
  const collapsedLines: string[] = [];
  let firstLine: string | undefined;
  let stopAtDuplicatePass = false;

  for (const chunk of rawChunks) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const line of lines) {
      if (!firstLine) {
        firstLine = line;
      }
      if (collapsedLines.length > 0 && firstLine && line.includes(firstLine) && line !== firstLine) {
        const markerIndex = line.indexOf(firstLine);
        if (markerIndex > 0) {
          const prefix = line.slice(0, markerIndex).trim();
          if (prefix && !collapsedLines.includes(prefix)) {
            collapsedLines.push(prefix);
          }
        }
        stopAtDuplicatePass = true;
        break;
      }
      if (line === firstLine && collapsedLines.length > 1) {
        stopAtDuplicatePass = true;
        break;
      }
      if (!collapsedLines.includes(line)) {
        collapsedLines.push(line);
      }
    }
    if (stopAtDuplicatePass) {
      break;
    }
  }

  return collapsedLines.join("\n").trim();
}

function collapseClaudeStdout(detail: RunDetail): string {
  const stdoutEvents = detail.events.filter((event) => event.eventType === "run.chunk.stdout");
  let resultText: string | undefined;
  const assistantTexts: string[] = [];

  for (const event of stdoutEvents) {
    const text = getMessageText(event.payload);
    if (!text) {
      continue;
    }

    for (const line of text.split("\n")) {
      const parsed = parseJsonLine(line);
      if (!parsed) {
        continue;
      }

      if (parsed.type === "result") {
        const result = parsed.result;
        if (typeof result === "string" && result.trim()) {
          resultText = result.trim();
        }
        continue;
      }

      if (parsed.type !== "assistant") {
        continue;
      }

      const message = parsed.message;
      if (!message || typeof message !== "object") {
        continue;
      }
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }
        const typedPart = part as { type?: unknown; text?: unknown };
        if (typedPart.type !== "text") {
          continue;
        }
        if (typeof typedPart.text === "string" && typedPart.text.trim()) {
          assistantTexts.push(typedPart.text.trim());
        }
      }
    }
  }

  if (resultText) {
    return resultText;
  }
  if (assistantTexts.length) {
    return [...new Set(assistantTexts)].join("\n\n");
  }
  return "";
}

function failedMessageFromDetail(detail: RunDetail): string | undefined {
  const failedEvent = detail.events.find((event) => event.eventType === "run.failed");
  const message = failedEvent?.payload.message;
  if (typeof message === "string" && message.trim()) {
    return `Error: ${message}`;
  }
  return undefined;
}

export function ChatScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [provider, setProvider] = useState<Provider>("codex");
  const [chatBoundaries, setChatBoundaries] = useState<Record<Provider, string | null>>({
    codex: null,
    claude: null
  });
  const [draft, setDraft] = useState("");
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [codexDetails, setCodexDetails] = useState<Record<string, RunDetail>>({});
  const [claudeDetails, setClaudeDetails] = useState<Record<string, RunDetail>>({});

  const grantedWorkspaces = useMemo(() => {
    return state.workspaceGrants.filter((grant) => !grant.revokedAt).map((grant) => grant.path);
  }, [state.workspaceGrants]);
  const workspace = grantedWorkspaces[0] ?? "";

  const chatBoundary = chatBoundaries[provider];

  const providerRuns = useMemo(() => {
    return state.runs
      .filter((run) => run.provider === provider && run.mode === "non-interactive")
      .filter((run) => !chatBoundary || new Date(run.startedAt).valueOf() >= new Date(chatBoundary).valueOf())
      .slice()
      .sort((a, b) => new Date(a.startedAt).valueOf() - new Date(b.startedAt).valueOf());
  }, [chatBoundary, provider, state.runs]);

  const latestRun = providerRuns[providerRuns.length - 1];

  const awaitingHarness = useMemo(() => {
    return Boolean(latestRun && (latestRun.status === "queued" || latestRun.status === "running"));
  }, [latestRun]);

  useEffect(() => {
    if (latestRun && state.selectedRunId !== latestRun.id) {
      void actions.selectRun(latestRun.id);
    }
  }, [actions, latestRun, state.selectedRunId]);

  useEffect(() => {
    const recent = providerRuns.slice(-20);
    const localDetails = provider === "codex" ? codexDetails : claudeDetails;
    const missingIds = recent
      .map((run) => run.id)
      .filter((runId) => !state.runDetails[runId] && !localDetails[runId]);
    if (!missingIds.length) {
      return;
    }

    let cancelled = false;
    void Promise.all(
      missingIds.map(async (runId) => {
        const loaded = await getRun(runId);
        return [runId, loaded] as const;
      })
    ).then((results) => {
      if (cancelled) {
        return;
      }
      if (provider === "codex") {
        setCodexDetails((previous) => {
          const next = { ...previous };
          for (const [runId, loaded] of results) {
            if (loaded) {
              next[runId] = loaded;
            }
          }
          return next;
        });
      } else {
        setClaudeDetails((previous) => {
          const next = { ...previous };
          for (const [runId, loaded] of results) {
            if (loaded) {
              next[runId] = loaded;
            }
          }
          return next;
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [claudeDetails, codexDetails, provider, providerRuns, state.runDetails]);

  const messages = useMemo(() => {
    const details = provider === "codex" ? codexDetails : claudeDetails;
    const timeline: ChatMessage[] = [];

    for (const run of providerRuns) {
      timeline.push({
        id: `prompt-${run.id}`,
        role: "user",
        text: run.prompt,
        timestamp: run.startedAt
      });

      const runDetail = state.runDetails[run.id] ?? details[run.id];
      const collapsed = runDetail
        ? provider === "codex"
          ? collapseCodexStdout(runDetail)
          : collapseClaudeStdout(runDetail)
        : "";

      if (collapsed) {
        timeline.push({
          id: `assistant-${run.id}`,
          role: "assistant",
          text: collapsed,
          timestamp: run.endedAt ?? run.startedAt
        });
        continue;
      }

      if (run.status === "failed") {
        const failureText =
          (runDetail ? failedMessageFromDetail(runDetail) : undefined) ??
          (run.errorSummary ? `Error: ${run.errorSummary}` : "Error: Run failed");
        timeline.push({
          id: `failed-${run.id}`,
          role: "assistant",
          text: failureText,
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
        continue;
      }

      if (run.status === "completed" && !runDetail) {
        timeline.push({
          id: `loading-${run.id}`,
          role: "assistant",
          text: "Loading response...",
          timestamp: run.endedAt ?? run.startedAt
        });
      }
    }

    return timeline;
  }, [claudeDetails, codexDetails, provider, providerRuns, state.runDetails]);

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
      const previousRun = providerRuns[providerRuns.length - 1];
      const details = provider === "codex" ? codexDetails : claudeDetails;
      const previousDetail = previousRun ? state.runDetails[previousRun.id] ?? details[previousRun.id] : undefined;
      const resumeSessionId = previousDetail
        ? provider === "codex"
          ? extractCodexSessionId(previousDetail)
          : extractClaudeSessionId(previousDetail)
        : undefined;

      const payload: StartRunPayload = {
        provider,
        prompt: text,
        model: undefined,
        mode: "non-interactive",
        outputFormat: "text",
        cwd: workspace,
        optionalFlags: resumeSessionId ? { __resume_session_id: resumeSessionId } : {},
        queuePriority: 0,
        timeoutSeconds: 300,
        maxRetries: 0,
        retryBackoffMs: 1000
      };
      const { runId } = await startRunDirect(payload);
      await actions.refreshAll();
      await actions.selectRun(runId);
      setDraft("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSending(false);
    }
  }, [actions, claudeDetails, codexDetails, draft, provider, providerRuns, sending, state.runDetails, workspace]);

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

  async function startNewChat(): Promise<void> {
    const boundary = nowIso();
    setChatBoundaries((previous) => ({
      ...previous,
      [provider]: boundary
    }));
    setDraft("");
    setError(undefined);
    await actions.selectRun(undefined);
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Chat</h2>
        <p>Talk directly to Codex or Claude with minimal setup.</p>
      </div>

      <div className="card chat-shell">
        <div className="chat-toolbar">
          <label>
            Model
            <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label>
            Workspace
            <input value={workspace} readOnly />
          </label>
          <button type="button" onClick={() => void startNewChat()}>
            New chat
          </button>
        </div>

        <div className="chat-messages" aria-live="polite">
          {!messages.length && <div className="chat-empty">Start by sending a message below.</div>}
          {messages.map((message) => (
            <article key={message.id} className={`chat-bubble ${message.role}${message.kind ? ` ${message.kind}` : ""}`}>
              <header>
                <strong>{message.role === "user" ? "You" : provider === "codex" ? "Codex" : "Claude"}</strong>
                <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
              </header>
              {message.kind === "loading" ? (
                <div className="harness-loading inline" role="status" aria-live="polite">
                  <div className="harness-loading-head">
                    <strong>Waiting for harness response</strong>
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
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

        <form className="chat-input" onSubmit={(event) => void submit(event)}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setCtrlHeld(false)}
            rows={4}
            placeholder="Message the model..."
          />
          <div className="actions">
            <div className={`shortcut-hint${ctrlHeld ? " ready" : ""}`} aria-live="polite">
              <span>Send shortcut</span>
              <kbd>Ctrl/Cmd</kbd>
              <span>+</span>
              <kbd>Enter</kbd>
              <strong>{ctrlHeld ? "Ready" : "Idle"}</strong>
            </div>
            <button type="submit" className="primary" disabled={sending || !workspace || awaitingHarness}>
              {sending ? "Sending..." : awaitingHarness ? "Awaiting response..." : "Send"}
            </button>
          </div>
        </form>

        {error && <div className="banner error">{error}</div>}
        {!workspace && (
          <div className="banner info">No workspace grant is configured yet. Open Settings and add one.</div>
        )}
        {latestRun && (
          <small>
            Run status: <strong>{latestRun.status}</strong>
          </small>
        )}
      </div>
    </section>
  );
}
