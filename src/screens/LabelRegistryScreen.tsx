import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  featureFlagsList,
  registryEntriesList,
  registryEntryDelete,
  registryEntrySave,
  registryEntryUpdate
} from "../lib/tauriClient";
import type { FeatureFlag, RegistryEntry, RegistryEntryKind, RegistryEntryStatus } from "../lib/types";

function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}

function isEnabled(flags: FeatureFlag[], key: FeatureFlag["key"], fallback = true): boolean {
  const flag = flags.find((item) => item.key === key);
  return flag ? flag.enabled : fallback;
}

export function LabelRegistryScreen(): JSX.Element {
  const [entries, setEntries] = useState<RegistryEntry[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<RegistryEntryKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<RegistryEntryStatus | "all">("active");
  const [selectedEntryId, setSelectedEntryId] = useState<string>();

  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<RegistryEntryKind>("category");
  const [createName, setCreateName] = useState("");
  const [createAliases, setCreateAliases] = useState("");
  const [createParentIds, setCreateParentIds] = useState<string[]>([]);

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [editStatus, setEditStatus] = useState<RegistryEntryStatus>("active");
  const [editParentIds, setEditParentIds] = useState<string[]>([]);

  const registryEnabled = isEnabled(featureFlags, "workspace.registry", true);
  const labelsUiEnabled = isEnabled(featureFlags, "workspace.label_registry_ui_v1", true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const [flags, page] = await Promise.all([
        featureFlagsList(),
        registryEntriesList({ limit: 1000 })
      ]);
      setFeatureFlags(flags);
      setEntries(page.items);
      if (!selectedEntryId && page.items.length > 0) {
        setSelectedEntryId(page.items[0].id);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [selectedEntryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId),
    [entries, selectedEntryId]
  );

  useEffect(() => {
    if (!selectedEntry) {
      setEditName("");
      setEditAliases("");
      setEditStatus("active");
      setEditParentIds([]);
      return;
    }
    setEditName(selectedEntry.name);
    setEditAliases(selectedEntry.aliases.join(", "));
    setEditStatus(selectedEntry.status);
    setEditParentIds(selectedEntry.parentIds);
    setShowEdit(false);
  }, [selectedEntry]);

  const entriesById = useMemo(() => {
    const map = new Map<string, RegistryEntry>();
    for (const entry of entries) {
      map.set(entry.id, entry);
    }
    return map;
  }, [entries]);

  const filteredEntries = useMemo(() => {
    let items = [...entries];
    if (kindFilter !== "all") {
      items = items.filter((entry) => entry.kind === kindFilter);
    }
    if (statusFilter !== "all") {
      items = items.filter((entry) => entry.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (entry) =>
          entry.name.toLowerCase().includes(q) ||
          entry.aliases.some((alias) => alias.toLowerCase().includes(q))
      );
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }, [entries, kindFilter, search, statusFilter]);

  const parentCandidates = useMemo(() => {
    const forKind = createKind === "category" ? "category" : createKind;
    return entries
      .filter((entry) => entry.kind === forKind)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [createKind, entries]);

  const editParentCandidates = useMemo(() => {
    if (!selectedEntry) {
      return [];
    }
    return entries
      .filter((entry) => entry.kind === selectedEntry.kind && entry.id !== selectedEntry.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, selectedEntry]);

  const children = useMemo(() => {
    if (!selectedEntry) return [];
    return entries
      .filter((entry) => entry.parentIds.includes(selectedEntry.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, selectedEntry]);

  const toggleCreateParent = (parentId: string): void => {
    setCreateParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId]
    );
  };

  const toggleEditParent = (parentId: string): void => {
    setEditParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId]
    );
  };

  const handleCreateSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!registryEnabled || !labelsUiEnabled) {
      setError("Label registry UI is disabled by feature flag.");
      return;
    }
    if (!createName.trim()) {
      setError("Name is required.");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const created = await registryEntrySave({
        kind: createKind,
        name: createName.trim(),
        aliases: parseCsv(createAliases),
        parentIds: createParentIds,
        status: "active"
      });
      setCreateName("");
      setCreateAliases("");
      setCreateParentIds([]);
      setShowCreate(false);
      await refresh();
      setSelectedEntryId(created.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const handleEditSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedEntry || !registryEnabled || !labelsUiEnabled) {
      return;
    }
    if (!editName.trim()) {
      setError("Name is required.");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      await registryEntryUpdate(selectedEntry.id, {
        expectedRevision: selectedEntry.revision,
        name: editName.trim(),
        aliases: parseCsv(editAliases),
        status: editStatus,
        parentIds: editParentIds
      });
      setShowEdit(false);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!selectedEntry || saving) {
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await registryEntryDelete(selectedEntry.id);
      setSelectedEntryId(undefined);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="labels-screen screen">
      <div className="page-sidebar-layout">
        {/* ---- Sidebar ---- */}
        <nav className="project-list-sidebar" aria-label="Labels">
          <div className="project-list-header">
            <h3>Labels</h3>
            <div className="project-list-header-actions">
              <button
                type="button"
                className="notepad-list-new-btn"
                onClick={() => setShowCreate((c) => !c)}
                aria-expanded={showCreate}
                aria-label="New label"
                disabled={!registryEnabled || !labelsUiEnabled}
                title="New label"
              >
                +
              </button>
            </div>
          </div>

          <div className="project-list-search">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search labels"
              aria-label="Search labels"
            />
          </div>

          <div className="project-list-create" style={{ marginBottom: 8, padding: "0 0.5rem" }}>
            <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as RegistryEntryKind | "all")}>
              <option value="all">All kinds</option>
              <option value="category">Category</option>
              <option value="thread">Thread</option>
              <option value="north_star">North star</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RegistryEntryStatus | "all")}>
              <option value="active">Active</option>
              <option value="stale">Stale</option>
              <option value="retired">Retired</option>
              <option value="all">All statuses</option>
            </select>
          </div>

          {/* Create form (toggled by + button) */}
          {showCreate && (
            <form className="project-list-create" onSubmit={(event) => void handleCreateSubmit(event)}>
              <select value={createKind} onChange={(event) => setCreateKind(event.target.value as RegistryEntryKind)}>
                <option value="category">Category</option>
                <option value="thread">Thread</option>
                <option value="north_star">North star</option>
              </select>
              <input
                type="text"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Label name"
                autoFocus
              />
              <input
                type="text"
                value={createAliases}
                onChange={(event) => setCreateAliases(event.target.value)}
                placeholder="Aliases (comma-separated)"
              />
              <div style={{ padding: "0 0.5rem" }}>
                <small className="settings-hint">Parents</small>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {parentCandidates.length === 0 && <small className="settings-hint">No parent candidates.</small>}
                  {parentCandidates.map((entry) => (
                    <label key={entry.id} className="project-list-tag" style={{ cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={createParentIds.includes(entry.id)}
                        onChange={() => toggleCreateParent(entry.id)}
                      />{" "}
                      {entry.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="project-list-create-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={saving || !createName.trim() || !registryEnabled || !labelsUiEnabled}
                >
                  {saving ? "..." : "Create"}
                </button>
                <button type="button" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* List items */}
          <ul className="project-list-items" role="listbox" aria-label="Registry entries">
            {filteredEntries.map((entry) => {
              const isActive = selectedEntryId === entry.id;
              return (
                <li key={entry.id} role="option" aria-selected={isActive}>
                  <div className={`project-list-item${isActive ? " active" : ""}`}>
                    <button
                      type="button"
                      className="project-list-item-btn"
                      onClick={() => setSelectedEntryId(entry.id)}
                    >
                      <span className="project-list-item-name">{entry.name}</span>
                      <span className="project-list-item-tags">
                        <span className="project-list-tag">{entry.kind}</span>
                        <span className="project-list-tag">{entry.status}</span>
                      </span>
                    </button>
                    {isActive && (
                      <button
                        type="button"
                        className="project-list-edit-btn"
                        onClick={() => setShowEdit((c) => !c)}
                        aria-label="Edit label"
                        title="Edit label"
                        disabled={!registryEnabled || !labelsUiEnabled}
                      >
                        ...
                      </button>
                    )}
                  </div>
                  {/* Inline edit form (toggled by ... button) */}
                  {isActive && showEdit && (
                    <form className="project-list-edit" onSubmit={(event) => void handleEditSubmit(event)}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Name"
                        autoFocus
                      />
                      <input
                        type="text"
                        value={editAliases}
                        onChange={(event) => setEditAliases(event.target.value)}
                        placeholder="Aliases (comma-separated)"
                      />
                      <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as RegistryEntryStatus)}>
                        <option value="active">Active</option>
                        <option value="stale">Stale</option>
                        <option value="retired">Retired</option>
                      </select>
                      <div style={{ padding: "0 0.5rem" }}>
                        <small className="settings-hint">Parents</small>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                          {editParentCandidates.length === 0 && <small className="settings-hint">No parent candidates.</small>}
                          {editParentCandidates.map((candidate) => (
                            <label key={candidate.id} className="project-list-tag" style={{ cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={editParentIds.includes(candidate.id)}
                                onChange={() => toggleEditParent(candidate.id)}
                              />{" "}
                              {candidate.name}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="project-list-create-actions">
                        <button
                          type="submit"
                          className="primary"
                          disabled={saving || !editName.trim() || !registryEnabled || !labelsUiEnabled}
                        >
                          {saving ? "..." : "Save"}
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
            {filteredEntries.length === 0 && (
              <li className="project-list-empty">No labels found</li>
            )}
          </ul>
        </nav>

        {/* ---- Main content: detail view ---- */}
        <div className="page-sidebar-main">
          {!registryEnabled && <div className="banner info">Registry is disabled by feature flag `workspace.registry`.</div>}
          {!labelsUiEnabled && <div className="banner info">Label registry UI is disabled by feature flag `workspace.label_registry_ui_v1`.</div>}
          {(loading || saving) && <div className="banner info">{loading ? "Loading labels..." : "Saving label..."}</div>}
          {error && <div className="banner error">{error}</div>}

          {selectedEntry ? (
            <div className="project-detail card">
              <h2>{selectedEntry.name}</h2>
              <div className="project-detail-meta">
                <span className="project-list-tag">{selectedEntry.kind}</span>
                <span className="project-list-tag">{selectedEntry.status}</span>
              </div>
              <small className="settings-hint">ID: {selectedEntry.id}</small>

              {selectedEntry.aliases.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <small className="settings-hint">Aliases</small>
                  <div className="project-detail-meta" style={{ marginTop: 4 }}>
                    {selectedEntry.aliases.map((alias) => (
                      <span key={alias} className="project-list-tag">{alias}</span>
                    ))}
                  </div>
                </div>
              )}

              {selectedEntry.parentIds.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <small className="settings-hint">Parents</small>
                  <div className="project-detail-meta" style={{ marginTop: 4 }}>
                    {selectedEntry.parentIds.map((parentId) => (
                      <span key={parentId} className="project-list-tag">
                        {entriesById.get(parentId)?.name ?? parentId}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {children.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <small className="settings-hint">Children</small>
                  <div className="project-detail-meta" style={{ marginTop: 4 }}>
                    {children.map((child) => (
                      <span key={child.id} className="project-list-tag">{child.name}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="project-detail-actions">
                <button
                  type="button"
                  onClick={() => void onDelete()}
                  disabled={saving || !registryEnabled || !labelsUiEnabled}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="project-empty-state">
              <span>{entries.length === 0 ? "No labels yet \u2014 create one from the sidebar" : "Select a label from the sidebar"}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
