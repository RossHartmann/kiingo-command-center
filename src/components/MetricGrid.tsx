import { useMemo, useCallback, useRef, useEffect } from "react";
import {
  ResponsiveGridLayout,
  noCompactor,
  useContainerWidth,
} from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { ScreenMetricView, ScreenMetricLayoutItem } from "../lib/types";
import { MetricCard } from "./MetricCard";

const ROW_HEIGHT = 40;
const MARGIN = 12;

interface MetricGridProps {
  views: ScreenMetricView[];
  editMode: boolean;
  onLayoutChange?: (layouts: ScreenMetricLayoutItem[]) => void;
  onRemoveWidget?: (bindingId: string) => void;
  onDropMetric?: (metricId: string) => void;
}

export function MetricGrid({ views, editMode, onLayoutChange, onRemoveWidget, onDropMetric }: MetricGridProps): JSX.Element {
  const { width, containerRef, mounted } = useContainerWidth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which snapshot content we've already auto-sized to avoid loops
  const autoSizedRef = useRef<Record<string, string>>({});

  const layout = useMemo<LayoutItem[]>(() => {
    return views.map((view, index) => {
      const b = view.binding;
      return {
        i: b.id,
        x: b.gridX >= 0 ? b.gridX : (index * 4) % 12,
        y: b.gridY >= 0 ? b.gridY : Math.floor((index * 4) / 12) * 3,
        w: b.gridW,
        h: b.gridH,
        minW: 2,
        minH: 2,
      };
    });
  }, [views]);

  // Auto-size: after content renders, detect overflow and bump grid height
  useEffect(() => {
    if (!containerRef.current || !mounted || !onLayoutChange) return;

    // Build a content-key per binding so we only auto-size once per content change
    const contentKeys: Record<string, string> = {};
    for (const v of views) {
      const snapId = v.latestSnapshot?.id ?? "none";
      contentKeys[v.binding.id] = snapId;
    }

    // Wait for react-live to finish rendering
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      const gridItems = container.querySelectorAll<HTMLElement>("[data-binding-id]");
      const heightUpdates: Record<string, number> = {};

      gridItems.forEach((el) => {
        const bindingId = el.dataset.bindingId;
        if (!bindingId) return;

        // Skip if we already auto-sized for this exact content
        const key = contentKeys[bindingId];
        if (key && autoSizedRef.current[bindingId] === key) return;

        const body = el.querySelector<HTMLElement>(".metric-card-body");
        if (!body) return;

        // Check if content overflows the card body
        if (body.scrollHeight > body.clientHeight + 5) {
          const overflow = body.scrollHeight - body.clientHeight;
          const currentItem = layout.find((l) => l.i === bindingId);
          if (!currentItem) return;

          const additionalRows = Math.ceil(overflow / (ROW_HEIGHT + MARGIN));
          heightUpdates[bindingId] = currentItem.h + additionalRows;
        }

        // Mark as auto-sized for this content
        if (key) autoSizedRef.current[bindingId] = key;
      });

      if (Object.keys(heightUpdates).length > 0) {
        const items: ScreenMetricLayoutItem[] = layout.map((l) => ({
          bindingId: l.i,
          gridX: l.x,
          gridY: l.y,
          gridW: l.w,
          gridH: heightUpdates[l.i] ?? l.h,
        }));
        onLayoutChange(items);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [mounted, views, layout, onLayoutChange]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (!onLayoutChange || !editMode) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const items: ScreenMetricLayoutItem[] = newLayout.map((l) => ({
          bindingId: l.i,
          gridX: l.x,
          gridY: l.y,
          gridW: l.w,
          gridH: l.h,
        }));
        onLayoutChange(items);
      }, 500);
    },
    [onLayoutChange, editMode]
  );

  // Handle mouse-based drop from sidebar (mouseup over the grid)
  const onDropMetricRef = useRef(onDropMetric);
  onDropMetricRef.current = onDropMetric;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editMode) return;

    const handleMouseUp = (e: MouseEvent) => {
      // Check if there's a metric being dragged (set by sidebar)
      const metricId = (window as any).__draggingMetricId as string | undefined;
      if (!metricId) return;
      (window as any).__draggingMetricId = null;

      // Remove ghost
      const ghost = document.getElementById("metric-drag-ghost");
      if (ghost) ghost.remove();
      document.body.classList.remove("metric-dragging");

      onDropMetricRef.current?.(metricId);
    };

    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [editMode, containerRef]);

  // Grid needs enough height to be a valid drop target even when empty
  const gridStyle = editMode ? { minHeight: "calc(100vh - 100px)" } : undefined;

  return (
    <div ref={containerRef}>
      {mounted && (
        <ResponsiveGridLayout
          width={width}
          className="metric-grid-layout"
          layouts={{ lg: layout }}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
          rowHeight={ROW_HEIGHT}
          style={gridStyle}
          dragConfig={
            editMode
              ? { enabled: true, handle: ".metric-card-header" }
              : { enabled: false }
          }
          resizeConfig={
            editMode
              ? { enabled: true, handles: ["se", "s", "e"] as const }
              : { enabled: false }
          }
          compactor={noCompactor}
          margin={[MARGIN, MARGIN] as const}
          onLayoutChange={handleLayoutChange}
        >
          {views.map((view) => (
            <div key={view.binding.id} data-binding-id={view.binding.id}>
              <MetricCard
                view={view}
                onRemove={editMode && onRemoveWidget ? () => onRemoveWidget(view.binding.id) : undefined}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
