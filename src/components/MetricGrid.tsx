import { MetricCard } from "./MetricCard";
import type { ScreenMetricView } from "../lib/types";

interface MetricGridProps {
  views: ScreenMetricView[];
}

export function MetricGrid({ views }: MetricGridProps): JSX.Element {
  if (views.length === 0) {
    return <></>;
  }

  return (
    <div className="metric-grid">
      {views.map((view) => (
        <MetricCard key={view.binding.id} view={view} />
      ))}
    </div>
  );
}
