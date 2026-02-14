import { useCallback, useEffect, useState } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { MetricGrid } from "../components/MetricGrid";
import { MetricBindingManager } from "../components/MetricBindingManager";
import type { ScreenMetricLayoutItem } from "../lib/types";

interface DashboardScreenProps {
  screenId: string;
}

export function DashboardScreen({ screenId }: DashboardScreenProps): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const views = state.screenMetricViews[screenId] ?? [];
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    void actions.loadScreenMetrics(screenId);
  }, [screenId, actions]);

  useEffect(() => {
    if (views.length === 0) return;
    const staleMetrics = views.filter((v) => v.isStale && !v.refreshInProgress);
    for (const view of staleMetrics) {
      void actions.refreshMetric(view.definition.id).catch(() => {});
    }
  }, [views, actions]);

  const handleLayoutChange = useCallback(
    (layouts: ScreenMetricLayoutItem[]) => {
      void actions.updateScreenMetricLayout(screenId, layouts);
    },
    [actions, screenId]
  );

  if (views.length === 0 && !editMode) {
    return (
      <div className="screen">
        <div className="metric-empty-state">
          <p>No metrics configured for this screen.</p>
          <p className="settings-hint">
            <button
              type="button"
              className="metric-link-btn"
              onClick={() => setEditMode(true)}
            >
              Add metrics
            </button>
            {" or go to "}
            <button
              type="button"
              className="metric-link-btn"
              onClick={() => actions.selectScreen("metric-admin")}
            >
              Metrics Admin
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`screen${editMode ? " dashboard-editing" : ""}`}>
      <div className="dashboard-toolbar">
        <button
          type="button"
          className={editMode ? "primary" : ""}
          onClick={() => setEditMode(!editMode)}
        >
          {editMode ? "Done" : "Edit"}
        </button>
      </div>
      <MetricGrid views={views} editMode={editMode} onLayoutChange={handleLayoutChange} />
      {editMode && <MetricBindingManager screenId={screenId} />}
    </div>
  );
}
