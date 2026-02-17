import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { MetricGrid } from "../components/MetricGrid";
import { OMNI_SCROLL_TO_METRIC } from "../components/OmniSearch";
import type { MetricLayoutHint, ScreenMetricLayoutItem } from "../lib/types";

interface DashboardScreenProps {
  screenId: string;
}

const GRID_DEFAULTS: Record<string, { gridW: number; gridH: number }> = {
  card: { gridW: 4, gridH: 6 },
  wide: { gridW: 8, gridH: 6 },
  full: { gridW: 12, gridH: 8 },
};

// Must match MetricGrid's ResponsiveGridLayout config
const GRID_BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 };
const GRID_COLS = { lg: 12, md: 10, sm: 6, xs: 4 };

function getColsForWidth(width: number): number {
  if (width >= GRID_BREAKPOINTS.lg) return GRID_COLS.lg;
  if (width >= GRID_BREAKPOINTS.md) return GRID_COLS.md;
  if (width >= GRID_BREAKPOINTS.sm) return GRID_COLS.sm;
  return GRID_COLS.xs;
}

export function DashboardScreen({ screenId }: DashboardScreenProps): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const views = state.screenMetricViews[screenId] ?? [];
  const [editMode, setEditMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [compact, setCompact] = useState(false);
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void actions.loadScreenMetrics(screenId);
  }, [screenId, actions]);

  useEffect(() => {
    if (state.metricDefinitions.length === 0) {
      void actions.loadMetricDefinitions();
    }
  }, [actions, state.metricDefinitions.length]);

  // Track which metrics we've already kicked off a refresh for so that
  // view reloads (which create a new `views` reference) don't re-trigger
  // duplicate refresh attempts in a cascade.
  const refreshedRef = useRef(new Set<string>());
  useEffect(() => {
    refreshedRef.current = new Set<string>();
  }, [screenId]);

  useEffect(() => {
    if (views.length === 0) return;
    const staleMetrics = views.filter((v) => v.isStale && !v.refreshInProgress);
    for (const view of staleMetrics) {
      if (refreshedRef.current.has(view.definition.id)) continue;
      refreshedRef.current.add(view.definition.id);
      void actions.refreshMetric(view.definition.id).catch(() => {});
    }
  }, [views, actions]);

  // Scroll-to-metric when triggered from OmniSearch
  useEffect(() => {
    const handler = (e: Event) => {
      const { bindingId } = (e as CustomEvent).detail as { bindingId: string };
      const el = gridContainerRef.current?.querySelector<HTMLElement>(
        `[data-binding-id="${CSS.escape(bindingId)}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("omni-highlight");
        setTimeout(() => el.classList.remove("omni-highlight"), 2000);
      }
    };
    window.addEventListener(OMNI_SCROLL_TO_METRIC, handler);
    return () => window.removeEventListener(OMNI_SCROLL_TO_METRIC, handler);
  }, []);

  const handleLayoutChange = useCallback(
    (layouts: ScreenMetricLayoutItem[]) => {
      void actions.updateScreenMetricLayout(screenId, layouts);
    },
    [actions, screenId]
  );

  const handleAutoArrange = useCallback(() => {
    if (views.length === 0) return;

    // Use actual grid container width to match the responsive column count
    const containerWidth = gridContainerRef.current?.clientWidth ?? window.innerWidth;
    const COLS = getColsForWidth(containerWidth);

    // Sort by current position: top-to-bottom, left-to-right
    const sorted = [...views].sort((a, b) => {
      const ay = a.binding.gridY, by = b.binding.gridY;
      if (ay !== by) return ay - by;
      return a.binding.gridX - b.binding.gridX;
    });

    // Occupancy grid — tracks which cells are taken
    const occupied: boolean[][] = [];
    const ensureRows = (n: number) => {
      while (occupied.length < n) occupied.push(new Array(COLS).fill(false));
    };

    const newLayout: ScreenMetricLayoutItem[] = [];

    for (const view of sorted) {
      // Clamp width to fit within available columns
      const w = Math.max(1, Math.min(view.binding.gridW, COLS));
      const h = Math.max(1, view.binding.gridH);
      let placed = false;

      for (let row = 0; !placed; row++) {
        ensureRows(row + h);
        for (let col = 0; col <= COLS - w; col++) {
          // Check if w×h rectangle fits
          let fits = true;
          for (let dy = 0; dy < h && fits; dy++) {
            for (let dx = 0; dx < w && fits; dx++) {
              if (occupied[row + dy][col + dx]) fits = false;
            }
          }
          if (fits) {
            // Place widget
            for (let dy = 0; dy < h; dy++) {
              for (let dx = 0; dx < w; dx++) {
                occupied[row + dy][col + dx] = true;
              }
            }
            newLayout.push({
              bindingId: view.binding.id,
              gridX: col,
              gridY: row,
              gridW: w,
              gridH: h,
            });
            placed = true;
          }
        }
      }
    }

    void actions.updateScreenMetricLayout(screenId, newLayout);
  }, [views, actions, screenId]);

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
        <button
          type="button"
          className={editMode ? "primary" : ""}
          onClick={() => {
            const nextEditMode = !editMode;
            setEditMode(nextEditMode);
            if (!nextEditMode) {
              setShowToolsPanel(false);
            }
            setDrawerOpen(false);
            setSearch("");
          }}
        >
          {editMode ? "Done" : "Edit"}
        </button>
        {editMode && (
          <>
            <button type="button" onClick={() => setDrawerOpen(!drawerOpen)}>
              {drawerOpen ? "Hide Widgets" : "Widgets"}
            </button>
            <button
              type="button"
              className={showToolsPanel ? "primary" : ""}
              onClick={() => setShowToolsPanel((current) => !current)}
              aria-expanded={showToolsPanel}
            >
              Tools
            </button>
          </>
        )}
      </div>

      {editMode && showToolsPanel && (
        <div className="dashboard-toolbar-panel">
          <small className="settings-hint">Layout controls</small>
          <div className="dashboard-toolbar-panel-actions">
            <button
              type="button"
              className={compact ? "primary" : ""}
              onClick={() => setCompact(!compact)}
              title={compact ? "Switch to free-form layout" : "Switch to vertical compaction"}
            >
              {compact ? "Compact On" : "Compact Off"}
            </button>
            <button type="button" onClick={handleAutoArrange} title="Pack widgets tightly with no gaps">
              Auto-arrange
            </button>
          </div>
        </div>
      )}

      <div ref={gridContainerRef}>
        <MetricGrid
          views={views}
          editMode={editMode}
          compact={compact}
          onLayoutChange={handleLayoutChange}
          onRemoveWidget={editMode ? handleRemoveWidget : undefined}
          onDropMetric={editMode ? handleDropMetric : undefined}
        />
      </div>

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
