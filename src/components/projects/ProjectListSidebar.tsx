import { useState, useRef, useEffect, type FormEvent } from "react";
import type { NotepadViewDefinition, ProjectDefinition } from "../../lib/types";

interface ProjectListSidebarProps {
  projects: ProjectDefinition[];
  notepads: NotepadViewDefinition[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  createName: string;
  createDescription: string;
  createKind: ProjectDefinition["kind"];
  createLabels: string;
  createDefaultViewId: string;
  createCaptureLabels: string;
  createCaptureCategories: string;
  createCaptureThreadIds: string;
  createCaptureTaskStatus: "todo" | "doing" | "blocked" | "done" | "";
  createCaptureTaskPriority: "1" | "2" | "3" | "4" | "5" | "";
  creatingProject: boolean;
  onChangeCreateName: (value: string) => void;
  onChangeCreateDescription: (value: string) => void;
  onChangeCreateKind: (value: ProjectDefinition["kind"]) => void;
  onChangeCreateLabels: (value: string) => void;
  onChangeCreateDefaultViewId: (value: string) => void;
  onChangeCreateCaptureLabels: (value: string) => void;
  onChangeCreateCaptureCategories: (value: string) => void;
  onChangeCreateCaptureThreadIds: (value: string) => void;
  onChangeCreateCaptureTaskStatus: (value: "todo" | "doing" | "blocked" | "done" | "") => void;
  onChangeCreateCaptureTaskPriority: (value: "1" | "2" | "3" | "4" | "5" | "") => void;
  onCreateProject: (event: FormEvent) => void;
  editName: string;
  editDescription: string;
  editLabels: string;
  editingProject: boolean;
  onChangeEditName: (value: string) => void;
  onChangeEditDescription: (value: string) => void;
  onChangeEditLabels: (value: string) => void;
  onSaveProjectEdits: (event: FormEvent) => void;
  projectsEnabled: boolean;
  loading: boolean;
  saving: boolean;
}

export function ProjectListSidebar({
  projects,
  notepads,
  activeProjectId,
  onSelectProject,
  createName,
  createDescription,
  createKind,
  createLabels,
  createDefaultViewId,
  createCaptureLabels,
  createCaptureCategories,
  createCaptureThreadIds,
  createCaptureTaskStatus,
  createCaptureTaskPriority,
  creatingProject,
  onChangeCreateName,
  onChangeCreateDescription,
  onChangeCreateKind,
  onChangeCreateLabels,
  onChangeCreateDefaultViewId,
  onChangeCreateCaptureLabels,
  onChangeCreateCaptureCategories,
  onChangeCreateCaptureThreadIds,
  onChangeCreateCaptureTaskStatus,
  onChangeCreateCaptureTaskPriority,
  onCreateProject,
  editName,
  editDescription,
  editLabels,
  editingProject,
  onChangeEditName,
  onChangeEditDescription,
  onChangeEditLabels,
  onSaveProjectEdits,
  projectsEnabled,
  loading,
  saving
}: ProjectListSidebarProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  const filtered = search.trim()
    ? sorted.filter((p) => {
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          p.labelIds.some((l) => l.toLowerCase().includes(q))
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
    onCreateProject(event);
    setShowCreate(false);
  }

  function handleEditSubmit(event: FormEvent): void {
    onSaveProjectEdits(event);
    setShowEdit(false);
  }

  return (
    <nav className="project-list-sidebar" aria-label="Projects">
      <div className="project-list-header">
        <h3>Projects</h3>
        <div className="project-list-header-actions">
          <button
            type="button"
            className="notepad-list-new-btn"
            onClick={() => setShowCreate((c) => !c)}
            aria-expanded={showCreate}
            aria-label="New project"
            disabled={!projectsEnabled}
            title="New project"
          >
            +
          </button>
        </div>
      </div>

      <div className="project-list-search">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          aria-label="Search projects"
        />
      </div>

      {showCreate && (
        <form className="project-list-create" onSubmit={handleCreateSubmit}>
          <input
            type="text"
            value={createName}
            onChange={(e) => onChangeCreateName(e.target.value)}
            placeholder="Project name"
            autoFocus
          />
          <select
            value={createKind}
            onChange={(e) => onChangeCreateKind(e.target.value as ProjectDefinition["kind"])}
          >
            <option value="workspace_project">Workspace project</option>
            <option value="label_project">Label project</option>
          </select>
          <select
            value={createDefaultViewId}
            onChange={(e) => onChangeCreateDefaultViewId(e.target.value)}
          >
            {notepads.map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={createLabels}
            onChange={(e) => onChangeCreateLabels(e.target.value)}
            placeholder="Labels (comma-separated)"
          />
          <input
            type="text"
            value={createDescription}
            onChange={(e) => onChangeCreateDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <input
            type="text"
            value={createCaptureLabels}
            onChange={(e) => onChangeCreateCaptureLabels(e.target.value)}
            placeholder="Capture labels (comma-separated)"
          />
          <input
            type="text"
            value={createCaptureCategories}
            onChange={(e) => onChangeCreateCaptureCategories(e.target.value)}
            placeholder="Capture categories (comma-separated)"
          />
          <input
            type="text"
            value={createCaptureThreadIds}
            onChange={(e) => onChangeCreateCaptureThreadIds(e.target.value)}
            placeholder="Capture thread IDs (comma-separated)"
          />
          <select
            value={createCaptureTaskStatus}
            onChange={(e) => onChangeCreateCaptureTaskStatus(e.target.value as "todo" | "doing" | "blocked" | "done" | "")}
          >
            <option value="">Capture status (inherit)</option>
            <option value="todo">todo</option>
            <option value="doing">doing</option>
            <option value="blocked">blocked</option>
            <option value="done">done</option>
          </select>
          <select
            value={createCaptureTaskPriority}
            onChange={(e) => onChangeCreateCaptureTaskPriority(e.target.value as "1" | "2" | "3" | "4" | "5" | "")}
          >
            <option value="">Capture priority (inherit)</option>
            <option value="1">P1</option>
            <option value="2">P2</option>
            <option value="3">P3</option>
            <option value="4">P4</option>
            <option value="5">P5</option>
          </select>
          <div className="project-list-create-actions">
            <button
              type="submit"
              className="primary"
              disabled={creatingProject || !createName.trim() || !projectsEnabled}
            >
              {creatingProject ? "..." : "Create"}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="project-list-items" role="listbox" aria-label="Project list">
        {filtered.map((project) => {
          const isActive = project.id === activeProjectId;
          return (
            <li key={project.id} role="option" aria-selected={isActive}>
              <div className={`project-list-item${isActive ? " active" : ""}`}>
                <button
                  type="button"
                  className="project-list-item-btn"
                  onClick={() => onSelectProject(project.id)}
                  disabled={loading || saving}
                  title={project.description || project.name}
                >
                  <span className="project-list-item-name">{project.name}</span>
                  <span className="project-list-item-tags">
                    <span className="project-list-tag">{project.kind === "label_project" ? "label" : "workspace"}</span>
                    {project.labelIds.slice(0, 3).map((l) => (
                      <span key={l} className="project-list-tag">{l}</span>
                    ))}
                    {project.labelIds.length > 3 && (
                      <span className="project-list-tag">+{project.labelIds.length - 3}</span>
                    )}
                  </span>
                </button>
                {isActive && (
                  <button
                    type="button"
                    className="project-list-edit-btn"
                    onClick={() => setShowEdit((c) => !c)}
                    aria-label="Edit project"
                    title="Edit project"
                    disabled={!projectsEnabled}
                  >
                    ...
                  </button>
                )}
              </div>
              {isActive && showEdit && (
                <form className="project-list-edit" onSubmit={handleEditSubmit}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => onChangeEditName(e.target.value)}
                    placeholder="Name"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => onChangeEditDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <input
                    type="text"
                    value={editLabels}
                    onChange={(e) => onChangeEditLabels(e.target.value)}
                    placeholder="Labels (comma-separated)"
                  />
                  <div className="project-list-create-actions">
                    <button
                      type="submit"
                      className="primary"
                      disabled={editingProject || !editName.trim() || !projectsEnabled}
                    >
                      {editingProject ? "..." : "Save"}
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
          <li className="project-list-empty">
            {search.trim() ? "No matches" : "No projects yet"}
          </li>
        )}
      </ul>
    </nav>
  );
}
