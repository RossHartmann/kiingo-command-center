import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  pointerWithin,
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NotepadRow } from "./NotepadRow";
import type { FlatRow } from "./types";
import { collectVisibleSubtreePlacementIds, type PlacementDropIntent } from "./treeData";

interface NotepadTreeDropPayload {
  sourcePlacementId: string;
  targetPlacementId: string;
  intent: PlacementDropIntent;
}

interface NotepadTreeProps {
  rows: FlatRow[];
  selectedPlacementId?: string;
  keyboardDropTarget?: NotepadTreeDropPayload;
  getRowText: (row: FlatRow) => string;
  isTaskRow: (row: FlatRow) => boolean;
  parseOverlayMode: (row: FlatRow) => "person" | "task" | "date" | undefined;
  onSelectRow: (placementId: string) => void;
  onToggleCollapsed: (placementId: string) => void;
  onEditorFocus: (placementId: string) => void;
  onEditorChange: (placementId: string, nextText: string) => void;
  onEditorBlur: (placementId: string, event: FocusEvent<HTMLTextAreaElement>) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
  onOpenContextMenu?: (placementId: string, x: number, y: number) => void;
  onContainerKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDropRow: (payload: NotepadTreeDropPayload) => void;
  onAutoExpandRow: (placementId: string) => void;
}

interface SortableNotepadRowProps {
  row: FlatRow;
  selected: boolean;
  textValue: string;
  overlayMode?: "person" | "task" | "date";
  isTask: boolean;
  dropHint?: PlacementDropIntent;
  dropIntentLabel?: string;
  followsParentDrag?: boolean;
  parentDragDelta?: { x: number; y: number };
  onSelect: (placementId: string) => void;
  onToggleCollapsed: (placementId: string) => void;
  onEditorFocus: (placementId: string) => void;
  onEditorChange: (placementId: string, nextText: string) => void;
  onEditorBlur: (placementId: string, event: FocusEvent<HTMLTextAreaElement>) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
  onOpenContextMenu?: (placementId: string, x: number, y: number) => void;
}

function SortableNotepadRow({
  row,
  selected,
  textValue,
  overlayMode,
  isTask,
  dropHint,
  dropIntentLabel,
  followsParentDrag,
  parentDragDelta,
  onSelect,
  onToggleCollapsed,
  onEditorFocus,
  onEditorChange,
  onEditorBlur,
  onEditorKeyDown,
  onOpenContextMenu
}: SortableNotepadRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.placement.id
  });
  const shouldFollowParent = !!followsParentDrag && !isDragging;
  const followTransform = shouldFollowParent
    ? `translate3d(${parentDragDelta?.x ?? 0}px, ${parentDragDelta?.y ?? 0}px, 0px)`
    : undefined;

  return (
    <div
      ref={setNodeRef}
      className={`notepad-tree-row${dropHint ? ` drop-${dropHint}` : ""}${isDragging ? " dragging" : ""}${shouldFollowParent ? " drag-follow" : ""}`}
      style={{
        transform: followTransform ?? CSS.Transform.toString(transform),
        transition: shouldFollowParent ? undefined : transition,
        opacity: isDragging ? 0.45 : shouldFollowParent ? 0.82 : undefined
      }}
    >
      {dropIntentLabel && <span className="notepad-drop-intent">{dropIntentLabel}</span>}
      <NotepadRow
        row={row}
        selected={selected}
        textValue={textValue}
        overlayMode={overlayMode}
        isTask={isTask}
        onSelect={onSelect}
        onToggleCollapsed={onToggleCollapsed}
        onEditorFocus={onEditorFocus}
        onEditorChange={onEditorChange}
        onEditorBlur={onEditorBlur}
        onEditorKeyDown={onEditorKeyDown}
        onOpenContextMenu={onOpenContextMenu}
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
        setDragHandleRef={setActivatorNodeRef}
        dragging={isDragging}
      />
    </div>
  );
}

function resolveDropIntent(
  event: DragOverEvent | DragEndEvent,
  targetDepth: number,
  forceSiblingOnly: boolean
): PlacementDropIntent {
  const overRect = event.over?.rect;
  if (!overRect) {
    return "after";
  }
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  if (!activeRect) {
    return "after";
  }

  const centerY = activeRect.top + activeRect.height / 2;
  const activeAnchorX = activeRect.left + Math.min(activeRect.width * 0.35, 28);
  const relativeY = (centerY - overRect.top) / Math.max(overRect.height, 1);
  const edgeBandRatio = 0.34;
  const rightwardNestThreshold = targetDepth <= 0 ? 20 : 12;
  const nestingGuideX = overRect.left + 54 + (10 + targetDepth * 18);
  const nestingIntentional = event.delta.x >= rightwardNestThreshold || activeAnchorX >= nestingGuideX;

  if (relativeY <= edgeBandRatio) {
    return "before";
  }
  if (relativeY >= 1 - edgeBandRatio) {
    return "after";
  }

  // Nesting should feel intentional: move to the center band and drag right past the nesting guide.
  if (nestingIntentional && !forceSiblingOnly) {
    return "inside";
  }

  // In the center band, default to sibling placement to avoid accidental child drops.
  const edgeBand = Math.min(22, overRect.height * 0.42);
  if (centerY <= overRect.top + edgeBand) {
    return "before";
  }
  if (centerY >= overRect.bottom - edgeBand) {
    return "after";
  }

  const midline = overRect.top + overRect.height / 2;
  return centerY < midline ? "before" : "after";
}

function resolveDropTarget(
  event: DragOverEvent | DragEndEvent,
  rowDepthByPlacementId: Record<string, number>,
  forceSiblingOnly: boolean
): Omit<NotepadTreeDropPayload, "sourcePlacementId"> | undefined {
  if (!event.over) {
    return undefined;
  }
  const targetPlacementId = String(event.over.id);
  const targetDepth = rowDepthByPlacementId[targetPlacementId] ?? 0;
  return {
    targetPlacementId,
    intent: resolveDropIntent(event, targetDepth, forceSiblingOnly)
  };
}

function dropIntentLabel(intent: PlacementDropIntent): string {
  if (intent === "before") return "Move above";
  if (intent === "after") return "Move below";
  return "Nest under";
}

export function NotepadTree({
  rows,
  selectedPlacementId,
  keyboardDropTarget,
  getRowText,
  isTaskRow,
  parseOverlayMode,
  onSelectRow,
  onToggleCollapsed,
  onEditorFocus,
  onEditorChange,
  onEditorBlur,
  onEditorKeyDown,
  onOpenContextMenu,
  onContainerKeyDown,
  onDropRow,
  onAutoExpandRow
}: NotepadTreeProps): JSX.Element {
  const [activePlacementId, setActivePlacementId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<Omit<NotepadTreeDropPayload, "sourcePlacementId">>();
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [forceSiblingDrop, setForceSiblingDrop] = useState(false);
  const expandHoverTimerRef = useRef<number>();
  const expandHoverTargetIdRef = useRef<string>();
  const rowIds = useMemo(() => rows.map((row) => row.placement.id), [rows]);
  const rowByPlacementId = useMemo(() => {
    const next: Record<string, FlatRow> = {};
    for (const row of rows) {
      next[row.placement.id] = row;
    }
    return next;
  }, [rows]);
  const rowDepthByPlacementId = useMemo(() => {
    const next: Record<string, number> = {};
    for (const row of rows) {
      next[row.placement.id] = row.depth;
    }
    return next;
  }, [rows]);
  const activeSubtreeIds = useMemo(
    () => (activePlacementId ? collectVisibleSubtreePlacementIds(rows, activePlacementId) : []),
    [activePlacementId, rows]
  );
  const activeSubtreeSet = useMemo(() => new Set(activeSubtreeIds), [activeSubtreeIds]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 }
    })
  );
  const collisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      const pointerCollisions = pointerWithin(args);
      if (pointerCollisions.length > 0) {
        return pointerCollisions;
      }
      return closestCenter(args);
    },
    []
  );

  const clearExpandHoverTimer = useCallback((): void => {
    if (expandHoverTimerRef.current) {
      window.clearTimeout(expandHoverTimerRef.current);
      expandHoverTimerRef.current = undefined;
    }
    expandHoverTargetIdRef.current = undefined;
  }, []);

  useEffect(() => {
    return () => {
      clearExpandHoverTimer();
    };
  }, [clearExpandHoverTimer]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.altKey || event.key === "Alt") {
        setForceSiblingDrop(true);
      }
    };
    const onKeyUp = (event: globalThis.KeyboardEvent): void => {
      if (!event.altKey) {
        setForceSiblingDrop(false);
      }
    };
    const onWindowBlur = (): void => {
      setForceSiblingDrop(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  const resetDragState = (): void => {
    setActivePlacementId(undefined);
    setDropTarget(undefined);
    setDragDelta({ x: 0, y: 0 });
    clearExpandHoverTimer();
  };

  const handleDragStart = (event: DragStartEvent): void => {
    const sourcePlacementId = String(event.active.id);
    setActivePlacementId(sourcePlacementId);
    setDragDelta({ x: 0, y: 0 });
    onSelectRow(sourcePlacementId);
  };

  const handleDragMove = (event: DragMoveEvent): void => {
    setDragDelta(event.delta);
  };

  const handleDragOver = (event: DragOverEvent): void => {
    const nextDropTarget = resolveDropTarget(event, rowDepthByPlacementId, forceSiblingDrop);
    setDropTarget(nextDropTarget);

    if (!nextDropTarget || nextDropTarget.intent !== "inside") {
      clearExpandHoverTimer();
      return;
    }
    const targetRow = rowByPlacementId[nextDropTarget.targetPlacementId];
    if (!targetRow || !targetRow.hasChildren || !targetRow.collapsed || targetRow.placement.id === activePlacementId) {
      clearExpandHoverTimer();
      return;
    }
    if (expandHoverTargetIdRef.current === targetRow.placement.id && expandHoverTimerRef.current) {
      return;
    }

    clearExpandHoverTimer();
    expandHoverTargetIdRef.current = targetRow.placement.id;
    expandHoverTimerRef.current = window.setTimeout(() => {
      onAutoExpandRow(targetRow.placement.id);
      clearExpandHoverTimer();
    }, 350);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const sourcePlacementId = String(event.active.id);
    const nextDropTarget = resolveDropTarget(event, rowDepthByPlacementId, forceSiblingDrop);
    resetDragState();
    if (!nextDropTarget) {
      return;
    }
    onDropRow({
      sourcePlacementId,
      targetPlacementId: nextDropTarget.targetPlacementId,
      intent: nextDropTarget.intent
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDragState}
    >
      <div
        className="notepad-tree"
        tabIndex={0}
        role="tree"
        onKeyDown={onContainerKeyDown}
      >
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          <div className="notepad-tree-inner">
            {rows.map((row) => {
              const effectiveActivePlacementId = activePlacementId ?? keyboardDropTarget?.sourcePlacementId;
              const pointerDropTarget =
                dropTarget?.targetPlacementId === row.placement.id && effectiveActivePlacementId !== row.placement.id
                  ? dropTarget
                  : undefined;
              const keyboardDrop =
                keyboardDropTarget?.targetPlacementId === row.placement.id &&
                keyboardDropTarget.sourcePlacementId !== row.placement.id
                  ? keyboardDropTarget
                  : undefined;
              const effectiveDropIntent = pointerDropTarget?.intent ?? keyboardDrop?.intent;
              return (
                <SortableNotepadRow
                  key={row.placement.id}
                  row={row}
                  selected={selectedPlacementId === row.placement.id}
                  textValue={getRowText(row)}
                  overlayMode={parseOverlayMode(row)}
                  isTask={isTaskRow(row)}
                  dropHint={effectiveDropIntent}
                  dropIntentLabel={effectiveDropIntent ? dropIntentLabel(effectiveDropIntent) : undefined}
                  followsParentDrag={
                    !!activePlacementId &&
                    row.placement.id !== activePlacementId &&
                    activeSubtreeSet.has(row.placement.id)
                  }
                  parentDragDelta={dragDelta}
                  onSelect={onSelectRow}
                  onToggleCollapsed={onToggleCollapsed}
                  onEditorFocus={onEditorFocus}
                  onEditorChange={onEditorChange}
                  onEditorBlur={onEditorBlur}
                  onEditorKeyDown={onEditorKeyDown}
                  onOpenContextMenu={onOpenContextMenu}
                />
              );
            })}
          </div>
        </SortableContext>
      </div>
    </DndContext>
  );
}
