import React, { useEffect, useRef, useState } from "react";
import { LiveProvider, LivePreview, LiveError } from "react-live";
import * as Recharts from "recharts";
import { useAppActions } from "../state/appState";
import type { MetricDiagnostics, ScreenMetricView } from "../lib/types";
import { getMetricDiagnostics } from "../lib/tauriClient";
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

// Memoized wrapper: only re-renders when the code string changes.
// This prevents react-live from re-executing the code on every parent re-render,
// which would create new data arrays and cause Recharts to restart its animations.
const MemoizedLiveChart = React.memo(function MemoizedLiveChart({ code }: { code: string }) {
  return (
    <LiveProvider code={code} scope={LIVE_SCOPE} noInline={false}>
      <LivePreview />
      <LiveError className="metric-live-error" />
    </LiveProvider>
  );
});

function formatDuration(secs: number | null): string {
  if (secs == null) return "\u2014";
  if (secs < 1) return `${Math.round(secs * 1000)}ms`;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

function ProgressBar({ elapsed, expected, label }: { elapsed: number; expected: number; label: string }) {
  const pct = Math.min((elapsed / expected) * 100, 100);
  const overrun = elapsed > expected;
  return (
    <div className="refresh-progress-row">
      <div className="refresh-progress-track">
        <div
          className={`refresh-progress-fill${overrun ? " overrun" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="refresh-progress-label">
        {formatDuration(elapsed)} / ~{formatDuration(expected)} <span className="refresh-progress-tag">{label}</span>
      </span>
    </div>
  );
}

function RefreshProgressBars({ startedAt, diagnostics }: { startedAt: string; diagnostics: MetricDiagnostics | null }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, (Date.now() - new Date(startedAt).valueOf()) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - new Date(startedAt).valueOf()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!diagnostics || (diagnostics.lastRunDurationSecs == null && diagnostics.avgRunDurationSecs == null)) {
    return null;
  }

  return (
    <div className="refresh-progress">
      {diagnostics.lastRunDurationSecs != null && (
        <ProgressBar elapsed={elapsed} expected={diagnostics.lastRunDurationSecs} label="last" />
      )}
      {diagnostics.avgRunDurationSecs != null && (
        <ProgressBar elapsed={elapsed} expected={diagnostics.avgRunDurationSecs} label="avg" />
      )}
    </div>
  );
}

function DiagnosticsPanel({ data }: { data: MetricDiagnostics | null }) {
  if (!data) return <div className="diag-loading">Loading diagnostics\u2026</div>;
  if (data.totalRuns === 0) return <div className="diag-loading">No diagnostic data available</div>;

  return (
    <div className="diag-panel">
      <div className="diag-section">
        <span className="diag-label">Last run</span>
        <span className="diag-value">{formatDuration(data.lastRunDurationSecs)}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Avg run</span>
        <span className="diag-value">{formatDuration(data.avgRunDurationSecs)}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Min</span>
        <span className="diag-value">{formatDuration(data.minRunDurationSecs)}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Max</span>
        <span className="diag-value">{formatDuration(data.maxRunDurationSecs)}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Success rate</span>
        <span className="diag-value">{data.successRate.toFixed(0)}% ({data.completedRuns}/{data.totalRuns})</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">TTL</span>
        <span className="diag-value">{formatDuration(data.ttlSeconds)}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Next refresh</span>
        <span className="diag-value">{data.nextRefreshAt ? formatTimeAgo(data.nextRefreshAt) : "\u2014"}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Provider</span>
        <span className="diag-value">{data.provider}{data.model ? ` / ${data.model}` : ""}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Status</span>
        <span className="diag-value">{data.currentStatus ?? "\u2014"}</span>
      </div>
      {data.lastError && (
        <div className="diag-error">
          <span className="diag-label">Last error</span>
          <span className="diag-value">{data.lastError}</span>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  view: ScreenMetricView;
  onRemove?: () => void;
}

export function MetricCard({ view, onRemove }: MetricCardProps): JSX.Element {
  const actions = useAppActions();
  const { definition, latestSnapshot, isStale, refreshInProgress } = view;
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MetricDiagnostics | null>(null);
  const prevRefreshing = useRef(false);

  // Fetch diagnostics when refresh starts so we have timing data for progress bars
  useEffect(() => {
    if (refreshInProgress && !prevRefreshing.current) {
      void getMetricDiagnostics(definition.id).then(setDiagnostics);
    }
    prevRefreshing.current = refreshInProgress;
  }, [refreshInProgress, definition.id]);

  const lastRefreshLabel = latestSnapshot?.completedAt
    ? formatTimeAgo(latestSnapshot.completedAt)
    : "never";

  const handleRefresh = () => {
    void actions.refreshMetric(definition.id);
  };

  const handleToggleDiagnostics = () => {
    if (!showDiagnostics) {
      setDiagnostics(null);
      void getMetricDiagnostics(definition.id).then(setDiagnostics);
    }
    setShowDiagnostics((v) => !v);
  };

  const diagButton = (
    <button
      type="button"
      className={`metric-diag-btn${showDiagnostics ? " active" : ""}`}
      onClick={handleToggleDiagnostics}
      title="Diagnostics"
    >
      {"\u2139"}
    </button>
  );

  if (refreshInProgress) {
    return (
      <div className="metric-card metric-loading">
        <div className="metric-card-header">
          <strong>{definition.name}</strong>
          <small className="metric-card-time">refreshing...</small>
        </div>
        <div className="metric-card-body">
          {latestSnapshot?.createdAt && diagnostics ? (
            <RefreshProgressBars startedAt={latestSnapshot.createdAt} diagnostics={diagnostics} />
          ) : null}
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
          <span className="metric-card-meta">
            {diagButton}
            <button type="button" className="metric-refresh-btn" onClick={handleRefresh}>
              Retry
            </button>
          </span>
        </div>
        <div className="metric-card-body">
          {showDiagnostics ? (
            <DiagnosticsPanel data={diagnostics} />
          ) : (
            <p className="metric-error-message">
              {latestSnapshot.errorMessage ?? "Metric refresh failed"}
            </p>
          )}
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
          {diagButton}
          <button type="button" className="metric-refresh-btn" onClick={handleRefresh} title="Refresh">
            {"\u21BB"}
          </button>
        </span>
      </div>
      <div className="metric-card-body">
        {showDiagnostics ? (
          <DiagnosticsPanel data={diagnostics} />
        ) : (
          <MemoizedLiveChart code={latestSnapshot.renderedHtml} />
        )}
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
