import { useEffect, useState, type FormEvent } from "react";
import type { FeatureFlag, NotepadViewDefinition, WorkspaceCapabilities, WorkspaceHealth } from "../../lib/types";

interface NotepadToolbarProps {
  notepads: NotepadViewDefinition[];
  activeNotepadId: string;
  activeNotepad?: NotepadViewDefinition;
  loading: boolean;
  saving: boolean;
  capabilities?: WorkspaceCapabilities;
  health?: WorkspaceHealth;
  featureFlags: FeatureFlag[];
  isFeatureGateOpen: boolean;
  statusPreset: "active" | "all";
  onSelectNotepad: (notepadId: string) => void;
  onSetStatusPreset: (preset: "active" | "all") => void;
  createName: string;
  createCategories: string;
  createDescription: string;
  creatingNotepad: boolean;
  onChangeCreateName: (value: string) => void;
  onChangeCreateCategories: (value: string) => void;
  onChangeCreateDescription: (value: string) => void;
  onCreateNotepad: (event: FormEvent) => void;
  editName: string;
  editCategories: string;
  editDescription: string;
  editingNotepad: boolean;
  onChangeEditName: (value: string) => void;
  onChangeEditCategories: (value: string) => void;
  onChangeEditDescription: (value: string) => void;
  onSaveNotepadEdits: (event: FormEvent) => void;
}

function featureFlagStatus(featureFlags: FeatureFlag[], key: string): string {
  const flag = featureFlags.find((value) => value.key === key);
  if (!flag) {
    return `${key}: default`;
  }
  return `${key}: ${flag.enabled ? "on" : "off"}`;
}

export function NotepadToolbar({
  notepads,
  activeNotepadId,
  activeNotepad,
  loading,
  saving,
  capabilities,
  health,
  featureFlags,
  isFeatureGateOpen,
  statusPreset,
  onSelectNotepad,
  onSetStatusPreset,
  createName,
  createCategories,
  createDescription,
  creatingNotepad,
  onChangeCreateName,
  onChangeCreateCategories,
  onChangeCreateDescription,
  onCreateNotepad,
  editName,
  editCategories,
  editDescription,
  editingNotepad,
  onChangeEditName,
  onChangeEditCategories,
  onChangeEditDescription,
  onSaveNotepadEdits
}: NotepadToolbarProps): JSX.Element {
  const sortedNotepads = [...notepads].sort((a, b) => {
    if (a.id === "now") return -1;
    if (b.id === "now") return 1;
    return a.name.localeCompare(b.name);
  });
  const [openPanel, setOpenPanel] = useState<"none" | "create" | "edit" | "info">("none");

  useEffect(() => {
    if (!activeNotepad && openPanel === "edit") {
      setOpenPanel("none");
    }
  }, [activeNotepad, openPanel]);

  function togglePanel(panel: "create" | "edit" | "info"): void {
    setOpenPanel((current) => (current === panel ? "none" : panel));
  }

  return (
    <>
      <div className="notepad-toolbar card">
        <div className="notepad-toolbar-row">
          <label>
            Project
            <select
              value={activeNotepadId}
              onChange={(event) => onSelectNotepad(event.target.value)}
              aria-label="Active project"
              disabled={loading || saving}
            >
              {sortedNotepads.map((notepad) => (
                <option key={notepad.id} value={notepad.id}>
                  {notepad.id === "now" ? "NOW (Inbox)" : notepad.name}
                </option>
              ))}
            </select>
          </label>

          <div className="notepad-preset-group" role="group" aria-label="Project row visibility">
            <button
              type="button"
              className={statusPreset === "active" ? "primary" : ""}
              onClick={() => onSetStatusPreset("active")}
              disabled={saving || !activeNotepad || !isFeatureGateOpen}
            >
              Active Rows
            </button>
            <button
              type="button"
              className={statusPreset === "all" ? "primary" : ""}
              onClick={() => onSetStatusPreset("all")}
              disabled={saving || !activeNotepad || !isFeatureGateOpen}
            >
              All Rows
            </button>
          </div>

          <div className="notepad-disclosure-actions" role="group" aria-label="Project controls">
            <button
              type="button"
              className={openPanel === "create" ? "primary" : ""}
              onClick={() => togglePanel("create")}
              aria-expanded={openPanel === "create"}
              disabled={!isFeatureGateOpen}
            >
              + New
            </button>
            <button
              type="button"
              className={openPanel === "edit" ? "primary" : ""}
              onClick={() => togglePanel("edit")}
              aria-expanded={openPanel === "edit"}
              disabled={!activeNotepad || !isFeatureGateOpen}
            >
              Edit
            </button>
            <button
              type="button"
              className={openPanel === "info" ? "primary" : ""}
              onClick={() => togglePanel("info")}
              aria-expanded={openPanel === "info"}
            >
              Info
            </button>
          </div>
        </div>

        {openPanel === "info" && (
          <div className="notepad-disclosure-panel">
            <div className="notepad-toolbar-row">
              <small className={`health-pill ${capabilities?.obsidianCliAvailable ? "ok" : "warn"}`}>
                CLI: {capabilities?.obsidianCliAvailable ? "available" : "unavailable"}
              </small>
              <small className={`health-pill ${health?.adapterHealthy ? "ok" : "warn"}`}>
                Adapter: {health?.adapterHealthy ? "healthy" : "degraded"}
              </small>
              <small className={`health-pill ${health?.vaultAccessible ? "ok" : "warn"}`}>
                Vault: {health?.vaultAccessible ? "accessible" : "unavailable"}
              </small>
              <small className="settings-hint">{featureFlagStatus(featureFlags, "workspace.notepad_ui_v2")}</small>
            </div>
            <details className="notepad-shortcuts">
              <summary>Shortcuts</summary>
              <ul>
                <li>`Enter`: new sibling row</li>
                <li>`Shift+Enter`: newline in row</li>
                <li>`Backspace` on empty row: delete row</li>
                <li>`ArrowUp`/`ArrowDown`: move between rows at line boundaries</li>
                <li>`ArrowLeft`/`ArrowRight` (tree): collapse/expand</li>
                <li>`Tab` / `Shift+Tab`: indent / outdent</li>
                <li>`Cmd/Ctrl+Shift+Arrow` (or `Cmd/Ctrl+Arrow`): reorder</li>
                <li>`Cmd/Ctrl+C`, `X`, `V`: copy/cut/paste row</li>
                <li>`Cmd/Ctrl+.`: focus project move actions</li>
                <li>`Esc`: exit edit mode</li>
              </ul>
            </details>
          </div>
        )}
      </div>

      {openPanel === "create" && (
        <form className="card notepad-create-form" onSubmit={onCreateNotepad}>
          <div className="notepad-create-row">
            <label>
              New project
              <input
                type="text"
                value={createName}
                onChange={(event) => onChangeCreateName(event.target.value)}
                placeholder="Launch prep"
              />
            </label>
            <label>
              Categories (comma separated)
              <input
                type="text"
                value={createCategories}
                onChange={(event) => onChangeCreateCategories(event.target.value)}
                placeholder="marketing, launch"
              />
            </label>
            <label>
              Description (optional)
              <input
                type="text"
                value={createDescription}
                onChange={(event) => onChangeCreateDescription(event.target.value)}
                placeholder="Saved view + capture defaults"
              />
            </label>
            <button type="submit" className="primary" disabled={creatingNotepad || !isFeatureGateOpen}>
              {creatingNotepad ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      )}

      {openPanel === "edit" && activeNotepad && (
        <form className="card notepad-create-form" onSubmit={onSaveNotepadEdits}>
          <div className="notepad-create-row">
            <label>
              Edit project name
              <input
                type="text"
                value={editName}
                onChange={(event) => onChangeEditName(event.target.value)}
                placeholder="Project name"
              />
            </label>
            <label>
              Edit categories
              <input
                type="text"
                value={editCategories}
                onChange={(event) => onChangeEditCategories(event.target.value)}
                placeholder="category-a, category-b"
              />
            </label>
            <label>
              Edit description
              <input
                type="text"
                value={editDescription}
                onChange={(event) => onChangeEditDescription(event.target.value)}
                placeholder="Description"
              />
            </label>
            <button type="submit" disabled={editingNotepad || !isFeatureGateOpen}>
              {editingNotepad ? "Saving..." : "Save Active Project"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
