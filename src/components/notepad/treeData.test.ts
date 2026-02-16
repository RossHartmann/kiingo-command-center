import { describe, expect, it } from "vitest";
import { activeOverlay, buildTreeData, findSiblingSwapTarget, insertPlacementAfter, sortPlacements } from "./treeData";
import type { AtomRecord, BlockRecord, ConditionRecord, PlacementRecord } from "../../lib/types";

function atom(id: string): AtomRecord {
  return {
    id,
    schemaVersion: 1,
    createdAt: "2026-02-16T00:00:00.000Z",
    updatedAt: "2026-02-16T00:00:00.000Z",
    rawText: id,
    captureSource: "ui",
    facets: ["task"],
    facetData: { task: { title: id, status: "todo", priority: 3 } },
    relations: { threadIds: [] },
    governance: { sensitivity: "internal", origin: "user_input", encryptionScope: "none" },
    revision: 1
  };
}

function block(id: string, atomId: string, parentBlockId?: string): BlockRecord {
  return {
    id,
    schemaVersion: 1,
    atomId,
    text: id,
    kind: "task",
    lifecycle: "active",
    parentBlockId,
    threadIds: [],
    labels: [],
    categories: [],
    taskStatus: "todo",
    priority: 3,
    createdAt: "2026-02-16T00:00:00.000Z",
    updatedAt: "2026-02-16T00:00:00.000Z",
    revision: 1
  };
}

function placement(id: string, blockId: string, orderKey: string, parentPlacementId?: string): PlacementRecord {
  return {
    id,
    schemaVersion: 1,
    viewId: "now",
    blockId,
    parentPlacementId,
    orderKey,
    pinned: false,
    createdAt: "2026-02-16T00:00:00.000Z",
    updatedAt: "2026-02-16T00:00:00.000Z",
    revision: 1
  };
}

describe("notepad treeData", () => {
  it("falls back to canonical parent block when placement parent is absent", () => {
    const placements = [
      placement("p-parent", "b-parent", "00000000-a"),
      placement("p-child", "b-child", "00000001-b")
    ];

    const blocksById: Record<string, BlockRecord> = {
      "b-parent": block("b-parent", "a-parent"),
      "b-child": block("b-child", "a-child", "b-parent")
    };

    const atomsById: Record<string, AtomRecord> = {
      "a-parent": atom("a-parent"),
      "a-child": atom("a-child")
    };

    const tree = buildTreeData(placements, blocksById, atomsById, {}, {});
    expect(tree.rowByPlacementId["p-child"].effectiveParentPlacementId).toBe("p-parent");
    expect(tree.flatRows[0].placement.id).toBe("p-parent");
    expect(tree.flatRows[1].placement.id).toBe("p-child");
  });

  it("prioritizes person > task > date overlays", () => {
    const conditions: ConditionRecord[] = [
      {
        id: "c-date",
        schemaVersion: 1,
        atomId: "a-1",
        status: "active",
        mode: "date",
        blockedUntil: "2026-02-17T00:00:00.000Z",
        createdAt: "2026-02-16T00:00:00.000Z",
        updatedAt: "2026-02-16T00:00:00.000Z",
        revision: 1
      },
      {
        id: "c-task",
        schemaVersion: 1,
        atomId: "a-1",
        status: "active",
        mode: "task",
        blockerAtomId: "a-2",
        createdAt: "2026-02-16T00:00:00.000Z",
        updatedAt: "2026-02-16T00:00:00.000Z",
        revision: 1
      },
      {
        id: "c-person",
        schemaVersion: 1,
        atomId: "a-1",
        status: "active",
        mode: "person",
        waitingOnPerson: "Alex",
        waitingCadenceDays: 3,
        createdAt: "2026-02-16T00:00:00.000Z",
        updatedAt: "2026-02-16T00:00:00.000Z",
        revision: 1
      }
    ];

    const overlay = activeOverlay(conditions);
    expect(overlay?.id).toBe("c-person");
  });

  it("supports deterministic insertion and sibling swaps", () => {
    const order = insertPlacementAfter(["a", "b", "c"], "x", "b");
    expect(order).toEqual(["a", "b", "x", "c"]);
    expect(findSiblingSwapTarget(["a", "b", "c"], "b", "up")).toBe("a");
    expect(findSiblingSwapTarget(["a", "b", "c"], "b", "down")).toBe("c");
  });

  it("sorts pinned rows before unpinned and keeps order keys", () => {
    const items = [
      { ...placement("p2", "b2", "00000002"), pinned: false },
      { ...placement("p1", "b1", "00000001"), pinned: true },
      { ...placement("p3", "b3", "00000000"), pinned: false }
    ];
    const sorted = sortPlacements(items);
    expect(sorted.map((value) => value.id)).toEqual(["p1", "p3", "p2"]);
  });
});
