import type { KeyboardEvent } from "react";
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
  onEditorBlur: (placementId: string) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
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
  onEditorKeyDown
}: NotepadRowProps): JSX.Element {
  return (
    <article
      className={`notepad-row ${selected ? "selected" : ""}`}
      style={{ paddingLeft: `${0.6 + row.depth * 1.1}rem` }}
      onClick={() => onSelect(row.placement.id)}
      onFocus={() => onSelect(row.placement.id)}
      tabIndex={0}
      role="treeitem"
      aria-selected={selected}
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? !row.collapsed : undefined}
    >
      <button
        type="button"
        className="notepad-toggle"
        onClick={() => onToggleCollapsed(row.placement.id)}
        disabled={!row.hasChildren}
        aria-label={row.hasChildren ? (row.collapsed ? "Expand row" : "Collapse row") : "Leaf row"}
      >
        {row.hasChildren ? (row.collapsed ? "▸" : "▾") : "·"}
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
