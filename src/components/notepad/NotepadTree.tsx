import { useMemo, useState, type FocusEvent, type KeyboardEvent } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NotepadRow } from "./NotepadRow";
import type { FlatRow } from "./types";
import type { PlacementDropIntent } from "./treeData";

interface NotepadTreeDropPayload {
  sourcePlacementId: string;
  targetPlacementId: string;
  intent: PlacementDropIntent;
}

interface NotepadTreeProps {
  rows: FlatRow[];
  selectedPlacementId?: string;
  getRowText: (row: FlatRow) => string;
  isTaskRow: (row: FlatRow) => boolean;
  parseOverlayMode: (row: FlatRow) => "person" | "task" | "date" | undefined;
  onSelectRow: (placementId: string) => void;
  onToggleCollapsed: (placementId: string) => void;
  onEditorFocus: (placementId: string) => void;
  onEditorChange: (placementId: string, nextText: string) => void;
  onEditorBlur: (placementId: string, event: FocusEvent<HTMLTextAreaElement>) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
  onContainerKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDropRow: (payload: NotepadTreeDropPayload) => void;
}

interface SortableNotepadRowProps {
  row: FlatRow;
  selected: boolean;
  textValue: string;
  overlayMode?: "person" | "task" | "date";
  isTask: boolean;
  dropHint?: PlacementDropIntent;
  onSelect: (placementId: string) => void;
  onToggleCollapsed: (placementId: string) => void;
  onEditorFocus: (placementId: string) => void;
  onEditorChange: (placementId: string, nextText: string) => void;
  onEditorBlur: (placementId: string, event: FocusEvent<HTMLTextAreaElement>) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
}

function SortableNotepadRow({
  row,
  selected,
  textValue,
  overlayMode,
  isTask,
  dropHint,
  onSelect,
  onToggleCollapsed,
  onEditorFocus,
  onEditorChange,
  onEditorBlur,
  onEditorKeyDown
}: SortableNotepadRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.placement.id
  });

  return (
    <div
      ref={setNodeRef}
      className={`notepad-tree-row${dropHint ? ` drop-${dropHint}` : ""}${isDragging ? " dragging" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : undefined
      }}
    >
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
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
        setDragHandleRef={setActivatorNodeRef}
        dragging={isDragging}
      />
    </div>
  );
}

function resolveDropIntent(event: DragOverEvent | DragEndEvent): PlacementDropIntent {
  const overRect = event.over?.rect;
  if (!overRect) {
    return "inside";
  }
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  if (!activeRect) {
    return "inside";
  }
  const centerY = activeRect.top + activeRect.height / 2;
  const edgeBand = Math.min(16, overRect.height * 0.28);
  if (centerY <= overRect.top + edgeBand) {
    return "before";
  }
  if (centerY >= overRect.bottom - edgeBand) {
    return "after";
  }
  return "inside";
}

function resolveDropTarget(event: DragOverEvent | DragEndEvent): Omit<NotepadTreeDropPayload, "sourcePlacementId"> | undefined {
  if (!event.over) {
    return undefined;
  }
  return {
    targetPlacementId: String(event.over.id),
    intent: resolveDropIntent(event)
  };
}

export function NotepadTree({
  rows,
  selectedPlacementId,
  getRowText,
  isTaskRow,
  parseOverlayMode,
  onSelectRow,
  onToggleCollapsed,
  onEditorFocus,
  onEditorChange,
  onEditorBlur,
  onEditorKeyDown,
  onContainerKeyDown,
  onDropRow
}: NotepadTreeProps): JSX.Element {
  const [activePlacementId, setActivePlacementId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<Omit<NotepadTreeDropPayload, "sourcePlacementId">>();
  const rowIds = useMemo(() => rows.map((row) => row.placement.id), [rows]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );

  const resetDragState = (): void => {
    setActivePlacementId(undefined);
    setDropTarget(undefined);
  };

  const handleDragStart = (event: DragStartEvent): void => {
    const sourcePlacementId = String(event.active.id);
    setActivePlacementId(sourcePlacementId);
    onSelectRow(sourcePlacementId);
  };

  const handleDragOver = (event: DragOverEvent): void => {
    setDropTarget(resolveDropTarget(event));
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const sourcePlacementId = String(event.active.id);
    const nextDropTarget = resolveDropTarget(event);
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
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
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
            {rows.map((row) => (
              <SortableNotepadRow
                key={row.placement.id}
                row={row}
                selected={selectedPlacementId === row.placement.id}
                textValue={getRowText(row)}
                overlayMode={parseOverlayMode(row)}
                isTask={isTaskRow(row)}
                dropHint={
                  dropTarget?.targetPlacementId === row.placement.id && activePlacementId !== row.placement.id
                    ? dropTarget.intent
                    : undefined
                }
                onSelect={onSelectRow}
                onToggleCollapsed={onToggleCollapsed}
                onEditorFocus={onEditorFocus}
                onEditorChange={onEditorChange}
                onEditorBlur={onEditorBlur}
                onEditorKeyDown={onEditorKeyDown}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </DndContext>
  );
}
