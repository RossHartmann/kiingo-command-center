import { useState, useRef, useEffect, type FormEvent } from "react";
import type { FeatureFlag, NotepadViewDefinition, WorkspaceCapabilities, WorkspaceHealth } from "../../lib/types";

const NOTEPAD_SIDEBAR_INFO_KEY = "notepad.sidebar.infoPanel";

interface NotepadListSidebarProps {
  notepads: NotepadViewDefinition[];
  activeNotepadId: string;
  onSelectNotepad: (notepadId: string) => void;
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
  capabilities?: WorkspaceCapabilities;
  health?: WorkspaceHealth;
  featureFlags: FeatureFlag[];
  isFeatureGateOpen: boolean;
  loading: boolean;
  saving: boolean;
}

function featureFlagStatus(featureFlags: FeatureFlag[], key: string): string {
  const flag = featureFlags.find((value) => value.key === key);
  if (!flag) {
    return `${key}: default`;
  }
  return `${key}: ${flag.enabled ? "on" : "off"}`;
}

function loadInfoPreference(): "help" | "diagnostics" {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return "help";
  }
  try {
    const value = window.localStorage.getItem(NOTEPAD_SIDEBAR_INFO_KEY);
    if (value === "diagnostics") {
      return "diagnostics";
    }
  } catch {
    return "help";
  }
  return "help";
}

export function NotepadListSidebar({
  notepads,
  activeNotepadId,
  onSelectNotepad,
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
  onSaveNotepadEdits,
  capabilities,
  health,
  featureFlags,
  isFeatureGateOpen,
  loading,
  saving
}: NotepadListSidebarProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [infoPanel, setInfoPanel] = useState<"help" | "diagnostics">(() => loadInfoPreference());
  const searchRef = useRef<HTMLInputElement>(null);

  const sorted = [...notepads].sort((a, b) => {
    if (a.id === "now") return -1;
    if (b.id === "now") return 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = search.trim()
    ? sorted.filter((n) => {
        const q = search.toLowerCase();
        return (
          n.name.toLowerCase().includes(q) ||
          (n.description ?? "").toLowerCase().includes(q) ||
          (n.filters?.categories ?? []).some((c) => c.toLowerCase().includes(q))
        );
      })
    : sorted;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleCreateSubmit(event: FormEvent): void {
    onCreateNotepad(event);
    setShowCreate(false);
  }

  function handleEditSubmit(event: FormEvent): void {
    onSaveNotepadEdits(event);
    setShowEdit(false);
  }

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") {
      return;
    }
    try {
      window.localStorage.setItem(NOTEPAD_SIDEBAR_INFO_KEY, infoPanel);
    } catch {
      // Ignore persistence failures.
    }
  }, [infoPanel]);

  return (
    <nav className="notepad-list-sidebar" aria-label="Notepads">
      <div className="notepad-list-header">
        <h3>Notepads</h3>
        <div className="notepad-list-header-actions">
          <button
            type="button"
            className="notepad-list-new-btn"
            onClick={() => { setShowInfo(false); setShowCreate((c) => !c); }}
            aria-expanded={showCreate}
            aria-label="New notepad"
            disabled={!isFeatureGateOpen}
            title="New notepad"
          >
            +
          </button>
          <button
            type="button"
            className="notepad-list-new-btn"
            onClick={() => { setShowCreate(false); setShowInfo((c) => !c); }}
            aria-expanded={showInfo}
            aria-label="Help & diagnostics"
            title="Help & diagnostics"
          >
            ?
          </button>
        </div>
      </div>

      <div className="notepad-list-search">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search notepads..."
          aria-label="Search notepads"
        />
      </div>

      {showInfo && (
        <div className="notepad-list-info">
          <div className="notepad-list-info-tabs" role="group" aria-label="Info sections">
            <button
              type="button"
              className={infoPanel === "help" ? "primary" : ""}
              onClick={() => setInfoPanel("help")}
            >
              Shortcuts
            </button>
            <button
              type="button"
              className={infoPanel === "diagnostics" ? "primary" : ""}
              onClick={() => setInfoPanel("diagnostics")}
            >
              Diagnostics
            </button>
          </div>
          {infoPanel === "help" ? (
            <ul className="notepad-list-shortcuts">
              <li><kbd>Enter</kbd> new sibling row</li>
              <li><kbd>Enter</kbd> at start: empty sibling above</li>
              <li><kbd>Enter</kbd> mid-line: split row</li>
              <li><kbd>Shift+Enter</kbd> newline in row</li>
              <li><kbd>Backspace</kbd> empty: delete row</li>
              <li><kbd>Backspace</kbd> at start: merge prev</li>
              <li><kbd>Delete</kbd> at end: merge next</li>
              <li><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> indent/outdent</li>
              <li><kbd>Cmd+Shift+Arrow</kbd> move/nest block</li>
              <li><kbd>Cmd+C/X/V</kbd> copy/cut/paste row</li>
              <li><kbd>Cmd+Z</kbd> / <kbd>Cmd+Shift+Z</kbd> undo/redo</li>
              <li><kbd>Cmd+.</kbd> quick actions</li>
              <li><kbd>Esc</kbd> exit edit mode</li>
            </ul>
          ) : (
            <div className="notepad-list-diagnostics">
              <small className={`health-pill ${capabilities?.obsidianCliAvailable ? "ok" : "warn"}`}>
                CLI: {capabilities?.obsidianCliAvailable ? "available" : "unavailable"}
              </small>
              <small className={`health-pill ${health?.adapterHealthy ? "ok" : "warn"}`}>
                Adapter: {health?.adapterHealthy ? "healthy" : "degraded"}
              </small>
              <small className={`health-pill ${health?.vaultAccessible ? "ok" : "warn"}`}>
                Vault: {health?.vaultAccessible ? "accessible" : "unavailable"}
              </small>
              <small className="notepad-list-diagnostics-flag">
                {featureFlagStatus(featureFlags, "workspace.notepad_ui_v2")}
              </small>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <form className="notepad-list-create" onSubmit={handleCreateSubmit}>
          <input
            type="text"
            value={createName}
            onChange={(e) => onChangeCreateName(e.target.value)}
            placeholder="Notepad name"
            autoFocus
          />
          <input
            type="text"
            value={createCategories}
            onChange={(e) => onChangeCreateCategories(e.target.value)}
            placeholder="Categories (optional)"
          />
          <div className="notepad-list-create-actions">
            <button
              type="submit"
              className="primary"
              disabled={creatingNotepad || !createName.trim() || !isFeatureGateOpen}
            >
              {creatingNotepad ? "..." : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="notepad-list-items" role="listbox" aria-label="Notepad list">
        {filtered.map((notepad) => {
          const isActive = notepad.id === activeNotepadId;
          const categories = notepad.filters?.categories ?? [];
          return (
            <li key={notepad.id} role="option" aria-selected={isActive}>
              <div className={`notepad-list-item${isActive ? " active" : ""}`}>
                <button
                  type="button"
                  className="notepad-list-item-btn"
                  onClick={() => onSelectNotepad(notepad.id)}
                  disabled={loading || saving}
                  title={notepad.description || notepad.name}
                >
                  <span className="notepad-list-item-name">
                    {notepad.id === "now" ? "NOW (Inbox)" : notepad.name}
                  </span>
                  {categories.length > 0 && (
                    <span className="notepad-list-item-tags">
                      {categories.slice(0, 3).map((c) => (
                        <span key={c} className="notepad-list-tag">
                          {c}
                        </span>
                      ))}
                      {categories.length > 3 && (
                        <span className="notepad-list-tag">+{categories.length - 3}</span>
                      )}
                    </span>
                  )}
                </button>
                {isActive && notepad.id !== "now" && (
                  <button
                    type="button"
                    className="notepad-list-edit-btn"
                    onClick={() => setShowEdit((c) => !c)}
                    aria-label="Edit notepad"
                    title="Edit notepad"
                    disabled={!isFeatureGateOpen}
                  >
                    ...
                  </button>
                )}
              </div>
              {isActive && showEdit && notepad.id !== "now" && (
                <form className="notepad-list-edit" onSubmit={handleEditSubmit}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => onChangeEditName(e.target.value)}
                    placeholder="Name"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editCategories}
                    onChange={(e) => onChangeEditCategories(e.target.value)}
                    placeholder="Categories"
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => onChangeEditDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <div className="notepad-list-create-actions">
                    <button
                      type="submit"
                      className="primary"
                      disabled={editingNotepad || !editName.trim() || !isFeatureGateOpen}
                    >
                      {editingNotepad ? "..." : "Save"}
                    </button>
                    <button type="button" onClick={() => setShowEdit(false)}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="notepad-list-empty">
            {search.trim() ? "No matches" : "No notepads yet"}
          </li>
        )}
      </ul>
    </nav>
  );
}
