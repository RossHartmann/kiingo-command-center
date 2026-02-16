import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  atomArchive,
  atomDelete,
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
  featureFlagsList,
  notepadAtomsList,
  notepadBlockCreate,
  notepadsList,
  notepadSave,
  placementDelete,
  placementSave,
  placementsList,
  placementsReorder,
  taskStatusSet,
  workspaceCapabilitiesGet,
  workspaceHealthGet
} from "../lib/tauriClient";
import type {
  AtomRecord,
  BlockRecord,
  ConditionRecord,
  FeatureFlag,
  NotepadFilter,
  NotepadViewDefinition,
  PlacementRecord,
  TaskStatus,
  WorkspaceCapabilities,
  WorkspaceHealth
} from "../lib/types";
import { NotepadToolbar } from "../components/notepad/NotepadToolbar";
import { NOTEPAD_ESTIMATED_ROW_HEIGHT, NotepadTree } from "../components/notepad/NotepadTree";
import {
  resolveContainerKeyAction,
  resolveEditorKeyAction
} from "../components/notepad/keyboardContract";
import { buildTreeData, findSiblingSwapTarget, insertPlacementAfter, parseOverlayMode, sortPlacements } from "../components/notepad/treeData";
import type { FlatRow } from "../components/notepad/types";
import { ROOT_KEY } from "../components/notepad/types";
import { useNotepadUiState } from "../state/notepadState";

const STATUS_OPTIONS: TaskStatus[] = ["todo", "doing", "blocked", "done"];

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
  const taskTitle = row.atom?.facetData.task?.title?.trim();
  if (taskTitle) {
    return taskTitle;
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

function rowText(row: FlatRow, draft: string | undefined): string {
  return draft ?? row.block.text;
}

function atomHasNoMeaningfulContent(atom: AtomRecord): boolean {
  const text = atom.rawText.trim();
  const body = (atom.body ?? "").trim();
  return text.length === 0 && body.length === 0;
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

function placeCaretAtEnd(element: HTMLTextAreaElement): void {
  const length = element.value.length;
  element.setSelectionRange(length, length);
}

export function NotepadScreen(): JSX.Element {
  const [uiState, uiDispatch] = useNotepadUiState();

  const [notepads, setNotepads] = useState<NotepadViewDefinition[]>([]);
  const [placements, setPlacements] = useState<PlacementRecord[]>([]);
  const [blocksById, setBlocksById] = useState<Record<string, BlockRecord>>({});
  const [atomsById, setAtomsById] = useState<Record<string, AtomRecord>>({});
  const [conditionsByAtomId, setConditionsByAtomId] = useState<Record<string, ConditionRecord[]>>({});
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

  const [quickTargetNotepadId, setQuickTargetNotepadId] = useState("");

  const saveTimersRef = useRef<Map<string, number>>(new Map());
  const pendingEditorFocusPlacementIdRef = useRef<string | undefined>(undefined);
  const selectedPlacementRef = useRef<string | undefined>(undefined);

  const activeNotepad = useMemo(
    () => notepads.find((notepad) => notepad.id === uiState.activeNotepadId),
    [notepads, uiState.activeNotepadId]
  );

  const treeData = useMemo(
    () => buildTreeData(placements, blocksById, atomsById, uiState.collapsedByPlacement, conditionsByAtomId),
    [placements, blocksById, atomsById, uiState.collapsedByPlacement, conditionsByAtomId]
  );

  const selectedRow = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;

  const isGateOpen = useMemo(() => !gateError, [gateError]);

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
    if (quickTargetNotepadId) {
      return;
    }
    const candidate = notepads.find((value) => value.id !== uiState.activeNotepadId);
    if (candidate) {
      setQuickTargetNotepadId(candidate.id);
    }
  }, [notepads, quickTargetNotepadId, uiState.activeNotepadId]);

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
      setGateError("Notepad is currently disabled by feature flag `workspace.notepad_ui_v2`.");
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
      const [atomItems, activeConditions] = await Promise.all([
        listAllPages((cursor) => notepadAtomsList(notepadId, 250, cursor)),
        listAllPages((cursor) => conditionsList({ status: "active", limit: 250, cursor }))
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
    [materializeMissingPlacements, uiDispatch]
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
    };
  }, []);

  const ensurePlacementVisible = useCallback(
    (placementId: string): void => {
      const container = document.querySelector<HTMLDivElement>(".notepad-tree");
      if (!container) {
        return;
      }
      const rowIndex = treeData.flatRows.findIndex((row) => row.placement.id === placementId);
      if (rowIndex === -1) {
        return;
      }
      const rowTop = rowIndex * NOTEPAD_ESTIMATED_ROW_HEIGHT;
      const rowBottom = rowTop + NOTEPAD_ESTIMATED_ROW_HEIGHT;
      const viewportTop = container.scrollTop;
      const viewportBottom = viewportTop + container.clientHeight;

      if (rowTop < viewportTop) {
        container.scrollTop = rowTop;
      } else if (rowBottom > viewportBottom) {
        container.scrollTop = rowBottom - container.clientHeight;
      }
    },
    [treeData.flatRows]
  );

  const focusEditorForPlacement = useCallback(
    (placementId: string): void => {
      ensurePlacementVisible(placementId);
      const attempt = (remaining: number): void => {
        const editor = document.querySelector<HTMLTextAreaElement>(`textarea[data-placement-id="${placementId}"]`);
        if (editor) {
          editor.focus();
          placeCaretAtEnd(editor);
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
        const updatedAtom = await atomUpdate(atom.id, {
          expectedRevision: atom.revision,
          rawText: nextText
        });
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
    [reloadActiveNotepad, uiDispatch]
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
    async (mutation: () => Promise<void>): Promise<void> => {
      setSaving(true);
      setError(undefined);
      try {
        await mutation();
        await reloadActiveNotepad();
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setSaving(false);
      }
    },
    [reloadActiveNotepad]
  );

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

      await runMutation(async () => {
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
      runMutation,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      uiState.selectedPlacementId,
      updateCanonicalParent
    ]
  );

  const reorderSelected = useCallback(
    async (direction: "up" | "down"): Promise<void> => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      if (!row || !uiState.activeNotepadId || !isGateOpen) {
        return;
      }
      const parentKey = row.effectiveParentPlacementId ?? ROOT_KEY;
      const siblings = treeData.childrenByParentKey[parentKey] ?? [];
      const swapWith = findSiblingSwapTarget(siblings, row.placement.id, direction);
      if (!swapWith) {
        return;
      }

      await runMutation(async () => {
        const order = [...treeData.orderedPlacementIds];
        const a = order.indexOf(row.placement.id);
        const b = order.indexOf(swapWith);
        if (a === -1 || b === -1) {
          return;
        }
        [order[a], order[b]] = [order[b], order[a]];
        await placementsReorder(uiState.activeNotepadId, {
          orderedPlacementIds: order,
          idempotencyKey: idempotencyKey()
        });
      });
    },
    [
      isGateOpen,
      runMutation,
      treeData.childrenByParentKey,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      uiState.activeNotepadId,
      uiState.selectedPlacementId
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

    await runMutation(async () => {
      await updatePlacementParent(row, previousVisible.placement.id);
      await updateCanonicalParent(row.atom, previousVisible.atom?.id);
    });
  }, [isGateOpen, runMutation, treeData.flatRows, treeData.rowByPlacementId, uiState.selectedPlacementId, updateCanonicalParent, updatePlacementParent]);

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

    await runMutation(async () => {
      await updatePlacementParent(row, nextParentPlacementId);
      await updateCanonicalParent(row.atom, nextParentAtomId);
    });
  }, [isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId, updateCanonicalParent, updatePlacementParent]);

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

      await runMutation(async () => {
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

          if (atomHasNoMeaningfulContent(archivedAtom)) {
            await atomDelete(archivedAtom.id, {
              expectedRevision: archivedAtom.revision,
              reason: "notepad_empty_row_pruned"
            });
          }
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
    [flushDraft, isGateOpen, runMutation, treeData.flatRows, uiDispatch, uiState.draftsByPlacement]
  );

  const deleteSelected = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row) {
      return;
    }
    await deleteRow(row);
  }, [deleteRow, treeData.rowByPlacementId, uiState.selectedPlacementId]);

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

    await runMutation(async () => {
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
    runMutation,
    treeData.orderedPlacementIds,
    treeData.rowByPlacementId,
    uiDispatch,
    uiState.activeNotepadId,
    uiState.clipboard,
    uiState.selectedPlacementId,
    updatePlacementParent
  ]);

  const moveSelectedToNotepad = useCallback(
    async (targetNotepadId: string, mode: "copy" | "move"): Promise<void> => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      if (!row || !targetNotepadId || !isGateOpen) {
        return;
      }
      if (targetNotepadId === row.placement.viewId && mode === "move") {
        return;
      }

      setSaving(true);
      setError(undefined);
      try {
        const destinationPlacement = await placementSave({
          viewId: targetNotepadId,
          blockId: row.block.id,
          idempotencyKey: idempotencyKey()
        });
        if (mode === "move") {
          await placementDelete(row.placement.id, idempotencyKey());
        }

        if (targetNotepadId === uiState.activeNotepadId) {
          await reloadActiveNotepad();
          uiDispatch({ type: "set_selected_placement", placementId: destinationPlacement.id });
        } else {
          uiDispatch({ type: "set_active_notepad", notepadId: targetNotepadId });
          uiDispatch({ type: "set_selected_placement", placementId: destinationPlacement.id });
          await loadNotepadData(targetNotepadId);
        }
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setSaving(false);
      }
    },
    [
      isGateOpen,
      loadNotepadData,
      reloadActiveNotepad,
      treeData.rowByPlacementId,
      uiDispatch,
      uiState.activeNotepadId,
      uiState.selectedPlacementId
    ]
  );

  const updateSelectedTaskStatus = useCallback(
    async (status: TaskStatus): Promise<void> => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      const rowAtom = row?.atom;
      if (!row || !rowAtom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(rowAtom.id)) ?? rowAtom;
        await taskStatusSet(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          status
        });
      });
    },
    [isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId]
  );

  const updateSelectedPriority = useCallback(
    async (priority: 1 | 2 | 3 | 4 | 5): Promise<void> => {
      const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
      const rowAtom = row?.atom;
      if (!row || !rowAtom || !isGateOpen) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(rowAtom.id)) ?? rowAtom;
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
    [isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId]
  );

  const snoozeSelectedUntilTomorrow = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row?.atom || !isGateOpen) {
      return;
    }
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await runMutation(async () => {
      await conditionSetDate({
        atomId: row.atom!.id,
        untilAt: tomorrow
      });
    });
  }, [isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId]);

  const setSelectedWaitingPerson = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row?.atom || !isGateOpen) {
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
  }, [isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId]);

  const setSelectedBlockedByTask = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row?.atom || !isGateOpen) {
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
  }, [isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId]);

  const clearSelectedConditions = useCallback(async (): Promise<void> => {
    const row = uiState.selectedPlacementId ? treeData.rowByPlacementId[uiState.selectedPlacementId] : undefined;
    if (!row?.atom || !isGateOpen) {
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
  }, [conditionsByAtomId, isGateOpen, runMutation, treeData.rowByPlacementId, uiState.selectedPlacementId]);

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
      const categories = parseCategories(createCategories);
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

        const filters: NotepadFilter = {
          includeArchived: false,
          categories
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
              categories
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
    [createCategories, createDescription, createName, creatingNotepad, isGateOpen, loadNotepadsIntoState, notepads, uiDispatch]
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
        const categories = parseCategories(editCategories);
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
              categories
            },
            sorts: activeNotepad.sorts,
            captureDefaults: {
              ...(activeNotepad.captureDefaults ?? {}),
              categories
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
    [activeNotepad, editCategories, editDescription, editName, editingNotepad, isGateOpen, loadNotepadsIntoState, reloadActiveNotepad]
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
      let cursor = treeData.effectiveParentByPlacementId[candidatePlacementId];
      while (cursor) {
        if (cursor === ancestorPlacementId) {
          return true;
        }
        cursor = treeData.effectiveParentByPlacementId[cursor];
      }
      return false;
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
    uiDispatch({ type: "set_quick_actions_open", open: !uiState.quickActionsOpen });
  }, [selectedRow, uiDispatch, uiState.quickActionsOpen]);

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

      switch (action.type) {
        case "none":
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
      indentSelected,
      moveEditorSelection,
      openQuickActions,
      outdentSelected,
      pasteAfterSelected,
      reorderSelected,
      uiDispatch,
      uiState.draftsByPlacement
    ]
  );

  const onTreeContainerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.target instanceof HTMLTextAreaElement) {
        return;
      }

      const action = resolveContainerKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        hasSelectedRow: !!uiState.selectedPlacementId
      });

      switch (action.type) {
        case "none":
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
      focusEditorForPlacement,
      navigateHorizontalSelection,
      navigateSelection,
      openQuickActions,
      pasteAfterSelected,
      uiState.selectedPlacementId
    ]
  );

  const selectedRowText = selectedRow ? rowText(selectedRow, uiState.draftsByPlacement[selectedRow.placement.id]) : "";

  return (
    <section className="notepad-screen screen">
      <NotepadToolbar
        notepads={notepads}
        activeNotepadId={uiState.activeNotepadId}
        activeNotepad={activeNotepad}
        selectedRow={selectedRow}
        loading={loading}
        saving={saving}
        clipboard={uiState.clipboard}
        capabilities={capabilities}
        health={health}
        featureFlags={featureFlags}
        isFeatureGateOpen={isGateOpen}
        interactionMode={uiState.interactionMode}
        onSelectNotepad={(notepadId) => uiDispatch({ type: "set_active_notepad", notepadId })}
        onRefresh={() => void reloadActiveNotepad()}
        onNewRow={() => void createRow("sibling", { focusEditor: true })}
        onNewChild={() => void createRow("child", { focusEditor: true })}
        onRemoveRow={() => void deleteSelected()}
        onMoveUp={() => void reorderSelected("up")}
        onMoveDown={() => void reorderSelected("down")}
        onIndent={() => void indentSelected()}
        onOutdent={() => void outdentSelected()}
        onCopyRow={() => copyOrCutSelected("copy")}
        onCutRow={() => copyOrCutSelected("cut")}
        onPasteRow={() => void pasteAfterSelected()}
        onToggleQuickActions={openQuickActions}
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
      />

      {gateError && <div className="banner error">{gateError}</div>}
      {error && <div className="banner error">{error}</div>}
      {(loading || saving) && <div className="banner info">{loading ? "Loading notepad..." : "Saving..."}</div>}

      <div className="notepad-layout">
        <div className="card notepad-outline">
          <header className="notepad-outline-header">
            <h3>{activeNotepad?.name ?? "Notepad"}</h3>
            <small>
              {treeData.flatRows.length} row{treeData.flatRows.length === 1 ? "" : "s"}
            </small>
          </header>

          {treeData.flatRows.length === 0 ? (
            <p className="settings-hint">No rows yet. Use "New Row" to start capturing.</p>
          ) : (
            <NotepadTree
              rows={treeData.flatRows}
              selectedPlacementId={uiState.selectedPlacementId}
              getRowText={(row) => rowText(row, uiState.draftsByPlacement[row.placement.id])}
              isTaskRow={isTaskRow}
              parseOverlayMode={(row) => parseOverlayMode(row.overlay)}
              onSelectRow={(placementId) => uiDispatch({ type: "set_selected_placement", placementId })}
              onToggleCollapsed={toggleRowCollapsed}
              onEditorFocus={(placementId) => {
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
              onEditorBlur={(placementId) => {
                void flushDraft(placementId);
                uiDispatch({ type: "set_interaction_mode", mode: "navigation" });
              }}
              onEditorKeyDown={onRowEditorKeyDown}
              onContainerKeyDown={onTreeContainerKeyDown}
            />
          )}
        </div>

        <aside className="card notepad-inspector">
          <h3>Row Details</h3>
          {!selectedRow && <p className="settings-hint">Select a row to inspect and edit metadata.</p>}
          {selectedRow && (
            <div className="notepad-inspector-grid">
              <p>
                <strong>{rowTitle(selectedRow)}</strong>
              </p>
              <small className="settings-hint">Block: {selectedRow.block.id}</small>
              {selectedRow.atom && <small className="settings-hint">Atom: {selectedRow.atom.id}</small>}
              <small className="settings-hint">Updated {new Date(selectedRow.block.updatedAt).toLocaleString()}</small>
              <small className="settings-hint">Text length: {selectedRowText.length}</small>

              {isTaskRow(selectedRow) && selectedRow.atom && (
                <>
                  <label>
                    Status
                    <select
                      value={selectedRow.atom.facetData.task?.status ?? "todo"}
                      onChange={(event) => void updateSelectedTaskStatus(event.target.value as TaskStatus)}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Priority
                    <select
                      value={selectedRow.atom.facetData.task?.priority ?? 3}
                      onChange={(event) => void updateSelectedPriority(Number(event.target.value) as 1 | 2 | 3 | 4 | 5)}
                    >
                      <option value={1}>P1</option>
                      <option value={2}>P2</option>
                      <option value={3}>P3</option>
                      <option value={4}>P4</option>
                      <option value={5}>P5</option>
                    </select>
                  </label>
                  <small className="settings-hint">
                    Current priority: {priorityLabel(selectedRow.atom.facetData.task?.priority ?? 3)}
                  </small>
                </>
              )}

              <div className="notepad-inspector-actions">
                <button type="button" onClick={() => void snoozeSelectedUntilTomorrow()} disabled={!selectedRow.atom || !isGateOpen}>
                  Snooze 1 day
                </button>
                <button type="button" onClick={() => void setSelectedWaitingPerson()} disabled={!selectedRow.atom || !isGateOpen}>
                  Waiting on person
                </button>
                <button type="button" onClick={() => void setSelectedBlockedByTask()} disabled={!selectedRow.atom || !isGateOpen}>
                  Blocked by task
                </button>
                <button type="button" onClick={() => void clearSelectedConditions()} disabled={!selectedRow.atom || !isGateOpen}>
                  Clear blocking
                </button>
              </div>

              {uiState.quickActionsOpen && (
                <div className="card quick-actions-panel">
                  <h4>Quick Actions</h4>
                  <label>
                    Destination notepad
                    <select value={quickTargetNotepadId} onChange={(event) => setQuickTargetNotepadId(event.target.value)}>
                      <option value="">Select notepad</option>
                      {notepads
                        .filter((value) => value.id !== uiState.activeNotepadId)
                        .map((value) => (
                          <option key={value.id} value={value.id}>
                            {value.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="notepad-inspector-actions">
                    <button type="button" onClick={() => void moveSelectedToNotepad(quickTargetNotepadId, "copy")} disabled={!quickTargetNotepadId}>
                      Copy to Notepad
                    </button>
                    <button type="button" onClick={() => void moveSelectedToNotepad(quickTargetNotepadId, "move")} disabled={!quickTargetNotepadId}>
                      Move to Notepad
                    </button>
                    <button type="button" onClick={() => uiDispatch({ type: "set_quick_actions_open", open: false })}>
                      Close
                    </button>
                  </div>
                </div>
              )}

              {selectedRow.overlay && (
                <small className="settings-hint">
                  Active condition: {selectedRow.overlay.mode}
                  {selectedRow.overlay.waitingOnPerson ? ` (${selectedRow.overlay.waitingOnPerson})` : ""}
                </small>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
