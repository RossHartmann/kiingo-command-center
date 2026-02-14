import { useMemo, useCallback, useRef } from "react";
import { ResponsiveGridLayout, verticalCompactor } from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { ScreenMetricView, ScreenMetricLayoutItem } from "../lib/types";
import { MetricCard } from "./MetricCard";

interface MetricGridProps {
  views: ScreenMetricView[];
  editMode: boolean;
  onLayoutChange?: (layouts: ScreenMetricLayoutItem[]) => void;
}

export function MetricGrid({ views, editMode, onLayoutChange }: MetricGridProps): JSX.Element {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return <></>;
  }

  return (
    <ResponsiveGridLayout
      className="metric-grid-layout"
      layouts={{ lg: layout }}
      breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
      cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
      rowHeight={80}
      dragConfig={editMode ? { handle: ".metric-card-header" } : { enabled: false }}
      resizeConfig={editMode ? {} : { enabled: false }}
      compactor={verticalCompactor}
      margin={[12, 12] as const}
      onLayoutChange={handleLayoutChange}
    >
      {views.map((view) => (
        <div key={view.binding.metricId} data-metric-id={view.binding.metricId}>
          <MetricCard view={view} />
        </div>
      ))}
    </ResponsiveGridLayout>
  );
}
