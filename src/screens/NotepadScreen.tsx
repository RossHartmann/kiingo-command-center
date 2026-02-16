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
  conditionsList,
  notepadAtomsList,
  notepadBlockCreate,
  notepadsList,
  notepadSave,
  placementDelete,
  placementSave,
  placementsList,
  placementsReorder,
  taskComplete,
  taskStatusSet
} from "../lib/tauriClient";
import type {
  AtomRecord,
  BlockRecord,
  ConditionRecord,
  NotepadFilter,
  NotepadViewDefinition,
  PlacementRecord,
  TaskStatus
} from "../lib/types";

type OverlayMode = "person" | "task" | "date";

interface FlatRow {
  placement: PlacementRecord;
  block: BlockRecord;
  atom?: AtomRecord;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  effectiveParentPlacementId?: string;
  overlay?: ConditionRecord;
}

interface TreeData {
  flatRows: FlatRow[];
  rowByPlacementId: Record<string, FlatRow>;
  effectiveParentByPlacementId: Record<string, string | undefined>;
  childrenByParentKey: Record<string, string[]>;
  orderedPlacementIds: string[];
}

interface ClipboardRow {
  blockId: string;
  sourcePlacementId: string;
  sourceViewId: string;
  mode: "copy" | "cut";
}

const ROOT_KEY = "__root__";
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

function overlayPriority(condition: ConditionRecord): number {
  if (condition.mode === "person") return 0;
  if (condition.mode === "task") return 1;
  if (condition.mode === "date") return 2;
  return 99;
}

function activeOverlay(conditions: ConditionRecord[] | undefined): ConditionRecord | undefined {
  if (!conditions || conditions.length === 0) {
    return undefined;
  }
  return [...conditions]
    .filter((condition) => condition.status === "active")
    .sort((a, b) => overlayPriority(a) - overlayPriority(b))[0];
}

function parseOverlayMode(condition: ConditionRecord | undefined): OverlayMode | undefined {
  if (!condition) return undefined;
  if (condition.mode === "person") return "person";
  if (condition.mode === "task") return "task";
  if (condition.mode === "date") return "date";
  return undefined;
}

function isTaskRow(row: FlatRow): boolean {
  return row.block.kind === "task" || !!row.atom?.facetData.task || !!row.block.taskStatus;
}

function rowText(row: FlatRow, draft: string | undefined): string {
  return draft ?? row.block.text;
}

function sortPlacements(values: PlacementRecord[]): PlacementRecord[] {
  return [...values].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return Number(b.pinned) - Number(a.pinned);
    }
    const keyCompare = a.orderKey.localeCompare(b.orderKey);
    if (keyCompare !== 0) {
      return keyCompare;
    }
    return a.id.localeCompare(b.id);
  });
}

function buildTreeData(
  placements: PlacementRecord[],
  blocksById: Record<string, BlockRecord>,
  atomsById: Record<string, AtomRecord>,
  collapsedByPlacement: Record<string, boolean>,
  conditionsByAtomId: Record<string, ConditionRecord[]>
): TreeData {
  const orderedPlacements = sortPlacements(placements);
  const placementById = new Map<string, PlacementRecord>(orderedPlacements.map((placement) => [placement.id, placement]));
  const blockToPlacementId = new Map<string, string>();
  for (const placement of orderedPlacements) {
    if (!blockToPlacementId.has(placement.blockId)) {
      blockToPlacementId.set(placement.blockId, placement.id);
    }
  }

  type Node = {
    placement: PlacementRecord;
    block: BlockRecord;
    atom?: AtomRecord;
    children: Node[];
    effectiveParentPlacementId?: string;
  };

  const nodesByPlacementId = new Map<string, Node>();
  for (const placement of orderedPlacements) {
    const block = blocksById[placement.blockId];
    if (!block) {
      continue;
    }
    nodesByPlacementId.set(placement.id, {
      placement,
      block,
      atom: block.atomId ? atomsById[block.atomId] : undefined,
      children: []
    });
  }

  const effectiveParentByPlacementId: Record<string, string | undefined> = {};
  const roots: Node[] = [];
  for (const placement of orderedPlacements) {
    const node = nodesByPlacementId.get(placement.id);
    if (!node) {
      continue;
    }
    let parentPlacementId = placement.parentPlacementId;
    if (!parentPlacementId || !nodesByPlacementId.has(parentPlacementId)) {
      const canonicalParentPlacementId = node.block.parentBlockId
        ? blockToPlacementId.get(node.block.parentBlockId)
        : undefined;
      parentPlacementId = canonicalParentPlacementId;
    }
    if (parentPlacementId === placement.id) {
      parentPlacementId = undefined;
    }
    node.effectiveParentPlacementId = parentPlacementId;
    effectiveParentByPlacementId[placement.id] = parentPlacementId;
  }

  for (const placement of orderedPlacements) {
    const node = nodesByPlacementId.get(placement.id);
    if (!node) {
      continue;
    }
    if (!node.effectiveParentPlacementId) {
      roots.push(node);
      continue;
    }
    const parentNode = nodesByPlacementId.get(node.effectiveParentPlacementId);
    if (!parentNode) {
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }

  const flatRows: FlatRow[] = [];
  const rowByPlacementId: Record<string, FlatRow> = {};
  const childrenByParentKey: Record<string, string[]> = {};
  const orderedPlacementIds: string[] = [];
  for (const placement of orderedPlacements) {
    if (nodesByPlacementId.has(placement.id)) {
      orderedPlacementIds.push(placement.id);
    }
  }

  const registerChild = (parentPlacementId: string | undefined, placementId: string): void => {
    const key = parentPlacementId ?? ROOT_KEY;
    if (!childrenByParentKey[key]) {
      childrenByParentKey[key] = [];
    }
    childrenByParentKey[key].push(placementId);
  };

  const visitNode = (node: Node, depth: number, path: Set<string>): void => {
    if (path.has(node.placement.id)) {
      return;
    }
    const nextPath = new Set(path);
    nextPath.add(node.placement.id);
    const row: FlatRow = {
      placement: node.placement,
      block: node.block,
      atom: node.atom,
      depth,
      hasChildren: node.children.length > 0,
      collapsed: !!collapsedByPlacement[node.placement.id],
      effectiveParentPlacementId: node.effectiveParentPlacementId,
      overlay: node.atom ? activeOverlay(conditionsByAtomId[node.atom.id]) : undefined
    };
    flatRows.push(row);
    rowByPlacementId[row.placement.id] = row;
    registerChild(node.effectiveParentPlacementId, row.placement.id);

    if (row.collapsed) {
      return;
    }
    for (const child of node.children) {
      visitNode(child, depth + 1, nextPath);
    }
  };

  for (const root of roots) {
    visitNode(root, 0, new Set());
  }

  return {
    flatRows,
    rowByPlacementId,
    effectiveParentByPlacementId,
    childrenByParentKey,
    orderedPlacementIds
  };
}

function insertPlacementAfter(order: string[], placementId: string, afterPlacementId?: string): string[] {
  const next = order.filter((value) => value !== placementId);
  if (!afterPlacementId) {
    next.push(placementId);
    return next;
  }
  const index = next.indexOf(afterPlacementId);
  if (index === -1) {
    next.push(placementId);
    return next;
  }
  next.splice(index + 1, 0, placementId);
  return next;
}

function findSiblingSwapTarget(siblings: string[], selectedId: string, direction: "up" | "down"): string | undefined {
  const index = siblings.indexOf(selectedId);
  if (index === -1) return undefined;
  if (direction === "up") {
    return index > 0 ? siblings[index - 1] : undefined;
  }
  return index < siblings.length - 1 ? siblings[index + 1] : undefined;
}

export function NotepadScreen(): JSX.Element {
  const [notepads, setNotepads] = useState<NotepadViewDefinition[]>([]);
  const [activeNotepadId, setActiveNotepadId] = useState<string>("now");
  const [placements, setPlacements] = useState<PlacementRecord[]>([]);
  const [blocksById, setBlocksById] = useState<Record<string, BlockRecord>>({});
  const [atomsById, setAtomsById] = useState<Record<string, AtomRecord>>({});
  const [conditionsByAtomId, setConditionsByAtomId] = useState<Record<string, ConditionRecord[]>>({});
  const [collapsedByPlacement, setCollapsedByPlacement] = useState<Record<string, boolean>>({});
  const [draftsByPlacement, setDraftsByPlacement] = useState<Record<string, string>>({});
  const [selectedPlacementId, setSelectedPlacementId] = useState<string>();
  const [clipboard, setClipboard] = useState<ClipboardRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [creatingNotepad, setCreatingNotepad] = useState(false);

  const saveTimersRef = useRef<Map<string, number>>(new Map());

  const activeNotepad = useMemo(
    () => notepads.find((notepad) => notepad.id === activeNotepadId),
    [notepads, activeNotepadId]
  );

  const treeData = useMemo(
    () => buildTreeData(placements, blocksById, atomsById, collapsedByPlacement, conditionsByAtomId),
    [placements, blocksById, atomsById, collapsedByPlacement, conditionsByAtomId]
  );

  const selectedRow = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;

  const loadNotepadsIntoState = useCallback(async (): Promise<NotepadViewDefinition[]> => {
    const views = await notepadsList();
    setNotepads(views);
    return views;
  }, []);

  const loadNotepadData = useCallback(async (notepadId: string): Promise<void> => {
    const [placementItems, blockItems, atomItems, activeConditions] = await Promise.all([
      listAllPages((cursor) => placementsList({ viewId: notepadId, limit: 250, cursor })),
      listAllPages((cursor) => blocksList({ notepadId, limit: 250, cursor })),
      listAllPages((cursor) => notepadAtomsList(notepadId, 250, cursor)),
      listAllPages((cursor) => conditionsList({ status: "active", limit: 250, cursor }))
    ]);

    const nextBlocksById: Record<string, BlockRecord> = {};
    for (const block of blockItems) {
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
      nextConditionsByAtomId[atomId].sort((a, b) => overlayPriority(a) - overlayPriority(b));
    }

    setPlacements(sortPlacements(placementItems));
    setBlocksById(nextBlocksById);
    setAtomsById(nextAtomsById);
    setConditionsByAtomId(nextConditionsByAtomId);
    setSelectedPlacementId((current) => {
      if (current && placementItems.some((placement) => placement.id === current)) {
        return current;
      }
      return placementItems[0]?.id;
    });
  }, []);

  const reloadActiveNotepad = useCallback(async (): Promise<void> => {
    if (!activeNotepadId) {
      return;
    }
    await loadNotepadData(activeNotepadId);
  }, [activeNotepadId, loadNotepadData]);

  useEffect(() => {
    let cancelled = false;
    const boot = async (): Promise<void> => {
      setLoading(true);
      setError(undefined);
      try {
        const views = await loadNotepadsIntoState();
        if (cancelled) {
          return;
        }
        const nextId =
          views.find((view) => view.id === activeNotepadId)?.id ??
          views.find((view) => view.id === "now")?.id ??
          views[0]?.id;
        if (nextId) {
          setActiveNotepadId(nextId);
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
  }, [loadNotepadsIntoState]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      if (!activeNotepadId) {
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        await loadNotepadData(activeNotepadId);
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
  }, [activeNotepadId, loadNotepadData]);

  useEffect(() => {
    return () => {
      for (const timer of saveTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      saveTimersRef.current.clear();
    };
  }, []);

  const persistRowText = useCallback(
    async (row: FlatRow, nextText: string): Promise<void> => {
      const atom = row.atom;
      if (!atom) {
        return;
      }
      if (nextText === row.block.text) {
        setDraftsByPlacement((current) => {
          const next = { ...current };
          delete next[row.placement.id];
          return next;
        });
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
        setDraftsByPlacement((current) => {
          const next = { ...current };
          delete next[row.placement.id];
          return next;
        });
      } catch (nextError) {
        setError(asErrorMessage(nextError));
        await reloadActiveNotepad();
      }
    },
    [reloadActiveNotepad]
  );

  const scheduleDraftSave = useCallback(
    (row: FlatRow, nextText: string): void => {
      setDraftsByPlacement((current) => ({ ...current, [row.placement.id]: nextText }));
      const existingTimer = saveTimersRef.current.get(row.placement.id);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      const timer = window.setTimeout(() => {
        void persistRowText(row, nextText);
      }, 450);
      saveTimersRef.current.set(row.placement.id, timer);
    },
    [persistRowText]
  );

  const flushDraft = useCallback(
    async (placementId: string): Promise<void> => {
      const timer = saveTimersRef.current.get(placementId);
      if (timer) {
        window.clearTimeout(timer);
        saveTimersRef.current.delete(placementId);
      }
      const row = treeData.rowByPlacementId[placementId];
      const draft = draftsByPlacement[placementId];
      if (!row || draft === undefined) {
        return;
      }
      await persistRowText(row, draft);
    },
    [draftsByPlacement, persistRowText, treeData.rowByPlacementId]
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
    if (parentAtomId && atom.relations.parentId === parentAtomId) {
      return;
    }
    if (!parentAtomId && !atom.relations.parentId) {
      return;
    }
    await atomUpdate(atom.id, {
      expectedRevision: atom.revision,
      relationsPatch: parentAtomId ? { parentId: parentAtomId } : undefined,
      clearParentId: parentAtomId ? undefined : true
    });
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

  const findPlacementForBlockInView = useCallback(
    async (blockId: string, viewId: string): Promise<PlacementRecord | undefined> => {
      const page = await placementsList({ viewId, blockId, limit: 25 });
      return sortPlacements(page.items)[0];
    },
    []
  );

  const createRow = useCallback(
    async (mode: "sibling" | "child"): Promise<void> => {
      if (!activeNotepadId) {
        return;
      }
      const anchorRow = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
      const parentPlacementId =
        mode === "child" ? anchorRow?.placement.id : anchorRow?.effectiveParentPlacementId;
      const parentRow = parentPlacementId ? treeData.rowByPlacementId[parentPlacementId] : undefined;
      const parentAtomId = parentRow?.atom?.id;

      await runMutation(async () => {
        const created = await notepadBlockCreate({
          notepadId: activeNotepadId,
          rawText: ""
        });
        let createdPlacement = await findPlacementForBlockInView(created.id, activeNotepadId);
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
          await placementsReorder(activeNotepadId, {
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
        setSelectedPlacementId(createdPlacement.id);
      });
    },
    [
      activeNotepadId,
      findPlacementForBlockInView,
      runMutation,
      selectedPlacementId,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId,
      updateCanonicalParent
    ]
  );

  const reorderSelected = useCallback(
    async (direction: "up" | "down"): Promise<void> => {
      const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
      if (!row || !activeNotepadId) {
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
        await placementsReorder(activeNotepadId, {
          orderedPlacementIds: order,
          idempotencyKey: idempotencyKey()
        });
      });
    },
    [
      activeNotepadId,
      runMutation,
      selectedPlacementId,
      treeData.childrenByParentKey,
      treeData.orderedPlacementIds,
      treeData.rowByPlacementId
    ]
  );

  const indentSelected = useCallback(async (): Promise<void> => {
    const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    if (!row) {
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
  }, [runMutation, selectedPlacementId, treeData.flatRows, treeData.rowByPlacementId, updateCanonicalParent, updatePlacementParent]);

  const outdentSelected = useCallback(async (): Promise<void> => {
    const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    if (!row) {
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
  }, [runMutation, selectedPlacementId, treeData.rowByPlacementId, updateCanonicalParent, updatePlacementParent]);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    if (!row) {
      return;
    }
    await flushDraft(row.placement.id);
    const index = treeData.flatRows.findIndex((value) => value.placement.id === row.placement.id);
    const fallbackSelection =
      treeData.flatRows[index + 1]?.placement.id ?? treeData.flatRows[index - 1]?.placement.id;
    setSelectedPlacementId(fallbackSelection);

    await runMutation(async () => {
      await placementDelete(row.placement.id, idempotencyKey());
      const remaining = await placementsList({ blockId: row.block.id, limit: 1 });
      if (remaining.items.length > 0 || !row.atom) {
        return;
      }
      const latestAtom = await atomGet(row.atom.id);
      if (!latestAtom) {
        return;
      }
      if (isTaskRow(row)) {
        await taskComplete(latestAtom.id, latestAtom.revision);
        return;
      }
      await atomArchive(latestAtom.id, {
        expectedRevision: latestAtom.revision,
        reason: "notepad_last_placement_removed"
      });
    });
  }, [flushDraft, runMutation, selectedPlacementId, treeData.flatRows, treeData.rowByPlacementId]);

  const copyOrCutSelected = useCallback(
    (mode: "copy" | "cut"): void => {
      const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
      if (!row || !activeNotepadId) {
        return;
      }
      setClipboard({
        blockId: row.block.id,
        sourcePlacementId: row.placement.id,
        sourceViewId: activeNotepadId,
        mode
      });
    },
    [activeNotepadId, selectedPlacementId, treeData.rowByPlacementId]
  );

  const pasteAfterSelected = useCallback(async (): Promise<void> => {
    if (!clipboard || !activeNotepadId) {
      return;
    }
    const target = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    const targetParentPlacementId = target?.effectiveParentPlacementId;

    await runMutation(async () => {
      let destinationPlacementId: string | undefined;

      if (clipboard.mode === "cut" && clipboard.sourceViewId === activeNotepadId) {
        const sourceRow = treeData.rowByPlacementId[clipboard.sourcePlacementId];
        if (!sourceRow) {
          setClipboard(null);
          return;
        }
        await updatePlacementParent(sourceRow, targetParentPlacementId);
        destinationPlacementId = sourceRow.placement.id;
      } else {
        const saved = await placementSave({
          viewId: activeNotepadId,
          blockId: clipboard.blockId,
          parentPlacementId: targetParentPlacementId,
          idempotencyKey: idempotencyKey()
        });
        destinationPlacementId = saved.id;
      }

      const reordered = insertPlacementAfter(treeData.orderedPlacementIds, destinationPlacementId, target?.placement.id);
      if (reordered.length > 1) {
        await placementsReorder(activeNotepadId, {
          orderedPlacementIds: reordered,
          idempotencyKey: idempotencyKey()
        });
      }

      if (
        clipboard.mode === "cut" &&
        !(clipboard.sourceViewId === activeNotepadId && clipboard.sourcePlacementId === destinationPlacementId)
      ) {
        await placementDelete(clipboard.sourcePlacementId, idempotencyKey());
        setClipboard(null);
      }

      setSelectedPlacementId(destinationPlacementId);
    });
  }, [
    activeNotepadId,
    clipboard,
    runMutation,
    selectedPlacementId,
    treeData.orderedPlacementIds,
    treeData.rowByPlacementId,
    updatePlacementParent
  ]);

  const updateSelectedTaskStatus = useCallback(
    async (status: TaskStatus): Promise<void> => {
      const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
      if (!row?.atom) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom;
        await taskStatusSet(latestAtom.id, {
          expectedRevision: latestAtom.revision,
          status
        });
      });
    },
    [runMutation, selectedPlacementId, treeData.rowByPlacementId]
  );

  const updateSelectedPriority = useCallback(
    async (priority: 1 | 2 | 3 | 4 | 5): Promise<void> => {
      const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
      if (!row?.atom) {
        return;
      }
      await runMutation(async () => {
        const latestAtom = (await atomGet(row.atom!.id)) ?? row.atom;
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
    [runMutation, selectedPlacementId, treeData.rowByPlacementId]
  );

  const snoozeSelectedUntilTomorrow = useCallback(async (): Promise<void> => {
    const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    if (!row?.atom) {
      return;
    }
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await runMutation(async () => {
      await conditionSetDate({
        atomId: row.atom!.id,
        untilAt: tomorrow
      });
    });
  }, [runMutation, selectedPlacementId, treeData.rowByPlacementId]);

  const setSelectedWaitingPerson = useCallback(async (): Promise<void> => {
    const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    if (!row?.atom) {
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
  }, [runMutation, selectedPlacementId, treeData.rowByPlacementId]);

  const clearSelectedConditions = useCallback(async (): Promise<void> => {
    const row = selectedPlacementId ? treeData.rowByPlacementId[selectedPlacementId] : undefined;
    if (!row?.atom) {
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
  }, [conditionsByAtomId, runMutation, selectedPlacementId, treeData.rowByPlacementId]);

  const createNotepad = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      if (creatingNotepad) {
        return;
      }
      const trimmedName = createName.trim();
      if (!trimmedName) {
        setError("Notepad name is required.");
        return;
      }
      const trimmedCategory = createCategory.trim();
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
          categories: trimmedCategory ? [trimmedCategory] : undefined
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
              categories: trimmedCategory ? [trimmedCategory] : undefined
            },
            layoutMode: "outline"
          }
        });

        const views = await loadNotepadsIntoState();
        setCreateName("");
        setCreateDescription("");
        setCreateCategory("");
        if (views.some((view) => view.id === nextId)) {
          setActiveNotepadId(nextId);
        }
      } catch (nextError) {
        setError(asErrorMessage(nextError));
      } finally {
        setCreatingNotepad(false);
      }
    },
    [createCategory, createDescription, createName, creatingNotepad, loadNotepadsIntoState, notepads]
  );

  const onRowEditorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow): void => {
      const isModifier = event.metaKey || event.ctrlKey;

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void createRow("sibling");
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (event.shiftKey) {
          void outdentSelected();
        } else {
          void indentSelected();
        }
        return;
      }
      if (event.key === "Backspace" && rowText(row, draftsByPlacement[row.placement.id]).trim().length === 0) {
        event.preventDefault();
        void deleteSelected();
        return;
      }
      if (isModifier && event.shiftKey && event.key === "ArrowUp") {
        event.preventDefault();
        void reorderSelected("up");
        return;
      }
      if (isModifier && event.shiftKey && event.key === "ArrowDown") {
        event.preventDefault();
        void reorderSelected("down");
      }
    },
    [createRow, deleteSelected, draftsByPlacement, indentSelected, outdentSelected, reorderSelected]
  );

  const onRowContainerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): void => {
      if (event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) {
        return;
      }
      const lowerKey = event.key.toLowerCase();
      if (lowerKey === "c") {
        event.preventDefault();
        copyOrCutSelected("copy");
      } else if (lowerKey === "x") {
        event.preventDefault();
        copyOrCutSelected("cut");
      } else if (lowerKey === "v") {
        event.preventDefault();
        void pasteAfterSelected();
      }
    },
    [copyOrCutSelected, pasteAfterSelected]
  );

  return (
    <section className="notepad-screen screen">
      <div className="notepad-toolbar card">
        <div className="notepad-toolbar-row">
          <label>
            Notepad
            <select
              value={activeNotepadId}
              onChange={(event) => setActiveNotepadId(event.target.value)}
              aria-label="Active notepad"
            >
              {notepads.map((notepad) => (
                <option key={notepad.id} value={notepad.id}>
                  {notepad.name}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={() => void reloadActiveNotepad()} disabled={loading || saving}>
            Refresh
          </button>
          <button type="button" onClick={() => void createRow("sibling")} disabled={!activeNotepadId || saving}>
            New Row
          </button>
          <button type="button" onClick={() => void createRow("child")} disabled={!selectedRow || saving}>
            New Child
          </button>
          <button type="button" onClick={() => void deleteSelected()} disabled={!selectedRow || saving}>
            Remove Row
          </button>
          <button type="button" onClick={() => void reorderSelected("up")} disabled={!selectedRow || saving}>
            Move Up
          </button>
          <button type="button" onClick={() => void reorderSelected("down")} disabled={!selectedRow || saving}>
            Move Down
          </button>
          <button type="button" onClick={() => void indentSelected()} disabled={!selectedRow || saving}>
            Indent
          </button>
          <button type="button" onClick={() => void outdentSelected()} disabled={!selectedRow || saving}>
            Outdent
          </button>
        </div>

        <div className="notepad-toolbar-row">
          <button type="button" onClick={() => copyOrCutSelected("copy")} disabled={!selectedRow || saving}>
            Copy Row
          </button>
          <button type="button" onClick={() => copyOrCutSelected("cut")} disabled={!selectedRow || saving}>
            Cut Row
          </button>
          <button type="button" onClick={() => void pasteAfterSelected()} disabled={!clipboard || saving}>
            Paste Row
          </button>
          {clipboard && (
            <small className="settings-hint">
              Clipboard: {clipboard.mode} from `{clipboard.sourceViewId}`
            </small>
          )}
        </div>
      </div>

      <form className="card notepad-create-form" onSubmit={(event) => void createNotepad(event)}>
        <div className="notepad-create-row">
          <label>
            New notepad
            <input
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Project notes"
            />
          </label>
          <label>
            Category (optional)
            <input
              type="text"
              value={createCategory}
              onChange={(event) => setCreateCategory(event.target.value)}
              placeholder="marketing"
            />
          </label>
          <label>
            Description (optional)
            <input
              type="text"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder="Saved view + capture defaults"
            />
          </label>
          <button type="submit" className="primary" disabled={creatingNotepad}>
            {creatingNotepad ? "Creating..." : "Create Notepad"}
          </button>
        </div>
      </form>

      {error && <div className="banner error">{error}</div>}
      {(loading || saving) && <div className="banner info">{loading ? "Loading notepad..." : "Saving..."}</div>}

      <div className="notepad-layout">
        <div className="card notepad-outline" onKeyDown={onRowContainerKeyDown}>
          <header className="notepad-outline-header">
            <h3>{activeNotepad?.name ?? "Notepad"}</h3>
            <small>
              {treeData.flatRows.length} row{treeData.flatRows.length === 1 ? "" : "s"}
            </small>
          </header>

          {treeData.flatRows.length === 0 ? (
            <p className="settings-hint">No rows yet. Use "New Row" to start capturing.</p>
          ) : (
            <div className="notepad-rows">
              {treeData.flatRows.map((row) => {
                const textValue = rowText(row, draftsByPlacement[row.placement.id]);
                const selected = selectedPlacementId === row.placement.id;
                const overlayMode = parseOverlayMode(row.overlay);
                return (
                  <article
                    key={row.placement.id}
                    className={`notepad-row ${selected ? "selected" : ""}`}
                    style={{ paddingLeft: `${0.6 + row.depth * 1.1}rem` }}
                    onClick={() => setSelectedPlacementId(row.placement.id)}
                  >
                    <button
                      type="button"
                      className="notepad-toggle"
                      onClick={() =>
                        setCollapsedByPlacement((current) => ({
                          ...current,
                          [row.placement.id]: !current[row.placement.id]
                        }))
                      }
                      disabled={!row.hasChildren}
                      aria-label={row.hasChildren ? (row.collapsed ? "Expand row" : "Collapse row") : "Leaf row"}
                    >
                      {row.hasChildren ? (row.collapsed ? "▸" : "▾") : "·"}
                    </button>

                    <textarea
                      className="notepad-editor"
                      rows={1}
                      value={textValue}
                      onFocus={() => setSelectedPlacementId(row.placement.id)}
                      onChange={(event) => scheduleDraftSave(row, event.target.value)}
                      onBlur={() => void flushDraft(row.placement.id)}
                      onKeyDown={(event) => onRowEditorKeyDown(event, row)}
                      placeholder="Type and press Enter"
                    />

                    {isTaskRow(row) && (
                      <span className="notepad-pill">{row.atom?.facetData.task?.status ?? row.block.taskStatus ?? "todo"}</span>
                    )}
                    {overlayMode && (
                      <span className={`notepad-pill overlay-${overlayMode}`}>
                        {overlayMode === "person" && "waiting"}
                        {overlayMode === "task" && "blocked"}
                        {overlayMode === "date" && "snoozed"}
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
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
              <small className="settings-hint">
                Updated {new Date(selectedRow.block.updatedAt).toLocaleString()}
              </small>

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
                  <small className="settings-hint">Current priority: {priorityLabel(selectedRow.atom.facetData.task?.priority ?? 3)}</small>
                </>
              )}

              <div className="notepad-inspector-actions">
                <button type="button" onClick={() => void snoozeSelectedUntilTomorrow()} disabled={!selectedRow.atom}>
                  Snooze 1 day
                </button>
                <button type="button" onClick={() => void setSelectedWaitingPerson()} disabled={!selectedRow.atom}>
                  Waiting on person
                </button>
                <button type="button" onClick={() => void clearSelectedConditions()} disabled={!selectedRow.atom}>
                  Clear blocking
                </button>
              </div>

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
