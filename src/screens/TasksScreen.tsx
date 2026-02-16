import { FormEvent, useEffect, useMemo, useState } from "react";
import { conditionsList, obsidianTasksSync } from "../lib/tauriClient";
import type { AtomRecord, ConditionRecord, TaskStatus } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "doing", "blocked", "done"];

function priorityLabel(priority: number): string {
  if (priority <= 1) return "P1";
  if (priority === 2) return "P2";
  if (priority === 3) return "P3";
  if (priority === 4) return "P4";
  return "P5";
}

function taskTitle(atom: AtomRecord): string {
  const fallback = atom.rawText.trim();
  return atom.facetData.task?.title ?? (fallback || "Untitled");
}

function conditionPriority(condition: ConditionRecord): number {
  if (condition.mode === "person") return 0;
  if (condition.mode === "task") return 1;
  if (condition.mode === "date") return 2;
  return 99;
}

function overlayLabel(condition: ConditionRecord): string {
  if (condition.mode === "person") {
    return condition.waitingOnPerson ? `Waiting on ${condition.waitingOnPerson}` : "Waiting";
  }
  if (condition.mode === "task") {
    return condition.blockerAtomId ? `Blocked by ${condition.blockerAtomId}` : "Blocked";
  }
  if (condition.mode === "date") {
    return condition.blockedUntil
      ? `Snoozed until ${new Date(condition.blockedUntil).toLocaleString()}`
      : "Snoozed";
  }
  return "Blocked";
}

function waitingLabel(conditions: ConditionRecord[] | undefined): string {
  if (!conditions || conditions.length === 0) {
    return "Blocked";
  }
  return overlayLabel(conditions[0]);
}

export function TasksScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const [draft, setDraft] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [creating, setCreating] = useState(false);
  const [busyAtomId, setBusyAtomId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const [activeConditionsByAtomId, setActiveConditionsByAtomId] = useState<Record<string, ConditionRecord[]>>({});

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async (): Promise<void> => {
      await actions.loadWorkspaceAtoms();
      await actions.loadWorkspaceNotepads();
    };

    const loadConditions = async (): Promise<void> => {
      const byAtomId: Record<string, ConditionRecord[]> = {};
      let cursor: string | undefined;
      for (;;) {
        const page = await conditionsList({ status: "active", limit: 250, cursor });
        for (const condition of page.items) {
          if (!byAtomId[condition.atomId]) {
            byAtomId[condition.atomId] = [];
          }
          byAtomId[condition.atomId].push(condition);
        }
        if (!page.nextCursor) {
          break;
        }
        cursor = page.nextCursor;
      }
      for (const atomId of Object.keys(byAtomId)) {
        byAtomId[atomId].sort((a, b) => conditionPriority(a) - conditionPriority(b));
      }
      if (!cancelled) {
        setActiveConditionsByAtomId(byAtomId);
      }
    };

    const sync = async (): Promise<void> => {
      setSyncing(true);
      try {
        await obsidianTasksSync();
        if (!cancelled) {
          await actions.loadWorkspaceAtoms();
          await loadConditions();
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to sync tasks from Obsidian");
        }
      } finally {
        if (!cancelled) {
          setSyncing(false);
        }
      }
    };

    void loadWorkspace().then(loadConditions);
    void sync();
    return () => {
      cancelled = true;
    };
  }, [actions]);

  const tasks = useMemo(() => {
    return [...state.workspaceAtoms].sort((a, b) => {
      const pa = a.facetData.task?.priority ?? 99;
      const pb = b.facetData.task?.priority ?? 99;
      if (pa !== pb) return pa - pb;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [state.workspaceAtoms]);

  const waitingAtomIds = new Set(Object.keys(activeConditionsByAtomId));

  const active = tasks.filter((atom) => {
    const status = atom.facetData.task?.status;
    return status !== "done" && status !== "archived" && !waitingAtomIds.has(atom.id);
  });
  const waiting = tasks.filter((atom) => {
    const status = atom.facetData.task?.status;
    return status !== "done" && status !== "archived" && waitingAtomIds.has(atom.id);
  });
  const done = tasks.filter((atom) => atom.facetData.task?.status === "done").slice(0, 50);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft.trim() || creating) return;
    setCreating(true);
    setError(undefined);
    try {
      await actions.createWorkspaceAtom({
        rawText: draft.trim(),
        captureSource: "ui",
        initialFacets: ["task"],
        facetData: {
          task: {
            title: draft.trim(),
            status: "todo",
            priority
          }
        }
      });
      setDraft("");
      setPriority(3);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to create task");
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(atom: AtomRecord, status: TaskStatus): Promise<void> {
    if (!atom.facetData.task || busyAtomId) return;
    setBusyAtomId(atom.id);
    setError(undefined);
    try {
      await actions.setWorkspaceTaskStatus(atom.id, {
        expectedRevision: atom.revision,
        status
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update task");
    } finally {
      setBusyAtomId(null);
    }
  }

  async function archive(atom: AtomRecord): Promise<void> {
    if (busyAtomId) return;
    setBusyAtomId(atom.id);
    setError(undefined);
    try {
      await actions.archiveWorkspaceAtom(atom.id, {
        expectedRevision: atom.revision,
        reason: "user_archive"
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to archive task");
    } finally {
      setBusyAtomId(null);
    }
  }

  return (
    <section className="tasks-screen">
      <form className="tasks-create" onSubmit={(event) => void submit(event)}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Capture a task"
          aria-label="Task title"
        />
        <label>
          Priority
          <select value={priority} onChange={(event) => setPriority(Number(event.target.value) as 1 | 2 | 3 | 4 | 5)}>
            <option value={1}>P1</option>
            <option value={2}>P2</option>
            <option value={3}>P3</option>
            <option value={4}>P4</option>
            <option value={5}>P5</option>
          </select>
        </label>
        <button type="submit" className="primary" disabled={creating || !draft.trim()}>
          {creating ? "Adding..." : "Add Task"}
        </button>
      </form>

      {error && <div className="banner error">{error}</div>}
      {syncing && <div className="banner info">Syncing tasks from Obsidian...</div>}

      <div className="tasks-columns">
        <div className="tasks-column">
          <h3>Active ({active.length})</h3>
          {active.length === 0 && <p className="settings-hint">No active tasks.</p>}
          {active.map((atom) => (
            <article key={atom.id} className="tasks-card">
              <div className="tasks-card-main">
                <strong>{taskTitle(atom)}</strong>
                <small>
                  {priorityLabel(atom.facetData.task?.priority ?? 3)} · Updated {new Date(atom.updatedAt).toLocaleString()}
                </small>
              </div>
              <div className="tasks-card-actions">
                <select
                  value={atom.facetData.task?.status ?? "todo"}
                  onChange={(event) => void setStatus(atom, event.target.value as TaskStatus)}
                  disabled={busyAtomId === atom.id}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void archive(atom)} disabled={busyAtomId === atom.id}>
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="tasks-column">
          <h3>Waiting ({waiting.length})</h3>
          {waiting.length === 0 && <p className="settings-hint">No waiting tasks.</p>}
          {waiting.map((atom) => (
            <article key={atom.id} className="tasks-card waiting">
              <div className="tasks-card-main">
                <strong>{taskTitle(atom)}</strong>
                <small>{waitingLabel(activeConditionsByAtomId[atom.id])}</small>
              </div>
              <div className="tasks-card-actions">
                <select
                  value={atom.facetData.task?.status ?? "blocked"}
                  onChange={(event) => void setStatus(atom, event.target.value as TaskStatus)}
                  disabled={busyAtomId === atom.id}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => void archive(atom)} disabled={busyAtomId === atom.id}>
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="tasks-column">
          <h3>Done ({done.length})</h3>
          {done.length === 0 && <p className="settings-hint">No completed tasks yet.</p>}
          {done.map((atom) => (
            <article key={atom.id} className="tasks-card done">
              <div className="tasks-card-main">
                <strong>{taskTitle(atom)}</strong>
                <small>
                  {atom.facetData.task?.completedAt
                    ? `Completed ${new Date(atom.facetData.task.completedAt).toLocaleString()}`
                    : `Updated ${new Date(atom.updatedAt).toLocaleString()}`}
                </small>
              </div>
              <div className="tasks-card-actions">
                <button
                  type="button"
                  onClick={() =>
                    void setStatus(atom, atom.facetData.task?.status === "blocked" ? "blocked" : "todo")
                  }
                  disabled={busyAtomId === atom.id}
                >
                  Reopen
                </button>
                <button type="button" onClick={() => void archive(atom)} disabled={busyAtomId === atom.id}>
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
