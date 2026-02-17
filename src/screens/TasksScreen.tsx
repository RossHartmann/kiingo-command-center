import { useEffect, useMemo, useState } from "react";
import { conditionsList, obsidianTasksSync } from "../lib/tauriClient";
import type { AtomRecord, ConditionRecord, TaskStatus } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "doing", "blocked", "done"];
const TASKS_SHOW_PROJECTION_INFO_KEY = "tasks.disclosure.showProjectionInfo";
const TASKS_SECTION_COLLAPSE_KEY = "tasks.disclosure.collapsedSections";
const TASKS_HINT_DISMISSED_KEY = "tasks.disclosure.hintDismissed";

interface TasksSectionCollapseState {
  active: boolean;
  waiting: boolean;
  done: boolean;
}

function loadTasksBoolPreference(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window.localStorage.getItem(key);
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function loadTasksSectionCollapsePreference(): TasksSectionCollapseState {
  if (typeof window === "undefined") {
    return { active: false, waiting: true, done: true };
  }
  const value = window.localStorage.getItem(TASKS_SECTION_COLLAPSE_KEY);
  if (!value) {
    return { active: false, waiting: true, done: true };
  }
  try {
    const parsed = JSON.parse(value) as Partial<TasksSectionCollapseState>;
    return {
      active: parsed.active ?? false,
      waiting: parsed.waiting ?? true,
      done: parsed.done ?? true
    };
  } catch {
    return { active: false, waiting: true, done: true };
  }
}

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

function projectLabel(atom: AtomRecord): string | undefined {
  const categories = atom.facetData.meta?.categories?.filter((value) => value.trim().length > 0) ?? [];
  if (categories.length === 0) {
    return undefined;
  }
  return categories.join(" / ");
}

export function TasksScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const [busyAtomId, setBusyAtomId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const [activeConditionsByAtomId, setActiveConditionsByAtomId] = useState<Record<string, ConditionRecord[]>>({});
  const [showProjectionInfo, setShowProjectionInfo] = useState<boolean>(() =>
    loadTasksBoolPreference(TASKS_SHOW_PROJECTION_INFO_KEY, false)
  );
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<TasksSectionCollapseState>(() =>
    loadTasksSectionCollapsePreference()
  );
  const [hintDismissed, setHintDismissed] = useState<boolean>(() =>
    loadTasksBoolPreference(TASKS_HINT_DISMISSED_KEY, false)
  );

  const dismissHint = (): void => {
    if (!hintDismissed) {
      setHintDismissed(true);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TASKS_SHOW_PROJECTION_INFO_KEY, String(showProjectionInfo));
  }, [showProjectionInfo]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TASKS_SECTION_COLLAPSE_KEY, JSON.stringify(collapsedSections));
  }, [collapsedSections]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(TASKS_HINT_DISMISSED_KEY, String(hintDismissed));
  }, [hintDismissed]);

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

    void loadWorkspace().then(loadConditions).catch((nextError) => {
      if (!cancelled) {
        setError(nextError instanceof Error ? nextError.message : "Failed to load task projection");
      }
    });

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

  async function refreshProjection(): Promise<void> {
    setSyncing(true);
    setError(undefined);
    try {
      await obsidianTasksSync();
      await actions.loadWorkspaceAtoms();
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
      setActiveConditionsByAtomId(byAtomId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to refresh tasks projection");
    } finally {
      setSyncing(false);
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

  function toggleSection(section: keyof TasksSectionCollapseState): void {
    dismissHint();
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function renderTaskCard(atom: AtomRecord, section: "active" | "waiting" | "done"): JSX.Element {
    const expanded = expandedTaskId === atom.id;
    const project = projectLabel(atom);
    const taskStatus = atom.facetData.task?.status ?? (section === "done" ? "done" : section === "waiting" ? "blocked" : "todo");
    return (
      <article key={atom.id} className={`tasks-card${section === "done" ? " done" : ""}${section === "waiting" ? " waiting" : ""}`}>
        <div className="tasks-card-main">
          <strong>{taskTitle(atom)}</strong>
          <small className={`tasks-status-pill tasks-status-${taskStatus}`}>Status: {taskStatus}</small>
        </div>
        <button
          type="button"
          className={`tasks-card-more${expanded ? " primary" : ""}`}
          onClick={() => {
            dismissHint();
            setExpandedTaskId((current) => (current === atom.id ? null : atom.id));
          }}
          aria-expanded={expanded}
        >
          {expanded ? "Hide" : "More"}
        </button>
        {expanded && (
          <div className="tasks-card-disclosure">
            <div className="tasks-card-meta">
              {section === "waiting" ? (
                <small>{waitingLabel(activeConditionsByAtomId[atom.id])}</small>
              ) : section === "done" ? (
                <small>
                  {atom.facetData.task?.completedAt
                    ? `Completed ${new Date(atom.facetData.task.completedAt).toLocaleString()}`
                    : `Updated ${new Date(atom.updatedAt).toLocaleString()}`}
                </small>
              ) : (
                <small>
                  {priorityLabel(atom.facetData.task?.priority ?? 3)} · Updated {new Date(atom.updatedAt).toLocaleString()}
                </small>
              )}
              {project && <small>Project: {project}</small>}
            </div>
            <div className="tasks-card-actions">
              {section === "done" ? (
                <button
                  type="button"
                  onClick={() =>
                    void setStatus(atom, atom.facetData.task?.status === "blocked" ? "blocked" : "todo")
                  }
                  disabled={busyAtomId === atom.id}
                >
                  Reopen
                </button>
              ) : (
                <select
                  value={taskStatus}
                  onChange={(event) => void setStatus(atom, event.target.value as TaskStatus)}
                  disabled={busyAtomId === atom.id}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" onClick={() => void archive(atom)} disabled={busyAtomId === atom.id}>
                Archive
              </button>
            </div>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="tasks-screen">
      <div className="card tasks-projection-bar">
        <small className="settings-hint">Tasks across your projects.</small>
        <div className="tasks-projection-actions">
          <button type="button" onClick={() => actions.selectScreen("notepad")}>
            Open Projects
          </button>
          <button
            type="button"
            className={showProjectionInfo ? "primary" : ""}
            onClick={() => {
              dismissHint();
              setShowProjectionInfo((current) => !current);
            }}
            aria-expanded={showProjectionInfo}
          >
            More
          </button>
        </div>
        {!hintDismissed && (
          <small className="settings-hint tasks-projection-hint">
            Tip: use section toggles and per-task More to reveal secondary controls only when needed.
          </small>
        )}
        {showProjectionInfo && (
          <div className="tasks-projection-disclosure">
            <small className="settings-hint">
              Tasks is a projection over shared project rows. Capture from Projects, then manage state here.
            </small>
            <button type="button" onClick={() => void refreshProjection()} disabled={syncing}>
              {syncing ? "Refreshing..." : "Refresh Projection"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="tasks-columns">
        <div className="tasks-column">
          <div className="tasks-column-header">
            <h3>Active ({active.length})</h3>
            <button
              type="button"
              className={collapsedSections.active ? "" : "primary"}
              onClick={() => toggleSection("active")}
              aria-expanded={!collapsedSections.active}
            >
              {collapsedSections.active ? "Show" : "Hide"}
            </button>
          </div>
          {collapsedSections.active ? (
            <p className="settings-hint">Collapsed. {active.length} active tasks.</p>
          ) : (
            <>
              {active.length === 0 && <p className="settings-hint">No active tasks.</p>}
              {active.map((atom) => renderTaskCard(atom, "active"))}
            </>
          )}
        </div>

        <div className="tasks-column">
          <div className="tasks-column-header">
            <h3>Waiting ({waiting.length})</h3>
            <button
              type="button"
              className={collapsedSections.waiting ? "" : "primary"}
              onClick={() => toggleSection("waiting")}
              aria-expanded={!collapsedSections.waiting}
            >
              {collapsedSections.waiting ? "Show" : "Hide"}
            </button>
          </div>
          {collapsedSections.waiting ? (
            <p className="settings-hint">Collapsed. {waiting.length} waiting tasks.</p>
          ) : (
            <>
              {waiting.length === 0 && <p className="settings-hint">No waiting tasks.</p>}
              {waiting.map((atom) => renderTaskCard(atom, "waiting"))}
            </>
          )}
        </div>

        <div className="tasks-column">
          <div className="tasks-column-header">
            <h3>Done ({done.length})</h3>
            <button
              type="button"
              className={collapsedSections.done ? "" : "primary"}
              onClick={() => toggleSection("done")}
              aria-expanded={!collapsedSections.done}
            >
              {collapsedSections.done ? "Show" : "Hide"}
            </button>
          </div>
          {collapsedSections.done ? (
            <p className="settings-hint">Collapsed. {done.length} completed tasks.</p>
          ) : (
            <>
              {done.length === 0 && <p className="settings-hint">No completed tasks yet.</p>}
              {done.map((atom) => renderTaskCard(atom, "done"))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
