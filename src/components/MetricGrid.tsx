import { lazy, Suspense } from "react";
import type { ScreenMetricView } from "../lib/types";

const MetricCard = lazy(() =>
  import("./MetricCard").then((m) => ({ default: m.MetricCard }))
);

interface MetricGridProps {
  views: ScreenMetricView[];
}

export function MetricGrid({ views }: MetricGridProps): JSX.Element {
  if (views.length === 0) {
    return <></>;
  }

  return (
    <div className="metric-grid">
      <Suspense fallback={null}>
        {views.map((view) => (
          <MetricCard key={view.binding.id} view={view} />
        ))}
      </Suspense>
    </div>
  );
}
