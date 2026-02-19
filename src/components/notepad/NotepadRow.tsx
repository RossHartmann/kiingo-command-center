import { useRef } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { InlineBlockEditor } from "./InlineBlockEditor";
import type { FlatRow } from "./types";

interface NotepadRowProps {
  row: FlatRow;
  selected: boolean;
  textValue: string;
  overlayMode?: "person" | "task" | "date";
  isTask: boolean;
  onSelect: (placementId: string) => void;
  onToggleCollapsed: (placementId: string) => void;
  onEditorFocus: (placementId: string) => void;
  onEditorChange: (placementId: string, nextText: string) => void;
  onEditorBlur: (placementId: string, event: FocusEvent<HTMLTextAreaElement>) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
  onOpenContextMenu?: (placementId: string, x: number, y: number) => void;
  dragHandleAttributes?: DraggableAttributes;
  dragHandleListeners?: DraggableSyntheticListeners;
  setDragHandleRef?: (element: HTMLElement | null) => void;
  dragging?: boolean;
}

export function NotepadRow({
  row,
  selected,
  textValue,
  overlayMode,
  isTask,
  onSelect,
  onToggleCollapsed,
  onEditorFocus,
  onEditorChange,
  onEditorBlur,
  onEditorKeyDown,
  onOpenContextMenu,
  dragHandleAttributes,
  dragHandleListeners,
  setDragHandleRef,
  dragging
}: NotepadRowProps): JSX.Element {
  const suppressRowClickRef = useRef(false);
  const handlePointerDownRef = useRef<{ x: number; y: number }>();
  const handlePointerMovedRef = useRef(false);
  const attentionLayer = row.atom?.facetData.task?.attentionLayer ?? row.atom?.facetData.attention?.layer;
  const heatScore = row.atom?.facetData.attention?.heatScore;

  const handleMouseDownCapture = (event: MouseEvent<HTMLElement>): void => {
    suppressRowClickRef.current = event.target instanceof HTMLTextAreaElement;
  };

  const handleRowClick = (event: MouseEvent<HTMLElement>): void => {
    if (suppressRowClickRef.current) {
      suppressRowClickRef.current = false;
      return;
    }
    if (event.target instanceof HTMLTextAreaElement) {
      // Editor focus already handles row selection; avoid duplicate dispatches on text interactions.
      return;
    }
    onSelect(row.placement.id);
    // Keep keyboard navigation active after clicking the row shell.
    const tree = event.currentTarget.closest(".notepad-tree");
    if (tree instanceof HTMLElement) {
      tree.focus();
    }
  };

  const handleGripClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const moved = handlePointerMovedRef.current;
    handlePointerMovedRef.current = false;
    if (moved) {
      return;
    }
    if (row.hasChildren) {
      onToggleCollapsed(row.placement.id);
    }
    onSelect(row.placement.id);
    const tree = event.currentTarget.closest(".notepad-tree");
    if (tree instanceof HTMLElement) {
      tree.focus();
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLElement>): void => {
    if (!onOpenContextMenu) {
      return;
    }
    event.preventDefault();
    onSelect(row.placement.id);
    onOpenContextMenu(row.placement.id, event.clientX, event.clientY);
  };

  return (
    <article
      className={`notepad-row ${selected ? "selected" : ""}${dragging ? " dragging" : ""}`}
      style={{ paddingLeft: `${0.6 + row.depth * 1.1}rem` }}
      data-placement-id={row.placement.id}
      onMouseDownCapture={handleMouseDownCapture}
      onClick={handleRowClick}
      onContextMenu={handleContextMenu}
      tabIndex={-1}
      role="treeitem"
      aria-selected={selected}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? !row.collapsed : undefined}
    >
      <button
        type="button"
        className="notepad-drag-handle"
        ref={setDragHandleRef}
        aria-label={row.hasChildren ? (row.collapsed ? "Expand row" : "Collapse row") : "Drag row"}
        onPointerDown={(event) => {
          handlePointerDownRef.current = { x: event.clientX, y: event.clientY };
          handlePointerMovedRef.current = false;
        }}
        onPointerMove={(event) => {
          const origin = handlePointerDownRef.current;
          if (!origin) {
            return;
          }
          if (Math.abs(event.clientX - origin.x) > 3 || Math.abs(event.clientY - origin.y) > 3) {
            handlePointerMovedRef.current = true;
          }
        }}
        onPointerUp={() => {
          handlePointerDownRef.current = undefined;
        }}
        onPointerCancel={() => {
          handlePointerDownRef.current = undefined;
          handlePointerMovedRef.current = false;
        }}
        onClick={handleGripClick}
        {...dragHandleAttributes}
        {...dragHandleListeners}
      >
        {row.hasChildren ? (row.collapsed ? "▸" : "▾") : "\u2261"}
      </button>

      <InlineBlockEditor
        placementId={row.placement.id}
        value={textValue}
        onFocus={onEditorFocus}
        onChange={onEditorChange}
        onBlur={onEditorBlur}
        onKeyDown={(event) => onEditorKeyDown(event, row)}
      />

      {isTask && <span className="notepad-pill">{row.atom?.facetData.task?.status ?? row.block.taskStatus ?? "todo"}</span>}
      {row.collapsed && row.descendantCount > 0 && (
        <span className="notepad-pill collapsed-descendants">
          {row.descendantCount} hidden
        </span>
      )}
      {attentionLayer && <span className="notepad-pill attention">{attentionLayer.toUpperCase()}</span>}
      {typeof heatScore === "number" && <span className="notepad-pill attention-heat">{heatScore.toFixed(1)}</span>}
      {overlayMode && (
        <span className={`notepad-pill overlay-${overlayMode}`}>
          {overlayMode === "person" && "waiting"}
          {overlayMode === "task" && "blocked"}
          {overlayMode === "date" && "snoozed"}
        </span>
      )}
    </article>
  );
}
