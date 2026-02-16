import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { notepadSave } from "../lib/tauriClient";
import { NotepadScreen } from "./NotepadScreen";

function uniqueNotepadId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

async function createTestNotepad(notepadId: string): Promise<void> {
  await notepadSave({
    idempotencyKey: `${notepadId}-save`,
    definition: {
      id: notepadId,
      schemaVersion: 1,
      name: notepadId,
      description: "integration test notepad",
      isSystem: false,
      filters: {
        includeArchived: false,
        categories: [notepadId]
      },
      sorts: [{ field: "updatedAt", direction: "desc" }],
      captureDefaults: {
        initialFacets: ["task"],
        taskStatus: "todo",
        taskPriority: 3,
        categories: [notepadId]
      },
      layoutMode: "outline"
    }
  });
}

async function settleNotepad(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Loading notepad...")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });
}

async function renderNotepadAndSwitch(notepadId: string): Promise<HTMLSelectElement> {
  render(<NotepadScreen />);
  const selector = (await screen.findByLabelText("Active notepad")) as HTMLSelectElement;
  fireEvent.change(selector, { target: { value: notepadId } });
  await waitFor(() => {
    expect(selector.value).toBe(notepadId);
  });
  await settleNotepad();
  return selector;
}

async function clickNewRow(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "New Row" }));
  await settleNotepad();
}

function selectedEditor(): HTMLTextAreaElement {
  const editor = document.querySelector<HTMLTextAreaElement>(".notepad-row.selected textarea.notepad-editor");
  expect(editor).toBeTruthy();
  return editor!;
}

function editorByPlacementId(placementId: string): HTMLTextAreaElement {
  const editor = document.querySelector<HTMLTextAreaElement>(`textarea.notepad-editor[data-placement-id="${placementId}"]`);
  expect(editor).toBeTruthy();
  return editor!;
}

describe("NotepadScreen integration", () => {
  afterEach(() => {
    cleanup();
  });

  it("supports repeated Enter flow for sibling creation while keeping edit focus", async () => {
    const notepadId = uniqueNotepadId("itest-enter");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "enter-root" } });

    fireEvent.keyDown(editor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    expect(editor.value).toBe("");
    const firstCreatedPlacementId = editor.dataset.placementId;
    expect(firstCreatedPlacementId).toBeTruthy();

    fireEvent.focus(editor);
    fireEvent.keyDown(editor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    expect(editor.value).toBe("");
    expect(editor.dataset.placementId).not.toBe(firstCreatedPlacementId);

    const editors = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea.notepad-editor"));
    expect(editors.length).toBeGreaterThanOrEqual(3);
  });

  it("deletes an empty row on Backspace and focuses previous row", async () => {
    const notepadId = uniqueNotepadId("itest-backspace");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "keep-row" } });

    fireEvent.keyDown(editor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    expect(editor.value).toBe("");

    fireEvent.focus(editor);
    fireEvent.keyDown(editor, { key: "Backspace" });
    await settleNotepad();

    editor = selectedEditor();
    expect(editor.value).toBe("keep-row");
    await waitFor(() => {
      expect(screen.queryAllByRole("treeitem").length).toBe(1);
    });
  });

  it("navigates rows with ArrowUp/ArrowDown at line boundaries", async () => {
    const notepadId = uniqueNotepadId("itest-arrows");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let first = selectedEditor();
    const firstPlacementId = first.dataset.placementId;
    expect(firstPlacementId).toBeTruthy();
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "line-one\nline-two" } });

    fireEvent.keyDown(first, { key: "Enter" });
    await settleNotepad();
    let second = selectedEditor();
    const secondPlacementId = second.dataset.placementId;
    expect(secondPlacementId).toBeTruthy();
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "second-row" } });

    first = editorByPlacementId(firstPlacementId!);
    fireEvent.focus(first);
    fireEvent.click(first);

    first.setSelectionRange(1, 1);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(selectedEditor().dataset.placementId).toBe(firstPlacementId);

    first.setSelectionRange(first.value.length, first.value.length);
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await settleNotepad();
    expect(selectedEditor().dataset.placementId).toBe(secondPlacementId);

    second = editorByPlacementId(secondPlacementId!);
    fireEvent.focus(second);
    second.setSelectionRange(0, 0);
    fireEvent.keyDown(second, { key: "ArrowUp" });
    await settleNotepad();
    expect(selectedEditor().dataset.placementId).toBe(firstPlacementId);
  });

  it("reanchors selection to parent when collapsing a row containing selected child", async () => {
    const notepadId = uniqueNotepadId("itest-collapse");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let editor = selectedEditor();
    const parentPlacementId = editor.dataset.placementId;
    expect(parentPlacementId).toBeTruthy();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "parent-row" } });

    fireEvent.click(screen.getByRole("button", { name: "New Child" }));
    await settleNotepad();
    editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "child-row" } });

    const childPlacementId = editor.dataset.placementId;
    expect(childPlacementId).toBeTruthy();
    const childEditor = editorByPlacementId(childPlacementId!);
    fireEvent.focus(childEditor);

    const parentEditor = editorByPlacementId(parentPlacementId!);
    const parentRow = parentEditor.closest(".notepad-row") as HTMLElement;
    const toggle = within(parentRow).getByRole("button", { name: "Collapse row" });
    fireEvent.click(toggle);

    await settleNotepad();

    expect(document.querySelector(`textarea.notepad-editor[data-placement-id="${childPlacementId}"]`)).toBeNull();
    expect(parentRow.className).toContain("selected");
  });

  it("reorders siblings and preserves subtree parentage", async () => {
    const notepadId = uniqueNotepadId("itest-reorder");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let editor = selectedEditor();
    const parentPlacementId = editor.dataset.placementId;
    expect(parentPlacementId).toBeTruthy();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "A-parent" } });

    fireEvent.keyDown(editor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "C-sibling" } });
    const siblingPlacementId = editor.dataset.placementId;
    expect(siblingPlacementId).toBeTruthy();

    const parentEditor = editorByPlacementId(parentPlacementId!);
    fireEvent.focus(parentEditor);

    fireEvent.click(screen.getByRole("button", { name: "New Child" }));
    await settleNotepad();
    editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "B-child" } });
    const childPlacementId = editor.dataset.placementId;
    expect(childPlacementId).toBeTruthy();

    fireEvent.focus(parentEditor);
    fireEvent.keyDown(parentEditor, { key: "ArrowDown", ctrlKey: true });
    await settleNotepad();

    const visibleEditors = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea.notepad-editor")).map((e) => e.value);
    const filtered = visibleEditors.filter((value) => ["A-parent", "B-child", "C-sibling"].includes(value));
    expect(filtered[0]).toBe("C-sibling");

    const child = editorByPlacementId(childPlacementId!);
    const childRow = child.closest(".notepad-row") as HTMLElement;
    expect(childRow.getAttribute("aria-level")).toBe("2");
  });
});
