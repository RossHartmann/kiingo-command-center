import { describe, expect, it } from "vitest";
import {
  hasLineAbove,
  hasLineBelow,
  resolveContainerKeyAction,
  resolveEditorKeyAction
} from "./keyboardContract";

describe("keyboardContract", () => {
  it("detects multiline boundaries", () => {
    const text = "alpha\nbeta\ngamma";
    expect(hasLineAbove(text, 0)).toBe(false);
    expect(hasLineAbove(text, 7)).toBe(true);
    expect(hasLineBelow(text, text.length)).toBe(false);
    expect(hasLineBelow(text, 4)).toBe(true);
  });

  it("maps editor key actions for core structural shortcuts", () => {
    expect(
      resolveEditorKeyAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "undo_structure" });

    expect(
      resolveEditorKeyAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "redo_structure" });

    expect(
      resolveEditorKeyAction({
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "create_sibling" });

    expect(
      resolveEditorKeyAction({
        key: "Tab",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "indent" });

    expect(
      resolveEditorKeyAction({
        key: "Tab",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "outdent" });

    expect(
      resolveEditorKeyAction({
        key: "Backspace",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "   ",
        selectionStart: 0,
        selectionEnd: 0
      })
    ).toEqual({ type: "delete_empty_row" });

    expect(
      resolveEditorKeyAction({
        key: "Backspace",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 0,
        selectionEnd: 0
      })
    ).toEqual({ type: "merge_with_previous_sibling" });

    expect(
      resolveEditorKeyAction({
        key: "Delete",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "merge_with_next_sibling" });
  });

  it("maps editor arrow behavior to row movement only at boundaries", () => {
    expect(
      resolveEditorKeyAction({
        key: "ArrowUp",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "line1\nline2",
        selectionStart: 8,
        selectionEnd: 8
      })
    ).toEqual({ type: "none" });

    expect(
      resolveEditorKeyAction({
        key: "ArrowUp",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "line1\nline2",
        selectionStart: 0,
        selectionEnd: 0
      })
    ).toEqual({ type: "move_selection_up" });

    expect(
      resolveEditorKeyAction({
        key: "ArrowDown",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "line1\nline2",
        selectionStart: 4,
        selectionEnd: 4
      })
    ).toEqual({ type: "none" });

    expect(
      resolveEditorKeyAction({
        key: "ArrowDown",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        rowText: "line1\nline2",
        selectionStart: 11,
        selectionEnd: 11
      })
    ).toEqual({ type: "move_selection_down" });
  });

  it("maps reorder and quick-action shortcuts", () => {
    expect(
      resolveEditorKeyAction({
        key: "ArrowUp",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "reorder_up" });

    expect(
      resolveEditorKeyAction({
        key: ".",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "open_quick_actions" });

    expect(
      resolveEditorKeyAction({
        key: "c",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        rowText: "hello",
        selectionStart: 1,
        selectionEnd: 3
      })
    ).toEqual({ type: "none" });

    expect(
      resolveEditorKeyAction({
        key: "ArrowRight",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        rowText: "hello",
        selectionStart: 5,
        selectionEnd: 5
      })
    ).toEqual({ type: "indent" });
  });

  it("maps container keys for navigation and mode transitions", () => {
    expect(
      resolveContainerKeyAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        hasSelectedRow: true
      })
    ).toEqual({ type: "undo_structure" });

    expect(
      resolveContainerKeyAction({
        key: "z",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        hasSelectedRow: true
      })
    ).toEqual({ type: "redo_structure" });

    expect(
      resolveContainerKeyAction({
        key: "ArrowUp",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        hasSelectedRow: true
      })
    ).toEqual({ type: "navigate_up" });

    expect(
      resolveContainerKeyAction({
        key: "ArrowRight",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        hasSelectedRow: true
      })
    ).toEqual({ type: "expand_or_child" });

    expect(
      resolveContainerKeyAction({
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        hasSelectedRow: true
      })
    ).toEqual({ type: "focus_editor" });

    expect(
      resolveContainerKeyAction({
        key: "v",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        hasSelectedRow: true
      })
    ).toEqual({ type: "clipboard_paste" });

    expect(
      resolveContainerKeyAction({
        key: "ArrowUp",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        hasSelectedRow: true
      })
    ).toEqual({ type: "reorder_up" });

    expect(
      resolveContainerKeyAction({
        key: "ArrowRight",
        metaKey: false,
        ctrlKey: true,
        shiftKey: true,
        hasSelectedRow: true
      })
    ).toEqual({ type: "indent_selected" });
  });
});
