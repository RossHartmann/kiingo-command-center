import type { FocusEvent, KeyboardEvent } from "react";
import { NotepadRow } from "./NotepadRow";
import type { FlatRow } from "./types";

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
  onContainerKeyDown
}: NotepadTreeProps): JSX.Element {
  return (
    <div
      className="notepad-tree"
      tabIndex={0}
      role="tree"
      onKeyDown={onContainerKeyDown}
    >
      <div className="notepad-tree-inner">
        {rows.map((row) => (
          <div className="notepad-tree-row" key={row.placement.id}>
            <NotepadRow
              row={row}
              selected={selectedPlacementId === row.placement.id}
              textValue={getRowText(row)}
              overlayMode={parseOverlayMode(row)}
              isTask={isTaskRow(row)}
              onSelect={onSelectRow}
              onToggleCollapsed={onToggleCollapsed}
              onEditorFocus={onEditorFocus}
              onEditorChange={onEditorChange}
              onEditorBlur={onEditorBlur}
              onEditorKeyDown={onEditorKeyDown}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
