import { useEffect, useState } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { MetricDefinitionEditor } from "../components/MetricDefinitionEditor";
import { MetricBindingManager } from "../components/MetricBindingManager";
import type { MetricDefinition } from "../lib/types";
import { listMetricSnapshots } from "../lib/tauriClient";
import type { MetricSnapshot } from "../lib/types";

type Tab = "definitions" | "bindings";

export function MetricAdminScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [activeTab, setActiveTab] = useState<Tab>("definitions");
  const [editingDefinition, setEditingDefinition] = useState<MetricDefinition | undefined>(undefined);
  const [showEditor, setShowEditor] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [historySnapshots, setHistorySnapshots] = useState<MetricSnapshot[]>([]);

  useEffect(() => {
    void actions.loadMetricDefinitions();
  }, [actions]);

  const handleNew = () => {
    setEditingDefinition(undefined);
    setShowEditor(true);
  };

  const handleEdit = (def: MetricDefinition) => {
    setEditingDefinition(def);
    setShowEditor(true);
  };

  const handleArchive = async (id: string) => {
    await actions.archiveMetricDefinition(id);
  };

  const handleDelete = async (id: string) => {
    await actions.deleteMetricDefinition(id);
  };

  const handleToggleHistory = async (metricId: string) => {
    if (expandedHistory === metricId) {
      setExpandedHistory(null);
      setHistorySnapshots([]);
      return;
    }
    setExpandedHistory(metricId);
    const snapshots = await listMetricSnapshots(metricId, 10);
    setHistorySnapshots(snapshots);
  };

  if (showEditor) {
    return (
      <div className="screen metric-admin">
        <MetricDefinitionEditor
          definition={editingDefinition}
          onClose={() => setShowEditor(false)}
        />
      </div>
    );
  }

  return (
    <div className="screen metric-admin">
      <div className="metric-admin-tabs">
        <button
          type="button"
          className={activeTab === "definitions" ? "active" : ""}
          onClick={() => setActiveTab("definitions")}
        >
          Definitions
        </button>
        <button
          type="button"
          className={activeTab === "bindings" ? "active" : ""}
          onClick={() => setActiveTab("bindings")}
        >
          Screen Bindings
        </button>
      </div>

      {activeTab === "definitions" && (
        <div className="metric-admin-definitions">
          <div className="metric-admin-header">
            <h3>Metric Definitions ({state.metricDefinitions.length})</h3>
            <button type="button" className="primary" onClick={handleNew}>
              + New Metric
            </button>
          </div>

          {state.metricDefinitions.length === 0 && (
            <p className="settings-hint">No metrics defined yet. Create one to get started.</p>
          )}

          <div className="metric-admin-list">
            {state.metricDefinitions.map((def) => (
              <div key={def.id} className={`metric-admin-item${def.archivedAt ? " archived" : ""}`}>
                <div className="metric-admin-item-header">
                  <div>
                    <strong>{def.name}</strong>
                    <small className="metric-slug">{def.slug}</small>
                  </div>
                  <div className="metric-admin-item-badges">
                    <span className={`metric-badge ${def.enabled ? "enabled" : "disabled"}`}>
                      {def.enabled ? "enabled" : "disabled"}
                    </span>
                    {def.proactive && <span className="metric-badge proactive">proactive</span>}
                    <span className="metric-badge provider">{def.provider}</span>
                  </div>
                </div>
                <p className="metric-admin-instructions">{def.instructions.slice(0, 120)}...</p>
                <div className="metric-admin-item-actions">
                  <button type="button" onClick={() => handleEdit(def)}>Edit</button>
                  <button type="button" onClick={() => handleToggleHistory(def.id)}>
                    {expandedHistory === def.id ? "Hide History" : "History"}
                  </button>
                  {!def.archivedAt && (
                    <button type="button" onClick={() => handleArchive(def.id)}>Archive</button>
                  )}
                  <button type="button" onClick={() => handleDelete(def.id)}>Delete</button>
                </div>

                {expandedHistory === def.id && (
                  <div className="metric-history">
                    <h4>Recent Snapshots</h4>
                    {historySnapshots.length === 0 && <p className="settings-hint">No snapshots yet</p>}
                    {historySnapshots.map((snap) => (
                      <div key={snap.id} className="metric-history-item">
                        <span className={`metric-badge ${snap.status}`}>{snap.status}</span>
                        <small>{new Date(snap.createdAt).toLocaleString()}</small>
                        {snap.errorMessage && <small className="metric-error-text">{snap.errorMessage}</small>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "bindings" && <MetricBindingManager />}
    </div>
  );
}
