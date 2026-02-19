import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { featureFlagsList, notepadsList, projectDelete, projectOpen, projectSave, projectsList } from "../lib/tauriClient";
import type { FeatureFlag, NotepadViewDefinition, ProjectDefinition } from "../lib/types";
import { useAppActions } from "../state/appState";
import { OMNI_OPEN_NOTEPAD } from "../components/OmniSearch";
import { ProjectListSidebar } from "../components/projects/ProjectListSidebar";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function isEnabled(flags: FeatureFlag[], key: FeatureFlag["key"], fallback = true): boolean {
  const match = flags.find((flag) => flag.key === key);
  return match ? match.enabled : fallback;
}

export function ProjectsScreen(): JSX.Element {
  const actions = useAppActions();
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [notepads, setNotepads] = useState<NotepadViewDefinition[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const [activeProjectId, setActiveProjectId] = useState("");

  // Create form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ProjectDefinition["kind"]>("workspace_project");
  const [labels, setLabels] = useState("");
  const [defaultViewId, setDefaultViewId] = useState("now");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLabels, setEditLabels] = useState("");
  const [editingProject, setEditingProject] = useState(false);

  const projectsEnabled = isEnabled(featureFlags, "workspace.projects_v1", true);
  const splitUiEnabled = isEnabled(featureFlags, "workspace.notepad_project_split_ui", true);
  const defaultViewsEnabled = isEnabled(featureFlags, "workspace.project_default_views", true);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId),
    [projects, activeProjectId]
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextProjects, nextNotepads, nextFlags] = await Promise.all([
        projectsList(),
        notepadsList(),
        featureFlagsList()
      ]);
      setProjects(nextProjects);
      setNotepads(nextNotepads);
      setFeatureFlags(nextFlags);
      if (nextNotepads.length > 0 && !nextNotepads.some((notepad) => notepad.id === defaultViewId)) {
        setDefaultViewId(nextNotepads[0].id);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [defaultViewId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync edit form when active project changes
  useEffect(() => {
    if (activeProject) {
      setEditName(activeProject.name);
      setEditDescription(activeProject.description ?? "");
      setEditLabels(activeProject.labelIds.join(", "));
    }
  }, [activeProject]);

  const onCreateProject = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!projectsEnabled) {
      setError("Projects are currently disabled by feature flag `workspace.projects_v1`.");
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }
    const id = slugify(trimmedName);
    if (!id) {
      setError("Unable to generate a stable project ID from this name.");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const parsedLabels = parseCsv(labels);
      const targetView = defaultViewId || "now";
      await projectSave({
        definition: {
          id,
          schemaVersion: 1,
          name: trimmedName,
          description: description.trim() || undefined,
          status: "active",
          kind,
          labelIds: parsedLabels,
          defaultViewId: targetView,
          viewIds: [targetView],
          source: "manual"
        }
      });
      setName("");
      setDescription("");
      setKind("workspace_project");
      setLabels("");
      await refresh();
      setActiveProjectId(id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const onSaveProjectEdits = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!activeProject || !projectsEnabled) return;
    const trimmedName = editName.trim();
    if (!trimmedName) return;

    setEditingProject(true);
    setError(undefined);
    try {
      await projectSave({
        definition: {
          ...activeProject,
          name: trimmedName,
          description: editDescription.trim() || undefined,
          labelIds: parseCsv(editLabels)
        }
      });
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setEditingProject(false);
    }
  };

  const onOpenProject = async (projectId: string): Promise<void> => {
    if (!defaultViewsEnabled) {
      setError("Project default view routing is disabled by `workspace.project_default_views`.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const result = await projectOpen(projectId);
      actions.selectScreen("notepad");
      window.dispatchEvent(new CustomEvent(OMNI_OPEN_NOTEPAD, { detail: { notepadId: result.defaultViewId } }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const onDeleteProject = async (projectId: string): Promise<void> => {
    setSaving(true);
    setError(undefined);
    try {
      await projectDelete(projectId);
      if (activeProjectId === projectId) {
        setActiveProjectId("");
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="projects-screen screen">
      <div className="page-sidebar-layout">
        <ProjectListSidebar
          projects={projects}
          notepads={notepads}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          createName={name}
          createDescription={description}
          createKind={kind}
          createLabels={labels}
          createDefaultViewId={defaultViewId}
          creatingProject={saving}
          onChangeCreateName={setName}
          onChangeCreateDescription={setDescription}
          onChangeCreateKind={setKind}
          onChangeCreateLabels={setLabels}
          onChangeCreateDefaultViewId={setDefaultViewId}
          onCreateProject={(event) => void onCreateProject(event)}
          editName={editName}
          editDescription={editDescription}
          editLabels={editLabels}
          editingProject={editingProject}
          onChangeEditName={setEditName}
          onChangeEditDescription={setEditDescription}
          onChangeEditLabels={setEditLabels}
          onSaveProjectEdits={(event) => void onSaveProjectEdits(event)}
          projectsEnabled={projectsEnabled}
          loading={loading}
          saving={saving}
        />

        <div className="page-sidebar-main">
          {!splitUiEnabled && (
            <div className="banner info">Project/notepad split UI feature flag is off; this screen is running in compatibility mode.</div>
          )}
          {error && <div className="banner error">{error}</div>}
          {(loading || saving) && <div className="banner info">{loading ? "Loading projects..." : "Applying changes..."}</div>}

          {activeProject ? (
            <div className="project-detail card">
              <h2>{activeProject.name}</h2>
              <div className="project-detail-meta">
                <span className="project-list-tag">{activeProject.kind === "label_project" ? "label" : "workspace"}</span>
                <span className="project-list-tag">{activeProject.status}</span>
                {activeProject.defaultViewId && (
                  <span className="project-list-tag">view: {activeProject.defaultViewId}</span>
                )}
                {activeProject.labelIds.map((l) => (
                  <span key={l} className="project-list-tag">{l}</span>
                ))}
              </div>
              {activeProject.description && (
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-muted)" }}>
                  {activeProject.description}
                </p>
              )}
              <div className="project-detail-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void onOpenProject(activeProject.id)}
                  disabled={saving}
                >
                  Open Default View
                </button>
                <button
                  type="button"
                  onClick={() => actions.selectScreen("notepad")}
                  disabled={saving}
                >
                  Open Notepads
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteProject(activeProject.id)}
                  disabled={saving}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="project-empty-state">
              <span>{projects.length === 0 ? "No projects yet — create one from the sidebar" : "Select a project from the sidebar"}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
