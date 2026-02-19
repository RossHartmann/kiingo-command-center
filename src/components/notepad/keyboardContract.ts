export type NotepadInteractionMode = "navigation" | "edit";

interface KeyContextBase {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface EditorKeyContext extends KeyContextBase {
  rowText: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface ContainerKeyContext extends KeyContextBase {
  hasSelectedRow: boolean;
}

export type EditorKeyAction =
  | { type: "none" }
  | { type: "undo_structure" }
  | { type: "redo_structure" }
  | { type: "open_quick_actions" }
  | { type: "clipboard_copy" }
  | { type: "clipboard_cut" }
  | { type: "clipboard_paste" }
  | { type: "reorder_up" }
  | { type: "reorder_down" }
  | { type: "move_selection_up" }
  | { type: "move_selection_down" }
  | { type: "create_sibling" }
  | { type: "indent" }
  | { type: "outdent" }
  | { type: "delete_empty_row" }
  | { type: "merge_with_previous_sibling" }
  | { type: "merge_with_next_sibling" }
  | { type: "exit_edit_mode" };

export type ContainerKeyAction =
  | { type: "none" }
  | { type: "undo_structure" }
  | { type: "redo_structure" }
  | { type: "navigate_up" }
  | { type: "navigate_down" }
  | { type: "navigate_start" }
  | { type: "navigate_end" }
  | { type: "reorder_up" }
  | { type: "reorder_down" }
  | { type: "indent_selected" }
  | { type: "outdent_selected" }
  | { type: "expand_or_child" }
  | { type: "collapse_or_parent" }
  | { type: "focus_editor" }
  | { type: "clipboard_copy" }
  | { type: "clipboard_cut" }
  | { type: "clipboard_paste" }
  | { type: "open_quick_actions" };

function isModifierPressed(ctx: KeyContextBase): boolean {
  return ctx.metaKey || ctx.ctrlKey;
}

export function hasLineAbove(value: string, cursorIndex: number): boolean {
  return value.slice(0, Math.max(0, cursorIndex)).includes("\n");
}

export function hasLineBelow(value: string, cursorIndex: number): boolean {
  return value.slice(Math.max(0, cursorIndex)).includes("\n");
}

export function resolveEditorKeyAction(ctx: EditorKeyContext): EditorKeyAction {
  const modifier = isModifierPressed(ctx);
  const lowerKey = ctx.key.toLowerCase();
  const hasSelection = ctx.selectionEnd > ctx.selectionStart;

  if (modifier && !ctx.shiftKey && lowerKey === "z") {
    return { type: "undo_structure" };
  }

  if ((modifier && ctx.shiftKey && lowerKey === "z") || (ctx.ctrlKey && !ctx.metaKey && !ctx.shiftKey && lowerKey === "y")) {
    return { type: "redo_structure" };
  }

  if (ctx.key === "Escape") {
    return { type: "exit_edit_mode" };
  }

  if (modifier && lowerKey === ".") {
    return { type: "open_quick_actions" };
  }

  if (modifier && (lowerKey === "c" || lowerKey === "x" || lowerKey === "v")) {
    if (hasSelection) {
      return { type: "none" };
    }
    if (lowerKey === "c") {
      return { type: "clipboard_copy" };
    }
    if (lowerKey === "x") {
      return { type: "clipboard_cut" };
    }
    return { type: "clipboard_paste" };
  }

  if (modifier && !ctx.shiftKey && ctx.key === "ArrowUp") {
    return { type: "reorder_up" };
  }

  if (modifier && !ctx.shiftKey && ctx.key === "ArrowDown") {
    return { type: "reorder_down" };
  }

  if (modifier && ctx.shiftKey && ctx.key === "ArrowUp") {
    return { type: "reorder_up" };
  }

  if (modifier && ctx.shiftKey && ctx.key === "ArrowDown") {
    return { type: "reorder_down" };
  }

  if (modifier && ctx.shiftKey && ctx.key === "ArrowRight") {
    return { type: "indent" };
  }

  if (modifier && ctx.shiftKey && ctx.key === "ArrowLeft") {
    return { type: "outdent" };
  }

  if (!modifier && !ctx.shiftKey && (ctx.key === "ArrowUp" || ctx.key === "ArrowDown")) {
    if (hasSelection) {
      return { type: "none" };
    }

    if (ctx.key === "ArrowUp" && !hasLineAbove(ctx.rowText, ctx.selectionStart)) {
      return { type: "move_selection_up" };
    }
    if (ctx.key === "ArrowDown" && !hasLineBelow(ctx.rowText, ctx.selectionEnd)) {
      return { type: "move_selection_down" };
    }
    return { type: "none" };
  }

  if (ctx.key === "Enter" && !ctx.shiftKey) {
    return { type: "create_sibling" };
  }

  if (ctx.key === "Tab" && !ctx.shiftKey) {
    return { type: "indent" };
  }

  if (ctx.key === "Tab" && ctx.shiftKey) {
    return { type: "outdent" };
  }

  if (ctx.key === "Backspace" && ctx.rowText.trim().length === 0) {
    return { type: "delete_empty_row" };
  }

  if (
    ctx.key === "Backspace" &&
    !modifier &&
    !ctx.shiftKey &&
    !hasSelection &&
    ctx.selectionStart === 0 &&
    ctx.selectionEnd === 0
  ) {
    return { type: "merge_with_previous_sibling" };
  }

  if (
    ctx.key === "Delete" &&
    !modifier &&
    !ctx.shiftKey &&
    !hasSelection &&
    ctx.selectionStart === ctx.rowText.length &&
    ctx.selectionEnd === ctx.rowText.length
  ) {
    return { type: "merge_with_next_sibling" };
  }

  return { type: "none" };
}

export function resolveContainerKeyAction(ctx: ContainerKeyContext): ContainerKeyAction {
  const modifier = isModifierPressed(ctx);
  const lowerKey = ctx.key.toLowerCase();

  if (modifier && !ctx.shiftKey && lowerKey === "z") {
    return { type: "undo_structure" };
  }

  if ((modifier && ctx.shiftKey && lowerKey === "z") || (ctx.ctrlKey && !ctx.metaKey && !ctx.shiftKey && lowerKey === "y")) {
    return { type: "redo_structure" };
  }

  if (modifier && ctx.shiftKey && ctx.hasSelectedRow && ctx.key === "ArrowUp") {
    return { type: "reorder_up" };
  }

  if (modifier && ctx.shiftKey && ctx.hasSelectedRow && ctx.key === "ArrowDown") {
    return { type: "reorder_down" };
  }

  if (modifier && ctx.shiftKey && ctx.hasSelectedRow && ctx.key === "ArrowRight") {
    return { type: "indent_selected" };
  }

  if (modifier && ctx.shiftKey && ctx.hasSelectedRow && ctx.key === "ArrowLeft") {
    return { type: "outdent_selected" };
  }

  if (ctx.key === "ArrowUp") {
    return { type: "navigate_up" };
  }
  if (ctx.key === "ArrowDown") {
    return { type: "navigate_down" };
  }
  if (ctx.key === "Home") {
    return { type: "navigate_start" };
  }
  if (ctx.key === "End") {
    return { type: "navigate_end" };
  }

  if (ctx.key === "ArrowRight") {
    return { type: "expand_or_child" };
  }

  if (ctx.key === "ArrowLeft") {
    return { type: "collapse_or_parent" };
  }

  if (ctx.key === "Enter" && ctx.hasSelectedRow) {
    return { type: "focus_editor" };
  }

  if (!modifier) {
    return { type: "none" };
  }

  if (lowerKey === "c") {
    return { type: "clipboard_copy" };
  }

  if (lowerKey === "x") {
    return { type: "clipboard_cut" };
  }

  if (lowerKey === "v") {
    return { type: "clipboard_paste" };
  }

  if (lowerKey === ".") {
    return { type: "open_quick_actions" };
  }

  return { type: "none" };
}
