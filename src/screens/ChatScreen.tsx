import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  claude: "opus"
};

type CodexReasoningLevel = "default" | "low" | "medium" | "high" | "xhigh";

function codexModelSupportsXhigh(model: string): boolean {
  return model.trim().toLowerCase() !== "gpt-5-codex";
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

function collapseSemanticAssistantText(detail: RunDetail): string {
  const semanticEvents = detail.events
    .filter((event) => event.eventType === "run.semantic")
    .slice()
    .sort((a, b) => a.seq - b.seq);

  let lastComplete: string | undefined;
  let deltaText = "";

  for (const event of semanticEvents) {
    const type = event.payload.type;
    const text = event.payload.text;
    if (typeof text !== "string" || text.length === 0) {
      continue;
    }
    if (type === "text_complete") {
      lastComplete = text;
      continue;
    }
    if (type === "text_delta") {
      deltaText += text;
    }
  }

  if (typeof lastComplete === "string" && lastComplete.trim().length > 0) {
    return lastComplete.trim();
  }

  return deltaText.trim();
}

function collapseCodexStdout(detail: RunDetail): string {
  const semanticText = collapseSemanticAssistantText(detail);
  if (semanticText) {
    return semanticText;
  }

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
    .map((event) => getMessageText(event.payload) ?? "")
    .filter((text) => text.trim().length > 0);
  if (!rawChunks.length) {
    return "";
  }
  const joined = rawChunks.join("\n");
  const normalized = joined.replace(/\r/g, "\n").trim();
  const half = Math.floor(normalized.length / 2);
  if (half > 100) {
    const left = normalized.slice(0, half).trim();
    const right = normalized.slice(half).trim();
    if (left.length > 0 && left === right) {
      return left;
    }
  }
  return normalized;
}

function collapseClaudeStdout(detail: RunDetail): string {
  const semanticText = collapseSemanticAssistantText(detail);
  if (semanticText) {
    return semanticText;
  }

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
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState("");
  const [modelsByProvider, setModelsByProvider] = useState<Record<Provider, string>>({
    codex: DEFAULT_CHAT_MODEL.codex,
    claude: DEFAULT_CHAT_MODEL.claude
  });
  const [codexReasoning, setCodexReasoning] = useState<CodexReasoningLevel>("default");
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [codexDetails, setCodexDetails] = useState<Record<string, RunDetail>>({});
  const [claudeDetails, setClaudeDetails] = useState<Record<string, RunDetail>>({});
  const autoCreateInFlight = useRef<Record<Provider, boolean>>({ codex: false, claude: false });
  const pendingChatHandled = useRef(false);

  const grantedWorkspaces = useMemo(() => {
    return state.workspaceGrants.filter((grant) => !grant.revokedAt).map((grant) => grant.path);
  }, [state.workspaceGrants]);
  const workspace = grantedWorkspaces[0] ?? "";

  const conversations = useMemo(() => {
    return state.conversations
      .filter((conversation) => conversation.provider === provider)
      .filter((conversation) => (showArchived ? Boolean(conversation.archivedAt) : !conversation.archivedAt))
      .slice()
      .sort((a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf());
  }, [provider, showArchived, state.conversations]);

  const selectedConversationId = state.selectedConversationByProvider[provider];
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId);
  const selectedDetail = selectedConversationId ? state.conversationDetails[selectedConversationId] : undefined;
  const conversationRuns = selectedDetail?.runs ?? [];

  useEffect(() => {
    if (pendingChatHandled.current) return;
    if (selectedConversationId && conversations.some((conversation) => conversation.id === selectedConversationId)) {
      return;
    }
    const fallback = conversations[0]?.id;
    if (!fallback && !selectedConversationId) {
      return;
    }
    if (fallback === selectedConversationId) {
      return;
    }
    void actions.selectConversation(provider, fallback);
  }, [actions, conversations, provider, selectedConversationId]);

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

  useEffect(() => {
    if (!state.settings?.conversationThreadsV1) {
      return;
    }
    if (showArchived) {
      return;
    }
    if (selectedConversationId || conversations.length > 0) {
      return;
    }
    if (autoCreateInFlight.current[provider]) {
      return;
    }
    autoCreateInFlight.current[provider] = true;
    void actions.createConversation(provider).finally(() => {
      autoCreateInFlight.current[provider] = false;
    });
  }, [actions, conversations.length, provider, selectedConversationId, showArchived, state.settings?.conversationThreadsV1]);

  useEffect(() => {
    const ctx = state.pendingChatContext;
    if (!ctx || pendingChatHandled.current) return;
    if (!workspace) return;
    pendingChatHandled.current = true;

    setProvider("claude");

    const capturedWorkspace = workspace;
    const capturedModel = modelsByProvider.claude.trim() || undefined;
    const capturedCtx = ctx;

    actions.setPendingChatContext(null);

    void (async () => {
      try {
        const title = capturedCtx.initialMessage.length > 60
          ? capturedCtx.initialMessage.slice(0, 57) + "..."
          : capturedCtx.initialMessage;
        const created = await actions.createConversation("claude", title);
        if (!created) return;

        const { runId } = await actions.sendConversationMessage({
          provider: "claude",
          conversationId: created.id,
          prompt: capturedCtx.initialMessage,
          model: capturedModel,
          outputFormat: "text",
          cwd: capturedWorkspace,
          ...(capturedCtx.systemPrompt ? { harness: { systemPrompt: capturedCtx.systemPrompt } } : {}),
          queuePriority: 0,
          timeoutSeconds: 300,
          maxRetries: 0,
          retryBackoffMs: 1000
        });

        await actions.selectConversation("claude", created.id);
        await actions.selectRun(runId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        pendingChatHandled.current = false;
      }
    })();
  }, [actions, modelsByProvider.claude, state.pendingChatContext, workspace]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }
    if (selectedDetail) {
      return;
    }
    void actions.selectConversation(provider, selectedConversationId);
  }, [actions, provider, selectedConversationId, selectedDetail]);

  const latestRun = conversationRuns[conversationRuns.length - 1];
  const awaitingHarness = useMemo(() => {
    return Boolean(latestRun && (latestRun.status === "queued" || latestRun.status === "running"));
  }, [latestRun]);
  const codexModelWarning = useMemo(() => {
    if (provider !== "codex") {
      return undefined;
    }
    const selectedModel = modelsByProvider.codex.trim().toLowerCase();
    for (const run of [...conversationRuns].reverse()) {
      if (run.status !== "failed") {
        continue;
      }
      const runModel = (run.model ?? "").trim().toLowerCase();
      if (selectedModel && runModel && runModel !== selectedModel) {
        continue;
      }
      const detail = state.runDetails[run.id] ?? codexDetails[run.id];
      const warning = codexModelWarningForRun(run, detail);
      if (warning) {
        return warning;
      }
    }
    return undefined;
  }, [codexDetails, conversationRuns, modelsByProvider.codex, provider, state.runDetails]);

  useEffect(() => {
    if (latestRun && state.selectedRunId !== latestRun.id) {
      void actions.selectRun(latestRun.id);
    }
  }, [actions, latestRun, state.selectedRunId]);

  useEffect(() => {
    const recent = conversationRuns.slice(-20);
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
  }, [claudeDetails, codexDetails, conversationRuns, provider, state.runDetails]);

  const messages = useMemo(() => {
    const details = provider === "codex" ? codexDetails : claudeDetails;
    const timeline: ChatMessage[] = [];

    for (const run of conversationRuns) {
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
  }, [claudeDetails, codexDetails, conversationRuns, provider, state.runDetails]);

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
      let targetConversationId = selectedConversationId;
      if (!targetConversationId) {
        const created = await actions.createConversation(provider, text);
        targetConversationId = created?.id;
      }
      if (!targetConversationId) {
        throw new Error("Unable to create or select a conversation.");
      }

      const optionalFlags: Record<string, unknown> = {};
      if (provider === "codex" && codexReasoning !== "default") {
        const modelName = modelsByProvider[provider].trim();
        if (codexReasoning === "xhigh" && !codexModelSupportsXhigh(modelName)) {
          throw new Error("x high reasoning is not supported by gpt-5-codex. Choose high or switch models.");
        }
        optionalFlags["reasoning-effort"] = codexReasoning;
      }

      const payload = {
        provider,
        conversationId: targetConversationId,
        prompt: text,
        model: modelsByProvider[provider].trim() || undefined,
        outputFormat: "text" as StartRunPayload["outputFormat"],
        cwd: workspace,
        optionalFlags,
        queuePriority: 0,
        timeoutSeconds: 300,
        maxRetries: 0,
        retryBackoffMs: 1000
      };
      const { runId } = await actions.sendConversationMessage(payload);
      await actions.selectRun(runId);
      await actions.selectConversation(provider, targetConversationId);
      setDraft("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSending(false);
    }
  }, [
    actions,
    codexReasoning,
    draft,
    modelsByProvider,
    provider,
    selectedConversationId,
    sending,
    workspace
  ]);

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
    setDraft("");
    setError(undefined);
    await actions.createConversation(provider);
  }

  async function selectConversation(conversationId: string): Promise<void> {
    await actions.selectConversation(provider, conversationId);
  }

  async function archiveCurrentConversation(): Promise<void> {
    if (!selectedConversationId) {
      return;
    }
    await actions.archiveConversation(selectedConversationId, provider, true);
  }

  async function restoreCurrentConversation(): Promise<void> {
    if (!selectedConversationId) {
      return;
    }
    await actions.archiveConversation(selectedConversationId, provider, false);
    setShowArchived(false);
    await actions.selectConversation(provider, selectedConversationId);
  }

  async function renameCurrentConversation(): Promise<void> {
    if (!selectedConversationId) {
      return;
    }
    const next = window.prompt("Rename conversation", selectedConversation?.title ?? "");
    if (!next || !next.trim()) {
      return;
    }
    await actions.renameConversation(selectedConversationId, next.trim(), provider);
  }

  return (
    <section className="screen chat-screen">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-header">
          <strong>Chats</strong>
          <div className="chat-sidebar-actions">
            <button type="button" className="new-chat-btn" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? "Active" : "Archived"}
            </button>
            <button type="button" className="new-chat-btn" onClick={() => void startNewChat()} disabled={showArchived}>
              New chat
            </button>
          </div>
        </div>
        <div className="chat-sidebar-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={`chat-thread ${conversation.id === selectedConversationId ? "active" : ""}`}
              onClick={() => void selectConversation(conversation.id)}
            >
              <span className="chat-thread-title">{conversation.title}</span>
              <small>
                {conversation.archivedAt ? "Archived" : new Date(conversation.updatedAt).toLocaleTimeString()}
              </small>
            </button>
          ))}
          {!conversations.length && (
            <p className="settings-hint">{showArchived ? "No archived chats." : "No chats yet."}</p>
          )}
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-header-row">
          <div>
            <strong>{selectedConversation?.title ?? "New chat"}</strong>
            {selectedConversation?.providerSessionId && (
              <span className="workspace-label">session connected</span>
            )}
          </div>
          {selectedConversationId && (
            <div className="chat-header-actions">
              <button type="button" onClick={() => void renameCurrentConversation()}>Rename</button>
              {selectedConversation?.archivedAt ? (
                <button type="button" onClick={() => void restoreCurrentConversation()}>Restore</button>
              ) : (
                <button type="button" onClick={() => void archiveCurrentConversation()}>Archive</button>
              )}
            </div>
          )}
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
        {!workspace && (
          <div className="banner info">No workspace configured. Add one in Settings.</div>
        )}

        <form className="chat-input" onSubmit={(event) => void submit(event)}>
          <div className="chat-input-row">
            <select
              className="model-select"
              value={provider}
              onChange={(event) => setProvider(event.target.value as Provider)}
              aria-label="Provider"
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
            <input
              className="model-select model-input"
              type="text"
              list={`model-options-${provider}`}
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
            <datalist id={`model-options-${provider}`}>
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
              <span className="workspace-label">
                reasoning: {codexReasoning === "default" ? "default" : codexReasoning}
              </span>
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
