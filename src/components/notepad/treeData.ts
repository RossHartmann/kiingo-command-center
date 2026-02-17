import type { AtomRecord, BlockRecord, ConditionRecord, PlacementRecord } from "../../lib/types";
import type { FlatRow, TreeData } from "./types";
import { ROOT_KEY } from "./types";

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

export function parseOverlayMode(condition: ConditionRecord | undefined): "person" | "task" | "date" | undefined {
  if (!condition) return undefined;
  if (condition.mode === "person") return "person";
  if (condition.mode === "task") return "task";
  if (condition.mode === "date") return "date";
  return undefined;
}
