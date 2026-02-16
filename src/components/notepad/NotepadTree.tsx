import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  onEditorBlur: (placementId: string) => void;
  onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, row: FlatRow) => void;
  onContainerKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export const NOTEPAD_ESTIMATED_ROW_HEIGHT = 48;
const OVERSCAN_ROWS = 20;

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
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(420);

  const totalHeight = rows.length * NOTEPAD_ESTIMATED_ROW_HEIGHT;

  const windowed = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / NOTEPAD_ESTIMATED_ROW_HEIGHT) - OVERSCAN_ROWS);
    const end = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / NOTEPAD_ESTIMATED_ROW_HEIGHT) + OVERSCAN_ROWS
    );
    return {
      start,
      end,
      items: rows.slice(start, end)
    };
  }, [rows, scrollTop, viewportHeight]);

  return (
    <div
      className="notepad-tree"
      ref={viewportRef}
      tabIndex={0}
      role="tree"
      onKeyDown={onContainerKeyDown}
      onScroll={(event) => {
        const target = event.currentTarget;
        setScrollTop(target.scrollTop);
        if (target.clientHeight !== viewportHeight) {
          setViewportHeight(target.clientHeight);
        }
      }}
    >
      <div className="notepad-tree-inner" style={{ height: `${totalHeight}px` }}>
        {windowed.items.map((row, index) => {
          const absoluteIndex = windowed.start + index;
          const top = absoluteIndex * NOTEPAD_ESTIMATED_ROW_HEIGHT;
          return (
            <div className="notepad-tree-row" key={row.placement.id} style={{ transform: `translateY(${top}px)` }}>
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
          );
        })}
      </div>
    </div>
  );
}
