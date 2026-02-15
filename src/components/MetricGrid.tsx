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
  onRemoveMetric?: (metricId: string) => void;
}

export function MetricGrid({ views, editMode, onLayoutChange, onRemoveMetric }: MetricGridProps): JSX.Element {
  const { width, containerRef, mounted } = useContainerWidth();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which snapshot content we've already auto-sized to avoid loops
  const autoSizedRef = useRef<Record<string, string>>({});

  const layout = useMemo<LayoutItem[]>(() => {
    return views.map((view, index) => {
      const b = view.binding;
      return {
        i: b.metricId,
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

    // Build a content-key per metric so we only auto-size once per content change
    const contentKeys: Record<string, string> = {};
    for (const v of views) {
      const snapId = v.latestSnapshot?.id ?? "none";
      contentKeys[v.binding.metricId] = snapId;
    }

    // Wait for react-live to finish rendering
    const timer = setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;

      const gridItems = container.querySelectorAll<HTMLElement>("[data-metric-id]");
      const heightUpdates: Record<string, number> = {};

      gridItems.forEach((el) => {
        const metricId = el.dataset.metricId;
        if (!metricId) return;

        // Skip if we already auto-sized for this exact content
        const key = contentKeys[metricId];
        if (key && autoSizedRef.current[metricId] === key) return;

        const body = el.querySelector<HTMLElement>(".metric-card-body");
        if (!body) return;

        // Check if content overflows the card body
        if (body.scrollHeight > body.clientHeight + 5) {
          const overflow = body.scrollHeight - body.clientHeight;
          const currentItem = layout.find((l) => l.i === metricId);
          if (!currentItem) return;

          const additionalRows = Math.ceil(overflow / (ROW_HEIGHT + MARGIN));
          heightUpdates[metricId] = currentItem.h + additionalRows;
        }

        // Mark as auto-sized for this content
        if (key) autoSizedRef.current[metricId] = key;
      });

      if (Object.keys(heightUpdates).length > 0) {
        const items: ScreenMetricLayoutItem[] = layout.map((l) => ({
          metricId: l.i,
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
          metricId: l.i,
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

  if (views.length === 0) {
    return <div ref={containerRef} />;
  }

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
            <div key={view.binding.metricId} data-metric-id={view.binding.metricId}>
              <MetricCard
                view={view}
                onRemove={editMode && onRemoveMetric ? () => onRemoveMetric(view.binding.metricId) : undefined}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      )}
    </div>
  );
}
