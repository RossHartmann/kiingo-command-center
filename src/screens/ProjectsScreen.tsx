import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  featureFlagsList,
  migrationPlanCreate,
  migrationRunGet,
  migrationRunStart,
  notepadSave,
  notepadsList,
  projectDelete,
  projectOpen,
  projectSave,
  projectsList
} from "../lib/tauriClient";
import type {
  FeatureFlag,
  MigrationRun,
  NotepadCaptureDefaults,
  NotepadViewDefinition,
  ProjectCaptureDefaults,
  ProjectDefinition,
  TaskStatus
} from "../lib/types";
import { useAppActions } from "../state/appState";
import { OMNI_OPEN_NOTEPAD, type OmniOpenNotepadDetail } from "../components/OmniSearch";
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

function listToCsv(value?: string[]): string {
  return (value ?? []).join(", ");
}

function isEnabled(flags: FeatureFlag[], key: FeatureFlag["key"], fallback = true): boolean {
  const match = flags.find((flag) => flag.key === key);
  return match ? match.enabled : fallback;
}

function parsePriority(value: "1" | "2" | "3" | "4" | "5" | ""): 1 | 2 | 3 | 4 | 5 | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (parsed >= 1 && parsed <= 5) {
    return parsed as 1 | 2 | 3 | 4 | 5;
  }
  return undefined;
}

function mergeArray(primary?: string[], secondary?: string[], caseInsensitive = false): string[] | undefined {
  const values = [...(primary ?? []), ...(secondary ?? [])];
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = caseInsensitive ? trimmed.toLowerCase() : trimmed;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
  }
  return merged.length > 0 ? merged : undefined;
}

function buildCaptureDefaults(input: {
  labels: string;
  categories: string;
  threadIds: string;
  taskStatus: "todo" | "doing" | "blocked" | "done" | "";
  taskPriority: "1" | "2" | "3" | "4" | "5" | "";
  fallbackLabelIds?: string[];
}): ProjectCaptureDefaults | undefined {
  const labels = parseCsv(input.labels);
  const categories = parseCsv(input.categories);
  const threadIds = parseCsv(input.threadIds);
  const fallbackLabelIds = input.fallbackLabelIds ?? [];
  const mergedLabelIds = fallbackLabelIds.length > 0 ? fallbackLabelIds : undefined;
  const taskStatus = input.taskStatus || undefined;
  const taskPriority = parsePriority(input.taskPriority);
  if (
    labels.length === 0 &&
    categories.length === 0 &&
    threadIds.length === 0 &&
    !mergedLabelIds &&
    !taskStatus &&
    !taskPriority
  ) {
    return undefined;
  }
  return {
    labels: labels.length > 0 ? labels : undefined,
    labelIds: mergedLabelIds,
    categories: categories.length > 0 ? categories : undefined,
    threadIds: threadIds.length > 0 ? threadIds : undefined,
    taskStatus: taskStatus as TaskStatus | undefined,
    taskPriority
  };
}

function mergeNotepadCaptureDefaults(
  existing: NotepadCaptureDefaults | undefined,
  project: ProjectCaptureDefaults | undefined
): NotepadCaptureDefaults | undefined {
  if (!project) {
    return existing;
  }
  const merged: NotepadCaptureDefaults = {
    ...existing,
    labels: mergeArray(existing?.labels, project.labels, true),
    categories: mergeArray(existing?.categories, project.categories, true),
    threadIds: mergeArray(existing?.threadIds, project.threadIds),
    labelIds: mergeArray(existing?.labelIds, project.labelIds),
    categoryIds: mergeArray(existing?.categoryIds, project.categoryIds),
    taskStatus: project.taskStatus ?? existing?.taskStatus,
    taskPriority: project.taskPriority ?? existing?.taskPriority
  };
  return merged;
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

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ProjectDefinition["kind"]>("workspace_project");
  const [labels, setLabels] = useState("");
  const [defaultViewId, setDefaultViewId] = useState("now");
  const [createCaptureLabels, setCreateCaptureLabels] = useState("");
  const [createCaptureCategories, setCreateCaptureCategories] = useState("");
  const [createCaptureThreadIds, setCreateCaptureThreadIds] = useState("");
  const [createCaptureTaskStatus, setCreateCaptureTaskStatus] = useState<"todo" | "doing" | "blocked" | "done" | "">("");
  const [createCaptureTaskPriority, setCreateCaptureTaskPriority] = useState<"1" | "2" | "3" | "4" | "5" | "">("");

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLabels, setEditLabels] = useState("");
  const [editCaptureLabels, setEditCaptureLabels] = useState("");
  const [editCaptureCategories, setEditCaptureCategories] = useState("");
  const [editCaptureThreadIds, setEditCaptureThreadIds] = useState("");
  const [editCaptureTaskStatus, setEditCaptureTaskStatus] = useState<"todo" | "doing" | "blocked" | "done" | "">("");
  const [editCaptureTaskPriority, setEditCaptureTaskPriority] = useState<"1" | "2" | "3" | "4" | "5" | "">("");
  const [editingProject, setEditingProject] = useState(false);

  const [associationViewIds, setAssociationViewIds] = useState<string[]>([]);
  const [associationDefaultViewId, setAssociationDefaultViewId] = useState("now");
  const [associationsSaving, setAssociationsSaving] = useState(false);

  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationRun, setMigrationRun] = useState<MigrationRun | null>(null);

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

  useEffect(() => {
    if (!activeProject) {
      setEditName("");
      setEditDescription("");
      setEditLabels("");
      setEditCaptureLabels("");
      setEditCaptureCategories("");
      setEditCaptureThreadIds("");
      setEditCaptureTaskStatus("");
      setEditCaptureTaskPriority("");
      setAssociationViewIds([]);
      setAssociationDefaultViewId("now");
      return;
    }

    setEditName(activeProject.name);
    setEditDescription(activeProject.description ?? "");
    setEditLabels(activeProject.labelIds.join(", "));
    setEditCaptureLabels(listToCsv(activeProject.captureDefaults?.labels));
    setEditCaptureCategories(listToCsv(activeProject.captureDefaults?.categories));
    setEditCaptureThreadIds(listToCsv(activeProject.captureDefaults?.threadIds));
    setEditCaptureTaskStatus((activeProject.captureDefaults?.taskStatus as "todo" | "doing" | "blocked" | "done" | undefined) ?? "");
    setEditCaptureTaskPriority(activeProject.captureDefaults?.taskPriority ? String(activeProject.captureDefaults.taskPriority) as "1" | "2" | "3" | "4" | "5" : "");

    const nextViewIds = activeProject.viewIds.length > 0
      ? activeProject.viewIds
      : activeProject.defaultViewId
        ? [activeProject.defaultViewId]
        : ["now"];
    setAssociationViewIds(nextViewIds);
    setAssociationDefaultViewId(activeProject.defaultViewId ?? nextViewIds[0] ?? "now");
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
      const captureDefaults = buildCaptureDefaults({
        labels: createCaptureLabels,
        categories: createCaptureCategories,
        threadIds: createCaptureThreadIds,
        taskStatus: createCaptureTaskStatus,
        taskPriority: createCaptureTaskPriority,
        fallbackLabelIds: kind === "label_project" ? parsedLabels : undefined
      });
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
          captureDefaults,
          source: "manual"
        }
      });
      setName("");
      setDescription("");
      setKind("workspace_project");
      setLabels("");
      setCreateCaptureLabels("");
      setCreateCaptureCategories("");
      setCreateCaptureThreadIds("");
      setCreateCaptureTaskStatus("");
      setCreateCaptureTaskPriority("");
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
      const parsedLabels = parseCsv(editLabels);
      const captureDefaults = buildCaptureDefaults({
        labels: editCaptureLabels,
        categories: editCaptureCategories,
        threadIds: editCaptureThreadIds,
        taskStatus: editCaptureTaskStatus,
        taskPriority: editCaptureTaskPriority,
        fallbackLabelIds: activeProject.kind === "label_project" ? parsedLabels : undefined
      });
      await projectSave({
        definition: {
          ...activeProject,
          name: trimmedName,
          description: editDescription.trim() || undefined,
          labelIds: parsedLabels,
          captureDefaults
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
      window.dispatchEvent(
        new CustomEvent<OmniOpenNotepadDetail>(OMNI_OPEN_NOTEPAD, {
          detail: { notepadId: result.defaultViewId, projectId: result.projectId }
        })
      );
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

  const toggleAssociationView = (viewId: string): void => {
    setAssociationViewIds((current) => {
      const next = current.includes(viewId) ? current.filter((id) => id !== viewId) : [...current, viewId];
      return next.length > 0 ? next : [viewId];
    });
    setAssociationDefaultViewId((current) => (current ? current : viewId));
  };

  const saveAssociations = async (): Promise<void> => {
    if (!activeProject) {
      return;
    }
    setAssociationsSaving(true);
    setError(undefined);
    try {
      const deduped = associationViewIds.filter((value, index, values) => value && values.indexOf(value) === index);
      const fallbackDefault = associationDefaultViewId || deduped[0] || activeProject.defaultViewId || "now";
      const ensured = deduped.includes(fallbackDefault) ? deduped : [fallbackDefault, ...deduped];
      await projectSave({
        definition: {
          ...activeProject,
          viewIds: ensured,
          defaultViewId: fallbackDefault
        }
      });
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAssociationsSaving(false);
    }
  };

  const applyDefaultsToViews = async (): Promise<void> => {
    if (!activeProject) {
      return;
    }
    const projectCapture = activeProject.captureDefaults;
    if (!projectCapture) {
      setError("Project has no capture defaults to apply.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const targetIds = new Set<string>([
        ...(activeProject.defaultViewId ? [activeProject.defaultViewId] : []),
        ...activeProject.viewIds
      ]);
      for (const notepad of notepads) {
        if (!targetIds.has(notepad.id)) {
          continue;
        }
        const merged = mergeNotepadCaptureDefaults(notepad.captureDefaults, projectCapture);
        await notepadSave({
          expectedRevision: notepad.revision,
          definition: {
            id: notepad.id,
            schemaVersion: notepad.schemaVersion,
            name: notepad.name,
            description: notepad.description,
            isSystem: notepad.isSystem,
            viewKind: notepad.viewKind,
            scopeProjectId: notepad.scopeProjectId,
            displayRole: notepad.displayRole,
            filters: notepad.filters,
            sorts: notepad.sorts,
            captureDefaults: merged,
            layoutMode: notepad.layoutMode
          }
        });
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const runBackfill = async (dryRun: boolean): Promise<void> => {
    setMigrationBusy(true);
    setError(undefined);
    try {
      const plan = await migrationPlanCreate({
        domain: "project",
        fromVersion: 1,
        toVersion: 2,
        dryRun
      });
      const started = await migrationRunStart(plan.id);
      const run = await migrationRunGet(started.id);
      setMigrationRun(run ?? started);
      if (!dryRun) {
        await refresh();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setMigrationBusy(false);
    }
  };

  const associatedViewOptions = useMemo(() => {
    return [...notepads].sort((a, b) => a.name.localeCompare(b.name));
  }, [notepads]);

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
          createCaptureLabels={createCaptureLabels}
          createCaptureCategories={createCaptureCategories}
          createCaptureThreadIds={createCaptureThreadIds}
          createCaptureTaskStatus={createCaptureTaskStatus}
          createCaptureTaskPriority={createCaptureTaskPriority}
          creatingProject={saving}
          onChangeCreateName={setName}
          onChangeCreateDescription={setDescription}
          onChangeCreateKind={setKind}
          onChangeCreateLabels={setLabels}
          onChangeCreateDefaultViewId={setDefaultViewId}
          onChangeCreateCaptureLabels={setCreateCaptureLabels}
          onChangeCreateCaptureCategories={setCreateCaptureCategories}
          onChangeCreateCaptureThreadIds={setCreateCaptureThreadIds}
          onChangeCreateCaptureTaskStatus={setCreateCaptureTaskStatus}
          onChangeCreateCaptureTaskPriority={setCreateCaptureTaskPriority}
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
          {(loading || saving || associationsSaving) && (
            <div className="banner info">{loading ? "Loading projects..." : "Applying changes..."}</div>
          )}

          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ marginTop: 0 }}>Migration Backfill</h3>
            <small className="settings-hint">Backfill derived projects for existing notepads using the new project model.</small>
            <div className="project-detail-actions" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => void runBackfill(true)} disabled={migrationBusy}>
                Dry Run Backfill
              </button>
              <button type="button" className="primary" onClick={() => void runBackfill(false)} disabled={migrationBusy}>
                Run Backfill
              </button>
              <button type="button" onClick={() => actions.selectScreen("labels")}>Open Labels</button>
            </div>
            {migrationRun && (
              <div style={{ marginTop: 10 }}>
                <small className="settings-hint">Last run: {migrationRun.status}</small>
                <ul style={{ marginTop: 8, paddingLeft: 16 }}>
                  {migrationRun.logs.map((log, index) => (
                    <li key={`${migrationRun.id}-${index}`}><small>{log}</small></li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {activeProject ? (
            <>
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

              <div className="card" style={{ marginTop: 12 }}>
                <h3 style={{ marginTop: 0 }}>Project Views</h3>
                <small className="settings-hint">Associate multiple notepad views and choose the project default route.</small>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {associatedViewOptions.map((view) => (
                    <label key={view.id} className="project-list-tag" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={associationViewIds.includes(view.id)}
                        onChange={() => toggleAssociationView(view.id)}
                      />{" "}
                      {view.name}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                  <label>
                    <small className="settings-hint">Default view</small>
                    <select
                      value={associationDefaultViewId}
                      onChange={(event) => setAssociationDefaultViewId(event.target.value)}
                    >
                      {associationViewIds.map((viewId) => {
                        const view = notepads.find((item) => item.id === viewId);
                        return (
                          <option key={viewId} value={viewId}>
                            {view?.name ?? viewId}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
                <div className="project-detail-actions" style={{ marginTop: 10 }}>
                  <button type="button" className="primary" onClick={() => void saveAssociations()} disabled={associationsSaving || saving}>
                    Save View Associations
                  </button>
                </div>
              </div>

              <div className="card" style={{ marginTop: 12 }}>
                <h3 style={{ marginTop: 0 }}>Capture Defaults</h3>
                <small className="settings-hint">Defaults applied when capturing from this project context.</small>
                <form onSubmit={(event) => void onSaveProjectEdits(event)} style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    placeholder="Project name"
                  />
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(event) => setEditDescription(event.target.value)}
                    placeholder="Description"
                  />
                  <input
                    type="text"
                    value={editLabels}
                    onChange={(event) => setEditLabels(event.target.value)}
                    placeholder="Project labels (comma-separated IDs)"
                  />
                  <input
                    type="text"
                    value={editCaptureLabels}
                    onChange={(event) => setEditCaptureLabels(event.target.value)}
                    placeholder="Capture labels (comma-separated)"
                  />
                  <input
                    type="text"
                    value={editCaptureCategories}
                    onChange={(event) => setEditCaptureCategories(event.target.value)}
                    placeholder="Capture categories (comma-separated)"
                  />
                  <input
                    type="text"
                    value={editCaptureThreadIds}
                    onChange={(event) => setEditCaptureThreadIds(event.target.value)}
                    placeholder="Capture thread IDs (comma-separated)"
                  />
                  <select
                    value={editCaptureTaskStatus}
                    onChange={(event) => setEditCaptureTaskStatus(event.target.value as "todo" | "doing" | "blocked" | "done" | "")}
                  >
                    <option value="">Capture status (inherit)</option>
                    <option value="todo">todo</option>
                    <option value="doing">doing</option>
                    <option value="blocked">blocked</option>
                    <option value="done">done</option>
                  </select>
                  <select
                    value={editCaptureTaskPriority}
                    onChange={(event) => setEditCaptureTaskPriority(event.target.value as "1" | "2" | "3" | "4" | "5" | "")}
                  >
                    <option value="">Capture priority (inherit)</option>
                    <option value="1">P1</option>
                    <option value="2">P2</option>
                    <option value="3">P3</option>
                    <option value="4">P4</option>
                    <option value="5">P5</option>
                  </select>
                  <div className="project-detail-actions">
                    <button type="submit" className="primary" disabled={editingProject || saving}>
                      {editingProject ? "Saving..." : "Save Project + Defaults"}
                    </button>
                    <button type="button" onClick={() => void applyDefaultsToViews()} disabled={saving || editingProject}>
                      Apply Defaults To Associated Views
                    </button>
                  </div>
                </form>
              </div>
            </>
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
