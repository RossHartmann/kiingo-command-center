import React, { useCallback, useEffect, useState } from "react";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [compact, setCompact] = useState(false);

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
    // Deduplicate by metricId — multiple widgets of the same metric should only trigger one refresh
    const seen = new Set<string>();
    for (const view of staleMetrics) {
      if (seen.has(view.definition.id)) continue;
      seen.add(view.definition.id);
      void actions.refreshMetric(view.definition.id).catch(() => {});
    }
  }, [views, actions]);

  const handleLayoutChange = useCallback(
    (layouts: ScreenMetricLayoutItem[]) => {
      void actions.updateScreenMetricLayout(screenId, layouts);
    },
    [actions, screenId]
  );

  const handleRemoveWidget = useCallback(
    (bindingId: string) => {
      void actions.unbindMetricFromScreen(screenId, bindingId);
    },
    [actions, screenId]
  );

  const allMetrics = state.metricDefinitions.filter((d) => !d.archivedAt);
  const filtered = allMetrics.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.slug.toLowerCase().includes(search.toLowerCase())
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
  };

  const handleDropMetric = useCallback(
    (metricId: string) => {
      void handleAddMetric(metricId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenId, actions, views.length]
  );

  // Mouse-based drag from sidebar cards (bypasses HTML5 DnD issues in Tauri WebKit)
  const handleMouseDownDrag = useCallback((e: React.MouseEvent, metricId: string, label: string) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost: HTMLElement | null = null;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      // Don't start drag until mouse moves 5px (allows click-to-add to work)
      if (!dragging && Math.abs(dx) + Math.abs(dy) > 5) {
        dragging = true;
        (window as any).__draggingMetricId = metricId;
        document.body.classList.add("metric-dragging");

        ghost = document.createElement("div");
        ghost.id = "metric-drag-ghost";
        ghost.textContent = label;
        ghost.style.cssText = `
          position: fixed; left: ${ev.clientX - 40}px; top: ${ev.clientY - 14}px;
          pointer-events: none; z-index: 9999; padding: 6px 14px; border-radius: 8px;
          font-size: 0.75rem; font-weight: 600; background: var(--accent); color: #fff;
          opacity: 0.9; box-shadow: 0 4px 12px rgba(0,0,0,0.3); white-space: nowrap;
        `;
        document.body.appendChild(ghost);
      }

      if (ghost) {
        ghost.style.left = `${ev.clientX - 40}px`;
        ghost.style.top = `${ev.clientY - 14}px`;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      if (!dragging) return; // Was a click, not a drag — let onClick handle it

      // If the grid's mouseup handler didn't consume it, clean up
      setTimeout(() => {
        if ((window as any).__draggingMetricId) {
          (window as any).__draggingMetricId = null;
        }
        if (ghost) ghost.remove();
        document.body.classList.remove("metric-dragging");
      }, 0);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  if (views.length === 0 && !editMode) {
    return (
      <div className="screen">
        <div className="metric-empty-state">
          <p>No metrics configured for this screen.</p>
          <p className="settings-hint">
            <button
              type="button"
              className="metric-link-btn"
              onClick={() => { setEditMode(true); setDrawerOpen(true); }}
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
        {editMode && (
          <>
            <button type="button" onClick={() => setDrawerOpen(!drawerOpen)}>
              + Add Widget
            </button>
            <button
              type="button"
              className={compact ? "active" : ""}
              onClick={() => setCompact(!compact)}
              title={compact ? "Switch to free-form layout" : "Switch to vertical compaction"}
            >
              {compact ? "Compact" : "Free-form"}
            </button>
          </>
        )}
        <button
          type="button"
          className={editMode ? "primary" : ""}
          onClick={() => {
            setEditMode(!editMode);
            setDrawerOpen(false);
            setSearch("");
          }}
        >
          {editMode ? "Done" : "Edit"}
        </button>
      </div>

      <MetricGrid
        views={views}
        editMode={editMode}
        compact={compact}
        onLayoutChange={handleLayoutChange}
        onRemoveWidget={editMode ? handleRemoveWidget : undefined}
        onDropMetric={editMode ? handleDropMetric : undefined}
      />

      {editMode && drawerOpen && (
        <aside className="metric-drawer">
          <div className="metric-drawer-header">
            <strong>Metric Library</strong>
            <button
              type="button"
              className="metric-drawer-close"
              onClick={() => setDrawerOpen(false)}
            >
              {"\u2715"}
            </button>
          </div>
          <input
            className="metric-drawer-search"
            type="text"
            placeholder="Search metrics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="metric-drawer-list">
            {filtered.length === 0 && (
              <p className="metric-drawer-empty">No metrics found</p>
            )}
            {filtered.map((m) => (
                <div
                  key={m.id}
                  className="metric-library-card"
                  onMouseDown={(e) => handleMouseDownDrag(e, m.id, m.name)}
                  onClick={() => handleAddMetric(m.id)}
                >
                  <div className="metric-library-card-info">
                    <strong>{m.name}</strong>
                    {m.instructions && (
                      <small>
                        {m.instructions.length > 100
                          ? m.instructions.slice(0, 100) + "..."
                          : m.instructions}
                      </small>
                    )}
                    <span className="metric-library-card-meta">
                      {m.provider}
                      {m.ttlSeconds ? ` \u00b7 ${formatTtl(m.ttlSeconds)}` : ""}
                    </span>
                  </div>
                  <span className="metric-library-btn-hint">+</span>
                </div>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function formatTtl(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m refresh`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h refresh`;
  return `${Math.round(seconds / 86400)}d refresh`;
}
