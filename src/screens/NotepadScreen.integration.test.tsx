import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { notepadAtomsList, notepadBlockCreate, notepadSave } from "../lib/tauriClient";
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

async function seedRow(notepadId: string, text: string): Promise<void> {
  await notepadBlockCreate({
    notepadId,
    rawText: text
  });
}

async function settleNotepad(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText("Loading project...")).not.toBeInTheDocument();
    expect(screen.queryByText("Saving...")).not.toBeInTheDocument();
  });
}

async function renderNotepadAndSwitch(notepadId: string): Promise<HTMLSelectElement> {
  render(<NotepadScreen />);
  const selector = (await screen.findByLabelText("Active project")) as HTMLSelectElement;
  fireEvent.change(selector, { target: { value: notepadId } });
  await waitFor(() => {
    expect(selector.value).toBe(notepadId);
  });
  await settleNotepad();
  return selector;
}

async function clickNewRow(): Promise<void> {
  const tree = screen.getByRole("tree");
  fireEvent.focus(tree);
  fireEvent.keyDown(tree, { key: "Enter" });
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
    fireEvent.change(editor, { target: { value: "enter-second" } });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.keyDown(editor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    expect(editor.value).toBe("");
    expect(editor.dataset.placementId).not.toBe(firstCreatedPlacementId);

    const editors = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea.notepad-editor"));
    expect(editors.length).toBeGreaterThanOrEqual(3);
  });

  it("inserts an empty sibling above when Enter is pressed at line start", async () => {
    const notepadId = uniqueNotepadId("itest-enter-start");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    const original = selectedEditor();
    const originalPlacementId = original.dataset.placementId;
    expect(originalPlacementId).toBeTruthy();
    fireEvent.focus(original);
    fireEvent.change(original, { target: { value: "moved-down-line" } });

    const sourceEditor = editorByPlacementId(originalPlacementId!);
    sourceEditor.setSelectionRange(0, 0);
    fireEvent.keyDown(sourceEditor, { key: "Enter" });
    await settleNotepad();

    const focused = selectedEditor();
    expect(focused.dataset.placementId).toBe(originalPlacementId);
    expect(focused.value).toBe("moved-down-line");
    expect(focused.selectionStart).toBe(0);
    expect(focused.selectionEnd).toBe(0);

    const visibleEditors = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea.notepad-editor")).map((e) => e.value);
    expect(visibleEditors.slice(0, 2)).toEqual(["", "moved-down-line"]);
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

  it("merges with next sibling when pressing Delete at end of row", async () => {
    const notepadId = uniqueNotepadId("itest-delete-merge");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let first = selectedEditor();
    const firstPlacementId = first.dataset.placementId;
    expect(firstPlacementId).toBeTruthy();
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "Alpha" } });

    fireEvent.keyDown(first, { key: "Enter" });
    await settleNotepad();

    const second = selectedEditor();
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "Beta" } });

    first = editorByPlacementId(firstPlacementId!);
    fireEvent.focus(first);
    first.setSelectionRange(first.value.length, first.value.length);
    fireEvent.keyDown(first, { key: "Delete" });
    await settleNotepad();

    expect(selectedEditor().value).toBe("Alpha Beta");
    await waitFor(() => {
      expect(screen.queryAllByRole("treeitem").length).toBe(1);
    });
  });

  it("reparents next sibling children when merging with Delete", async () => {
    const notepadId = uniqueNotepadId("itest-delete-merge-children");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    let first = selectedEditor();
    const firstPlacementId = first.dataset.placementId;
    expect(firstPlacementId).toBeTruthy();
    fireEvent.focus(first);
    fireEvent.change(first, { target: { value: "Alpha" } });

    fireEvent.keyDown(first, { key: "Enter" });
    await settleNotepad();

    let second = selectedEditor();
    const secondPlacementId = second.dataset.placementId;
    expect(secondPlacementId).toBeTruthy();
    fireEvent.focus(second);
    fireEvent.change(second, { target: { value: "Beta" } });

    fireEvent.keyDown(second, { key: "Enter" });
    await settleNotepad();
    let child = selectedEditor();
    fireEvent.focus(child);
    fireEvent.keyDown(child, { key: "Tab" });
    await settleNotepad();
    child = selectedEditor();
    const childPlacementId = child.dataset.placementId;
    expect(childPlacementId).toBeTruthy();
    fireEvent.focus(child);
    fireEvent.change(child, { target: { value: "Child of beta" } });

    first = editorByPlacementId(firstPlacementId!);
    fireEvent.focus(first);
    first.setSelectionRange(first.value.length, first.value.length);
    fireEvent.keyDown(first, { key: "Delete" });
    await settleNotepad();

    const selected = selectedEditor();
    expect(selected.dataset.placementId).toBe(firstPlacementId);
    expect(selected.value).toBe("Alpha Beta");

    const childEditor = editorByPlacementId(childPlacementId!);
    expect(childEditor.value).toBe("Child of beta");
    const childRow = childEditor.closest(".notepad-row") as HTMLElement;
    expect(childRow.getAttribute("aria-level")).toBe("2");

    expect(document.querySelector(`textarea.notepad-editor[data-placement-id="${secondPlacementId}"]`)).toBeNull();
    await waitFor(() => {
      expect(screen.queryAllByRole("treeitem").length).toBe(2);
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

    fireEvent.keyDown(editor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.keyDown(editor, { key: "Tab" });
    await settleNotepad();
    editor = selectedEditor();
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
    expect(within(parentRow).getByText("1 hidden")).toBeTruthy();
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

    fireEvent.keyDown(parentEditor, { key: "Enter" });
    await settleNotepad();
    editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.keyDown(editor, { key: "Tab" });
    await settleNotepad();
    editor = selectedEditor();
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

  it("re-targets move/copy destination when switching active project", async () => {
    const sourceNotepadId = uniqueNotepadId("itest-move-source");
    const targetNotepadId = uniqueNotepadId("itest-move-target");
    await createTestNotepad(sourceNotepadId);
    await createTestNotepad(targetNotepadId);
    await seedRow(sourceNotepadId, "source-row");
    await seedRow(targetNotepadId, "target-row");
    await renderNotepadAndSwitch(sourceNotepadId);

    const inspectorToggle = screen.getByRole("button", { name: /Show|Hide/ });
    if (inspectorToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(inspectorToggle);
    }
    const moveCopyToggle = screen.getByRole("button", { name: "Move/Copy" });
    if (moveCopyToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(moveCopyToggle);
    }

    const destinationBefore = (await screen.findByLabelText("Destination project")) as HTMLSelectElement;
    fireEvent.change(destinationBefore, { target: { value: targetNotepadId } });
    expect(destinationBefore.value).toBe(targetNotepadId);

    const activeProject = (await screen.findByLabelText("Active project")) as HTMLSelectElement;
    fireEvent.change(activeProject, { target: { value: targetNotepadId } });
    await waitFor(() => {
      expect(activeProject.value).toBe(targetNotepadId);
    });
    await settleNotepad();

    const destinationAfter = (await screen.findByLabelText("Destination project")) as HTMLSelectElement;
    const available = Array.from(destinationAfter.options)
      .map((option) => option.value)
      .filter((value) => value.length > 0);
    expect(available).not.toContain(targetNotepadId);
    expect(available).toContain(destinationAfter.value);
  });

  it("persists inline row text changes to atom rawText", async () => {
    const notepadId = uniqueNotepadId("itest-title-sync");
    await createTestNotepad(notepadId);
    await renderNotepadAndSwitch(notepadId);

    await clickNewRow();
    const editor = selectedEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "Recruit speakers for webinar" } });

    await waitFor(
      async () => {
        const page = await notepadAtomsList(notepadId, 50);
        const atom = page.items.find((candidate) => candidate.rawText.includes("Recruit speakers for webinar"));
        expect(atom).toBeTruthy();
        expect(atom?.rawText).toContain("Recruit speakers for webinar");
        expect(atom?.facetData.task?.status).toBe("todo");
      },
      { timeout: 5000 }
    );
  });
});
