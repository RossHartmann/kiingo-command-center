import { useEffect, useState } from "react";
import { useAppActions, useAppState, type Screen } from "../state/appState";
import type { MetricLayoutHint } from "../lib/types";
import { SCREEN_META } from "./Sidebar/navigationConfig";

interface MetricBindingManagerProps {
  screenId?: string;
}

export function MetricBindingManager({ screenId: initialScreenId }: MetricBindingManagerProps): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [selectedScreen, setSelectedScreen] = useState<string>(initialScreenId ?? "dashboard");
  const [selectedMetricId, setSelectedMetricId] = useState<string>("");
  const [layoutHint, setLayoutHint] = useState<MetricLayoutHint>("card");

  const views = state.screenMetricViews[selectedScreen] ?? [];

  useEffect(() => {
    void actions.loadScreenMetrics(selectedScreen);
  }, [selectedScreen, actions]);

  useEffect(() => {
    if (state.metricDefinitions.length === 0) {
      void actions.loadMetricDefinitions();
    }
  }, [actions, state.metricDefinitions.length]);

  const availableMetrics = state.metricDefinitions.filter(
    (d) => !d.archivedAt && !views.some((v) => v.definition.id === d.id)
  );

  const handleBind = async () => {
    if (!selectedMetricId) return;
    await actions.bindMetricToScreen({
      screenId: selectedScreen,
      metricId: selectedMetricId,
      position: views.length,
      layoutHint
    });
    setSelectedMetricId("");
  };

  const handleUnbind = async (metricId: string) => {
    await actions.unbindMetricFromScreen(selectedScreen, metricId);
  };

  const screenOptions = Object.entries(SCREEN_META).map(([id, meta]) => ({
    id: id as Screen,
    label: meta.title
  }));

  return (
    <div className="metric-binding-manager">
      <div className="metric-binding-header">
        <label>
          Screen
          <select value={selectedScreen} onChange={(e) => setSelectedScreen(e.target.value)}>
            {screenOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="metric-binding-list">
        <h3>Bound Metrics ({views.length})</h3>
        {views.length === 0 && <p className="settings-hint">No metrics bound to this screen</p>}
        {views.map((view) => (
          <div key={view.binding.id} className="metric-binding-item">
            <span>{view.definition.name}</span>
            <small>{view.binding.layoutHint}</small>
            <button
              type="button"
              onClick={() => handleUnbind(view.definition.id)}
              title="Remove"
            >
              {"\u2715"}
            </button>
          </div>
        ))}
      </div>

      {availableMetrics.length > 0 && (
        <div className="metric-binding-add">
          <h3>Add Metric</h3>
          <div className="metric-binding-add-row">
            <select value={selectedMetricId} onChange={(e) => setSelectedMetricId(e.target.value)}>
              <option value="">Select metric...</option>
              {availableMetrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select value={layoutHint} onChange={(e) => setLayoutHint(e.target.value as MetricLayoutHint)}>
              <option value="card">Card</option>
              <option value="wide">Wide</option>
              <option value="full">Full</option>
            </select>
            <button type="button" className="primary" onClick={handleBind} disabled={!selectedMetricId}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
