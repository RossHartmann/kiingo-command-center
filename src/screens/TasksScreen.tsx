import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AtomRecord, TaskStatus } from "../lib/types";
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

export function TasksScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const [draft, setDraft] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [creating, setCreating] = useState(false);
  const [busyAtomId, setBusyAtomId] = useState<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void actions.loadWorkspaceAtoms();
    void actions.loadWorkspaceNotepads();
  }, [actions]);

  const tasks = useMemo(() => {
    return [...state.workspaceAtoms].sort((a, b) => {
      const pa = a.facetData.task?.priority ?? 99;
      const pb = b.facetData.task?.priority ?? 99;
      if (pa !== pb) return pa - pb;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [state.workspaceAtoms]);

  const active = tasks.filter((atom) => {
    const status = atom.facetData.task?.status;
    return status !== "done" && status !== "archived";
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
