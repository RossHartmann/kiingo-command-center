import { useCallback, useEffect, useRef, useState } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { MetricGrid } from "../components/MetricGrid";
import type { MetricLayoutHint, ScreenMetricLayoutItem } from "../lib/types";

interface DashboardScreenProps {
  screenId: string;
}

const GRID_DEFAULTS: Record<string, { gridW: number; gridH: number }> = {
  card: { gridW: 4, gridH: 6 },
  wide: { gridW: 8, gridH: 6 },
  full: { gridW: 12, gridH: 8 },
};

export function DashboardScreen({ screenId }: DashboardScreenProps): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const views = state.screenMetricViews[screenId] ?? [];
  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void actions.loadScreenMetrics(screenId);
  }, [screenId, actions]);

  useEffect(() => {
    if (state.metricDefinitions.length === 0) {
      void actions.loadMetricDefinitions();
    }
  }, [actions, state.metricDefinitions.length]);

  useEffect(() => {
    if (views.length === 0) return;
    const staleMetrics = views.filter((v) => v.isStale && !v.refreshInProgress);
    for (const view of staleMetrics) {
      void actions.refreshMetric(view.definition.id).catch(() => {});
    }
  }, [views, actions]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  const handleLayoutChange = useCallback(
    (layouts: ScreenMetricLayoutItem[]) => {
      void actions.updateScreenMetricLayout(screenId, layouts);
    },
    [actions, screenId]
  );

  const handleRemoveMetric = useCallback(
    (metricId: string) => {
      void actions.unbindMetricFromScreen(screenId, metricId);
    },
    [actions, screenId]
  );

  const handleAddMetric = async (metricId: string, hint: MetricLayoutHint = "card") => {
    const { gridW, gridH } = GRID_DEFAULTS[hint] ?? GRID_DEFAULTS.card;
    await actions.bindMetricToScreen({
      screenId,
      metricId,
      position: views.length,
      layoutHint: hint,
      gridW,
      gridH,
    });
    setPickerOpen(false);
  };

  const availableMetrics = state.metricDefinitions.filter(
    (d) => !d.archivedAt && !views.some((v) => v.definition.id === d.id)
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
    <div className={`screen dashboard-screen${editMode ? " dashboard-editing" : ""}`}>
      <div className="dashboard-toolbar">
        {editMode && availableMetrics.length > 0 && (
          <div className="widget-picker-wrap" ref={pickerRef}>
            <button type="button" onClick={() => setPickerOpen(!pickerOpen)}>
              + Add Widget
            </button>
            {pickerOpen && (
              <div className="widget-picker-dropdown">
                {availableMetrics.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="widget-picker-item"
                    onClick={() => handleAddMetric(m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className={editMode ? "primary" : ""}
          onClick={() => {
            setEditMode(!editMode);
            setPickerOpen(false);
          }}
        >
          {editMode ? "Done" : "Edit"}
        </button>
      </div>
      <MetricGrid
        views={views}
        editMode={editMode}
        onLayoutChange={handleLayoutChange}
        onRemoveMetric={editMode ? handleRemoveMetric : undefined}
      />
    </div>
  );
}
