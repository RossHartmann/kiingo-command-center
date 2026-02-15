import { useState } from "react";
import { LiveProvider, LivePreview, LiveError } from "react-live";
import * as Recharts from "recharts";
import { useAppActions } from "../state/appState";
import type { ScreenMetricView } from "../lib/types";
import { StatCard, MetricSection, MetricRow, MetricText, MetricNote } from "./MetricComponents";

const METRIC_THEME = {
  bg:            "var(--bg)",
  panel:         "var(--panel)",
  ink:           "var(--ink)",
  inkMuted:      "var(--ink-muted)",
  line:          "var(--line)",
  accent:        "var(--accent)",
  accentStrong:  "var(--accent-strong)",
  danger:        "var(--danger)",
  axisStroke:    "var(--ink-muted)",
  gridStroke:    "var(--line)",
  tooltipBg:     "var(--panel)",
  tooltipBorder: "var(--line)",
  tooltipText:   "var(--ink)",
  gradientFrom:  "var(--accent)",
};

const LIVE_SCOPE = {
  ...Recharts,
  useState,
  StatCard,
  MetricSection,
  MetricRow,
  MetricText,
  MetricNote,
  theme: METRIC_THEME,
};

interface MetricCardProps {
  view: ScreenMetricView;
  onRemove?: () => void;
}

export function MetricCard({ view, onRemove }: MetricCardProps): JSX.Element {
  const actions = useAppActions();
  const { definition, latestSnapshot, isStale, refreshInProgress } = view;

  const lastRefreshLabel = latestSnapshot?.completedAt
    ? formatTimeAgo(latestSnapshot.completedAt)
    : "never";

  const handleRefresh = () => {
    void actions.refreshMetric(definition.id);
  };

  if (refreshInProgress) {
    return (
      <div className="metric-card metric-loading">
        <div className="metric-card-header">
          <strong>{definition.name}</strong>
          <small className="metric-card-time">refreshing...</small>
        </div>
        <div className="metric-card-body">
          <div className="metric-shimmer">
            <div className="shimmer-line" />
            <div className="shimmer-line short" />
            <div className="shimmer-line" />
          </div>
        </div>
      </div>
    );
  }

  if (latestSnapshot?.status === "failed") {
    return (
      <div className="metric-card metric-error">
        <div className="metric-card-header">
          <strong>{definition.name}</strong>
          <button type="button" className="metric-refresh-btn" onClick={handleRefresh}>
            Retry
          </button>
        </div>
        <div className="metric-card-body">
          <p className="metric-error-message">
            {latestSnapshot.errorMessage ?? "Metric refresh failed"}
          </p>
        </div>
      </div>
    );
  }

  if (!latestSnapshot || !latestSnapshot.renderedHtml) {
    return (
      <div className="metric-card metric-stale">
        <div className="metric-card-header">
          <strong>{definition.name}</strong>
          <button type="button" className="metric-refresh-btn" onClick={handleRefresh}>
            Load
          </button>
        </div>
        <div className="metric-card-body">
          <p className="metric-empty-message">No data yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`metric-card${isStale ? " metric-stale" : ""}`}>
      {onRemove && (
        <button type="button" className="metric-card-remove" onClick={onRemove} title="Remove widget">
          {"\u2715"}
        </button>
      )}
      <div className="metric-card-header">
        <strong>{definition.name}</strong>
        <span className="metric-card-meta">
          <small className="metric-card-time">{lastRefreshLabel}</small>
          <button type="button" className="metric-refresh-btn" onClick={handleRefresh} title="Refresh">
            {"\u21BB"}
          </button>
        </span>
      </div>
      <div className="metric-card-body">
        <LiveProvider code={latestSnapshot.renderedHtml} scope={LIVE_SCOPE} noInline={false}>
          <LivePreview />
          <LiveError className="metric-live-error" />
        </LiveProvider>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).valueOf()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
