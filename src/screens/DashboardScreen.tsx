import { useEffect } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { MetricGrid } from "../components/MetricGrid";

interface DashboardScreenProps {
  screenId: string;
}

export function DashboardScreen({ screenId }: DashboardScreenProps): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const views = state.screenMetricViews[screenId] ?? [];

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

  if (views.length === 0) {
    return (
      <div className="screen">
        <div className="metric-empty-state">
          <p>No metrics configured for this screen.</p>
          <p className="settings-hint">
            Go to{" "}
            <button
              type="button"
              className="metric-link-btn"
              onClick={() => actions.selectScreen("metric-admin")}
            >
              Metrics Admin
            </button>{" "}
            to create and bind metrics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <MetricGrid views={views} />
    </div>
  );
}
