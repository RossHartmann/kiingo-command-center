import type { AtomRecord, BlockRecord, ConditionRecord, PlacementRecord } from "../../lib/types";
import type { FlatRow, TreeData } from "./types";
import { ROOT_KEY } from "./types";

export type PlacementDropIntent = "before" | "after" | "inside";

export function overlayPriority(condition: ConditionRecord): number {
  if (condition.mode === "person") return 0;
  if (condition.mode === "task") return 1;
  if (condition.mode === "date") return 2;
  return 99;
}

export function activeOverlay(conditions: ConditionRecord[] | undefined): ConditionRecord | undefined {
  if (!conditions || conditions.length === 0) {
    return undefined;
  }
  return [...conditions]
    .filter((condition) => condition.status === "active")
    .sort((a, b) => overlayPriority(a) - overlayPriority(b))[0];
}

export function sortPlacements(values: PlacementRecord[]): PlacementRecord[] {
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

export function buildTreeData(
  placements: PlacementRecord[],
  blocksById: Record<string, BlockRecord>,
  atomsById: Record<string, AtomRecord>,
  collapsedByPlacement: Record<string, boolean>,
  conditionsByAtomId: Record<string, ConditionRecord[]>
): TreeData {
  const orderedPlacements = sortPlacements(placements);
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

  const descendantCountByPlacementId: Record<string, number> = {};
  const countDescendants = (node: Node, path: Set<string>): number => {
    if (path.has(node.placement.id)) {
      return 0;
    }
    const nextPath = new Set(path);
    nextPath.add(node.placement.id);
    let total = 0;
    for (const child of node.children) {
      total += 1 + countDescendants(child, nextPath);
    }
    descendantCountByPlacementId[node.placement.id] = total;
    return total;
  };
  for (const root of roots) {
    countDescendants(root, new Set());
  }
  for (const node of nodesByPlacementId.values()) {
    if (descendantCountByPlacementId[node.placement.id] === undefined) {
      countDescendants(node, new Set());
    }
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
      descendantCount: descendantCountByPlacementId[node.placement.id] ?? 0,
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

export function insertPlacementAfter(order: string[], placementId: string, afterPlacementId?: string): string[] {
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

export function findSiblingSwapTarget(siblings: string[], selectedId: string, direction: "up" | "down"): string | undefined {
  const index = siblings.indexOf(selectedId);
  if (index === -1) return undefined;
  if (direction === "up") {
    return index > 0 ? siblings[index - 1] : undefined;
  }
  return index < siblings.length - 1 ? siblings[index + 1] : undefined;
}

export function isPlacementDescendant(
  candidatePlacementId: string,
  ancestorPlacementId: string,
  effectiveParentByPlacementId: Record<string, string | undefined>
): boolean {
  let cursor = effectiveParentByPlacementId[candidatePlacementId];
  while (cursor) {
    if (cursor === ancestorPlacementId) {
      return true;
    }
    cursor = effectiveParentByPlacementId[cursor];
  }
  return false;
}

function buildChildrenByParent(
  effectiveParentByPlacementId: Record<string, string | undefined>,
  orderedPlacementIds: string[]
): Record<string, string[]> {
  const orderIndex = new Map(orderedPlacementIds.map((id, index) => [id, index]));
  const childrenByParent: Record<string, string[]> = {};
  for (const [placementId, parentPlacementId] of Object.entries(effectiveParentByPlacementId)) {
    if (!parentPlacementId) {
      continue;
    }
    if (!childrenByParent[parentPlacementId]) {
      childrenByParent[parentPlacementId] = [];
    }
    childrenByParent[parentPlacementId].push(placementId);
  }
  for (const children of Object.values(childrenByParent)) {
    children.sort((a, b) => (orderIndex.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b) ?? Number.MAX_SAFE_INTEGER));
  }
  return childrenByParent;
}

export function collectSubtreePlacementIds(
  rootPlacementId: string,
  effectiveParentByPlacementId: Record<string, string | undefined>,
  orderedPlacementIds: string[]
): string[] {
  if (!orderedPlacementIds.includes(rootPlacementId)) {
    return [];
  }
  const childrenByParent = buildChildrenByParent(effectiveParentByPlacementId, orderedPlacementIds);
  const visited = new Set<string>();
  const stack = [rootPlacementId];
  while (stack.length > 0) {
    const placementId = stack.pop();
    if (!placementId || visited.has(placementId)) {
      continue;
    }
    visited.add(placementId);
    const children = childrenByParent[placementId] ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return orderedPlacementIds.filter((placementId) => visited.has(placementId));
}

export interface PlacementDropPlan {
  orderedPlacementIds: string[];
  movedPlacementIds: string[];
  nextParentPlacementId?: string;
}

interface PlanPlacementDropArgs {
  orderedPlacementIds: string[];
  effectiveParentByPlacementId: Record<string, string | undefined>;
  sourcePlacementId: string;
  targetPlacementId: string;
  intent: PlacementDropIntent;
}

export function planPlacementDrop({
  orderedPlacementIds,
  effectiveParentByPlacementId,
  sourcePlacementId,
  targetPlacementId,
  intent
}: PlanPlacementDropArgs): PlacementDropPlan | undefined {
  if (!orderedPlacementIds.includes(sourcePlacementId) || !orderedPlacementIds.includes(targetPlacementId)) {
    return undefined;
  }

  const movedPlacementIds = collectSubtreePlacementIds(
    sourcePlacementId,
    effectiveParentByPlacementId,
    orderedPlacementIds
  );
  if (movedPlacementIds.length === 0) {
    return undefined;
  }

  const movedSet = new Set(movedPlacementIds);
  if (movedSet.has(targetPlacementId)) {
    return undefined;
  }

  const nextParentPlacementId =
    intent === "inside" ? targetPlacementId : effectiveParentByPlacementId[targetPlacementId];
  if (nextParentPlacementId && movedSet.has(nextParentPlacementId)) {
    return undefined;
  }

  const remaining = orderedPlacementIds.filter((placementId) => !movedSet.has(placementId));
  let insertionIndex = remaining.length;

  if (intent === "before") {
    const index = remaining.indexOf(targetPlacementId);
    if (index === -1) {
      return undefined;
    }
    insertionIndex = index;
  } else {
    const targetSubtree = collectSubtreePlacementIds(
      targetPlacementId,
      effectiveParentByPlacementId,
      orderedPlacementIds
    );
    let anchorPlacementId: string | undefined;
    for (let index = targetSubtree.length - 1; index >= 0; index -= 1) {
      const candidate = targetSubtree[index];
      if (!movedSet.has(candidate)) {
        anchorPlacementId = candidate;
        break;
      }
    }
    if (anchorPlacementId) {
      const anchorIndex = remaining.indexOf(anchorPlacementId);
      insertionIndex = anchorIndex === -1 ? remaining.length : anchorIndex + 1;
    }
  }

  const nextOrdered = [
    ...remaining.slice(0, insertionIndex),
    ...movedPlacementIds,
    ...remaining.slice(insertionIndex)
  ];

  const orderUnchanged =
    nextOrdered.length === orderedPlacementIds.length &&
    nextOrdered.every((placementId, index) => placementId === orderedPlacementIds[index]);
  const parentUnchanged = effectiveParentByPlacementId[sourcePlacementId] === nextParentPlacementId;
  if (orderUnchanged && parentUnchanged) {
    return undefined;
  }

  return {
    orderedPlacementIds: nextOrdered,
    movedPlacementIds,
    nextParentPlacementId
  };
}

export function parseOverlayMode(condition: ConditionRecord | undefined): "person" | "task" | "date" | undefined {
  if (!condition) return undefined;
  if (condition.mode === "person") return "person";
  if (condition.mode === "task") return "task";
  if (condition.mode === "date") return "date";
  return undefined;
}
