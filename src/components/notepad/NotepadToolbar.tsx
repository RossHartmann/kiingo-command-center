import type { FormEvent } from "react";
import type { FeatureFlag, NotepadViewDefinition, WorkspaceCapabilities, WorkspaceHealth } from "../../lib/types";
import type { ClipboardRow, FlatRow } from "./types";
import type { NotepadInteractionMode } from "./keyboardContract";

interface NotepadToolbarProps {
  notepads: NotepadViewDefinition[];
  activeNotepadId: string;
  activeNotepad?: NotepadViewDefinition;
  selectedRow?: FlatRow;
  loading: boolean;
  saving: boolean;
  clipboard: ClipboardRow | null;
  capabilities?: WorkspaceCapabilities;
  health?: WorkspaceHealth;
  featureFlags: FeatureFlag[];
  isFeatureGateOpen: boolean;
  interactionMode: NotepadInteractionMode;
  onSelectNotepad: (notepadId: string) => void;
  onRefresh: () => void;
  onNewRow: () => void;
  onNewChild: () => void;
  onRemoveRow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onCopyRow: () => void;
  onCutRow: () => void;
  onPasteRow: () => void;
  onToggleQuickActions: () => void;
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
  selectedRow,
  loading,
  saving,
  clipboard,
  capabilities,
  health,
  featureFlags,
  isFeatureGateOpen,
  interactionMode,
  onSelectNotepad,
  onRefresh,
  onNewRow,
  onNewChild,
  onRemoveRow,
  onMoveUp,
  onMoveDown,
  onIndent,
  onOutdent,
  onCopyRow,
  onCutRow,
  onPasteRow,
  onToggleQuickActions,
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
  return (
    <>
      <div className="notepad-toolbar card">
        <div className="notepad-toolbar-row">
          <label>
            Notepad
            <select
              value={activeNotepadId}
              onChange={(event) => onSelectNotepad(event.target.value)}
              aria-label="Active notepad"
            >
              {notepads.map((notepad) => (
                <option key={notepad.id} value={notepad.id}>
                  {notepad.name}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={onRefresh} disabled={loading || saving}>
            Refresh
          </button>
          <button type="button" onClick={onNewRow} disabled={!activeNotepadId || saving || !isFeatureGateOpen}>
            New Row
          </button>
          <button type="button" onClick={onNewChild} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            New Child
          </button>
          <button type="button" onClick={onRemoveRow} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Remove Row
          </button>
          <button type="button" onClick={onMoveUp} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Move Up
          </button>
          <button type="button" onClick={onMoveDown} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Move Down
          </button>
          <button type="button" onClick={onIndent} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Indent
          </button>
          <button type="button" onClick={onOutdent} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Outdent
          </button>
          <button type="button" onClick={onToggleQuickActions} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Quick Actions
          </button>
        </div>

        <div className="notepad-toolbar-row">
          <button type="button" onClick={onCopyRow} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Copy Row
          </button>
          <button type="button" onClick={onCutRow} disabled={!selectedRow || saving || !isFeatureGateOpen}>
            Cut Row
          </button>
          <button type="button" onClick={onPasteRow} disabled={!clipboard || saving || !isFeatureGateOpen}>
            Paste Row
          </button>
          {clipboard && (
            <small className="settings-hint">
              Clipboard: {clipboard.mode} from `{clipboard.sourceViewId}`
            </small>
          )}
          {activeNotepad && <small className="settings-hint">Layout: {activeNotepad.layoutMode}</small>}
        </div>

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
          <small className="settings-hint">{featureFlagStatus(featureFlags, "workspace.blocks_v2")}</small>
          <small className="settings-hint">{featureFlagStatus(featureFlags, "workspace.placements_v2")}</small>
          <small className="settings-hint">Mode: {interactionMode}</small>
          <details className="notepad-shortcuts">
            <summary>Shortcuts</summary>
            <ul>
              <li>`Enter`: new sibling row</li>
              <li>`Shift+Enter`: newline in row</li>
              <li>`Backspace` on empty row: delete row</li>
              <li>`ArrowUp`/`ArrowDown`: navigate rows at line boundaries</li>
              <li>`ArrowLeft`/`ArrowRight` (tree): collapse/expand</li>
              <li>`Tab` / `Shift+Tab`: indent / outdent</li>
              <li>`Cmd/Ctrl+Shift+Arrow` (or `Cmd/Ctrl+Arrow`): reorder</li>
              <li>`Cmd/Ctrl+C`, `X`, `V`: copy/cut/paste row</li>
              <li>`Esc`: exit edit mode</li>
              <li>`Cmd/Ctrl+.`: quick actions</li>
            </ul>
          </details>
        </div>
      </div>

      <form className="card notepad-create-form" onSubmit={onCreateNotepad}>
        <div className="notepad-create-row">
          <label>
            New notepad
            <input
              type="text"
              value={createName}
              onChange={(event) => onChangeCreateName(event.target.value)}
              placeholder="Project notes"
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
            {creatingNotepad ? "Creating..." : "Create Notepad"}
          </button>
        </div>
      </form>

      {activeNotepad && (
        <form className="card notepad-create-form" onSubmit={onSaveNotepadEdits}>
          <div className="notepad-create-row">
            <label>
              Edit name
              <input
                type="text"
                value={editName}
                onChange={(event) => onChangeEditName(event.target.value)}
                placeholder="Notepad name"
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
              {editingNotepad ? "Saving..." : "Save Active Notepad"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
