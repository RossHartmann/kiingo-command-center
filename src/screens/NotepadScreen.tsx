import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  atomArchive,
  atomGet,
  atomUpdate,
  blockGet,
  blocksList,
  conditionCancel,
  conditionResolve,
  conditionSetDate,
  conditionSetPerson,
  conditionSetTask,
  conditionsList,
  decisionsList,
  featureFlagsList,
  notepadAtomsList,
  notepadBlockCreate,
  notepadsList,
  notepadSave,
  registryEntriesList,
  registryEntrySave,
  placementDelete,
  placementSave,
  placementsList,
  placementsReorder,
  systemApplyAttentionUpdate,
  systemGenerateDecisionCards,
  taskReopen,
  taskStatusSet,
  workSessionsList,
  workspaceCapabilitiesGet,
  workspaceHealthGet
} from "../lib/tauriClient";
import type {
  AtomRecord,
  BlockRecord,
  ConditionRecord,
  DecisionPrompt,
  FeatureFlag,
  RegistryEntry,
  NotepadFilter,
  NotepadViewDefinition,
  PlacementRecord,
  TaskStatus,
  WorkSessionRecord,
  WorkspaceCapabilities,
  WorkspaceHealth
} from "../lib/types";
import { taskDisplayTitle } from "../lib/taskTitle";
import { NotepadListSidebar } from "../components/notepad/NotepadListSidebar";
import { NotepadTree } from "../components/notepad/NotepadTree";
import {
  resolveContainerKeyAction,
  resolveEditorKeyAction
} from "../components/notepad/keyboardContract";
import {
  buildTreeData,
  collectSubtreePlacementIds,
  collectVisibleSubtreePlacementIds,
  insertPlacementAfter,
  isPlacementDescendant,
  parseOverlayMode,
  planPlacementDrop,
  sortPlacements,
  type PlacementDropIntent
} from "../components/notepad/treeData";
import { ROOT_KEY, type FlatRow } from "../components/notepad/types";
import { OMNI_OPEN_NOTEPAD, OMNI_OPEN_NOTEPAD_BY_CATEGORY } from "../components/OmniSearch";
import { useOptionalAppActions } from "../state/appState";
import { useNotepadUiState } from "../state/notepadState";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "doing", "blocked", "done"];
const ACTIVE_ROW_STATUSES: TaskStatus[] = ["todo", "doing", "blocked"];
const NOTEPAD_HINT_DISMISSED_KEY = "notepad.disclosure.hintDismissed";
const NOTEPAD_DRAG_UNDO_TTL_MS = 10000;
const STRUCTURAL_HISTORY_LIMIT = 50;

interface DragUndoState {
  notepadId: string;
  sourcePlacementId: string;
  previousOrderedPlacementIds: string[];
  previousParentPlacementId?: string;
  previousCanonicalParentAtomId?: string;
  message: string;
}

interface SnapshotPlacement {
  id: string;
  viewId: string;
  blockId: string;
  parentPlacementId?: string;
  orderKey: string;
  pinned: boolean;
}

interface StructuralSnapshot {
  notepadId: string;
  placements: SnapshotPlacement[];
  orderedPlacementIds: string[];
  atoms: AtomRecord[];
  selectedPlacementId?: string;
}

interface StructuralHistoryEntry {
  label: string;
  before: StructuralSnapshot;
  after: StructuralSnapshot;
}

interface KeyboardDragState {
  sourcePlacementId: string;
  targetPlacementId: string;
  intent: PlacementDropIntent;
}

function loadNotepadBoolPreference(key: string, fallback: boolean): boolean {
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

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConflictError(error: unknown): boolean {
  return asErrorMessage(error).includes("CONFLICT");
}

async function listAllPages<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.nextCursor) {
      return items;
    }
    cursor = page.nextCursor;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function priorityLabel(priority: number): string {
  if (priority <= 1) return "P1";
  if (priority === 2) return "P2";
  if (priority === 3) return "P3";
  if (priority === 4) return "P4";
  return "P5";
}

function rowTitle(row: FlatRow): string {
  if (row.atom) {
    return taskDisplayTitle(row.atom, "Untitled");
  }
  const fallback = row.block.text.trim();
  return fallback.length > 0 ? fallback : "Untitled";
}

function isTaskRow(row: FlatRow): boolean {
  return row.block.kind === "task" || !!row.atom?.facetData.task || !!row.block.taskStatus;
}

function parseCategories(input: string): string[] | undefined {
  const items = input
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  return items.length > 0 ? items : undefined;
}

function normalizeCategoryName(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^#+/, "");
}

function normalizeTagName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "");
}

function uniqueLowercase(values: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    next.push(normalized);
  }
  return next;
}

function extractInlineTags(rawText: string): string[] {
  if (!rawText.includes("#")) {
    return [];
  }
  const stripped = rawText
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const matches = stripped.match(/(^|\s)#([A-Za-z0-9][A-Za-z0-9_-]{0,63})/g) ?? [];
  return uniqueLowercase(
    matches
      .map((match) => {
        const token = match.trim();
        const idx = token.indexOf("#");
        return idx >= 0 ? token.slice(idx + 1) : "";
      })
      .map(normalizeTagName)
      .filter((value) => value.length > 0)
  );
}

function rowText(row: FlatRow, draft: string | undefined): string {
  return draft ?? row.block.text;
}

function mergeRowText(current: string, next: string): string {
  if (current.length === 0) return next;
  if (next.length === 0) return current;
  if (/\s$/.test(current) || /^\s/.test(next)) {
    return `${current}${next}`;
  }
  return `${current} ${next}`;
}

function mergeBoundaryOffset(left: string, right: string): number {
  if (left.length === 0 || right.length === 0) {
    return left.length;
  }
  if (/\s$/.test(left) || /^\s/.test(right)) {
    return left.length;
  }
  return left.length + 1;
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function requiredWorkspaceCommandsPresent(capabilities: WorkspaceCapabilities | undefined): { ok: boolean; missing: string[] } {
  if (!capabilities) {
    return { ok: false, missing: ["workspace_capabilities_get"] };
  }
  const required = [
    "notepads_list",
    "notepad_block_create",
    "notepad_atoms_list",
    "blocks_list",
    "placements_list",
    "placement_save",
    "placement_delete",
    "placements_reorder",
    "atom_update",
    "task_status_set"
  ];
  const missing = required.filter((command) => !capabilities.supportedCommands.includes(command));
  return { ok: missing.length === 0, missing };
}

function notepadUiFlagEnabled(featureFlags: FeatureFlag[]): boolean {
  const flag = featureFlags.find((value) => value.key === "workspace.notepad_ui_v2");
  return flag ? flag.enabled : true;
}

function workspaceFlagEnabled(featureFlags: FeatureFlag[], key: FeatureFlag["key"], fallback = true): boolean {
  const flag = featureFlags.find((value) => value.key === key);
  return flag ? flag.enabled : fallback;
}

function placeCaretAtEnd(element: HTMLTextAreaElement): void {
  const length = element.value.length;
  element.setSelectionRange(length, length);
}

interface PendingEditorSelection {
  placementId: string;
  start: number;
  end: number;
}

interface PendingCategoryOpenRequest {
  categories: string[];
  filterMode: "or" | "and";
}

interface RowContextMenuState {
  placementId: string;
  x: number;
  y: number;
}

export function NotepadScreen(): JSX.Element {
  const [uiState, uiDispatch] = useNotepadUiState();
  const appActions = useOptionalAppActions();

  const [notepads, setNotepads] = useState<NotepadViewDefinition[]>([]);
  const [placements, setPlacements] = useState<PlacementRecord[]>([]);
  const [blocksById, setBlocksById] = useState<Record<string, BlockRecord>>({});
  const [atomsById, setAtomsById] = useState<Record<string, AtomRecord>>({});
  const [conditionsByAtomId, setConditionsByAtomId] = useState<Record<string, ConditionRecord[]>>({});
  const [decisionQueue, setDecisionQueue] = useState<DecisionPrompt[]>([]);
  const [runningSession, setRunningSession] = useState<WorkSessionRecord | null>(null);
  const [attentionBusy, setAttentionBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [gateError, setGateError] = useState<string>();

  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities>();
  const [health, setHealth] = useState<WorkspaceHealth>();
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createCategories, setCreateCategories] = useState("");
  const [creatingNotepad, setCreatingNotepad] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategories, setEditCategories] = useState("");
  const [editingNotepad, setEditingNotepad] = useState(false);

  const [pendingNotepadId, setPendingNotepadId] = useState<string>();
  const [pendingCategoryOpen, setPendingCategoryOpen] = useState<PendingCategoryOpenRequest>();
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState | null>(null);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() =>
    loadNotepadBoolPreference(NOTEPAD_HINT_DISMISSED_KEY, false)
  );
  const [dragUndo, setDragUndo] = useState<DragUndoState | null>(null);
  const [dragAnnouncement, setDragAnnouncement] = useState("");
  const [keyboardDrag, setKeyboardDrag] = useState<KeyboardDragState | null>(null);

  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const dragUndoTimerRef = useRef<number>();
  const structuralUndoRef = useRef<StructuralHistoryEntry[]>([]);
  const structuralRedoRef = useRef<StructuralHistoryEntry[]>([]);
  const applyingStructuralHistoryRef = useRef(false);
  const pendingEditorFocusPlacementIdRef = useRef<string | undefined>(undefined);
  const pendingEditorSelectionRef = useRef<PendingEditorSelection>();
  const selectedPlacementRef = useRef<string | undefined>(undefined);
  const pointerEditorInteractionRef = useRef<{ active: boolean; placementId?: string }>({
    active: false,
    placementId: undefined
  });

  const activeNotepad = useMemo(
    () => notepads.find((notepad) => notepad.id === uiState.activeNotepadId),
    [notepads, uiState.activeNotepadId]
  );

  const treeData = useMemo(
    () => buildTreeData(placements, blocksById, atomsById, uiState.collapsedByPlacement, conditionsByAtomId),
    [placements, blocksById, atomsById, uiState.collapsedByPlacement, conditionsByAtomId]
  );

  const selectedRow = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
  const contextMenuRow = rowContextMenu ? treeData.rowByPlacementId[rowContextMenu.placementId] : undefined;
  const activeCategories = activeNotepad?.filters.categories ?? [];
  const statusPreset = useMemo<"active" | "all">(() => {
    const statuses = activeNotepad?.filters.statuses;
    if (!statuses || statuses.length === 0) {
      return "all";
    }
    const statusSet = new Set(statuses);
    const activeOnly = ACTIVE_ROW_STATUSES.every((status) => statusSet.has(status)) && !statusSet.has("done");
    return activeOnly ? "active" : "all";
  }, [activeNotepad]);
  const activeRowCount = useMemo(
    () =>
      treeData.flatRows.filter((row) => {
        const status = row.atom?.facetData.task?.status;
        return !row.atom?.archivedAt && status !== "done" && status !== "archived";
      }).length,
    [treeData.flatRows]
  );
  const latestRowUpdate = useMemo(() => {
    let latest: string | undefined;
    for (const row of treeData.flatRows) {
      if (!latest || row.block.updatedAt > latest) {
        latest = row.block.updatedAt;
      }
    }
    return latest;
  }, [treeData.flatRows]);
  const attentionCounts = useMemo(() => {
    const counts: Record<"l3" | "ram" | "short" | "long", number> = { l3: 0, ram: 0, short: 0, long: 0 };
    for (const row of treeData.flatRows) {
      const layer = row.atom?.facetData.task?.attentionLayer ?? row.atom?.facetData.attention?.layer;
      if (layer === "l3" || layer === "ram" || layer === "short" || layer === "long") {
        counts[layer] += 1;
      }
    }
    return counts;
  }, [treeData.flatRows]);
  const driftingSoonCount = useMemo(() => {
    const now = Date.now();
    let count = 0;
    for (const row of treeData.flatRows) {
      const decayAt = row.atom?.facetData.attention?.decayEligibleAt;
      if (!decayAt) continue;
      const dt = new Date(decayAt);
      if (Number.isNaN(dt.valueOf())) continue;
      const hours = (dt.valueOf() - now) / (1000 * 60 * 60);
      if (hours <= 6) {
        count += 1;
      }
    }
    return count;
  }, [treeData.flatRows]);
  const decisionQueueEnabled = workspaceFlagEnabled(featureFlags, "workspace.decision_queue", true);
  const decayEngineEnabled = workspaceFlagEnabled(featureFlags, "workspace.decay_engine", true);
  const focusSessionsEnabled = workspaceFlagEnabled(featureFlags, "workspace.focus_sessions_v2", true);
  const openNotepadV2Enabled = workspaceFlagEnabled(featureFlags, "workspace.notepad_open_notepad_v2", true);
  const inlineTagsEnabled = workspaceFlagEnabled(featureFlags, "workspace.inline_tags", true);
  const contextMenuEnabled = workspaceFlagEnabled(featureFlags, "workspace.notepad_context_menu", true);

  const isGateOpen = useMemo(() => !gateError, [gateError]);

  useEffect(() => {
    if (rowContextMenu && !contextMenuRow) {
      setRowContextMenu(null);
    }
  }, [contextMenuRow, rowContextMenu]);
  const dismissHint = useCallback(() => {
    if (!hintDismissed) {
      setHintDismissed(true);
    }
  }, [hintDismissed]);
  const announceDragAction = useCallback((message: string): void => {
    setDragAnnouncement(message);
    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(() => {
        setDragAnnouncement((current) => (current === message ? "" : current));
      }, 1400);
    }
  }, []);

  const [contextSubmenu, setContextSubmenu] = useState<"none" | "status" | "priority" | "move">("none");

  const closeRowContextMenu = useCallback((): void => {
    setRowContextMenu(null);
    setContextSubmenu("none");
  }, []);

  const openRowContextMenu = useCallback(
    (placementId: string, x: number, y: number): void => {
      if (!contextMenuEnabled) {
        return;
      }
      dismissHint();
      uiDispatch({ type: "set_selected_placement", placementId });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
      setRowContextMenu({ placementId, x, y });
    },
    [contextMenuEnabled, dismissHint, uiDispatch]
  );

  useEffect(() => {
    if (!rowContextMenu) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".notepad-context-menu")) {
        return;
      }
      setRowContextMenu(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setRowContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rowContextMenu]);

  const clearDragUndo = useCallback((): void => {
    if (dragUndoTimerRef.current) {
      window.clearTimeout(dragUndoTimerRef.current);
      dragUndoTimerRef.current = undefined;
    }
    setDragUndo(null);
  }, []);

  const queueDragUndo = useCallback((nextUndo: DragUndoState): void => {
    if (dragUndoTimerRef.current) {
      window.clearTimeout(dragUndoTimerRef.current);
    }
    setDragUndo(nextUndo);
    dragUndoTimerRef.current = window.setTimeout(() => {
      setDragUndo((current) => (current?.sourcePlacementId === nextUndo.sourcePlacementId ? null : current));
      dragUndoTimerRef.current = undefined;
    }, NOTEPAD_DRAG_UNDO_TTL_MS);
  }, []);

  useEffect(() => {
    if (!activeNotepad) {
      return;
    }
    setEditName(activeNotepad.name);
    setEditDescription(activeNotepad.description ?? "");
    setEditCategories((activeNotepad.filters.categories ?? []).join(", "));
  }, [activeNotepad]);

  useEffect(() => {
    selectedPlacementRef.current = uiState.selectedPlacementId;
  }, [uiState.selectedPlacementId]);

  useEffect(() => {
    if (dragUndo && dragUndo.notepadId !== uiState.activeNotepadId) {
      clearDragUndo();
    }
  }, [clearDragUndo, dragUndo, uiState.activeNotepadId]);

  useEffect(() => {
    if (!keyboardDrag) {
      return;
    }
    if (!treeData.rowByPlacementId[keyboardDrag.sourcePlacementId] || !treeData.rowByPlacementId[keyboardDrag.targetPlacementId]) {
      setKeyboardDrag(null);
    }
  }, [keyboardDrag, treeData.rowByPlacementId]);

  useEffect(() => {
    const onMouseDownCapture = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.classList.contains("notepad-editor")) {
        pointerEditorInteractionRef.current = { active: false, placementId: undefined };
        return;
      }
      pointerEditorInteractionRef.current = { active: true, placementId: target.dataset.placementId };
    };
    const onMouseUpCapture = (): void => {
      window.setTimeout(() => {
        pointerEditorInteractionRef.current = { active: false, placementId: undefined };
      }, 0);
    };
    document.addEventListener("mousedown", onMouseDownCapture, true);
    document.addEventListener("mouseup", onMouseUpCapture, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDownCapture, true);
      document.removeEventListener("mouseup", onMouseUpCapture, true);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
      return;
    }
    try {
      window.localStorage.setItem(NOTEPAD_HINT_DISMISSED_KEY, String(hintDismissed));
    } catch {
      // Ignore persistence failures in constrained environments.
    }
  }, [hintDismissed]);

  useEffect(() => {
    const onOpenNotepad = (event: Event): void => {
      const detail = (event as CustomEvent<{ notepadId?: string }>).detail;
      const notepadId = detail?.notepadId;
      if (!notepadId) {
        return;
      }
      setPendingNotepadId(notepadId);
    };
    const onOpenCategoryNotepad = (event: Event): void => {
      const detail = (event as CustomEvent<{ categories?: string[]; filterMode?: "or" | "and" }>).detail;
      const categories = (detail?.categories ?? []).map(normalizeCategoryName).filter((value) => value.length > 0);
      if (categories.length === 0) {
        return;
      }
      setPendingCategoryOpen({
        categories: uniqueLowercase(categories),
        filterMode: detail?.filterMode === "and" ? "and" : "or"
      });
    };
    window.addEventListener(OMNI_OPEN_NOTEPAD, onOpenNotepad as EventListener);
    window.addEventListener(OMNI_OPEN_NOTEPAD_BY_CATEGORY, onOpenCategoryNotepad as EventListener);
    return () => {
      window.removeEventListener(OMNI_OPEN_NOTEPAD, onOpenNotepad as EventListener);
      window.removeEventListener(OMNI_OPEN_NOTEPAD_BY_CATEGORY, onOpenCategoryNotepad as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!pendingNotepadId) {
      return;
    }
    if (!notepads.some((view) => view.id === pendingNotepadId)) {
      return;
    }
    uiDispatch({ type: "set_active_notepad", notepadId: pendingNotepadId });
    setPendingNotepadId(undefined);
  }, [notepads, pendingNotepadId, uiDispatch]);

  const loadWorkspaceGate = useCallback(async (): Promise<void> => {
    const [nextCapabilities, nextHealth, nextFlags] = await Promise.all([
      workspaceCapabilitiesGet(),
      workspaceHealthGet(),
      featureFlagsList()
    ]);
    setCapabilities(nextCapabilities);
    setHealth(nextHealth);
    setFeatureFlags(nextFlags);

    if (!notepadUiFlagEnabled(nextFlags)) {
      setGateError("Notepads are currently disabled by feature flag `workspace.notepad_ui_v2`.");
      return;
    }

    const commandCheck = requiredWorkspaceCommandsPresent(nextCapabilities);
    if (!commandCheck.ok) {
      setGateError(`Missing workspace commands: ${commandCheck.missing.join(", ")}`);
      return;
    }

    if (!nextHealth.adapterHealthy || !nextHealth.vaultAccessible) {
      setGateError("Workspace adapter or Obsidian vault is unavailable. Resolve health issues in settings and retry.");
      return;
    }

    setGateError(undefined);
  }, []);

  const loadNotepadsIntoState = useCallback(async (): Promise<NotepadViewDefinition[]> => {
    const views = await notepadsList();
    setNotepads(views);
    return views;
  }, []);

  const ensureCategoryRegistryEntries = useCallback(
    async (inputCategories: string[]): Promise<{ categories: string[]; categoryIds: string[] }> => {
      const normalized = uniqueLowercase(inputCategories.map(normalizeCategoryName).filter((value) => value.length > 0));
      if (normalized.length === 0) {
        return { categories: [], categoryIds: [] };
      }
      const registryPage = await registryEntriesList({ kind: "category", status: "active", limit: 1000 });
      const byName = new Map<string, RegistryEntry>();
      for (const entry of registryPage.items) {
        byName.set(entry.name.toLowerCase(), entry);
        for (const alias of entry.aliases) {
          byName.set(alias.toLowerCase(), entry);
        }
      }

      const categories: string[] = [];
      const categoryIds: string[] = [];
      for (const category of normalized) {
        const found = byName.get(category.toLowerCase());
        if (found) {
          categories.push(found.name);
          categoryIds.push(found.id);
          continue;
        }
        const created = await registryEntrySave({
          kind: "category",
          name: category,
          aliases: [],
          status: "active"
        });
        categories.push(created.name);
        categoryIds.push(created.id);
        byName.set(created.name.toLowerCase(), created);
      }

      return {
        categories: uniqueLowercase(categories),
        categoryIds: uniqueLowercase(categoryIds)
      };
    },
    []
  );

  const ensureThreadRegistryEntries = useCallback(async (inputThreads: string[]): Promise<string[]> => {
    const normalized = uniqueLowercase(inputThreads.map(normalizeCategoryName).filter((value) => value.length > 0));
    if (normalized.length === 0) {
      return [];
    }
    const registryPage = await registryEntriesList({ kind: "thread", status: "active", limit: 1000 });
    const byName = new Map<string, RegistryEntry>();
    for (const entry of registryPage.items) {
      byName.set(entry.name.toLowerCase(), entry);
      for (const alias of entry.aliases) {
        byName.set(alias.toLowerCase(), entry);
      }
    }

    const threadIds: string[] = [];
    for (const thread of normalized) {
      const found = byName.get(thread.toLowerCase());
      if (found) {
        threadIds.push(found.id);
        continue;
      }
      const created = await registryEntrySave({
        kind: "thread",
        name: thread,
        aliases: [],
        status: "active"
      });
      threadIds.push(created.id);
      byName.set(created.name.toLowerCase(), created);
    }
    return uniqueLowercase(threadIds);
  }, []);

  const openCategoryNotepadFromPalette = useCallback(
    async (request: PendingCategoryOpenRequest): Promise<void> => {
      if (!isGateOpen) {
        return;
      }
      if (!openNotepadV2Enabled) {
        setError("Open Notepad by category is disabled by feature flag `workspace.notepad_open_notepad_v2`.");
        return;
      }
      const normalized = uniqueLowercase(request.categories.map(normalizeCategoryName).filter((value) => value.length > 0));
      if (normalized.length === 0) {
        return;
      }
      setSaving(true);
      setError(undefined);
      try {
        const resolved = await ensureCategoryRegistryEntries(normalized);
        const categories = resolved.categories;
        const filterMode = request.filterMode === "and" ? "and" : "or";
        const filterSet = new Set(categories.map((value) => value.toLowerCase()));
        const existing = notepads.find((view) => {
          if ((view.filters.categoryFilterMode ?? "or") !== filterMode) {
            return false;
          }
          const current = view.filters.categories ?? [];
          if (current.length !== categories.length) {
            return false;
          }
          return current.every((value) => filterSet.has(value.toLowerCase()));
        });
        const slugParts = categories.map((value) => slugify(value)).filter((value) => value.length > 0);
        const fallbackId =
          categories.length === 1
            ? `category-${slugParts[0] ?? Date.now().toString()}`
            : `categories-${filterMode}-${slugParts.join("-") || Date.now().toString()}`;
        const notepadId = existing?.id ?? fallbackId;
        const name =
          categories.length === 1
            ? categories[0]
            : `${filterMode.toUpperCase()}: ${categories.join(" + ")}`;
        const definition: Omit<NotepadViewDefinition, "createdAt" | "updatedAt" | "revision"> = {
          id: notepadId,
          schemaVersion: existing?.schemaVersion ?? 1,
          name,
          description:
            categories.length === 1
              ? `Category notepad for ${categories[0]}`
              : `Multi-category notepad (${filterMode.toUpperCase()})`,
          isSystem: existing?.isSystem ?? false,
          filters: {
            ...(existing?.filters ?? {}),
            includeArchived: false,
            categories,
            labels: categories,
            categoryFilterMode: filterMode,
            categoryIds: resolved.categoryIds,
            labelIds: resolved.categoryIds
          },
          sorts: existing?.sorts ?? [{ field: "updatedAt", direction: "desc" }],
          captureDefaults: {
            ...(existing?.captureDefaults ?? {}),
            categories,
            labels: categories,
            categoryIds: resolved.categoryIds,
            labelIds: resolved.categoryIds
          },
          layoutMode: existing?.layoutMode ?? "outline"
        };
        const saved = await notepadSave({
          expectedRevision: existing?.revision,
          idempotencyKey: idempotencyKey(),
          definition
        });
        await loadNotepadsIntoState();
        uiDispatch({ type: "set_active_notepad", notepadId: saved.id });
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setSaving(false);
      }
    },
    [
      ensureCategoryRegistryEntries,
      isGateOpen,
      loadNotepadsIntoState,
      notepads,
      openNotepadV2Enabled,
      uiDispatch
    ]
  );

  useEffect(() => {
    if (!pendingCategoryOpen) {
      return;
    }
    void openCategoryNotepadFromPalette(pendingCategoryOpen).finally(() => {
      setPendingCategoryOpen(undefined);
    });
  }, [openCategoryNotepadFromPalette, pendingCategoryOpen]);

  const materializeMissingPlacements = useCallback(
    async (
      notepadId: string,
      atomItems: AtomRecord[],
      placementItems: PlacementRecord[],
      blockItems: BlockRecord[]
    ): Promise<{ placements: PlacementRecord[]; blocks: BlockRecord[] }> => {
      const atomIds = new Set(atomItems.map((atom) => atom.id));
      const nextBlocks = [...blockItems];
      const blocksByAtomId = new Map<string, BlockRecord>();
      for (const block of nextBlocks) {
        if (block.atomId) {
          blocksByAtomId.set(block.atomId, block);
        }
      }

      const missingAtomIds = atomItems
        .map((atom) => atom.id)
        .filter((atomId) => !blocksByAtomId.has(atomId));
      if (missingAtomIds.length > 0) {
        const missingLookups = await Promise.all(missingAtomIds.map((atomId) => blocksList({ atomId, limit: 1 })));
        for (const page of missingLookups) {
          const block = page.items[0];
          if (!block) {
            continue;
          }
          nextBlocks.push(block);
          if (block.atomId) {
            blocksByAtomId.set(block.atomId, block);
          }
        }
      }

      const existingBlockIds = new Set(placementItems.map((placement) => placement.blockId));
      const missingBlockIds = nextBlocks
        .filter((block) => block.atomId && atomIds.has(block.atomId))
        .map((block) => block.id)
        .filter((blockId, index, values) => values.indexOf(blockId) === index)
        .filter((blockId) => !existingBlockIds.has(blockId));

      if (missingBlockIds.length > 0) {
        for (const blockId of missingBlockIds) {
          await placementSave({
            viewId: notepadId,
            blockId,
            idempotencyKey: idempotencyKey()
          });
        }
      }

      const finalPlacements = missingBlockIds.length > 0
        ? await listAllPages((cursor) => placementsList({ viewId: notepadId, limit: 250, cursor }))
        : placementItems;
      const finalBlocks = missingBlockIds.length > 0
        ? await listAllPages((cursor) => blocksList({ notepadId, limit: 250, cursor }))
        : nextBlocks;

      return { placements: finalPlacements, blocks: finalBlocks };
    },
    []
  );

  const loadNotepadData = useCallback(
    async (notepadId: string): Promise<void> => {
      const queueEnabled = workspaceFlagEnabled(featureFlags, "workspace.decision_queue", true);
      const focusEnabled = workspaceFlagEnabled(featureFlags, "workspace.focus_sessions_v2", true);
      const [atomItems, activeConditions, pendingDecisionPage, snoozedDecisionPage, runningSessionsPage] = await Promise.all([
        listAllPages((cursor) => notepadAtomsList(notepadId, 250, cursor)),
        listAllPages((cursor) => conditionsList({ status: "active", limit: 250, cursor })),
        queueEnabled ? decisionsList({ status: "pending", limit: 250 }) : Promise.resolve({ items: [], totalApprox: 0 }),
        queueEnabled ? decisionsList({ status: "snoozed", limit: 250 }) : Promise.resolve({ items: [], totalApprox: 0 }),
        focusEnabled ? workSessionsList({ status: "running", limit: 1 }) : Promise.resolve({ items: [], totalApprox: 0 })
      ]);

      const [placementItems, blockItems] = await Promise.all([
        listAllPages((cursor) => placementsList({ viewId: notepadId, limit: 250, cursor })),
        listAllPages((cursor) => blocksList({ notepadId, limit: 250, cursor }))
      ]);

      const materialized = await materializeMissingPlacements(notepadId, atomItems, placementItems, blockItems);

      const nextBlocksById: Record<string, BlockRecord> = {};
      for (const block of materialized.blocks) {
        nextBlocksById[block.id] = block;
      }

      const nextAtomsById: Record<string, AtomRecord> = {};
      for (const atom of atomItems) {
        nextAtomsById[atom.id] = atom;
      }

      const nextConditionsByAtomId: Record<string, ConditionRecord[]> = {};
      for (const condition of activeConditions) {
        if (condition.status !== "active") {
          continue;
        }
        if (!nextConditionsByAtomId[condition.atomId]) {
          nextConditionsByAtomId[condition.atomId] = [];
        }
        nextConditionsByAtomId[condition.atomId].push(condition);
      }

      for (const atomId of Object.keys(nextConditionsByAtomId)) {
        nextConditionsByAtomId[atomId].sort((a, b) => {
          if (a.mode === b.mode) return 0;
          if (a.mode === "person") return -1;
          if (b.mode === "person") return 1;
          if (a.mode === "task") return -1;
          if (b.mode === "task") return 1;
          return 0;
        });
      }

      const sortedPlacements = sortPlacements(materialized.placements);
      setPlacements(sortedPlacements);
      setBlocksById(nextBlocksById);
      setAtomsById(nextAtomsById);
      setConditionsByAtomId(nextConditionsByAtomId);
      setDecisionQueue(
        queueEnabled
          ? [...pendingDecisionPage.items, ...snoozedDecisionPage.items].sort((a, b) => {
              if (a.priority !== b.priority) return a.priority - b.priority;
              return b.updatedAt.localeCompare(a.updatedAt);
            })
          : []
      );
      setRunningSession(focusEnabled ? runningSessionsPage.items[0] ?? null : null);
      const preferredSelectionId = selectedPlacementRef.current;
      const nextSelectionId =
        preferredSelectionId && sortedPlacements.some((placement) => placement.id === preferredSelectionId)
          ? preferredSelectionId
          : sortedPlacements[0]?.id;
      selectedPlacementRef.current = nextSelectionId;
      uiDispatch({
        type: "set_selected_placement",
        placementId: nextSelectionId
      });
    },
    [featureFlags, materializeMissingPlacements, uiDispatch]
  );

  const reloadActiveNotepad = useCallback(async (): Promise<void> => {
    if (!uiState.activeNotepadId) {
      return;
    }
    await loadWorkspaceGate();
    await loadNotepadData(uiState.activeNotepadId);
  }, [loadNotepadData, loadWorkspaceGate, uiState.activeNotepadId]);

  useEffect(() => {
    let cancelled = false;
    const boot = async (): Promise<void> => {
      setLoading(true);
      setError(undefined);
      try {
        await loadWorkspaceGate();
        const views = await loadNotepadsIntoState();
        if (cancelled) {
          return;
        }
        const nextId =
          views.find((view) => view.id === uiState.activeNotepadId)?.id ??
          views.find((view) => view.id === "now")?.id ??
          views[0]?.id;
        if (nextId) {
          uiDispatch({ type: "set_active_notepad", notepadId: nextId });
        } else {
          setLoading(false);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(asErrorMessage(nextError));
          setLoading(false);
        }
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadNotepadsIntoState, loadWorkspaceGate, uiDispatch, uiState.activeNotepadId]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!uiState.activeNotepadId) {
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        await loadNotepadData(uiState.activeNotepadId);
      } catch (nextError) {
        if (!cancelled) {
          setError(asErrorMessage(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadNotepadData, uiState.activeNotepadId]);

  useEffect(() => {
    return () => {
      for (const timer of saveTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      saveTimersRef.current.clear();
      if (dragUndoTimerRef.current) {
        window.clearTimeout(dragUndoTimerRef.current);
      }
    };
  }, []);

  const ensurePlacementVisible = useCallback(
    (placementId: string): void => {
      const container = document.querySelector<HTMLDivElement>(".notepad-tree");
      if (!container) {
        return;
      }
      const row = container.querySelector<HTMLElement>(`.notepad-row[data-placement-id="${placementId}"]`);
      if (!row) {
        return;
      }
      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;
      const viewportTop = container.scrollTop;
      const viewportBottom = viewportTop + container.clientHeight;

      if (rowTop < viewportTop) {
        container.scrollTop = rowTop;
      } else if (rowBottom > viewportBottom) {
        container.scrollTop = rowBottom - container.clientHeight;
      }
    },
    []
  );

  const focusEditorForPlacement = useCallback(
    (placementId: string): void => {
      ensurePlacementVisible(placementId);
      const attempt = (remaining: number): void => {
        const editor = document.querySelector<HTMLTextAreaElement>(`textarea[data-placement-id="${placementId}"]`);
        if (editor) {
          const shouldRefocus = document.activeElement !== editor;
          if (shouldRefocus) {
            editor.focus();
          }
          const pendingSelection = pendingEditorSelectionRef.current;
          if (pendingSelection?.placementId === placementId) {
            editor.setSelectionRange(pendingSelection.start, pendingSelection.end);
            pendingEditorSelectionRef.current = undefined;
          } else if (shouldRefocus) {
            placeCaretAtEnd(editor);
          }
          pendingEditorFocusPlacementIdRef.current = undefined;
          uiDispatch({ type: "set_interaction_mode", mode: "edit" });
          return;
        }
        if (remaining <= 0) {
          return;
        }
        window.setTimeout(() => {
          window.requestAnimationFrame(() => attempt(remaining - 1));
        }, 16);
      };
      attempt(12);
    },
    [ensurePlacementVisible, uiDispatch]
  );

  const focusEditorSelectionForPlacement = useCallback(
    (placementId: string, start: number, end: number): void => {
      ensurePlacementVisible(placementId);
      const attempt = (remaining: number): void => {
        const editor = document.querySelector<HTMLTextAreaElement>(`textarea[data-placement-id="${placementId}"]`);
        if (editor) {
          editor.focus();
          editor.setSelectionRange(start, end);
          uiDispatch({ type: "set_interaction_mode", mode: "edit" });
          return;
        }
        if (remaining <= 0) {
          return;
        }
        window.setTimeout(() => {
          window.requestAnimationFrame(() => attempt(remaining - 1));
        }, 16);
      };
      attempt(12);
    },
    [ensurePlacementVisible, uiDispatch]
  );

  useEffect(() => {
    if (!uiState.selectedPlacementId) {
      return;
    }
    ensurePlacementVisible(uiState.selectedPlacementId);
  }, [ensurePlacementVisible, uiState.selectedPlacementId]);

  useEffect(() => {
    const selectedPlacementId = uiState.selectedPlacementId;
    if (!selectedPlacementId) {
      return;
    }
    if (pendingEditorFocusPlacementIdRef.current === selectedPlacementId) {
      return;
    }
    if (treeData.rowByPlacementId[selectedPlacementId]) {
      return;
    }

    let fallback = treeData.effectiveParentByPlacementId[selectedPlacementId];
    while (fallback && !treeData.rowByPlacementId[fallback]) {
      fallback = treeData.effectiveParentByPlacementId[fallback];
    }
    if (!fallback) {
      fallback = treeData.flatRows[0]?.placement.id;
    }
    uiDispatch({ type: "set_selected_placement", placementId: fallback });
    uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
  }, [
    treeData.effectiveParentByPlacementId,
    treeData.flatRows,
    treeData.rowByPlacementId,
    uiDispatch,
    uiState.selectedPlacementId
  ]);

  useEffect(() => {
    const pendingPlacementId = pendingEditorFocusPlacementIdRef.current;
    if (!pendingPlacementId) {
      return;
    }
    if (uiState.selectedPlacementId !== pendingPlacementId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusEditorForPlacement(pendingPlacementId);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [focusEditorForPlacement, treeData.flatRows, uiState.selectedPlacementId]);

  const applyInlineTagsToAtom = useCallback(
    async (atom: AtomRecord, nextText: string): Promise<AtomRecord> => {
      if (!inlineTagsEnabled) {
        return atom;
      }
      const tags = extractInlineTags(nextText);
      if (tags.length === 0) {
        return atom;
      }
      const entries = await registryEntriesList({ status: "active", limit: 1000 });
      const byAlias = new Map<string, RegistryEntry>();
      for (const entry of entries.items) {
        byAlias.set(normalizeTagName(entry.name), entry);
        for (const alias of entry.aliases) {
          byAlias.set(normalizeTagName(alias), entry);
        }
      }

      const nextThreadIds = new Set(atom.relations.threadIds ?? []);
      const nextLabels = new Set(atom.facetData.meta?.labels ?? []);
      const nextCategories = new Set(atom.facetData.meta?.categories ?? []);

      for (const tag of tags) {
        const normalized = normalizeTagName(tag);
        if (!normalized) {
          continue;
        }
        let entry = byAlias.get(normalized);
        if (!entry) {
          entry = await registryEntrySave({
            kind: "category",
            name: normalized,
            aliases: [],
            status: "active"
          });
          byAlias.set(normalized, entry);
        }

        nextLabels.add(entry.name);
        if (entry.kind === "thread") {
          nextThreadIds.add(entry.id);
        } else {
          nextCategories.add(entry.name);
        }
      }

      const mergedThreadIds = uniqueLowercase([...nextThreadIds]);
      const mergedLabels = uniqueLowercase([...nextLabels]);
      const mergedCategories = uniqueLowercase([...nextCategories]);
      const unchanged =
        mergedThreadIds.length === (atom.relations.threadIds ?? []).length &&
        mergedLabels.length === (atom.facetData.meta?.labels ?? []).length &&
        mergedCategories.length === (atom.facetData.meta?.categories ?? []).length &&
        mergedThreadIds.every((value, index) => value === (atom.relations.threadIds ?? [])[index]) &&
        mergedLabels.every((value, index) => value === (atom.facetData.meta?.labels ?? [])[index]) &&
        mergedCategories.every((value, index) => value === (atom.facetData.meta?.categories ?? [])[index]);

      if (unchanged) {
        return atom;
      }

      const latestAtom = (await atomGet(atom.id)) ?? atom;
      return atomUpdate(latestAtom.id, {
        expectedRevision: latestAtom.revision,
        relationsPatch: {
          ...latestAtom.relations,
          threadIds: mergedThreadIds
        },
        facetDataPatch: {
          meta: {
            ...(latestAtom.facetData.meta ?? {}),
            labels: mergedLabels,
            categories: mergedCategories
          }
        }
      });
    },
    [inlineTagsEnabled]
  );

  const persistRowText = useCallback(
    async (row: FlatRow, nextText: string): Promise<void> => {
      const atom = row.atom;
      if (!atom) {
        return;
      }
      if (nextText === row.block.text) {
        uiDispatch({ type: "clear_draft", placementId: row.placement.id });
        return;
      }

      try {
        let updatedAtom = await atomUpdate(atom.id, {
          expectedRevision: atom.revision,
          rawText: nextText
        });
        updatedAtom = await applyInlineTagsToAtom(updatedAtom, nextText);
        const latestBlock = await blockGet(row.block.id);
        setAtomsById((current) => ({ ...current, [updatedAtom.id]: updatedAtom }));
        if (latestBlock) {
          setBlocksById((current) => ({ ...current, [latestBlock.id]: latestBlock }));
        }
        uiDispatch({ type: "clear_draft", placementId: row.placement.id });
      } catch (nextError) {
        setError(asErrorMessage(nextError));
        await reloadActiveNotepad();
      }
    },
    [applyInlineTagsToAtom, reloadActiveNotepad, uiDispatch]
  );

  const scheduleDraftSave = useCallback(
    (row: FlatRow, nextText: string): void => {
      uiDispatch({ type: "set_draft", placementId: row.placement.id, draft: nextText });
      const existingTimer = saveTimersRef.current.get(row.placement.id);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      const timer = window.setTimeout(() => {
        void persistRowText(row, nextText);
      }, 450);
      saveTimersRef.current.set(row.placement.id, timer);
    },
    [persistRowText, uiDispatch]
  );

  const flushDraft = useCallback(
    async (placementId: string): Promise<void> => {
      const timer = saveTimersRef.current.get(placementId);
      if (timer) {
        window.clearTimeout(timer);
        saveTimersRef.current.delete(placementId);
      }
      const row = treeData.rowByPlacementId[placementId];
      const draft = uiState.draftsByPlacement[placementId];
      if (!row || draft === undefined) {
        return;
      }
      await persistRowText(row, draft);
    },
    [persistRowText, treeData.rowByPlacementId, uiState.draftsByPlacement]
  );

  const runMutation = useCallback(
    async (mutation: () => Promise<void>): Promise<boolean> => {
      setSaving(true);
      setError(undefined);
      try {
        await mutation();
        await reloadActiveNotepad();
        return true;
      } catch (nextError) {
        setError(asErrorMessage(nextError));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [reloadActiveNotepad]
  );

  const snapshotSignature = useCallback((snapshot: StructuralSnapshot): string => {
    return JSON.stringify({
      placements: snapshot.placements,
      orderedPlacementIds: snapshot.orderedPlacementIds,
      atoms: snapshot.atoms.map((atom) => ({
        id: atom.id,
        rawText: atom.rawText,
        facetData: atom.facetData,
        relations: atom.relations,
        body: atom.body,
        archivedAt: atom.archivedAt
      })),
      selectedPlacementId: snapshot.selectedPlacementId
    });
  }, []);

  const captureStructuralSnapshot = useCallback(async (): Promise<StructuralSnapshot | undefined> => {
    if (!uiState.activeNotepadId) {
      return undefined;
    }
    const placementsInView = sortPlacements(
      await listAllPages((cursor) => placementsList({ viewId: uiState.activeNotepadId!, limit: 250, cursor }))
    );
    const blockIds = Array.from(new Set(placementsInView.map((placement) => placement.blockId)));
    const blocks = (
      await Promise.all(blockIds.map(async (blockId) => blockGet(blockId)))
    ).filter((block): block is BlockRecord => !!block);
    const atomIds = Array.from(new Set(blocks.map((block) => block.atomId).filter((value): value is string => !!value)));
    const atoms = (
      await Promise.all(atomIds.map(async (atomIdValue) => atomGet(atomIdValue)))
    ).filter((atom): atom is AtomRecord => !!atom);

    return {
      notepadId: uiState.activeNotepadId,
      placements: placementsInView.map((placement) => ({
        id: placement.id,
        viewId: placement.viewId,
        blockId: placement.blockId,
        parentPlacementId: placement.parentPlacementId,
        orderKey: placement.orderKey,
        pinned: placement.pinned
      })),
      orderedPlacementIds: placementsInView.map((placement) => placement.id),
      atoms: atoms.map((atom) => deepClone(atom)),
      selectedPlacementId: selectedPlacementRef.current
    };
  }, [uiState.activeNotepadId]);

  const applyStructuralSnapshot = useCallback(
    async (snapshot: StructuralSnapshot, directionLabel: "undo" | "redo"): Promise<boolean> => {
      if (!isGateOpen || !snapshot.notepadId) {
        return false;
      }

      if (uiState.activeNotepadId !== snapshot.notepadId) {
        uiDispatch({ type: "set_active_notepad", notepadId: snapshot.notepadId });
        await loadNotepadData(snapshot.notepadId);
      }

      const snapshotPlacementById = new Map(snapshot.placements.map((placement) => [placement.id, placement]));
      const snapshotBlockIds = new Set(snapshot.placements.map((placement) => placement.blockId));
      const snapshotAtomIds = new Set(snapshot.atoms.map((atom) => atom.id));

      const applied = await runMutation(async () => {
        const currentPlacements = await listAllPages((cursor) =>
          placementsList({ viewId: snapshot.notepadId, limit: 250, cursor })
        );
        const currentPlacementById = new Map(currentPlacements.map((placement) => [placement.id, placement]));
        const extraBlockIds = new Set<string>();

        for (const placement of currentPlacements) {
          if (!snapshotPlacementById.has(placement.id)) {
            extraBlockIds.add(placement.blockId);
            await placementDelete(placement.id, idempotencyKey());
          }
        }

        for (const placementId of snapshot.orderedPlacementIds) {
          const placement = snapshotPlacementById.get(placementId);
          if (!placement) {
            continue;
          }
          const existing = currentPlacementById.get(placement.id);
          await placementSave({
            id: placement.id,
            viewId: placement.viewId,
            blockId: placement.blockId,
            parentPlacementId: placement.parentPlacementId,
            orderKey: placement.orderKey,
            pinned: placement.pinned,
            expectedRevision: existing?.revision,
            idempotencyKey: idempotencyKey()
          });
        }

        if (snapshot.orderedPlacementIds.length > 1) {
          await placementsReorder(snapshot.notepadId, {
            orderedPlacementIds: snapshot.orderedPlacementIds,
            idempotencyKey: idempotencyKey()
          });
        }

        for (const snapshotAtom of snapshot.atoms) {
          let latestAtom = await atomGet(snapshotAtom.id);
          if (!latestAtom) {
            continue;
          }

          if (snapshotAtom.archivedAt && !latestAtom.archivedAt) {
            latestAtom = await atomArchive(latestAtom.id, {
              expectedRevision: latestAtom.revision,
              reason: `notepad_structure_${directionLabel}`
            });
          } else if (!snapshotAtom.archivedAt && latestAtom.archivedAt) {
            const reopenStatus =
              snapshotAtom.facetData.task?.status === "doing" || snapshotAtom.facetData.task?.status === "blocked"
                ? snapshotAtom.facetData.task.status
                : "todo";
            latestAtom = await taskReopen(latestAtom.id, {
              expectedRevision: latestAtom.revision,
              status: reopenStatus
            });
          }

          await atomUpdate(latestAtom.id, {
            expectedRevision: latestAtom.revision,
            rawText: snapshotAtom.rawText,
            facetDataPatch: deepClone(snapshotAtom.facetData),
            relationsPatch: {
              parentId: snapshotAtom.relations.parentId,
              blockedByAtomId: snapshotAtom.relations.blockedByAtomId,
              threadIds: [...(snapshotAtom.relations.threadIds ?? [])],
              derivedFromAtomId: snapshotAtom.relations.derivedFromAtomId
            },
            clearParentId: snapshotAtom.relations.parentId ? undefined : true,
            bodyPatch: { mode: "replace", value: snapshotAtom.body ?? "" }
          });
        }

        for (const extraBlockId of extraBlockIds) {
          if (snapshotBlockIds.has(extraBlockId)) {
            continue;
          }
          const placementsForBlock = await listAllPages((cursor) =>
            placementsList({ blockId: extraBlockId, limit: 250, cursor })
          );
          if (placementsForBlock.length > 0) {
            continue;
          }
          const block = await blockGet(extraBlockId);
          if (!block?.atomId || snapshotAtomIds.has(block.atomId)) {
            continue;
          }
          const latestAtom = await atomGet(block.atomId);
          if (latestAtom && !latestAtom.archivedAt) {
            await atomArchive(latestAtom.id, {
              expectedRevision: latestAtom.revision,
              reason: `notepad_structure_${directionLabel}_cleanup`
            });
          }
        }
      });

      if (!applied) {
        return false;
      }

      const fallbackPlacementId = snapshot.selectedPlacementId ?? snapshot.orderedPlacementIds[0];
      selectedPlacementRef.current = fallbackPlacementId;
      uiDispatch({ type: "set_selected_placement", placementId: fallbackPlacementId });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
      return true;
    },
    [isGateOpen, loadNotepadData, runMutation, uiDispatch, uiState.activeNotepadId]
  );

  const runStructuralMutation = useCallback(
    async (label: string, mutation: () => Promise<void>): Promise<boolean> => {
      if (applyingStructuralHistoryRef.current) {
        return runMutation(mutation);
      }
      const before = await captureStructuralSnapshot();
      const mutated = await runMutation(mutation);
      if (!mutated || !before) {
        return mutated;
      }
      const after = await captureStructuralSnapshot();
      if (!after) {
        return mutated;
      }

      if (snapshotSignature(before) === snapshotSignature(after)) {
        return mutated;
      }

      structuralUndoRef.current.push({ label, before, after });
      if (structuralUndoRef.current.length > STRUCTURAL_HISTORY_LIMIT) {
        structuralUndoRef.current.shift();
      }
      structuralRedoRef.current = [];
      return mutated;
    },
    [captureStructuralSnapshot, runMutation, snapshotSignature]
  );

  const undoStructuralChange = useCallback(async (): Promise<void> => {
    if (structuralUndoRef.current.length === 0) {
      announceDragAction("Nothing to undo.");
      return;
    }
    const entry = structuralUndoRef.current[structuralUndoRef.current.length - 1];
    applyingStructuralHistoryRef.current = true;
    try {
      const applied = await applyStructuralSnapshot(entry.before, "undo");
      if (!applied) {
        return;
      }
      structuralUndoRef.current.pop();
      structuralRedoRef.current.push(entry);
      if (structuralRedoRef.current.length > STRUCTURAL_HISTORY_LIMIT) {
        structuralRedoRef.current.shift();
      }
      announceDragAction(`Undid ${entry.label}.`);
    } finally {
      applyingStructuralHistoryRef.current = false;
    }
  }, [announceDragAction, applyStructuralSnapshot]);

  const redoStructuralChange = useCallback(async (): Promise<void> => {
    if (structuralRedoRef.current.length === 0) {
      announceDragAction("Nothing to redo.");
      return;
    }
    const entry = structuralRedoRef.current[structuralRedoRef.current.length - 1];
    applyingStructuralHistoryRef.current = true;
    try {
      const applied = await applyStructuralSnapshot(entry.after, "redo");
      if (!applied) {
        return;
      }
      structuralRedoRef.current.pop();
      structuralUndoRef.current.push(entry);
      if (structuralUndoRef.current.length > STRUCTURAL_HISTORY_LIMIT) {
        structuralUndoRef.current.shift();
      }
      announceDragAction(`Redid ${entry.label}.`);
    } finally {
      applyingStructuralHistoryRef.current = false;
    }
  }, [announceDragAction, applyStructuralSnapshot]);

  const updateCanonicalParent = useCallback(async (atom: AtomRecord | undefined, parentAtomId?: string): Promise<void> => {
    if (!atom) {
      return;
    }
    const targetParentId = parentAtomId ?? undefined;
    const hasTargetParent = (target: AtomRecord): boolean => (target.relations.parentId ?? undefined) === targetParentId;
    const patchParent = async (target: AtomRecord): Promise<void> => {
      await atomUpdate(target.id, {
        expectedRevision: target.revision,
        relationsPatch: targetParentId ? { parentId: targetParentId } : undefined,
        clearParentId: targetParentId ? undefined : true
      });
    };

    const latestBeforeUpdate = (await atomGet(atom.id)) ?? atom;
    if (hasTargetParent(latestBeforeUpdate)) {
      return;
    }

    try {
      await patchParent(latestBeforeUpdate);
    } catch (nextError) {
      if (!isConflictError(nextError)) {
        throw nextError;
      }
      const latestAfterConflict = await atomGet(atom.id);
      if (!latestAfterConflict || hasTargetParent(latestAfterConflict)) {
        return;
      }
      await patchParent(latestAfterConflict);
    }
  }, []);

  const updatePlacementParent = useCallback(async (row: FlatRow, parentPlacementId?: string): Promise<void> => {
    if (row.placement.parentPlacementId === parentPlacementId) {
      return;
    }
    await placementSave({
      id: row.placement.id,
      viewId: row.placement.viewId,
      blockId: row.placement.blockId,
      parentPlacementId,
      orderKey: row.placement.orderKey,
      pinned: row.placement.pinned,
      expectedRevision: row.placement.revision,
      idempotencyKey: idempotencyKey()
    });
  }, []);

  const findPlacementForBlockInView = useCallback(async (blockId: string, viewId: string): Promise<PlacementRecord | undefined> => {
    const page = await placementsList({ viewId, blockId, limit: 25 });
    return sortPlacements(page.items)[0];
  }, []);

  const insertSiblingBeforeAndKeepFocus = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!uiState.activeNotepadId || !isGateOpen) {
        return;
      }
      await flushDraft(row.placement.id);
      const parentPlacementId = row.effectiveParentPlacementId;
      const parentRow = parentPlacementId ? treeData.rowByPlacementId[parentPlacementId] : undefined;
      const parentAtomId = parentRow?.atom?.id;

      await runStructuralMutation("insert-row-above", async () => {
        const created = await notepadBlockCreate({
          notepadId: uiState.activeNotepadId,
          rawText: ""
        });
        let createdPlacement = await findPlacementForBlockInView(created.id, uiState.activeNotepadId);
        if (!createdPlacement) {
          throw new Error("Unable to locate placement for newly created row");
        }

        if (createdPlacement.parentPlacementId !== parentPlacementId) {
          createdPlacement = await placementSave({
            id: createdPlacement.id,
            viewId: createdPlacement.viewId,
            blockId: createdPlacement.blockId,
            parentPlacementId,
            orderKey: createdPlacement.orderKey,
            pinned: createdPlacement.pinned,
            expectedRevision: createdPlacement.revision,
            idempotencyKey: idempotencyKey()
          });
        }

        const reordered = treeData.orderedPlacementIds.filter((placementId) => placementId !== createdPlacement.id);
        const insertionIndex = reordered.indexOf(row.placement.id);
        if (insertionIndex === -1) {
          reordered.push(createdPlacement.id);
        } else {
          reordered.splice(insertionIndex, 0, createdPlacement.id);
        }
        if (reordered.length > 1) {
          await placementsReorder(uiState.activeNotepadId, {
            orderedPlacementIds: reordered,
            idempotencyKey: idempotencyKey()
          });
        }

        if (created.atomId && parentAtomId) {
          const createdAtom = await atomGet(created.atomId);
          if (createdAtom) {
            await updateCanonicalParent(createdAtom, parentAtomId);
          }
        }

        selectedPlacementRef.current = row.placement.id;
        pendingEditorFocusPlacementIdRef.current = row.placement.id;
        pendingEditorSelectionRef.current = {
          placementId: row.placement.id,
          start: 0,
          end: 0
        };
        uiDispatch({ type: "set_selected_placement", placementId: row.placement.id });
        uiDispatch({ type: "set_interaction_mode", mode: "edit" });
      });
    },
    [
      findPlacementForBlockInView,
      flushDraft,
      isGateOpen,
      runStructuralMutation,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      updateCanonicalParent
    ]
  );

  const createRow = useCallback(
    async (
      mode: "sibling" | "child",
      options?: { anchorRow?: FlatRow; focusEditor?: boolean }
    ): Promise<void> => {
      if (!uiState.activeNotepadId || !isGateOpen) {
        return;
      }
      const anchorRow = options?.anchorRow ?? (uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined);
      const parentPlacementId = mode === "child" ? anchorRow?.placement.id : anchorRow?.effectiveParentPlacementId;
      const parentRow = parentPlacementId ? treeData.rowByPlacementId[parentPlacementId] : undefined;
      const parentAtomId = parentRow?.atom?.id;

      if (anchorRow) {
        await flushDraft(anchorRow.placement.id);
      }

      await runStructuralMutation("create-row", async () => {
        const created = await notepadBlockCreate({
          notepadId: uiState.activeNotepadId,
          rawText: ""
        });
        let createdPlacement = await findPlacementForBlockInView(created.id, uiState.activeNotepadId);
        if (!createdPlacement) {
          throw new Error("Unable to locate placement for newly created row");
        }

        if (createdPlacement.parentPlacementId !== parentPlacementId) {
          createdPlacement = await placementSave({
            id: createdPlacement.id,
            viewId: createdPlacement.viewId,
            blockId: createdPlacement.blockId,
            parentPlacementId,
            orderKey: createdPlacement.orderKey,
            pinned: createdPlacement.pinned,
            expectedRevision: createdPlacement.revision,
            idempotencyKey: idempotencyKey()
          });
        }

        const anchorPlacementId = anchorRow?.placement.id;
        const reordered = insertPlacementAfter(treeData.orderedPlacementIds, createdPlacement.id, anchorPlacementId);
        if (reordered.length > 1) {
          await placementsReorder(uiState.activeNotepadId, {
            orderedPlacementIds: reordered,
            idempotencyKey: idempotencyKey()
          });
        }

        if (created.atomId && parentAtomId) {
          const createdAtom = await atomGet(created.atomId);
          if (createdAtom) {
            await updateCanonicalParent(createdAtom, parentAtomId);
          }
        }
        if (options?.focusEditor) {
          pendingEditorFocusPlacementIdRef.current = createdPlacement.id;
          uiDispatch({ type: "set_interaction_mode", mode: "edit" });
        } else {
          uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        }
        selectedPlacementRef.current = createdPlacement.id;
        uiDispatch({ type: "set_selected_placement", placementId: createdPlacement.id });
      });
    },
    [
      findPlacementForBlockInView,
      flushDraft,
      isGateOpen,
      runStructuralMutation,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      uiState.selectedPlacementId,
      updateCanonicalParent
    ]
  );

  const indentSelected = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row || !isGateOpen) {
      return;
    }
    const index = treeData.flatRows.findIndex((value) => value.placement.id === row.placement.id);
    if (index <= 0) {
      return;
    }
    const previousVisible = treeData.flatRows[index - 1];
    if (!previousVisible) {
      return;
    }

    await runStructuralMutation("indent-row", async () => {
      await updatePlacementParent(row, previousVisible.placement.id);
      await updateCanonicalParent(row.atom, previousVisible.atom?.id);
    });
  }, [
    isGateOpen,
    runStructuralMutation,
    treeData.flatRows,
    treeData.rowByPlacementId,
    uiState.selectedPlacementId,
    updateCanonicalParent,
    updatePlacementParent
  ]);

  const outdentSelected = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row || !isGateOpen) {
      return;
    }
    const currentParentPlacementId = row.effectiveParentPlacementId;
    if (!currentParentPlacementId) {
      return;
    }
    const parentRow = treeData.rowByPlacementId[currentParentPlacementId];
    const nextParentPlacementId = parentRow?.effectiveParentPlacementId;
    const nextParentAtomId = nextParentPlacementId
      ? treeData.rowByPlacementId[nextParentPlacementId]?.atom?.id
      : undefined;

    await runStructuralMutation("outdent-row", async () => {
      await updatePlacementParent(row, nextParentPlacementId);
      await updateCanonicalParent(row.atom, nextParentAtomId);
    });
  }, [
    isGateOpen,
    runStructuralMutation,
    treeData.rowByPlacementId,
    uiState.selectedPlacementId,
    updateCanonicalParent,
    updatePlacementParent
  ]);

  const dropReorderRow = useCallback(
    async (
      sourcePlacementId: string,
      targetPlacementId: string,
      intent: PlacementDropIntent,
      options?: { trackUndo?: boolean; announce?: boolean }
    ): Promise<void> => {
      if (!uiState.activeNotepadId || !isGateOpen) {
        return;
      }
      const sourceRow = treeData.rowByPlacementId[sourcePlacementId];
      if (!sourceRow) {
        return;
      }
      const targetRow = treeData.rowByPlacementId[targetPlacementId];
      const visibleSubtreeIds = collectVisibleSubtreePlacementIds(treeData.flatRows, sourcePlacementId);
      const canonicalSubtreeIds = collectSubtreePlacementIds(
        sourcePlacementId,
        treeData.effectiveParentByPlacementId,
        treeData.orderedPlacementIds
      );
      const movedSet = new Set<string>([...canonicalSubtreeIds, ...visibleSubtreeIds]);
      const movedPlacementIds = treeData.orderedPlacementIds.filter((placementId) => movedSet.has(placementId));

      const dropPlan = planPlacementDrop({
        orderedPlacementIds: treeData.orderedPlacementIds,
        effectiveParentByPlacementId: treeData.effectiveParentByPlacementId,
        sourcePlacementId,
        targetPlacementId,
        intent,
        movedPlacementIds
      });
      if (!dropPlan) {
        return;
      }

      await flushDraft(sourcePlacementId);
      const previousOrderedPlacementIds = [...treeData.orderedPlacementIds];
      const previousParentPlacementId = sourceRow.placement.parentPlacementId;
      const previousCanonicalParentAtomId = sourceRow.atom?.relations.parentId;
      const nextParentAtomId = dropPlan.nextParentPlacementId
        ? treeData.rowByPlacementId[dropPlan.nextParentPlacementId]?.atom?.id
        : undefined;
      const orderChanged =
        dropPlan.orderedPlacementIds.length === treeData.orderedPlacementIds.length &&
        dropPlan.orderedPlacementIds.some(
          (placementId, index) => placementId !== treeData.orderedPlacementIds[index]
        );

      const mutated = await runStructuralMutation(
        intent === "inside" ? "nest-block" : "move-block",
        async () => {
        await updatePlacementParent(sourceRow, dropPlan.nextParentPlacementId);
        await updateCanonicalParent(sourceRow.atom, nextParentAtomId);
        if (orderChanged) {
          await placementsReorder(uiState.activeNotepadId, {
            orderedPlacementIds: dropPlan.orderedPlacementIds,
            idempotencyKey: idempotencyKey()
          });
        }
        selectedPlacementRef.current = sourcePlacementId;
        uiDispatch({ type: "set_selected_placement", placementId: sourcePlacementId });
        uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        }
      );
      if (!mutated) {
        return;
      }

      const sourceTitle = rowTitle(sourceRow);
      const targetTitle = targetRow ? rowTitle(targetRow) : "target row";
      const movedRowCount = dropPlan.movedPlacementIds.length;

      if (options?.trackUndo !== false) {
        queueDragUndo({
          notepadId: uiState.activeNotepadId,
          sourcePlacementId,
          previousOrderedPlacementIds,
          previousParentPlacementId,
          previousCanonicalParentAtomId,
          message:
            movedRowCount > 1
              ? `Moved block (${movedRowCount} rows).`
              : `Moved "${sourceTitle}".`
        });
      }

      if (options?.announce !== false) {
        if (intent === "inside") {
          announceDragAction(`Nested ${sourceTitle} under ${targetTitle}.`);
        } else if (intent === "before") {
          announceDragAction(`Moved ${sourceTitle} above ${targetTitle}.`);
        } else {
          announceDragAction(`Moved ${sourceTitle} below ${targetTitle}.`);
        }
      }
    },
    [
      announceDragAction,
      flushDraft,
      isGateOpen,
      queueDragUndo,
      runStructuralMutation,
      treeData.effectiveParentByPlacementId,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      updateCanonicalParent,
      updatePlacementParent
    ]
  );

  const undoLastDrop = useCallback(async (): Promise<void> => {
    if (!dragUndo || !isGateOpen || !uiState.activeNotepadId || dragUndo.notepadId !== uiState.activeNotepadId) {
      return;
    }
    const sourceRow = treeData.rowByPlacementId[dragUndo.sourcePlacementId];
    if (!sourceRow) {
      clearDragUndo();
      return;
    }

    clearDragUndo();
    await flushDraft(dragUndo.sourcePlacementId);
    const currentPlacementIds = treeData.orderedPlacementIds;
    const canRestoreOrder =
      currentPlacementIds.length === dragUndo.previousOrderedPlacementIds.length &&
      dragUndo.previousOrderedPlacementIds.every((placementId) => currentPlacementIds.includes(placementId));

    const reverted = await runMutation(async () => {
      await updatePlacementParent(sourceRow, dragUndo.previousParentPlacementId);
      await updateCanonicalParent(sourceRow.atom, dragUndo.previousCanonicalParentAtomId);
      if (canRestoreOrder) {
        await placementsReorder(uiState.activeNotepadId, {
          orderedPlacementIds: dragUndo.previousOrderedPlacementIds,
          idempotencyKey: idempotencyKey()
        });
      }
      selectedPlacementRef.current = sourceRow.placement.id;
      uiDispatch({ type: "set_selected_placement", placementId: sourceRow.placement.id });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    });

    if (!reverted) {
      return;
    }
    if (!canRestoreOrder) {
      setError("Undo restored hierarchy, but ordering changed before undo could be applied.");
    }
    announceDragAction("Last drag action undone.");
  }, [
    announceDragAction,
    clearDragUndo,
    dragUndo,
    flushDraft,
    isGateOpen,
    runMutation,
    treeData.orderedPlacementIds,
    treeData.rowByPlacementId,
    uiDispatch,
    uiState.activeNotepadId,
    updateCanonicalParent,
    updatePlacementParent
  ]);

  const reorderSelected = useCallback(
    async (direction: "up" | "down"): Promise<void> => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      if (!row || !uiState.activeNotepadId || !isGateOpen) {
        return;
      }

      const visibleSubtreeIds = collectVisibleSubtreePlacementIds(treeData.flatRows, row.placement.id);
      const rowIndex = treeData.flatRows.findIndex((value) => value.placement.id === row.placement.id);
      if (rowIndex === -1) {
        return;
      }
      const subtreeEndIndex = rowIndex + Math.max(0, visibleSubtreeIds.length - 1);

      if (direction === "up") {
        const targetRow = treeData.flatRows[rowIndex - 1];
        if (!targetRow) {
          return;
        }
        await dropReorderRow(row.placement.id, targetRow.placement.id, "before", { trackUndo: false, announce: false });
        announceDragAction(`Moved ${rowTitle(row)} up.`);
        return;
      }

      const targetRow = treeData.flatRows[subtreeEndIndex + 1];
      if (!targetRow) {
        return;
      }
      await dropReorderRow(row.placement.id, targetRow.placement.id, "after", { trackUndo: false, announce: false });
      announceDragAction(`Moved ${rowTitle(row)} down.`);
    },
    [
      announceDragAction,
      dropReorderRow,
      isGateOpen,
      treeData.flatRows,
      treeData.rowByPlacementId,
      uiState.activeNotepadId,
      uiState.selectedPlacementId
    ]
  );

  const deleteRow = useCallback(
    async (row: FlatRow, options?: { preferPrevious?: boolean; focusEditor?: boolean }): Promise<void> => {
      if (!isGateOpen) {
        return;
      }
      const draftedText = rowText(row, uiState.draftsByPlacement[row.placement.id]);
      const deletingEmptyLine = draftedText.trim().length === 0;
      await flushDraft(row.placement.id);
      const index = treeData.flatRows.findIndex((value) => value.placement.id === row.placement.id);
      const previousPlacementId = treeData.flatRows[index - 1]?.placement.id;
      const nextPlacementId = treeData.flatRows[index + 1]?.placement.id;
      const fallbackSelection = options?.preferPrevious
        ? previousPlacementId ?? nextPlacementId
        : nextPlacementId ?? previousPlacementId;
      if (options?.focusEditor && fallbackSelection) {
        pendingEditorFocusPlacementIdRef.current = fallbackSelection;
        uiDispatch({ type: "set_interaction_mode", mode: "edit" });
      } else {
        uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
      }
      selectedPlacementRef.current = fallbackSelection;
      uiDispatch({ type: "set_selected_placement", placementId: fallbackSelection });

      await runStructuralMutation("delete-row", async () => {
        await placementDelete(row.placement.id, idempotencyKey());
        const remainingPlacements = await listAllPages((cursor) => placementsList({ blockId: row.block.id, limit: 250, cursor }));
        if (!row.atom) {
          return;
        }
        const latestAtom = await atomGet(row.atom.id);
        if (!latestAtom) {
          return;
        }

        if (deletingEmptyLine) {
          for (const placement of remainingPlacements) {
            await placementDelete(placement.id, idempotencyKey());
          }
          const archivedAtom = latestAtom.archivedAt
            ? latestAtom
            : await atomArchive(latestAtom.id, {
                expectedRevision: latestAtom.revision,
                reason: "notepad_empty_row_deleted"
              });

          void archivedAtom;
          return;
        }

        if (remainingPlacements.length > 0) {
          return;
        }

        await atomArchive(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          reason: "notepad_last_placement_removed"
        });
      });
    },
    [flushDraft, isGateOpen, runStructuralMutation, treeData.flatRows, uiDispatch, uiState.draftsByPlacement]
  );

  const copyOrCutSelected = useCallback(
    (mode: "copy" | "cut"): void => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      if (!row || !uiState.activeNotepadId || !isGateOpen) {
        return;
      }
      uiDispatch({
        type: "set_clipboard",
        clipboard: {
          blockId: row.block.id,
          sourcePlacementId: row.placement.id,
          sourceViewId: uiState.activeNotepadId,
          mode
        }
      });
    },
    [isGateOpen, treeData.rowByPlacementId, uiDispatch, uiState.activeNotepadId, uiState.selectedPlacementId]
  );

  const pasteAfterSelected = useCallback(async (): Promise<void> => {
    const clipboard = uiState.clipboard;
    if (!clipboard || !uiState.activeNotepadId || !isGateOpen) {
      return;
    }
    const target = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    const targetParentPlacementId = target?.effectiveParentPlacementId;

    await runStructuralMutation("paste-row", async () => {
      let destinationPlacementId: string | undefined;

      if (clipboard.mode === "cut" && clipboard.sourceViewId === uiState.activeNotepadId) {
        const sourceRow = treeData.rowByPlacementId[clipboard.sourcePlacementId];
        if (!sourceRow) {
          uiDispatch({ type: "set_clipboard", clipboard: null });
          return;
        }
        await updatePlacementParent(sourceRow, targetParentPlacementId);
        destinationPlacementId = sourceRow.placement.id;
      } else {
        const saved = await placementSave({
          viewId: uiState.activeNotepadId,
          blockId: clipboard.blockId,
          parentPlacementId: targetParentPlacementId,
          idempotencyKey: idempotencyKey()
        });
        destinationPlacementId = saved.id;
      }

      const reordered = insertPlacementAfter(treeData.orderedPlacementIds, destinationPlacementId, target?.placement.id);
      if (reordered.length > 1) {
        await placementsReorder(uiState.activeNotepadId, {
          orderedPlacementIds: reordered,
          idempotencyKey: idempotencyKey()
        });
      }

      if (
        clipboard.mode === "cut" &&
        !(clipboard.sourceViewId === uiState.activeNotepadId && clipboard.sourcePlacementId === destinationPlacementId)
      ) {
        await placementDelete(clipboard.sourcePlacementId, idempotencyKey());
        uiDispatch({ type: "set_clipboard", clipboard: null });
      }

      selectedPlacementRef.current = destinationPlacementId;
      uiDispatch({ type: "set_selected_placement", placementId: destinationPlacementId });
    });
  }, [
    isGateOpen,
    runStructuralMutation,
    treeData.orderedPlacementIds,
    treeData.rowByPlacementId,
    uiDispatch,
    uiState.activeNotepadId,
    uiState.clipboard,
    uiState.selectedPlacementId,
    updatePlacementParent
  ]);

  const syncAttentionEngine = useCallback(async (): Promise<void> => {
    if (!isGateOpen || attentionBusy || !decayEngineEnabled) {
      return;
    }
    setAttentionBusy(true);
    setError(undefined);
    try {
      await systemApplyAttentionUpdate();
      if (decisionQueueEnabled) {
        await systemGenerateDecisionCards();
      }
      if (uiState.activeNotepadId) {
        await loadNotepadData(uiState.activeNotepadId);
      }
    } catch (nextError) {
      setError(asErrorMessage(nextError));
    } finally {
      setAttentionBusy(false);
    }
  }, [attentionBusy, decayEngineEnabled, decisionQueueEnabled, isGateOpen, loadNotepadData, uiState.activeNotepadId]);

  const makeRowHot = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        const existingTask = latestAtom.facetData.task ?? {
          title: latestAtom.rawText.trim() || "Untitled",
          status: "todo" as const,
          priority: 3 as const
        };
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          facetDataPatch: {
            task: {
              ...existingTask,
              attentionLayer: "l3",
              priority: Math.min(existingTask.priority ?? 3, 2) as 1 | 2 | 3 | 4 | 5
            },
            attention: {
              layer: "l3",
              heatScore: Math.max(10, latestAtom.facetData.attention?.heatScore ?? 0),
              dwellStartedAt: new Date().toISOString(),
              explanation: "Pinned hot from context menu."
            }
          }
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const coolRowAttention = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        const existingTask = latestAtom.facetData.task ?? {
          title: latestAtom.rawText.trim() || "Untitled",
          status: "todo" as const,
          priority: 3 as const
        };
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          facetDataPatch: {
            task: {
              ...existingTask,
              attentionLayer: "long"
            },
            attention: {
              ...latestAtom.facetData.attention,
              layer: "long",
              explanation: "Cooled from context menu."
            }
          }
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const snoozeRowUntilTomorrow = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await runMutation(async () => {
        await conditionSetDate({
          atomId: row.atom!.id,
          untilAt: tomorrow
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const setRowWaitingPerson = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      const person = window.prompt("Who are you waiting on?");
      if (!person || !person.trim()) {
        return;
      }
      await runMutation(async () => {
        await conditionSetPerson({
          atomId: row.atom!.id,
          waitingOnPerson: person.trim(),
          cadenceDays: 3
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const setRowBlockedByTask = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      const blockerAtomId = window.prompt("Blocker atom id (task this depends on):");
      if (!blockerAtomId || !blockerAtomId.trim()) {
        return;
      }
      await runMutation(async () => {
        await conditionSetTask({
          atomId: row.atom!.id,
          blockerAtomId: blockerAtomId.trim()
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const clearRowConditions = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      const active = (conditionsByAtomId[row.atom.id] ?? []).filter((condition) => condition.status === "active");
      if (active.length === 0) {
        return;
      }
      await runMutation(async () => {
        for (const condition of active) {
          try {
            await conditionResolve(condition.id, {
              expectedRevision: condition.revision
            });
          } catch {
            await conditionCancel(condition.id, {
              expectedRevision: condition.revision,
              reason: "user_clear_blocking"
            });
          }
        }
      });
    },
    [conditionsByAtomId, isGateOpen, runMutation]
  );

  const addTagsToRow = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      const value = window.prompt("Add labels/categories (comma-separated):");
      if (!value || !value.trim()) {
        return;
      }
      const tags = uniqueLowercase(
        value
          .split(",")
          .map((entry) => normalizeCategoryName(entry))
          .filter((entry) => entry.length > 0)
      );
      if (tags.length === 0) {
        return;
      }
      await runMutation(async () => {
        const resolved = await ensureCategoryRegistryEntries(tags);
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        const existingLabels = latestAtom.facetData.meta?.labels ?? [];
        const existingCategories = latestAtom.facetData.meta?.categories ?? [];
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          facetDataPatch: {
            meta: {
              ...(latestAtom.facetData.meta ?? {}),
              labels: uniqueLowercase([...existingLabels, ...resolved.categories]),
              categories: uniqueLowercase([...existingCategories, ...resolved.categories])
            }
          }
        });
      });
    },
    [ensureCategoryRegistryEntries, isGateOpen, runMutation]
  );

  const addThreadsToRow = useCallback(
    async (row: FlatRow): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      const value = window.prompt("Add thread(s) (comma-separated names):");
      if (!value || !value.trim()) {
        return;
      }
      const names = uniqueLowercase(
        value
          .split(",")
          .map((entry) => normalizeCategoryName(entry))
          .filter((entry) => entry.length > 0)
      );
      if (names.length === 0) {
        return;
      }
      await runMutation(async () => {
        const threadIds = await ensureThreadRegistryEntries(names);
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          relationsPatch: {
            ...latestAtom.relations,
            threadIds: uniqueLowercase([...(latestAtom.relations.threadIds ?? []), ...threadIds])
          }
        });
      });
    },
    [ensureThreadRegistryEntries, isGateOpen, runMutation]
  );

  const setRowCommitmentLevel = useCallback(
    async (row: FlatRow, level: "hard" | "soft" | null): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        const existingTask = latestAtom.facetData.task ?? {
          title: latestAtom.rawText.trim() || "Untitled",
          status: "todo" as const,
          priority: 3 as const
        };
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          facetDataPatch: {
            task: {
              ...existingTask,
              commitmentLevel: level ?? undefined
            },
            commitment: level
              ? {
                  level,
                  rationale: "Set from context menu"
                }
              : undefined
          }
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const setRowTaskStatus = useCallback(
    async (row: FlatRow, status: TaskStatus): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        await taskStatusSet(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          status
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const setRowPriority = useCallback(
    async (row: FlatRow, priority: 1 | 2 | 3 | 4 | 5): Promise<void> => {
      if (!row.atom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        const existingTask = latestAtom.facetData.task ?? {
          title: latestAtom.rawText.trim() || "Untitled",
          status: "todo" as const,
          priority: 3 as const
        };
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          facetDataPatch: {
            task: {
              ...existingTask,
              priority
            }
          }
        });
      });
    },
    [isGateOpen, runMutation]
  );

  const moveRowToNotepad = useCallback(
    async (row: FlatRow, targetNotepadId: string, mode: "copy" | "move"): Promise<void> => {
      if (!row.atom || !targetNotepadId || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        await placementSave({
          viewId: targetNotepadId,
          blockId: row.block.id,
          orderKey: `z|${Date.now()}`
        });
        if (mode === "move") {
          await placementDelete(row.placement.id);
        }
      });
    },
    [isGateOpen, runMutation]
  );

  const createNotepad = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      if (creatingNotepad || !isGateOpen) {
        return;
      }
      const trimmedName = createName.trim();
      if (!trimmedName) {
        setError("Notepad name is required.");
        return;
      }
      const inferredCategory = slugify(trimmedName);
      const requestedCategories = parseCategories(createCategories) ?? (inferredCategory ? [inferredCategory] : []);
      setCreatingNotepad(true);
      setError(undefined);
      try {
        const existingIds = new Set(notepads.map((value) => value.id));
        const baseId = slugify(trimmedName) || `notepad-${Date.now()}`;
        let nextId = baseId;
        let index = 2;
        while (existingIds.has(nextId)) {
          nextId = `${baseId}-${index}`;
          index += 1;
        }

        const resolvedCategories = await ensureCategoryRegistryEntries(requestedCategories);
        const categories = resolvedCategories.categories.length > 0 ? resolvedCategories.categories : undefined;
        const categoryIds = resolvedCategories.categoryIds.length > 0 ? resolvedCategories.categoryIds : undefined;
        const filters: NotepadFilter = {
          includeArchived: false,
          categories,
          labels: categories,
          categoryIds,
          labelIds: categoryIds,
          categoryFilterMode: "or"
        };

        await notepadSave({
          idempotencyKey: idempotencyKey(),
          definition: {
            id: nextId,
            schemaVersion: 1,
            name: trimmedName,
            description: createDescription.trim() || undefined,
            isSystem: false,
            filters,
            sorts: [{ field: "updatedAt", direction: "desc" }],
            captureDefaults: {
              initialFacets: ["task"],
              taskStatus: "todo",
              taskPriority: 3,
              categories,
              labels: categories,
              categoryIds,
              labelIds: categoryIds
            },
            layoutMode: "outline"
          }
        });

        const views = await loadNotepadsIntoState();
        setCreateName("");
        setCreateDescription("");
        setCreateCategories("");
        if (views.some((view) => view.id === nextId)) {
          uiDispatch({ type: "set_active_notepad", notepadId: nextId });
        }
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setCreatingNotepad(false);
      }
    },
    [
      createCategories,
      createDescription,
      createName,
      creatingNotepad,
      ensureCategoryRegistryEntries,
      isGateOpen,
      loadNotepadsIntoState,
      notepads,
      uiDispatch
    ]
  );

  const saveNotepadEdits = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      if (!activeNotepad || editingNotepad || !isGateOpen) {
        return;
      }
      const trimmedName = editName.trim();
      if (!trimmedName) {
        setError("Active notepad name cannot be empty.");
        return;
      }
      setEditingNotepad(true);
      setError(undefined);
      try {
        const requestedCategories = parseCategories(editCategories) ?? [];
        const resolvedCategories = await ensureCategoryRegistryEntries(requestedCategories);
        const categories = resolvedCategories.categories.length > 0 ? resolvedCategories.categories : undefined;
        const categoryIds = resolvedCategories.categoryIds.length > 0 ? resolvedCategories.categoryIds : undefined;
        await notepadSave({
          expectedRevision: activeNotepad.revision,
          idempotencyKey: idempotencyKey(),
          definition: {
            id: activeNotepad.id,
            schemaVersion: activeNotepad.schemaVersion,
            name: trimmedName,
            description: editDescription.trim() || undefined,
            isSystem: activeNotepad.isSystem,
            filters: {
              ...activeNotepad.filters,
              categories,
              labels: categories,
              categoryIds,
              labelIds: categoryIds,
              categoryFilterMode: activeNotepad.filters.categoryFilterMode ?? "or"
            },
            sorts: activeNotepad.sorts,
            captureDefaults: {
              ...(activeNotepad.captureDefaults ?? {}),
              categories,
              labels: categories,
              categoryIds,
              labelIds: categoryIds
            },
            layoutMode: activeNotepad.layoutMode
          }
        });
        await loadNotepadsIntoState();
        await reloadActiveNotepad();
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setEditingNotepad(false);
      }
    },
    [
      activeNotepad,
      editCategories,
      editDescription,
      editName,
      editingNotepad,
      ensureCategoryRegistryEntries,
      isGateOpen,
      loadNotepadsIntoState,
      reloadActiveNotepad
    ]
  );

  const setStatusPreset = useCallback(
    async (preset: "active" | "all"): Promise<void> => {
      if (!activeNotepad || !isGateOpen || saving) {
        return;
      }
      setSaving(true);
      setError(undefined);
      try {
        await notepadSave({
          expectedRevision: activeNotepad.revision,
          idempotencyKey: idempotencyKey(),
          definition: {
            id: activeNotepad.id,
            schemaVersion: activeNotepad.schemaVersion,
            name: activeNotepad.name,
            description: activeNotepad.description,
            isSystem: activeNotepad.isSystem,
            filters: {
              ...activeNotepad.filters,
              statuses: preset === "active" ? ACTIVE_ROW_STATUSES : undefined
            },
            sorts: activeNotepad.sorts,
            captureDefaults: activeNotepad.captureDefaults,
            layoutMode: activeNotepad.layoutMode
          }
        });
        await loadNotepadsIntoState();
        await loadNotepadData(activeNotepad.id);
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setSaving(false);
      }
    },
    [activeNotepad, isGateOpen, loadNotepadData, loadNotepadsIntoState, saving]
  );

  const navigateSelection = useCallback(
    (target: "up" | "down" | "start" | "end"): void => {
      const rows = treeData.flatRows;
      if (rows.length === 0) {
        uiDispatch({ type: "set_selected_placement", placementId: undefined });
        uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        return;
      }
      if (target === "start") {
        uiDispatch({ type: "set_selected_placement", placementId: rows[0].placement.id });
        uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        return;
      }
      if (target === "end") {
        uiDispatch({ type: "set_selected_placement", placementId: rows[rows.length - 1].placement.id });
        uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        return;
      }

      const index = uiState.selectedPlacementId
        ? rows.findIndex((row) => row.placement.id === uiState.selectedPlacementId)
        : -1;
      if (index === -1) {
        uiDispatch({ type: "set_selected_placement", placementId: rows[0].placement.id });
        uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        return;
      }
      const nextIndex = target === "up" ? Math.max(0, index - 1) : Math.min(rows.length - 1, index + 1);
      uiDispatch({ type: "set_selected_placement", placementId: rows[nextIndex].placement.id });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    },
    [treeData.flatRows, uiDispatch, uiState.selectedPlacementId]
  );

  const isDescendantOf = useCallback(
    (candidatePlacementId: string, ancestorPlacementId: string): boolean => {
      return isPlacementDescendant(
        candidatePlacementId,
        ancestorPlacementId,
        treeData.effectiveParentByPlacementId
      );
    },
    [treeData.effectiveParentByPlacementId]
  );

  const setRowCollapsed = useCallback(
    (placementId: string, collapsed: boolean): void => {
      if (collapsed && uiState.selectedPlacementId && isDescendantOf(uiState.selectedPlacementId, placementId)) {
        uiDispatch({ type: "set_selected_placement", placementId });
      }
      uiDispatch({ type: "set_row_collapsed", placementId, collapsed });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    },
    [isDescendantOf, uiDispatch, uiState.selectedPlacementId]
  );

  const toggleRowCollapsed = useCallback(
    (placementId: string): void => {
      const isCollapsed = !!uiState.collapsedByPlacement[placementId];
      setRowCollapsed(placementId, !isCollapsed);
    },
    [setRowCollapsed, uiState.collapsedByPlacement]
  );

  const navigateHorizontalSelection = useCallback(
    (direction: "left" | "right"): void => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      if (!row) {
        return;
      }

      if (direction === "right") {
        if (row.hasChildren && row.collapsed) {
          setRowCollapsed(row.placement.id, false);
          return;
        }
        const children = treeData.childrenByParentKey[row.placement.id] ?? [];
        if (children.length > 0) {
          const nextPlacementId = children[0];
          uiDispatch({ type: "set_selected_placement", placementId: nextPlacementId });
          uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
        }
        return;
      }

      if (row.hasChildren && !row.collapsed) {
        setRowCollapsed(row.placement.id, true);
        return;
      }

      if (!row.effectiveParentPlacementId) {
        return;
      }
      uiDispatch({ type: "set_selected_placement", placementId: row.effectiveParentPlacementId });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    },
    [
      setRowCollapsed,
      treeData.childrenByParentKey,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.selectedPlacementId
    ]
  );

  const openQuickActions = useCallback(() => {
    if (!selectedRow) {
      return;
    }
    dismissHint();
    const editor = document.querySelector<HTMLElement>(
      `[data-placement-id="${selectedRow.placement.id}"]`
    );
    const rect = editor?.getBoundingClientRect();
    const x = rect ? rect.right : window.innerWidth / 2;
    const y = rect ? rect.top : window.innerHeight / 2;
    openRowContextMenu(selectedRow.placement.id, x, y);
  }, [dismissHint, openRowContextMenu, selectedRow]);

  const moveEditorSelection = useCallback(
    (row: FlatRow, direction: "up" | "down"): void => {
      const rows = treeData.flatRows;
      const index = rows.findIndex((value) => value.placement.id === row.placement.id);
      if (index === -1) {
        return;
      }
      const targetIndex = direction === "up" ? Math.max(0, index - 1) : Math.min(rows.length - 1, index + 1);
      const targetRow = rows[targetIndex];
      if (!targetRow || targetRow.placement.id === row.placement.id) {
        return;
      }
      pendingEditorFocusPlacementIdRef.current = targetRow.placement.id;
      uiDispatch({ type: "set_selected_placement", placementId: targetRow.placement.id });
      uiDispatch({ type: "set_interaction_mode", mode: "edit" });
    },
    [treeData.flatRows, uiDispatch]
  );

  const mergeRowWithAdjacentSibling = useCallback(
    async (row: FlatRow, direction: "previous" | "next"): Promise<void> => {
      if (!isGateOpen || !row.atom || !uiState.activeNotepadId) {
        return;
      }
      const parentKey = row.effectiveParentPlacementId ?? ROOT_KEY;
      const siblings = treeData.childrenByParentKey[parentKey] ?? [];
      const rowIndex = siblings.indexOf(row.placement.id);
      if (rowIndex === -1) {
        return;
      }
      const siblingPlacementId =
        direction === "next" ? siblings[rowIndex + 1] : siblings[rowIndex - 1];
      if (!siblingPlacementId) {
        return;
      }
      const siblingRow = treeData.rowByPlacementId[siblingPlacementId];
      if (!siblingRow?.atom) {
        return;
      }

      // Keep the row under cursor as the surviving identity whenever possible.
      const primaryRow = row;
      const secondaryRow = siblingRow;
      const primaryText = rowText(primaryRow, uiState.draftsByPlacement[primaryRow.placement.id]);
      const secondaryText = rowText(secondaryRow, uiState.draftsByPlacement[secondaryRow.placement.id]);
      const leftText = direction === "previous" ? secondaryText : primaryText;
      const rightText = direction === "previous" ? primaryText : secondaryText;
      const mergedText = mergeRowText(leftText, rightText);
      const selectionOffset = mergeBoundaryOffset(leftText, rightText);

      await flushDraft(primaryRow.placement.id);
      await flushDraft(secondaryRow.placement.id);

      const mutated = await runStructuralMutation(direction === "next" ? "merge-with-next" : "merge-with-previous", async () => {
        const latestPrimaryAtom = (await atomGet(primaryRow.atom!.id)) ?? primaryRow.atom!;
        await atomUpdate(latestPrimaryAtom.id, {
          expectedRevision: latestPrimaryAtom.revision,
          rawText: mergedText
        });

        const secondaryDirectChildPlacementIds = treeData.orderedPlacementIds.filter(
          (placementId) => treeData.effectiveParentByPlacementId[placementId] === secondaryRow.placement.id
        );

        if (secondaryDirectChildPlacementIds.length > 0) {
          const [allPlacements, allBlocks] = await Promise.all([
            listAllPages((cursor) => placementsList({ viewId: uiState.activeNotepadId, limit: 250, cursor })),
            listAllPages((cursor) => blocksList({ notepadId: uiState.activeNotepadId, limit: 250, cursor }))
          ]);
          const placementById = new Map(allPlacements.map((placement) => [placement.id, placement]));
          const blockById = new Map(allBlocks.map((block) => [block.id, block]));

          for (const childPlacementId of secondaryDirectChildPlacementIds) {
            const childPlacement = placementById.get(childPlacementId);
            if (!childPlacement) {
              continue;
            }
            await placementSave({
              id: childPlacement.id,
              viewId: childPlacement.viewId,
              blockId: childPlacement.blockId,
              parentPlacementId: primaryRow.placement.id,
              orderKey: childPlacement.orderKey,
              pinned: childPlacement.pinned,
              expectedRevision: childPlacement.revision,
              idempotencyKey: idempotencyKey()
            });

            const childBlock = blockById.get(childPlacement.blockId);
            if (!childBlock?.atomId) {
              continue;
            }
            const childAtom = await atomGet(childBlock.atomId);
            if (!childAtom) {
              continue;
            }
            await updateCanonicalParent(childAtom, latestPrimaryAtom.id);
          }
        }

        await placementDelete(secondaryRow.placement.id, idempotencyKey());
        const remainingPlacements = await listAllPages((cursor) =>
          placementsList({ blockId: secondaryRow.block.id, limit: 250, cursor })
        );
        const latestSecondaryAtom = await atomGet(secondaryRow.atom!.id);
        if (!latestSecondaryAtom || remainingPlacements.length > 0) {
          return;
        }
        await atomArchive(latestSecondaryAtom.id, {
          expectedRevision: latestSecondaryAtom.revision,
          reason: "notepad_merged_into_sibling"
        });
      });
      if (!mutated) {
        return;
      }

      selectedPlacementRef.current = primaryRow.placement.id;
      uiDispatch({ type: "set_selected_placement", placementId: primaryRow.placement.id });
      uiDispatch({ type: "set_interaction_mode", mode: "edit" });
      focusEditorSelectionForPlacement(primaryRow.placement.id, selectionOffset, selectionOffset);
    },
    [
      focusEditorSelectionForPlacement,
      flushDraft,
      isGateOpen,
      runStructuralMutation,
      treeData.childrenByParentKey,
      treeData.effectiveParentByPlacementId,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      uiState.draftsByPlacement,
      updateCanonicalParent
    ]
  );

  const splitRowAtSelection = useCallback(
    async (row: FlatRow, selectionStart: number, selectionEnd: number): Promise<void> => {
      if (!uiState.activeNotepadId || !isGateOpen || !row.atom) {
        return;
      }
      const sourceText = rowText(row, uiState.draftsByPlacement[row.placement.id]);
      const start = Math.max(0, Math.min(selectionStart, sourceText.length));
      const end = Math.max(start, Math.min(selectionEnd, sourceText.length));
      const beforeText = sourceText.slice(0, start);
      const afterText = sourceText.slice(end);

      await flushDraft(row.placement.id);
      const parentPlacementId = row.effectiveParentPlacementId;
      const parentRow = parentPlacementId ? treeData.rowByPlacementId[parentPlacementId] : undefined;
      const parentAtomId = parentRow?.atom?.id;

      const mutated = await runStructuralMutation("split-row", async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom!;
        await atomUpdate(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          rawText: afterText
        });

        const created = await notepadBlockCreate({
          notepadId: uiState.activeNotepadId,
          rawText: beforeText
        });
        let createdPlacement = await findPlacementForBlockInView(created.id, uiState.activeNotepadId);
        if (!createdPlacement) {
          throw new Error("Unable to locate placement for split row");
        }

        if (createdPlacement.parentPlacementId !== parentPlacementId) {
          createdPlacement = await placementSave({
            id: createdPlacement.id,
            viewId: createdPlacement.viewId,
            blockId: createdPlacement.blockId,
            parentPlacementId,
            orderKey: createdPlacement.orderKey,
            pinned: createdPlacement.pinned,
            expectedRevision: createdPlacement.revision,
            idempotencyKey: idempotencyKey()
          });
        }

        const reordered = treeData.orderedPlacementIds.filter((placementId) => placementId !== createdPlacement.id);
        const insertionIndex = reordered.indexOf(row.placement.id);
        if (insertionIndex === -1) {
          reordered.push(createdPlacement.id);
        } else {
          reordered.splice(insertionIndex, 0, createdPlacement.id);
        }
        if (reordered.length > 1) {
          await placementsReorder(uiState.activeNotepadId, {
            orderedPlacementIds: reordered,
            idempotencyKey: idempotencyKey()
          });
        }

        if (created.atomId && parentAtomId) {
          const createdAtom = await atomGet(created.atomId);
          if (createdAtom) {
            await updateCanonicalParent(createdAtom, parentAtomId);
          }
        }
      });
      if (!mutated) {
        return;
      }

      selectedPlacementRef.current = row.placement.id;
      uiDispatch({ type: "set_selected_placement", placementId: row.placement.id });
      uiDispatch({ type: "set_interaction_mode", mode: "edit" });
      focusEditorSelectionForPlacement(row.placement.id, 0, 0);
    },
    [
      findPlacementForBlockInView,
      focusEditorSelectionForPlacement,
      flushDraft,
      isGateOpen,
      runStructuralMutation,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      uiState.draftsByPlacement,
      updateCanonicalParent
    ]
  );

  const onRowEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow): void => {
      const target = event.currentTarget;
      const selectionStart = target.selectionStart ?? 0;
      const selectionEnd = target.selectionEnd ?? selectionStart;
      const action = resolveEditorKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        rowText: rowText(row, uiState.draftsByPlacement[row.placement.id]),
        selectionStart,
        selectionEnd
      });
      if (action.type !== "none") {
        dismissHint();
      }

      switch (action.type) {
        case "none":
          return;
        case "undo_structure":
          event.preventDefault();
          void undoStructuralChange();
          return;
        case "redo_structure":
          event.preventDefault();
          void redoStructuralChange();
          return;
        case "open_quick_actions":
          event.preventDefault();
          openQuickActions();
          return;
        case "clipboard_copy":
          event.preventDefault();
          copyOrCutSelected("copy");
          return;
        case "clipboard_cut":
          event.preventDefault();
          copyOrCutSelected("cut");
          return;
        case "clipboard_paste":
          event.preventDefault();
          void pasteAfterSelected();
          return;
        case "reorder_up":
          event.preventDefault();
          void reorderSelected("up");
          return;
        case "reorder_down":
          event.preventDefault();
          void reorderSelected("down");
          return;
        case "move_selection_up":
          event.preventDefault();
          moveEditorSelection(row, "up");
          return;
        case "move_selection_down":
          event.preventDefault();
          moveEditorSelection(row, "down");
          return;
        case "create_sibling":
          event.preventDefault();
          if (selectionStart > 0 && selectionStart < rowText(row, uiState.draftsByPlacement[row.placement.id]).length) {
            target.blur();
            void splitRowAtSelection(row, selectionStart, selectionEnd);
            return;
          }
          if (selectionStart === 0 && selectionEnd === 0) {
            // Split-at-start semantics: insert an empty sibling above and keep caret at start of current row.
            target.blur();
            void insertSiblingBeforeAndKeepFocus(row);
            return;
          }
          // Blur the current editor first so stale focus does not re-select the previous row
          // while we are creating and focusing the new sibling row.
          target.blur();
          void createRow("sibling", { anchorRow: row, focusEditor: true });
          return;
        case "indent":
          event.preventDefault();
          void indentSelected();
          return;
        case "outdent":
          event.preventDefault();
          void outdentSelected();
          return;
        case "delete_empty_row":
          event.preventDefault();
          void deleteRow(row, { preferPrevious: true, focusEditor: true });
          return;
        case "merge_with_previous_sibling":
          event.preventDefault();
          void mergeRowWithAdjacentSibling(row, "previous");
          return;
        case "merge_with_next_sibling":
          event.preventDefault();
          void mergeRowWithAdjacentSibling(row, "next");
          return;
        case "exit_edit_mode":
          event.preventDefault();
          uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
          target.blur();
          return;
        default:
          return;
      }
    },
    [
      copyOrCutSelected,
      createRow,
      deleteRow,
      dismissHint,
      indentSelected,
      insertSiblingBeforeAndKeepFocus,
      mergeRowWithAdjacentSibling,
      moveEditorSelection,
      openQuickActions,
      outdentSelected,
      pasteAfterSelected,
      redoStructuralChange,
      reorderSelected,
      splitRowAtSelection,
      undoStructuralChange,
      uiDispatch,
      uiState.draftsByPlacement
    ]
  );

  const navigateSiblingSelection = useCallback(
    (direction: "up" | "down"): void => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      if (!row) {
        return;
      }
      const parentKey = row.effectiveParentPlacementId ?? ROOT_KEY;
      const siblings = treeData.childrenByParentKey[parentKey] ?? [];
      const index = siblings.indexOf(row.placement.id);
      if (index === -1) {
        return;
      }
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      const nextPlacementId = siblings[nextIndex];
      if (!nextPlacementId) {
        return;
      }
      uiDispatch({ type: "set_selected_placement", placementId: nextPlacementId });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    },
    [treeData.childrenByParentKey, treeData.rowByPlacementId, uiDispatch, uiState.selectedPlacementId]
  );

  const jumpSelectionToParent = useCallback((): void => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row?.effectiveParentPlacementId) {
      return;
    }
    uiDispatch({ type: "set_selected_placement", placementId: row.effectiveParentPlacementId });
    uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
  }, [treeData.rowByPlacementId, uiDispatch, uiState.selectedPlacementId]);

  const jumpSelectionToFirstChild = useCallback((): void => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row) {
      return;
    }
    const children = treeData.childrenByParentKey[row.placement.id] ?? [];
    if (children.length === 0) {
      return;
    }
    uiDispatch({ type: "set_selected_placement", placementId: children[0] });
    uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
  }, [treeData.childrenByParentKey, treeData.rowByPlacementId, uiDispatch, uiState.selectedPlacementId]);

  const setSelectedSubtreeCollapsed = useCallback(
    (collapsed: boolean): void => {
      const selectedPlacementId = uiState.selectedPlacementId;
      if (!selectedPlacementId) {
        return;
      }
      const subtree = collectSubtreePlacementIds(
        selectedPlacementId,
        treeData.effectiveParentByPlacementId,
        treeData.orderedPlacementIds
      );
      const hasChildrenSet = new Set(Object.values(treeData.effectiveParentByPlacementId).filter((value): value is string => !!value));
      for (const placementId of subtree) {
        if (!hasChildrenSet.has(placementId)) {
          continue;
        }
        uiDispatch({ type: "set_row_collapsed", placementId, collapsed });
      }
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    },
    [
      treeData.effectiveParentByPlacementId,
      treeData.orderedPlacementIds,
      uiDispatch,
      uiState.selectedPlacementId
    ]
  );

  const moveKeyboardDragTarget = useCallback(
    (direction: "up" | "down"): void => {
      if (!keyboardDrag) {
        return;
      }
      const sourceSubtreeIds = new Set(collectVisibleSubtreePlacementIds(treeData.flatRows, keyboardDrag.sourcePlacementId));
      const candidateIds = treeData.flatRows
        .map((row) => row.placement.id)
        .filter((placementId) => !sourceSubtreeIds.has(placementId));
      if (candidateIds.length === 0) {
        return;
      }
      const currentIndex = candidateIds.indexOf(keyboardDrag.targetPlacementId);
      const fallbackIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        direction === "up"
          ? Math.max(0, fallbackIndex - 1)
          : Math.min(candidateIds.length - 1, fallbackIndex + 1);
      const nextTarget = candidateIds[nextIndex];
      if (!nextTarget) {
        return;
      }
      setKeyboardDrag((current) =>
        current
          ? {
              ...current,
              targetPlacementId: nextTarget
            }
          : current
      );
      uiDispatch({ type: "set_selected_placement", placementId: nextTarget });
      uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
    },
    [keyboardDrag, treeData.flatRows, uiDispatch]
  );

  const cycleKeyboardDragIntent = useCallback((reverse = false): void => {
    const intents: PlacementDropIntent[] = ["before", "after", "inside"];
    setKeyboardDrag((current) => {
      if (!current) {
        return current;
      }
      const index = intents.indexOf(current.intent);
      const nextIndex = reverse
        ? (index - 1 + intents.length) % intents.length
        : (index + 1) % intents.length;
      const nextIntent = intents[nextIndex];
      announceDragAction(
        nextIntent === "inside"
          ? "Keyboard drag intent: nest under target."
          : nextIntent === "before"
            ? "Keyboard drag intent: move above target."
            : "Keyboard drag intent: move below target."
      );
      return {
        ...current,
        intent: nextIntent
      };
    });
  }, [announceDragAction]);

  const startKeyboardDrag = useCallback((): void => {
    const sourcePlacementId = uiState.selectedPlacementId;
    if (!sourcePlacementId) {
      return;
    }
    const sourceSubtreeIds = new Set(collectVisibleSubtreePlacementIds(treeData.flatRows, sourcePlacementId));
    const candidateIds = treeData.flatRows
      .map((row) => row.placement.id)
      .filter((placementId) => !sourceSubtreeIds.has(placementId));
    if (candidateIds.length === 0) {
      return;
    }

    const sourceIndex = treeData.flatRows.findIndex((row) => row.placement.id === sourcePlacementId);
    const targetAfter = treeData.flatRows
      .slice(sourceIndex + 1)
      .find((row) => !sourceSubtreeIds.has(row.placement.id))
      ?.placement.id;
    const targetBefore = [...treeData.flatRows]
      .slice(0, Math.max(0, sourceIndex))
      .reverse()
      .find((row) => !sourceSubtreeIds.has(row.placement.id))
      ?.placement.id;
    const targetPlacementId = targetAfter ?? targetBefore ?? candidateIds[0];
    const intent: PlacementDropIntent = targetAfter ? "after" : "before";

    setKeyboardDrag({
      sourcePlacementId,
      targetPlacementId,
      intent
    });
    announceDragAction("Keyboard drag started. Arrow keys move target, Tab changes placement, Enter drops.");
  }, [announceDragAction, treeData.flatRows, uiState.selectedPlacementId]);

  const cancelKeyboardDrag = useCallback((): void => {
    if (!keyboardDrag) {
      return;
    }
    setKeyboardDrag(null);
    announceDragAction("Keyboard drag canceled.");
  }, [announceDragAction, keyboardDrag]);

  const dropKeyboardDrag = useCallback(async (): Promise<void> => {
    if (!keyboardDrag) {
      return;
    }
    const payload = keyboardDrag;
    setKeyboardDrag(null);
    await dropReorderRow(payload.sourcePlacementId, payload.targetPlacementId, payload.intent);
  }, [dropReorderRow, keyboardDrag]);

  const onTreeContainerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (keyboardDrag) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelKeyboardDrag();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void dropKeyboardDrag();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveKeyboardDragTarget("up");
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveKeyboardDragTarget("down");
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          cycleKeyboardDragIntent(event.shiftKey);
          return;
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        if (keyboardDrag) {
          void dropKeyboardDrag();
        } else {
          startKeyboardDrag();
        }
        return;
      }

      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        navigateSiblingSelection("up");
        return;
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        navigateSiblingSelection("down");
        return;
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        jumpSelectionToParent();
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        jumpSelectionToFirstChild();
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        setSelectedSubtreeCollapsed(true);
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        setSelectedSubtreeCollapsed(false);
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const placementId = uiState.selectedPlacementId;
        if (!placementId) {
          return;
        }
        event.preventDefault();
        const rowElement = document.querySelector<HTMLElement>(`.notepad-row[data-placement-id="${placementId}"]`);
        if (rowElement) {
          const rect = rowElement.getBoundingClientRect();
          openRowContextMenu(placementId, rect.left + Math.min(140, rect.width * 0.4), rect.top + rect.height * 0.55);
        } else {
          openRowContextMenu(placementId, window.innerWidth * 0.5, window.innerHeight * 0.45);
        }
        return;
      }

      if (event.key === "Enter" && treeData.flatRows.length === 0) {
        event.preventDefault();
        dismissHint();
        void createRow("sibling", { focusEditor: true });
        return;
      }

      const action = resolveContainerKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        hasSelectedRow: !!uiState.selectedPlacementId
      });
      if (action.type !== "none") {
        dismissHint();
      }

      switch (action.type) {
        case "none":
          return;
        case "undo_structure":
          event.preventDefault();
          void undoStructuralChange();
          return;
        case "redo_structure":
          event.preventDefault();
          void redoStructuralChange();
          return;
        case "navigate_up":
          event.preventDefault();
          navigateSelection("up");
          return;
        case "navigate_down":
          event.preventDefault();
          navigateSelection("down");
          return;
        case "navigate_start":
          event.preventDefault();
          navigateSelection("start");
          return;
        case "navigate_end":
          event.preventDefault();
          navigateSelection("end");
          return;
        case "reorder_up":
          event.preventDefault();
          void reorderSelected("up");
          return;
        case "reorder_down":
          event.preventDefault();
          void reorderSelected("down");
          return;
        case "indent_selected":
          event.preventDefault();
          void indentSelected();
          return;
        case "outdent_selected":
          event.preventDefault();
          void outdentSelected();
          return;
        case "expand_or_child":
          event.preventDefault();
          navigateHorizontalSelection("right");
          return;
        case "collapse_or_parent":
          event.preventDefault();
          navigateHorizontalSelection("left");
          return;
        case "focus_editor":
          event.preventDefault();
          if (uiState.selectedPlacementId) {
            pendingEditorFocusPlacementIdRef.current = uiState.selectedPlacementId;
            focusEditorForPlacement(uiState.selectedPlacementId);
          }
          return;
        case "clipboard_copy":
          event.preventDefault();
          copyOrCutSelected("copy");
          return;
        case "clipboard_cut":
          event.preventDefault();
          copyOrCutSelected("cut");
          return;
        case "clipboard_paste":
          event.preventDefault();
          void pasteAfterSelected();
          return;
        case "open_quick_actions":
          event.preventDefault();
          openQuickActions();
          return;
        default:
          return;
      }
    },
    [
      copyOrCutSelected,
      createRow,
      cycleKeyboardDragIntent,
      cancelKeyboardDrag,
      dismissHint,
      dropKeyboardDrag,
      focusEditorForPlacement,
      indentSelected,
      jumpSelectionToFirstChild,
      jumpSelectionToParent,
      keyboardDrag,
      moveKeyboardDragTarget,
      navigateSiblingSelection,
      navigateHorizontalSelection,
      navigateSelection,
      openRowContextMenu,
      openQuickActions,
      outdentSelected,
      pasteAfterSelected,
      redoStructuralChange,
      reorderSelected,
      setSelectedSubtreeCollapsed,
      startKeyboardDrag,
      treeData.flatRows.length,
      undoStructuralChange,
      uiState.selectedPlacementId
    ]
  );

  const contextMenuPosition = useMemo(() => {
    if (!rowContextMenu || typeof window === "undefined") {
      return undefined;
    }
    const width = 260;
    const height = 360;
    const margin = 10;
    const x = Math.max(margin, Math.min(rowContextMenu.x, window.innerWidth - width - margin));
    const y = Math.max(margin, Math.min(rowContextMenu.y, window.innerHeight - height - margin));
    return { left: x, top: y };
  }, [rowContextMenu]);

  return (
    <section className="notepad-screen screen">
      <div className="notepad-live-announcer" role="status" aria-live="polite" aria-atomic="true">
        {dragAnnouncement}
      </div>

      <div className="page-sidebar-layout">
        <NotepadListSidebar
          notepads={notepads}
          activeNotepadId={uiState.activeNotepadId}
          onSelectNotepad={(notepadId) => uiDispatch({ type: "set_active_notepad", notepadId })}
          createName={createName}
          createCategories={createCategories}
          createDescription={createDescription}
          creatingNotepad={creatingNotepad}
          onChangeCreateName={setCreateName}
          onChangeCreateCategories={setCreateCategories}
          onChangeCreateDescription={setCreateDescription}
          onCreateNotepad={(event) => void createNotepad(event)}
          editName={editName}
          editCategories={editCategories}
          editDescription={editDescription}
          editingNotepad={editingNotepad}
          onChangeEditName={setEditName}
          onChangeEditCategories={setEditCategories}
          onChangeEditDescription={setEditDescription}
          onSaveNotepadEdits={(event) => void saveNotepadEdits(event)}
          capabilities={capabilities}
          health={health}
          featureFlags={featureFlags}
          isFeatureGateOpen={isGateOpen}
          loading={loading}
          saving={saving}
        />

        <div className="page-sidebar-main">
          {gateError && <div className="banner error">{gateError}</div>}
          {error && <div className="banner error">{error}</div>}
          {(loading || saving) && <div className="banner info">{loading ? "Loading notepad..." : "Saving..."}</div>}
          {dragUndo && dragUndo.notepadId === uiState.activeNotepadId && (
            <div className="banner info notepad-undo-banner">
              <span>{dragUndo.message}</span>
              <button type="button" onClick={() => void undoLastDrop()} disabled={saving || loading}>
                Undo
              </button>
            </div>
          )}

        <div className="card notepad-outline">
          <header className="notepad-outline-header">
            <h3>{activeNotepad?.name ?? "Notepad"}</h3>
            <div className="notepad-outline-meta">
              <small className="notepad-meta-pill">
                {treeData.flatRows.length} row{treeData.flatRows.length === 1 ? "" : "s"}
              </small>
              <button
                type="button"
                className={`notepad-meta-pill notepad-meta-action${statusPreset === "active" ? " active" : ""}`}
                onClick={() => void setStatusPreset(statusPreset === "active" ? "all" : "active")}
                disabled={saving || !activeNotepad || !isGateOpen}
                title={statusPreset === "active" ? "Showing active rows only — click to show all" : "Showing all rows — click to hide done"}
              >
                {activeRowCount} active{statusPreset === "all" ? " / all" : ""}
              </button>
              {activeCategories.length > 0 && (
                <small className="notepad-meta-pill">
                  {activeCategories.join(", ")}
                </small>
              )}
            </div>
          </header>

          <div className="notepad-attention-rail">
            <small className="notepad-meta-pill">L3 {attentionCounts.l3}</small>
            <small className="notepad-meta-pill">RAM {attentionCounts.ram}</small>
            <small className="notepad-meta-pill">Short {attentionCounts.short}</small>
            <small className="notepad-meta-pill">Long {attentionCounts.long}</small>
            <button
              type="button"
              className={`notepad-meta-pill notepad-meta-action${driftingSoonCount > 0 ? " warning" : ""}`}
              onClick={() => appActions?.selectScreen("tasks")}
              disabled={!decayEngineEnabled}
            >
              Drifting soon {driftingSoonCount}
            </button>
            <button
              type="button"
              className={`notepad-meta-pill notepad-meta-action${decisionQueue.length > 0 ? " warning" : ""}`}
              onClick={() => appActions?.selectScreen("tasks")}
              disabled={!decisionQueueEnabled}
            >
              Decisions {decisionQueueEnabled ? decisionQueue.length : "off"}
            </button>
            <button
              type="button"
              className="notepad-meta-pill notepad-meta-action"
              onClick={() => void syncAttentionEngine()}
              disabled={attentionBusy || !decayEngineEnabled}
            >
              {!decayEngineEnabled ? "Attention off" : attentionBusy ? "Syncing..." : "Sync attention"}
            </button>
            {focusSessionsEnabled && runningSession && <small className="notepad-meta-pill">Focus running</small>}
          </div>

          {treeData.flatRows.length === 0 && (
            <p className="settings-hint">No rows yet. Focus the outline and press Enter to add the first row.</p>
          )}
          {!hintDismissed && (
            <small className="settings-hint">
              Keyboard-first tip: Enter creates/splits rows, Tab indents, Backspace/Delete merge siblings, Cmd/Ctrl+Z undoes structure.
            </small>
          )}
          <NotepadTree
            rows={treeData.flatRows}
            selectedPlacementId={uiState.selectedPlacementId}
            keyboardDropTarget={
              keyboardDrag
                ? {
                    sourcePlacementId: keyboardDrag.sourcePlacementId,
                    targetPlacementId: keyboardDrag.targetPlacementId,
                    intent: keyboardDrag.intent
                  }
                : undefined
            }
            getRowText={(row) => rowText(row, uiState.draftsByPlacement[row.placement.id])}
            isTaskRow={isTaskRow}
            parseOverlayMode={(row) => parseOverlayMode(row.overlay)}
            onSelectRow={(placementId) => {
              dismissHint();
              uiDispatch({ type: "set_selected_placement", placementId });
            }}
            onToggleCollapsed={toggleRowCollapsed}
            onEditorFocus={(placementId) => {
              dismissHint();
              uiDispatch({ type: "set_selected_placement", placementId });
              uiDispatch({ type: "set_interaction_mode", mode: "edit" });
            }}
            onEditorChange={(placementId, nextText) => {
              const row = treeData.rowByPlacementId[placementId];
              if (!row) {
                return;
              }
              scheduleDraftSave(row, nextText);
            }}
            onEditorBlur={(placementId, event) => {
              const pointerStartedInEditor =
                pointerEditorInteractionRef.current.active &&
                pointerEditorInteractionRef.current.placementId === placementId;
              const related = event.relatedTarget;
              const blurredToTree = !!related?.closest(".notepad-tree");

              if (pointerStartedInEditor && (blurredToTree || !related)) {
                const start = event.currentTarget.selectionStart ?? 0;
                const end = event.currentTarget.selectionEnd ?? start;
                window.requestAnimationFrame(() => {
                  const activeElement = document.activeElement as HTMLElement | null;
                  const activeInTree = !!activeElement?.closest(".notepad-tree");
                  if (activeElement && activeElement !== document.body && !activeInTree) {
                    return;
                  }
                  const editor = document.querySelector<HTMLTextAreaElement>(
                    `textarea.notepad-editor[data-placement-id="${placementId}"]`
                  );
                  if (!editor) {
                    return;
                  }
                  editor.focus({ preventScroll: true });
                  editor.setSelectionRange(start, end);
                  uiDispatch({ type: "set_interaction_mode", mode: "edit" });
                });
                return;
              }

              void flushDraft(placementId);
              uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
            }}
            onEditorKeyDown={onRowEditorKeyDown}
            onOpenContextMenu={(placementId, x, y) => {
              openRowContextMenu(placementId, x, y);
            }}
            onContainerKeyDown={onTreeContainerKeyDown}
            onDropRow={({ sourcePlacementId, targetPlacementId, intent }) => {
              dismissHint();
              void dropReorderRow(sourcePlacementId, targetPlacementId, intent);
            }}
            onAutoExpandRow={(placementId) => {
              setRowCollapsed(placementId, false);
            }}
          />
        </div>
        </div>{/* end page-sidebar-main */}
      </div>{/* end page-sidebar-layout */}
      {rowContextMenu && contextMenuRow && contextMenuPosition && (
        <div
          className="notepad-context-menu"
          role="menu"
          aria-label="Row actions"
          style={{ left: `${contextMenuPosition.left}px`, top: `${contextMenuPosition.top}px` }}
        >
          {contextSubmenu === "none" && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setContextSubmenu("status")}
                disabled={!contextMenuRow.atom}
              >
                Status{contextMenuRow.atom?.facetData.task?.status ? ` (${contextMenuRow.atom.facetData.task.status})` : ""}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setContextSubmenu("priority")}
                disabled={!contextMenuRow.atom}
              >
                Priority{contextMenuRow.atom?.facetData.task?.priority ? ` (P${contextMenuRow.atom.facetData.task.priority})` : ""}
              </button>
              <hr className="notepad-context-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void makeRowHot(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Make Hot (L3)
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void coolRowAttention(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Cool to Long
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void setRowCommitmentLevel(contextMenuRow, "hard");
                }}
                disabled={!contextMenuRow.atom}
              >
                Set Hard Commitment
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void setRowCommitmentLevel(contextMenuRow, null);
                }}
                disabled={!contextMenuRow.atom}
              >
                Clear Commitment
              </button>
              <hr className="notepad-context-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void addTagsToRow(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Add Labels/Categories
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void addThreadsToRow(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Add Thread
              </button>
              <hr className="notepad-context-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void snoozeRowUntilTomorrow(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Snooze 1 day
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void setRowWaitingPerson(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Waiting on person
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void setRowBlockedByTask(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Blocked by task
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowContextMenu();
                  void clearRowConditions(contextMenuRow);
                }}
                disabled={!contextMenuRow.atom}
              >
                Clear Blocking
              </button>
              {notepads.length > 1 && (
                <>
                  <hr className="notepad-context-divider" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => setContextSubmenu("move")}
                    disabled={!contextMenuRow.atom}
                  >
                    Move / Copy to Notepad
                  </button>
                </>
              )}
            </>
          )}

          {contextSubmenu === "status" && (
            <>
              <button type="button" role="menuitem" onClick={() => setContextSubmenu("none")}>
                Back
              </button>
              <hr className="notepad-context-divider" />
              {STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  type="button"
                  role="menuitem"
                  className={contextMenuRow.atom?.facetData.task?.status === status ? "active" : ""}
                  onClick={() => {
                    closeRowContextMenu();
                    void setRowTaskStatus(contextMenuRow, status);
                  }}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
              ))}
            </>
          )}

          {contextSubmenu === "priority" && (
            <>
              <button type="button" role="menuitem" onClick={() => setContextSubmenu("none")}>
                Back
              </button>
              <hr className="notepad-context-divider" />
              {([1, 2, 3, 4, 5] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  role="menuitem"
                  className={contextMenuRow.atom?.facetData.task?.priority === p ? "active" : ""}
                  onClick={() => {
                    closeRowContextMenu();
                    void setRowPriority(contextMenuRow, p);
                  }}
                >
                  P{p}
                </button>
              ))}
            </>
          )}

          {contextSubmenu === "move" && (
            <>
              <button type="button" role="menuitem" onClick={() => setContextSubmenu("none")}>
                Back
              </button>
              <hr className="notepad-context-divider" />
              {notepads
                .filter((n) => n.id !== uiState.activeNotepadId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeRowContextMenu();
                      void moveRowToNotepad(contextMenuRow, n.id, "move");
                    }}
                  >
                    Move to {n.name}
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
