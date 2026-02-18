import { useEffect, useMemo, useState } from "react";
import { DecisionQueuePanel } from "../components/workspace/DecisionQueuePanel";
import {
  conditionFollowupLog,
  conditionsList,
  decisionDismiss,
  decisionResolve,
  decisionSnooze,
  decisionsList,
  featureFlagsList,
  obsidianTasksSync,
  projectionCheckpointGet,
  projectionRefresh,
  projectionsList,
  systemApplyAttentionUpdate,
  systemGenerateDecisionCards,
  workSessionCancel,
  workSessionEnd,
  workSessionNote,
  workSessionStart,
  workSessionsList
} from "../lib/tauriClient";
import type { AtomRecord, ConditionRecord, DecisionPrompt, FeatureFlag, TaskStatus, WorkSessionRecord } from "../lib/types";
import { taskDisplayTitle } from "../lib/taskTitle";
import { useAppActions, useAppState } from "../state/appState";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "doing", "blocked", "done"];
const TASKS_SHOW_PROJECTION_INFO_KEY = "tasks.disclosure.showProjectionInfo";
const TASKS_SECTION_COLLAPSE_KEY = "tasks.disclosure.collapsedSections";
const TASKS_HINT_DISMISSED_KEY = "tasks.disclosure.hintDismissed";
const TASKS_VIEW_MODE_KEY = "tasks.view.mode";

interface TasksSectionCollapseState {
  primary: boolean;
  secondary: boolean;
  tertiary: boolean;
  done: boolean;
}

function loadTasksBoolPreference(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return fallback;
  }
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {
    return fallback;
  }
  return fallback;
}

function loadTasksStringPreference(key: string, fallback: "status" | "attention"): "status" | "attention" {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return fallback;
  }
  try {
    const value = window.localStorage.getItem(key);
    if (value === "status" || value === "attention") {
      return value;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function loadTasksSectionCollapsePreference(): TasksSectionCollapseState {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return { primary: false, secondary: true, tertiary: true, done: true };
  }
  try {
    const value = window.localStorage.getItem(TASKS_SECTION_COLLAPSE_KEY);
    if (!value) {
      return { primary: false, secondary: true, tertiary: true, done: true };
    }
    const parsed = JSON.parse(value) as Partial<TasksSectionCollapseState>;
    return {
      primary: parsed.primary ?? false,
      secondary: parsed.secondary ?? true,
      tertiary: parsed.tertiary ?? true,
      done: parsed.done ?? true
    };
  } catch {
    return { primary: false, secondary: true, tertiary: true, done: true };
  }
}

function taskTitle(atom: AtomRecord): string {
  return taskDisplayTitle(atom, "Untitled task");
}

function priorityLabel(priority: number): string {
  if (priority <= 1) return "P1";
  if (priority === 2) return "P2";
  if (priority === 3) return "P3";
  if (priority === 4) return "P4";
  return "P5";
}

function projectLabel(atom: AtomRecord): string | undefined {
  const categories = atom.facetData.meta?.categories?.filter((value) => value.trim().length > 0) ?? [];
  if (categories.length === 0) {
    return undefined;
  }
  return categories.join(" / ");
}

function attentionLayerLabel(atom: AtomRecord): string {
  const layer = atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer ?? "long";
  if (layer === "l3") return "L3";
  if (layer === "ram") return "RAM";
  if (layer === "short") return "Short";
  if (layer === "long") return "Long";
  return "Archive";
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
    return condition.blockedUntil ? `Snoozed until ${new Date(condition.blockedUntil).toLocaleString()}` : "Snoozed";
  }
  return "Blocked";
}

function waitingLabel(conditions: ConditionRecord[] | undefined): string {
  if (!conditions || conditions.length === 0) {
    return "Blocked";
  }
  return overlayLabel(conditions[0]);
}

function layerRank(atom: AtomRecord): number {
  const layer = atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer ?? "long";
  if (layer === "l3") return 0;
  if (layer === "ram") return 1;
  if (layer === "short") return 2;
  if (layer === "long") return 3;
  return 4;
}

function dueDescriptor(atom: AtomRecord): string | undefined {
  const task = atom.facetData.task;
  if (!task) return undefined;
  if (task.hardDueAt) return `Hard due ${new Date(task.hardDueAt).toLocaleString()}`;
  if (task.softDueAt) return `Due ${new Date(task.softDueAt).toLocaleString()}`;
  return undefined;
}

function asBlockId(atomId: string): string {
  return `blk_${atomId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

interface WaitingProjectionItem {
  conditionId: string;
  atomId: string;
  mode?: string;
  waitingOnPerson?: string;
  nextFollowupAt?: string;
}

interface FocusProjectionItem {
  atomId: string;
  title?: string;
  status?: string;
  layer?: string;
  heatScore?: number;
}

function isFeatureEnabled(flags: FeatureFlag[], key: FeatureFlag["key"], fallback = true): boolean {
  const match = flags.find((flag) => flag.key === key);
  if (!match) return fallback;
  return match.enabled;
}

function parseWaitingProjectionItems(value: unknown): WaitingProjectionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      conditionId: typeof item.conditionId === "string" ? item.conditionId : "",
      atomId: typeof item.atomId === "string" ? item.atomId : "",
      mode: typeof item.mode === "string" ? item.mode : undefined,
      waitingOnPerson: typeof item.waitingOnPerson === "string" ? item.waitingOnPerson : undefined,
      nextFollowupAt: typeof item.nextFollowupAt === "string" ? item.nextFollowupAt : undefined
    }))
    .filter((item) => item.conditionId.length > 0 && item.atomId.length > 0);
}

function parseFocusProjectionItems(value: unknown): FocusProjectionItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      atomId: typeof item.atomId === "string" ? item.atomId : "",
      title: typeof item.title === "string" ? item.title : undefined,
      status: typeof item.status === "string" ? item.status : undefined,
      layer: typeof item.layer === "string" ? item.layer : undefined,
      heatScore: typeof item.heatScore === "number" ? item.heatScore : undefined
    }))
    .filter((item) => item.atomId.length > 0);
}

export function TasksScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const [busyAtomId, setBusyAtomId] = useState<string | null>(null);
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const [decisionError, setDecisionError] = useState<string>();
  const [focusError, setFocusError] = useState<string>();
  const [activeConditionsByAtomId, setActiveConditionsByAtomId] = useState<Record<string, ConditionRecord[]>>({});
  const [pendingDecisions, setPendingDecisions] = useState<DecisionPrompt[]>([]);
  const [runningSession, setRunningSession] = useState<WorkSessionRecord | null>(null);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [waitingProjectionItems, setWaitingProjectionItems] = useState<WaitingProjectionItem[]>([]);
  const [focusProjectionItems, setFocusProjectionItems] = useState<FocusProjectionItem[]>([]);
  const [focusNote, setFocusNote] = useState("");
  const [showProjectionInfo, setShowProjectionInfo] = useState<boolean>(() =>
    loadTasksBoolPreference(TASKS_SHOW_PROJECTION_INFO_KEY, false)
  );
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<TasksSectionCollapseState>(() =>
    loadTasksSectionCollapsePreference()
  );
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => loadTasksBoolPreference(TASKS_HINT_DISMISSED_KEY, false));
  const [viewMode, setViewMode] = useState<"status" | "attention">(() =>
    loadTasksStringPreference(TASKS_VIEW_MODE_KEY, "status")
  );

  const dismissHint = (): void => {
    if (!hintDismissed) {
      setHintDismissed(true);
    }
  };

  const decisionQueueEnabled = isFeatureEnabled(featureFlags, "workspace.decision_queue", true);
  const decayEngineEnabled = isFeatureEnabled(featureFlags, "workspace.decay_engine", true);
  const focusSessionsEnabled = isFeatureEnabled(featureFlags, "workspace.focus_sessions_v2", true);
  const projectionsEnabled = isFeatureEnabled(featureFlags, "workspace.projections", true);

  const loadFeatureFlags = async (): Promise<FeatureFlag[]> => {
    const flags = await featureFlagsList();
    setFeatureFlags(flags);
    return flags;
  };

  const loadConditions = async (): Promise<Record<string, ConditionRecord[]>> => {
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
    return byAtomId;
  };

  const loadDecisionQueue = async (): Promise<DecisionPrompt[]> => {
    const pages = await Promise.all([
      decisionsList({ status: "pending", limit: 250 }),
      decisionsList({ status: "snoozed", limit: 250 })
    ]);
    return [...pages[0].items, ...pages[1].items].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  };

  const loadRunningSession = async (): Promise<WorkSessionRecord | null> => {
    const page = await workSessionsList({ status: "running", limit: 1 });
    return page.items[0] ?? null;
  };

  const loadProjectionData = async (refresh = false, flagsOverride?: FeatureFlag[]): Promise<void> => {
    const flags = flagsOverride ?? featureFlags;
    if (!isFeatureEnabled(flags, "workspace.projections", true)) {
      setWaitingProjectionItems([]);
      setFocusProjectionItems([]);
      return;
    }
    const page = await projectionsList({ limit: 200 });
    const waitingProjection = page.items.find((projection) => projection.type === "tasks.waiting");
    const focusProjection = page.items.find((projection) => projection.type === "focus.queue");
    const refreshes: Promise<unknown>[] = [];
    if (refresh && waitingProjection) {
      refreshes.push(projectionRefresh(waitingProjection.id, "incremental"));
    }
    if (refresh && focusProjection) {
      refreshes.push(projectionRefresh(focusProjection.id, "incremental"));
    }
    if (refreshes.length > 0) {
      await Promise.all(refreshes);
    }
    const [waitingCheckpoint, focusCheckpoint] = await Promise.all([
      waitingProjection ? projectionCheckpointGet(waitingProjection.id) : Promise.resolve(undefined),
      focusProjection ? projectionCheckpointGet(focusProjection.id) : Promise.resolve(undefined)
    ]);
    setWaitingProjectionItems(parseWaitingProjectionItems(waitingCheckpoint?.preview?.items));
    setFocusProjectionItems(parseFocusProjectionItems(focusCheckpoint?.preview?.items));
  };

  async function refreshProjection(): Promise<void> {
    setSyncing(true);
    setError(undefined);
    setDecisionError(undefined);
    try {
      const flags = await loadFeatureFlags();
      await obsidianTasksSync();
      if (isFeatureEnabled(flags, "workspace.decay_engine", true)) {
        await systemApplyAttentionUpdate();
      }
      if (isFeatureEnabled(flags, "workspace.decision_queue", true)) {
        await systemGenerateDecisionCards();
      }
      await loadProjectionData(true, flags);
      await actions.loadWorkspaceAtoms();
      const [conditions, decisions, session] = await Promise.all([
        loadConditions(),
        loadDecisionQueue(),
        loadRunningSession()
      ]);
      setActiveConditionsByAtomId(conditions);
      setPendingDecisions(isFeatureEnabled(flags, "workspace.decision_queue", true) ? decisions : []);
      setRunningSession(session);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Failed to refresh tasks projection";
      setError(message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
      return;
    }
    try {
      window.localStorage.setItem(TASKS_SHOW_PROJECTION_INFO_KEY, String(showProjectionInfo));
    } catch {
      // Ignore persistence failures in constrained environments.
    }
  }, [showProjectionInfo]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
      return;
    }
    try {
      window.localStorage.setItem(TASKS_SECTION_COLLAPSE_KEY, JSON.stringify(collapsedSections));
    } catch {
      // Ignore persistence failures in constrained environments.
    }
  }, [collapsedSections]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
      return;
    }
    try {
      window.localStorage.setItem(TASKS_HINT_DISMISSED_KEY, String(hintDismissed));
    } catch {
      // Ignore persistence failures in constrained environments.
    }
  }, [hintDismissed]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
      return;
    }
    try {
      window.localStorage.setItem(TASKS_VIEW_MODE_KEY, viewMode);
    } catch {
      // Ignore persistence failures in constrained environments.
    }
  }, [viewMode]);

  useEffect(() => {
    let cancelled = false;

    const loadWorkspace = async (): Promise<void> => {
      await actions.loadWorkspaceAtoms();
      await actions.loadWorkspaceNotepads();
    };

    void loadWorkspace()
      .then(async () => {
        const flags = await loadFeatureFlags();
        await loadProjectionData(false, flags);
        const [conditions, decisions, session] = await Promise.all([
          loadConditions(),
          loadDecisionQueue(),
          loadRunningSession()
        ]);
        if (cancelled) {
          return;
        }
        setActiveConditionsByAtomId(conditions);
        setPendingDecisions(isFeatureEnabled(flags, "workspace.decision_queue", true) ? decisions : []);
        setRunningSession(session);
      })
      .catch((nextError) => {
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
      const la = layerRank(a);
      const lb = layerRank(b);
      if (la !== lb) return la - lb;
      const pa = a.facetData.task?.priority ?? 99;
      const pb = b.facetData.task?.priority ?? 99;
      if (pa !== pb) return pa - pb;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [state.workspaceAtoms]);

  const atomsById = useMemo(() => {
    const next: Record<string, AtomRecord> = {};
    for (const atom of state.workspaceAtoms) {
      next[atom.id] = atom;
    }
    return next;
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

  const l3 = active.filter((atom) => (atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer) === "l3");
  const ram = active.filter((atom) => (atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer) === "ram");
  const backlog = active.filter((atom) => {
    const layer = atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer ?? "long";
    return layer === "short" || layer === "long" || layer === "archive";
  });

  const waitingFollowupsDue = useMemo(() => {
    const now = new Date();
    const projected = waitingProjectionItems
      .filter((item) => item.mode === "person")
      .filter((item) => {
        if (!item.nextFollowupAt) return false;
        const next = new Date(item.nextFollowupAt);
        if (Number.isNaN(next.valueOf())) return false;
        return next <= now;
      })
      .map((item) => {
        const candidates = activeConditionsByAtomId[item.atomId] ?? [];
        return candidates.find((condition) => condition.id === item.conditionId);
      })
      .filter((condition): condition is ConditionRecord => !!condition);

    if (projected.length > 0) {
      return projected.sort((a, b) => (a.nextFollowupAt ?? "").localeCompare(b.nextFollowupAt ?? ""));
    }

    return Object.values(activeConditionsByAtomId)
      .flat()
      .filter((condition) => condition.mode === "person")
      .filter((condition) => {
        if (!condition.nextFollowupAt) return false;
        const next = new Date(condition.nextFollowupAt);
        if (Number.isNaN(next.valueOf())) return false;
        return next <= now;
      })
      .sort((a, b) => (a.nextFollowupAt ?? "").localeCompare(b.nextFollowupAt ?? ""));
  }, [activeConditionsByAtomId, waitingProjectionItems]);

  const focusSuggestions = useMemo(() => {
    const fromProjection = focusProjectionItems
      .map((item) => atomsById[item.atomId])
      .filter((atom): atom is AtomRecord => !!atom);
    if (fromProjection.length > 0) {
      return fromProjection.slice(0, 5);
    }
    return [...active]
      .sort((a, b) => {
        const la = layerRank(a);
        const lb = layerRank(b);
        if (la !== lb) return la - lb;
        const ah = a.facetData.attention?.heatScore ?? 0;
        const bh = b.facetData.attention?.heatScore ?? 0;
        if (ah !== bh) return bh - ah;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 5);
  }, [active, atomsById, focusProjectionItems]);

  async function resolveDecisionCard(decision: DecisionPrompt, optionId: string): Promise<void> {
    if (!decisionQueueEnabled) return;
    setBusyDecisionId(decision.id);
    setDecisionError(undefined);
    try {
      await decisionResolve(decision.id, optionId);
      await actions.loadWorkspaceAtoms();
      await loadProjectionData(true);
      const [conditions, decisions, session] = await Promise.all([
        loadConditions(),
        loadDecisionQueue(),
        loadRunningSession()
      ]);
      setActiveConditionsByAtomId(conditions);
      setPendingDecisions(decisions);
      setRunningSession(session);
    } catch (nextError) {
      setDecisionError(nextError instanceof Error ? nextError.message : "Failed to resolve decision");
    } finally {
      setBusyDecisionId(null);
    }
  }

  async function snoozeDecisionCard(decision: DecisionPrompt): Promise<void> {
    if (!decisionQueueEnabled) return;
    setBusyDecisionId(decision.id);
    setDecisionError(undefined);
    try {
      const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await decisionSnooze(decision.id, snoozedUntil);
      setPendingDecisions(decisionQueueEnabled ? await loadDecisionQueue() : []);
    } catch (nextError) {
      setDecisionError(nextError instanceof Error ? nextError.message : "Failed to snooze decision");
    } finally {
      setBusyDecisionId(null);
    }
  }

  async function dismissDecisionCard(decision: DecisionPrompt): Promise<void> {
    if (!decisionQueueEnabled) return;
    setBusyDecisionId(decision.id);
    setDecisionError(undefined);
    try {
      await decisionDismiss(decision.id, "dismissed_from_queue");
      setPendingDecisions(decisionQueueEnabled ? await loadDecisionQueue() : []);
    } catch (nextError) {
      setDecisionError(nextError instanceof Error ? nextError.message : "Failed to dismiss decision");
    } finally {
      setBusyDecisionId(null);
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
      setActiveConditionsByAtomId(await loadConditions());
      await loadProjectionData(true);
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
      setActiveConditionsByAtomId(await loadConditions());
      await loadProjectionData(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to archive task");
    } finally {
      setBusyAtomId(null);
    }
  }

  async function startFocus(atom: AtomRecord): Promise<void> {
    if (!focusSessionsEnabled) return;
    setFocusError(undefined);
    try {
      const session = await workSessionStart({
        focusBlockIds: [asBlockId(atom.id)],
        note: `Starting focus on ${taskTitle(atom)}`
      });
      setRunningSession(session);
      await actions.loadWorkspaceAtoms();
      await loadProjectionData(true);
    } catch (nextError) {
      setFocusError(nextError instanceof Error ? nextError.message : "Failed to start focus session");
    }
  }

  async function logFocusNote(): Promise<void> {
    if (!focusSessionsEnabled || !runningSession || focusNote.trim().length === 0) return;
    setFocusError(undefined);
    try {
      const updated = await workSessionNote(runningSession.id, {
        expectedRevision: runningSession.revision,
        note: focusNote.trim()
      });
      setRunningSession(updated);
      setFocusNote("");
      await actions.loadWorkspaceAtoms();
    } catch (nextError) {
      setFocusError(nextError instanceof Error ? nextError.message : "Failed to add focus note");
    }
  }

  async function endFocus(): Promise<void> {
    if (!focusSessionsEnabled || !runningSession) return;
    setFocusError(undefined);
    try {
      const updated = await workSessionEnd(runningSession.id, {
        expectedRevision: runningSession.revision,
        summaryNote: "Focus session completed"
      });
      setRunningSession(updated.status === "running" ? updated : null);
      await actions.loadWorkspaceAtoms();
      await loadProjectionData(true);
      setPendingDecisions(decisionQueueEnabled ? await loadDecisionQueue() : []);
    } catch (nextError) {
      setFocusError(nextError instanceof Error ? nextError.message : "Failed to end focus session");
    }
  }

  async function cancelFocus(): Promise<void> {
    if (!focusSessionsEnabled || !runningSession) return;
    setFocusError(undefined);
    try {
      const updated = await workSessionCancel(runningSession.id, {
        expectedRevision: runningSession.revision,
        reason: "canceled_from_tasks"
      });
      setRunningSession(updated.status === "running" ? updated : null);
      await actions.loadWorkspaceAtoms();
      await loadProjectionData(true);
    } catch (nextError) {
      setFocusError(nextError instanceof Error ? nextError.message : "Failed to cancel focus session");
    }
  }

  async function logFollowup(condition: ConditionRecord): Promise<void> {
    setError(undefined);
    try {
      await conditionFollowupLog(condition.id, { expectedRevision: condition.revision });
      setActiveConditionsByAtomId(await loadConditions());
      await loadProjectionData(true);
      setPendingDecisions(decisionQueueEnabled ? await loadDecisionQueue() : []);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to log follow-up");
    }
  }

  function toggleSection(section: keyof TasksSectionCollapseState): void {
    dismissHint();
    setCollapsedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function renderTaskCard(atom: AtomRecord, section: "primary" | "secondary" | "tertiary" | "done" | "waiting"): JSX.Element {
    const expanded = expandedTaskId === atom.id;
    const project = projectLabel(atom);
    const status = atom.facetData.task?.status ?? "todo";
    const due = dueDescriptor(atom);
    const layer = attentionLayerLabel(atom);
    const heat = atom.facetData.attention?.heatScore;

    return (
      <article key={atom.id} className={`tasks-card${section === "done" ? " done" : ""}${section === "waiting" ? " waiting" : ""}`}>
        <div className="tasks-card-main">
          <strong>{taskTitle(atom)}</strong>
          <div className="tasks-card-badges">
            <small className={`tasks-status-pill tasks-status-${status}`}>Status: {status}</small>
            <small className="tasks-status-pill">{layer}</small>
            {typeof heat === "number" && <small className="tasks-status-pill">Heat {heat.toFixed(1)}</small>}
            {atom.facetData.task?.commitmentLevel === "hard" && <small className="tasks-status-pill">Hard</small>}
          </div>
          {atom.facetData.attention?.explanation && <small>{atom.facetData.attention.explanation}</small>}
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
              <small>
                {priorityLabel(atom.facetData.task?.priority ?? 3)} · Updated {new Date(atom.updatedAt).toLocaleString()}
              </small>
              {section === "waiting" && <small>{waitingLabel(activeConditionsByAtomId[atom.id])}</small>}
              {due && <small>{due}</small>}
              {project && <small>Project: {project}</small>}
            </div>
            <div className="tasks-card-actions">
              {section === "done" ? (
                <button
                  type="button"
                  onClick={() => void setStatus(atom, atom.facetData.task?.status === "blocked" ? "blocked" : "todo")}
                  disabled={busyAtomId === atom.id}
                >
                  Reopen
                </button>
              ) : (
                <select value={status} onChange={(event) => void setStatus(atom, event.target.value as TaskStatus)} disabled={busyAtomId === atom.id}>
                  {STATUS_OPTIONS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" onClick={() => void startFocus(atom)} disabled={!!runningSession && runningSession.status === "running"}>
                Focus
              </button>
              <button type="button" onClick={() => void archive(atom)} disabled={busyAtomId === atom.id}>
                Archive
              </button>
            </div>
          </div>
        )}
      </article>
    );
  }

  const primaryTitle = viewMode === "attention" ? `Hot (${l3.length})` : `Active (${active.length})`;
  const secondaryTitle = viewMode === "attention" ? `Warm (${ram.length})` : `Waiting (${waiting.length})`;
  const tertiaryTitle = viewMode === "attention" ? `Backlog (${backlog.length})` : `Done (${done.length})`;

  const primaryItems = viewMode === "attention" ? l3 : active;
  const secondaryItems = viewMode === "attention" ? ram : waiting;
  const tertiaryItems = viewMode === "attention" ? backlog : done;

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
            className={viewMode === "attention" ? "primary" : ""}
            onClick={() => {
              dismissHint();
              setViewMode((current) => (current === "status" ? "attention" : "status"));
            }}
          >
            {viewMode === "status" ? "Attention View" : "Status View"}
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
            Tip: keep the queue small. Resolve one decision and start one focus block at a time.
          </small>
        )}
        {showProjectionInfo && (
          <div className="tasks-projection-disclosure">
            <small className="settings-hint">
              Tasks is a projection over project rows. Attention updates and decision cards are generated from shared workspace signals.
            </small>
            <small className="settings-hint">
              Flags: projections {projectionsEnabled ? "on" : "off"} · decay {decayEngineEnabled ? "on" : "off"} · decisions{" "}
              {decisionQueueEnabled ? "on" : "off"} · focus {focusSessionsEnabled ? "on" : "off"}
            </small>
            <button type="button" onClick={() => void refreshProjection()} disabled={syncing}>
              {syncing ? "Refreshing..." : "Refresh Projection"}
            </button>
          </div>
        )}
      </div>

      {decisionQueueEnabled ? (
        <DecisionQueuePanel
          decisions={pendingDecisions}
          atomsById={atomsById}
          busyDecisionId={busyDecisionId}
          loading={syncing}
          error={decisionError}
          onResolve={resolveDecisionCard}
          onSnooze={snoozeDecisionCard}
          onDismiss={dismissDecisionCard}
          onRefresh={refreshProjection}
        />
      ) : (
        <div className="card">
          <small className="settings-hint">Decision queue is disabled by feature flag.</small>
        </div>
      )}

      <div className="card tasks-focus-panel">
        <header className="tasks-focus-header">
          <h3>Focus Mode</h3>
          <small className="settings-hint">{runningSession ? "Session running" : "No active session"}</small>
        </header>
        {focusError && <div className="banner error">{focusError}</div>}
        {!focusSessionsEnabled ? (
          <small className="settings-hint">Focus sessions are disabled by feature flag.</small>
        ) : runningSession ? (
          <>
            <small className="settings-hint">Started {runningSession.startedAt ? new Date(runningSession.startedAt).toLocaleString() : "now"}</small>
            <div className="tasks-focus-actions">
              <input
                type="text"
                value={focusNote}
                onChange={(event) => setFocusNote(event.target.value)}
                placeholder="Add focus note"
              />
              <button type="button" onClick={() => void logFocusNote()} disabled={focusNote.trim().length === 0}>
                Add note
              </button>
              <button type="button" className="primary" onClick={() => void endFocus()}>
                End session
              </button>
              <button type="button" onClick={() => void cancelFocus()}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="tasks-focus-suggestions">
            {focusSuggestions.length === 0 && <small className="settings-hint">No focus suggestions right now.</small>}
            {focusSuggestions.map((atom) => (
              <button type="button" key={atom.id} onClick={() => void startFocus(atom)}>
                Start: {taskTitle(atom)}
              </button>
            ))}
          </div>
        )}
      </div>

      {waitingFollowupsDue.length > 0 && (
        <div className="card tasks-followup-rail">
          <header className="tasks-followup-header">
            <h3>Follow-ups Due ({waitingFollowupsDue.length})</h3>
          </header>
          <div className="tasks-followup-list">
            {waitingFollowupsDue.slice(0, 10).map((condition) => {
              const atom = atomsById[condition.atomId];
              return (
                <article className="tasks-followup-item" key={condition.id}>
                  <div>
                    <strong>{atom ? taskTitle(atom) : condition.atomId}</strong>
                    <small>
                      Waiting on {condition.waitingOnPerson ?? "someone"}
                      {condition.nextFollowupAt ? ` · due ${new Date(condition.nextFollowupAt).toLocaleString()}` : ""}
                    </small>
                  </div>
                  <button type="button" onClick={() => void logFollowup(condition)}>
                    Logged follow-up
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="banner error">{error}</div>}

      <div className="tasks-columns">
        <div className="tasks-column">
          <div className="tasks-column-header">
            <h3>{primaryTitle}</h3>
            <button
              type="button"
              className={collapsedSections.primary ? "" : "primary"}
              onClick={() => toggleSection("primary")}
              aria-expanded={!collapsedSections.primary}
            >
              {collapsedSections.primary ? "Show" : "Hide"}
            </button>
          </div>
          {collapsedSections.primary ? (
            <p className="settings-hint">Collapsed. {primaryItems.length} tasks.</p>
          ) : (
            <>
              {primaryItems.length === 0 && <p className="settings-hint">No tasks.</p>}
              {primaryItems.map((atom) => renderTaskCard(atom, "primary"))}
            </>
          )}
        </div>

        <div className="tasks-column">
          <div className="tasks-column-header">
            <h3>{secondaryTitle}</h3>
            <button
              type="button"
              className={collapsedSections.secondary ? "" : "primary"}
              onClick={() => toggleSection("secondary")}
              aria-expanded={!collapsedSections.secondary}
            >
              {collapsedSections.secondary ? "Show" : "Hide"}
            </button>
          </div>
          {collapsedSections.secondary ? (
            <p className="settings-hint">Collapsed. {secondaryItems.length} tasks.</p>
          ) : (
            <>
              {secondaryItems.length === 0 && <p className="settings-hint">No tasks.</p>}
              {secondaryItems.map((atom) => renderTaskCard(atom, viewMode === "attention" ? "secondary" : "waiting"))}
            </>
          )}
        </div>

        <div className="tasks-column">
          <div className="tasks-column-header">
            <h3>{tertiaryTitle}</h3>
            <button
              type="button"
              className={collapsedSections.tertiary ? "" : "primary"}
              onClick={() => toggleSection("tertiary")}
              aria-expanded={!collapsedSections.tertiary}
            >
              {collapsedSections.tertiary ? "Show" : "Hide"}
            </button>
          </div>
          {collapsedSections.tertiary ? (
            <p className="settings-hint">Collapsed. {tertiaryItems.length} tasks.</p>
          ) : (
            <>
              {tertiaryItems.length === 0 && <p className="settings-hint">No tasks.</p>}
              {tertiaryItems.map((atom) => renderTaskCard(atom, viewMode === "attention" ? "tertiary" : "done"))}
            </>
          )}
        </div>
      </div>

      {viewMode === "attention" && (
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
      )}
    </section>
  );
}
