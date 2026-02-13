import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Provider, StartRunPayload } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

interface PendingInitialMessage {
  id: string;
  provider: Provider;
  text: string;
  timestamp: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getMessageText(payload: Record<string, unknown>): string | undefined {
  const value = payload.text;
  return typeof value === "string" ? value : undefined;
}

export function ChatScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [provider, setProvider] = useState<Provider>("codex");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingInitial, setPendingInitial] = useState<PendingInitialMessage | null>(null);
  const [userMessagesByRun, setUserMessagesByRun] = useState<Record<string, ChatMessage[]>>({});

  const grantedWorkspaces = useMemo(() => {
    return state.workspaceGrants.filter((grant) => !grant.revokedAt).map((grant) => grant.path);
  }, [state.workspaceGrants]);
  const workspace = grantedWorkspaces[0] ?? "";

  const activeRun = useMemo(() => {
    return state.runs.find(
      (run) =>
        run.provider === provider &&
        run.mode === "interactive" &&
        (run.status === "running" || run.status === "queued")
    );
  }, [provider, state.runs]);

  const latestRun = useMemo(() => {
    return state.runs.find((run) => run.provider === provider && run.mode === "interactive");
  }, [provider, state.runs]);

  const chatRun = activeRun ?? latestRun;
  const detail = chatRun ? state.runDetails[chatRun.id] : undefined;

  useEffect(() => {
    if (chatRun && state.selectedRunId !== chatRun.id) {
      void actions.selectRun(chatRun.id);
    }
  }, [actions, chatRun, state.selectedRunId]);

  useEffect(() => {
    if (!pendingInitial || !chatRun || pendingInitial.provider !== provider) {
      return;
    }
    setUserMessagesByRun((prev) => {
      const existing = prev[chatRun.id] ?? [];
      if (existing.some((message) => message.id === pendingInitial.id)) {
        return prev;
      }
      return {
        ...prev,
        [chatRun.id]: [
          ...existing,
          {
            id: pendingInitial.id,
            role: "user",
            text: pendingInitial.text,
            timestamp: pendingInitial.timestamp
          }
        ]
      };
    });
    setPendingInitial(null);
  }, [chatRun, pendingInitial, provider]);

  const assistantMessages = useMemo(() => {
    if (!detail) {
      return [] as ChatMessage[];
    }
    return detail.events.reduce<ChatMessage[]>((messages, event) => {
      if (!(event.eventType === "run.chunk.stdout" || event.eventType === "run.chunk.stderr")) {
        return messages;
      }
        const text = getMessageText(event.payload);
      if (!text) {
        return messages;
        }
      messages.push({
          id: event.id,
          role: "assistant" as const,
          text,
          timestamp: event.createdAt
      });
      return messages;
    }, []);
  }, [detail]);

  const userMessages = chatRun ? userMessagesByRun[chatRun.id] ?? [] : [];

  const messages = useMemo(() => {
    return [...userMessages, ...assistantMessages].sort((a, b) => {
      return new Date(a.timestamp).valueOf() - new Date(b.timestamp).valueOf();
    });
  }, [assistantMessages, userMessages]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
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
      if (activeRun) {
        const userMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          text,
          timestamp: nowIso()
        };
        setUserMessagesByRun((prev) => ({
          ...prev,
          [activeRun.id]: [...(prev[activeRun.id] ?? []), userMessage]
        }));
        await actions.sendSessionInput(activeRun.id, text);
      } else {
        setPendingInitial({
          id: crypto.randomUUID(),
          provider,
          text,
          timestamp: nowIso()
        });
        const payload: StartRunPayload = {
          provider,
          prompt: text,
          model: undefined,
          mode: "interactive",
          outputFormat: "text",
          cwd: workspace,
          optionalFlags: {},
          queuePriority: 0,
          timeoutSeconds: 10800,
          maxRetries: 0,
          retryBackoffMs: 1000
        };
        await actions.startInteractiveSession(payload);
      }
      setDraft("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSending(false);
    }
  }

  async function startNewChat(): Promise<void> {
    setError(undefined);
    if (activeRun) {
      await actions.endSession(activeRun.id);
      return;
    }
    if (chatRun) {
      await actions.selectRun(undefined);
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Chat</h2>
        <p>Talk directly to Codex or Claude in a continuous interactive session.</p>
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
          {!messages.length && (
            <div className="chat-empty">
              Start by sending a message below. A session will be created automatically.
            </div>
          )}
          {messages.map((message) => (
            <article key={message.id} className={`chat-bubble ${message.role}`}>
              <header>
                <strong>{message.role === "user" ? "You" : provider === "codex" ? "Codex" : "Claude"}</strong>
                <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
              </header>
              <p>{message.text}</p>
            </article>
          ))}
        </div>

        <form className="chat-input" onSubmit={(event) => void submit(event)}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="Message the model..."
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={sending || !workspace}>
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>

        {error && <div className="banner error">{error}</div>}
        {!workspace && (
          <div className="banner info">
            No workspace grant is configured yet. Open Settings and add one.
          </div>
        )}
        {chatRun && (
          <small>
            Session status: <strong>{chatRun.status}</strong>
          </small>
        )}
      </div>
    </section>
  );
}
