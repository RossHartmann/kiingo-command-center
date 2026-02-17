import React, { useEffect, useRef, useState } from "react";
import { LiveProvider, LivePreview, LiveError } from "react-live";
import * as Recharts from "recharts";
import { useAppActions, useAppState } from "../state/appState";
import type { MetricDefinition, MetricDiagnostics, SaveMetricDefinitionPayload, ScreenMetricView } from "../lib/types";
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

function hasTimingBaseline(secs: number | null | undefined): secs is number {
  return secs != null && secs > 0.01;
}

function RefreshOverlay({ startTime, diagnostics }: { startTime: number; diagnostics: MetricDiagnostics | null }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, (Date.now() - startTime) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const hasLastBaseline = hasTimingBaseline(diagnostics?.lastRunDurationSecs);
  const hasAvgBaseline = hasTimingBaseline(diagnostics?.avgRunDurationSecs);
  const hasTimings = hasLastBaseline || hasAvgBaseline;
  const baselines: number[] = [];
  if (hasLastBaseline) baselines.push(diagnostics!.lastRunDurationSecs!);
  if (hasAvgBaseline) baselines.push(diagnostics!.avgRunDurationSecs!);

  const shorterBaseline = baselines.length > 0 ? Math.min(...baselines) : null;
  const longerBaseline = baselines.length > 0 ? Math.max(...baselines) : null;
  const activeBaseline = shorterBaseline == null
    ? null
    : longerBaseline != null && elapsed > shorterBaseline
      ? longerBaseline
      : shorterBaseline;
  const primaryPct = activeBaseline != null ? Math.min((elapsed / activeBaseline) * 100, 100) : null;
  const overrun = longerBaseline != null && elapsed > longerBaseline;

  return (
    <div className="refresh-overlay">
      <div className="refresh-overlay-top">
        <div className="refresh-pulse" />
        {primaryPct != null ? (
          <span className={`refresh-pct${overrun ? " overrun" : ""}`}>
            {overrun ? "100" : Math.round(primaryPct)}%
          </span>
        ) : (
          <span className="refresh-pct">{"\u2026"}</span>
        )}
        <span className="refresh-elapsed">{formatDuration(elapsed)} elapsed</span>
      </div>
      {!hasTimings && (
        <div className="refresh-timing-note">No successful timing baseline yet</div>
      )}
      {hasTimings && (
        <div className="refresh-bars">
          {hasLastBaseline && (
            <div className="refresh-bar-row">
              <div className="refresh-bar-head">
                <span className="refresh-bar-tag">last run</span>
                <span className="refresh-bar-est">~{formatDuration(diagnostics!.lastRunDurationSecs)}</span>
              </div>
              <div className="refresh-bar-track">
                <div
                  className={`refresh-bar-fill${elapsed > diagnostics!.lastRunDurationSecs! ? " overrun" : ""}`}
                  style={{ width: `${Math.min((elapsed / diagnostics!.lastRunDurationSecs!) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
          {hasAvgBaseline && (
            <div className="refresh-bar-row">
              <div className="refresh-bar-head">
                <span className="refresh-bar-tag">avg run</span>
                <span className="refresh-bar-est">~{formatDuration(diagnostics!.avgRunDurationSecs)}</span>
              </div>
              <div className="refresh-bar-track">
                <div
                  className={`refresh-bar-fill${elapsed > diagnostics!.avgRunDurationSecs! ? " overrun" : ""}`}
                  style={{ width: `${Math.min((elapsed / diagnostics!.avgRunDurationSecs!) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DependencyWaitProgress({
  dependencyName,
  startTime,
  diagnostics,
}: {
  dependencyName: string;
  startTime: number;
  diagnostics: MetricDiagnostics | null;
}) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, (Date.now() - startTime) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.max(0, (Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const hasLastBaseline = hasTimingBaseline(diagnostics?.lastRunDurationSecs);
  const hasAvgBaseline = hasTimingBaseline(diagnostics?.avgRunDurationSecs);
  const expected = hasLastBaseline
    ? diagnostics!.lastRunDurationSecs
    : hasAvgBaseline
      ? diagnostics!.avgRunDurationSecs
      : null;
  const pct = expected != null ? Math.min((elapsed / expected) * 100, 100) : null;
  const overrun = expected != null && elapsed > expected;

  return (
    <div className="metric-dependency-progress">
      <div className="metric-dependency-progress-head">
        <span className="metric-dependency-progress-label">
          <span className="metric-refresh-spinner" aria-hidden="true" />
          {`Waiting on dependency metric ${dependencyName}`}
        </span>
        <span className="metric-dependency-progress-time">{formatDuration(elapsed)}</span>
      </div>
      {pct != null ? (
        <div className="metric-dependency-progress-track">
          <div
            className={`metric-dependency-progress-fill${overrun ? " overrun" : ""}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <div className="metric-dependency-progress-note">Estimating runtime\u2026</div>
      )}
      <div className="metric-dependency-progress-note">
        {`This metric depends on ${dependencyName} and will continue when it finishes.`}
      </div>
    </div>
  );
}

function MetricFlipPanel({
  showBack,
  front,
  back,
}: {
  showBack: boolean;
  front: React.ReactNode;
  back: React.ReactNode;
}) {
  return (
    <div className={`metric-flip${showBack ? " is-flipped" : ""}`}>
      <div className="metric-flip-inner">
        <div className="metric-flip-face metric-flip-front">{front}</div>
        <div className="metric-flip-face metric-flip-back">{back}</div>
      </div>
    </div>
  );
}

function DiagnosticsPanel({ data }: { data: MetricDiagnostics | null }) {
  if (!data) return <div className="diag-loading">Loading diagnostics\u2026</div>;
  if (data.totalRuns === 0) return <div className="diag-loading">No refresh history yet</div>;
  const hasSuccessfulRun = data.completedRuns > 0;

  return (
    <div className="diag-panel">
      <div className="diag-section">
        <span className="diag-label">Last run</span>
        <span className="diag-value">{hasSuccessfulRun ? formatDuration(data.lastRunDurationSecs) : "No successful run yet"}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Avg run</span>
        <span className="diag-value">{hasSuccessfulRun ? formatDuration(data.avgRunDurationSecs) : "\u2014"}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Min</span>
        <span className="diag-value">{hasSuccessfulRun ? formatDuration(data.minRunDurationSecs) : "\u2014"}</span>
      </div>
      <div className="diag-section">
        <span className="diag-label">Max</span>
        <span className="diag-value">{hasSuccessfulRun ? formatDuration(data.maxRunDurationSecs) : "\u2014"}</span>
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

function DiagnosticsBackPanel({
  metricId,
  definition,
  diagnostics,
  ttlDraft,
  ttlSaveState,
  ttlSaveMessage,
  onTtlDraftChange,
  onSaveTtl,
}: {
  metricId: string;
  definition: MetricDefinition;
  diagnostics: MetricDiagnostics | null;
  ttlDraft: string;
  ttlSaveState: "idle" | "saving" | "saved" | "error";
  ttlSaveMessage: string | null;
  onTtlDraftChange: (next: string) => void;
  onSaveTtl: () => void;
}) {
  const parsedTtl = Number(ttlDraft);
  const ttlInvalid = !Number.isFinite(parsedTtl) || parsedTtl < 1;
  const ttlChanged = Math.round(parsedTtl) !== definition.ttlSeconds;

  return (
    <div className="metric-diagnostics-back">
      <p className="metric-back-cue">Tap the info icon again to return to the metric.</p>
      <DiagnosticsPanel data={diagnostics} />
      <div className="metric-instructions-panel">
        <span className="metric-instructions-label">Model instructions</span>
        <pre className="metric-instructions-text">
          {definition.instructions?.trim() ? definition.instructions : "No instructions configured."}
        </pre>
      </div>
      <div className="metric-ttl-editor">
        <label htmlFor={`metric-ttl-${metricId}`} className="metric-ttl-label">TTL (seconds)</label>
        <div className="metric-ttl-controls">
          <input
            id={`metric-ttl-${metricId}`}
            type="number"
            min={1}
            step={1}
            value={ttlDraft}
            onChange={(event) => onTtlDraftChange(event.target.value)}
          />
          <button
            type="button"
            className="metric-refresh-btn"
            onClick={onSaveTtl}
            disabled={ttlInvalid || !ttlChanged || ttlSaveState === "saving"}
          >
            {ttlSaveState === "saving" ? "Saving…" : "Save TTL"}
          </button>
        </div>
        {ttlInvalid && <p className="metric-ttl-message error">TTL must be at least 1 second.</p>}
        {!ttlInvalid && ttlSaveState === "saved" && ttlSaveMessage && (
          <p className="metric-ttl-message success">{ttlSaveMessage}</p>
        )}
        {!ttlInvalid && ttlSaveState === "error" && ttlSaveMessage && (
          <p className="metric-ttl-message error">{ttlSaveMessage}</p>
        )}
      </div>
    </div>
  );
}

interface MetricCardProps {
  view: ScreenMetricView;
  onRemove?: () => void;
}

export function MetricCard({ view, onRemove }: MetricCardProps): JSX.Element {
  const actions = useAppActions();
  const state = useAppState();
  const { definition, latestSnapshot, inflightSnapshot, isStale, refreshInProgress } = view;
  const refreshError = state.metricRefreshErrors[definition.id];
  const [refreshRequestState, setRefreshRequestState] = useState<"idle" | "submitting" | "queued" | "error">("idle");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MetricDiagnostics | null>(null);
  const [dependencyDiagnostics, setDependencyDiagnostics] = useState<MetricDiagnostics | null>(null);
  const [dependencyWaitStartTime, setDependencyWaitStartTime] = useState<number | null>(null);
  const [ttlDraft, setTtlDraft] = useState<string>(() => String(Math.max(1, definition.ttlSeconds)));
  const [ttlSaveState, setTtlSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [ttlSaveMessage, setTtlSaveMessage] = useState<string | null>(null);
  const prevRefreshing = useRef(false);
  const refreshStartedAtMs = parseIsoToMs(inflightSnapshot?.createdAt ?? latestSnapshot?.createdAt);

  // Fetch diagnostics when refresh begins.
  useEffect(() => {
    if (refreshInProgress && !prevRefreshing.current) {
      setRefreshRequestState("idle");
      void getMetricDiagnostics(definition.id).then(setDiagnostics);
    }
    prevRefreshing.current = refreshInProgress;
  }, [refreshInProgress, definition.id]);

  useEffect(() => {
    if (!refreshRequestState || refreshRequestState === "idle" || refreshRequestState === "submitting") return;
    const timer = window.setTimeout(() => setRefreshRequestState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [refreshRequestState]);

  useEffect(() => {
    setTtlDraft(String(Math.max(1, definition.ttlSeconds)));
    setTtlSaveState("idle");
    setTtlSaveMessage(null);
  }, [definition.id, definition.ttlSeconds]);

  const lastRefreshLabel = latestSnapshot?.completedAt
    ? formatTimeAgo(latestSnapshot.completedAt)
    : "never";

  const handleRefresh = () => {
    if (refreshInProgress) {
      setRefreshRequestState("queued");
      return;
    }
    if (refreshRequestState === "submitting") return;
    setRefreshRequestState("submitting");
    void actions
      .refreshMetric(definition.id)
      .then(() => {
        // Acknowledge click immediately; card will switch to overlay once views reload.
        setRefreshRequestState("queued");
      })
      .catch(() => {
        setRefreshRequestState("error");
      });
  };

  const retryLabel = refreshRequestState === "submitting"
    ? "Working\u2026"
    : refreshRequestState === "queued"
      ? "Queued"
      : refreshRequestState === "error"
        ? "Retry failed"
        : "Retry";
  const refreshButtonLabel = refreshRequestState === "submitting"
    ? "Working\u2026"
    : refreshRequestState === "queued"
      ? "Queued"
      : refreshRequestState === "error"
        ? "Retry failed"
        : "\u21BB";
  const dependencyRefs = Array.isArray(definition.metadataJson?.dependencies)
    ? definition.metadataJson.dependencies.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const primaryDependencyDefinition = dependencyRefs
    .map((reference) => state.metricDefinitions.find((metric) => metric.id === reference || metric.slug === reference))
    .find((metric): metric is (typeof state.metricDefinitions)[number] => Boolean(metric));
  const dependencyHint = dependencyRefs.length > 0
    ? `Waiting on dependency metric ${dependencyRefs.join(", ")}. This metric will continue after it completes\u2026`
    : "Submitting retry\u2026";

  useEffect(() => {
    if (refreshRequestState !== "submitting" || !primaryDependencyDefinition) {
      setDependencyDiagnostics(null);
      setDependencyWaitStartTime(null);
      return;
    }

    setDependencyWaitStartTime((existing) => existing ?? Date.now());
    let canceled = false;

    const loadDependencyDiagnostics = async () => {
      try {
        const result = await getMetricDiagnostics(primaryDependencyDefinition.id);
        if (!canceled) setDependencyDiagnostics(result);
      } catch {
        if (!canceled) setDependencyDiagnostics(null);
      }
    };

    void loadDependencyDiagnostics();
    const intervalId = window.setInterval(() => {
      void loadDependencyDiagnostics();
    }, 2500);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
    };
  }, [refreshRequestState, primaryDependencyDefinition]);

  const handleToggleDiagnostics = () => {
    if (!showDiagnostics) {
      setDiagnostics(null);
      void getMetricDiagnostics(definition.id).then(setDiagnostics);
    }
    setShowDiagnostics((v) => !v);
  };

  const handleSaveTtl = () => {
    const parsed = Number(ttlDraft);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setTtlSaveState("error");
      setTtlSaveMessage("TTL must be at least 1 second.");
      return;
    }

    const ttlSeconds = Math.round(parsed);
    if (ttlSeconds === definition.ttlSeconds) {
      setTtlSaveState("idle");
      setTtlSaveMessage(null);
      return;
    }

    const payload: SaveMetricDefinitionPayload = {
      id: definition.id,
      name: definition.name,
      slug: definition.slug,
      instructions: definition.instructions,
      templateHtml: definition.templateHtml,
      ttlSeconds,
      provider: definition.provider,
      model: definition.model,
      profileId: definition.profileId,
      cwd: definition.cwd,
      enabled: definition.enabled,
      proactive: definition.proactive,
      metadataJson: definition.metadataJson,
    };

    setTtlSaveState("saving");
    setTtlSaveMessage(null);
    void actions.saveMetricDefinition(payload)
      .then(async () => {
        await actions.loadScreenMetrics(view.binding.screenId);
        const diag = await getMetricDiagnostics(definition.id);
        setDiagnostics(diag);
        setTtlSaveState("saved");
        setTtlSaveMessage("TTL updated.");
      })
      .catch((error: unknown) => {
        setTtlSaveState("error");
        setTtlSaveMessage(error instanceof Error ? error.message : "Failed to update TTL.");
      });
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

  const diagnosticsBack = (
    <DiagnosticsBackPanel
      metricId={definition.id}
      definition={definition}
      diagnostics={diagnostics}
      ttlDraft={ttlDraft}
      ttlSaveState={ttlSaveState}
      ttlSaveMessage={ttlSaveMessage}
      onTtlDraftChange={(next) => {
        setTtlDraft(next);
        if (ttlSaveState !== "idle") {
          setTtlSaveState("idle");
          setTtlSaveMessage(null);
        }
      }}
      onSaveTtl={handleSaveTtl}
    />
  );

  if (refreshInProgress) {
    return (
      <div className="metric-card metric-refreshing">
        <div className="metric-card-header">
          <strong>{definition.name}</strong>
          <small className="metric-card-time">refreshing\u2026</small>
        </div>
        <div className="metric-card-body">
          <RefreshOverlay
            startTime={refreshStartedAtMs ?? Date.now()}
            diagnostics={diagnostics}
          />
        </div>
      </div>
    );
  }

  if (latestSnapshot?.status === "failed") {
    return (
      <div className={`metric-card metric-error metric-flippable${showDiagnostics ? " metric-showing-back" : ""}`}>
        <div className="metric-card-header">
          <strong>{definition.name}</strong>
          <span className="metric-card-meta">
            {diagButton}
            <button
              type="button"
              className={`metric-refresh-btn${refreshRequestState === "submitting" ? " is-pending" : ""}${refreshRequestState === "queued" ? " is-queued" : ""}${refreshRequestState === "error" ? " is-error" : ""}`}
              onClick={handleRefresh}
              disabled={refreshRequestState === "submitting"}
            >
              {refreshRequestState === "submitting" && (
                <span className="metric-refresh-spinner" aria-hidden="true" />
              )}
              {retryLabel}
            </button>
          </span>
        </div>
        <div className="metric-card-body">
          <MetricFlipPanel
            showBack={showDiagnostics}
            front={(
              <>
                <p className="metric-error-message">
                  {latestSnapshot.errorMessage ?? "Metric refresh failed"}
                </p>
                {refreshError && <p className="metric-error-text">{refreshError}</p>}
                {refreshRequestState === "submitting" && (
                  primaryDependencyDefinition && dependencyWaitStartTime ? (
                    <DependencyWaitProgress
                      dependencyName={primaryDependencyDefinition.name}
                      startTime={dependencyWaitStartTime}
                      diagnostics={dependencyDiagnostics}
                    />
                  ) : (
                    <p className="metric-refresh-feedback">
                      <span className="metric-refresh-spinner" aria-hidden="true" />
                      {dependencyHint}
                    </p>
                  )
                )}
                {refreshRequestState === "queued" && (
                  <p className="metric-refresh-feedback">Retry request accepted</p>
                )}
              </>
            )}
            back={diagnosticsBack}
          />
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
          <p className="metric-empty-message">{refreshError ? "Refresh blocked" : "No data yet"}</p>
          {refreshError && <p className="metric-error-text">{refreshError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={`metric-card metric-flippable${isStale ? " metric-stale" : ""}${showDiagnostics ? " metric-showing-back" : ""}`}>
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
          <button
            type="button"
            className={`metric-refresh-btn${refreshRequestState === "submitting" ? " is-pending" : ""}${refreshRequestState === "queued" ? " is-queued" : ""}${refreshRequestState === "error" ? " is-error" : ""}`}
            onClick={handleRefresh}
            title="Refresh"
            disabled={refreshRequestState === "submitting"}
          >
            {refreshRequestState === "submitting" && (
              <span className="metric-refresh-spinner" aria-hidden="true" />
            )}
            {refreshButtonLabel}
          </button>
        </span>
      </div>
      <div className="metric-card-body">
        <MetricFlipPanel
          showBack={showDiagnostics}
          front={(
            <>
              {refreshError && <p className="metric-error-text">{refreshError}</p>}
              <MemoizedLiveChart code={latestSnapshot.renderedHtml} />
            </>
          )}
          back={diagnosticsBack}
        />
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

function parseIsoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const millis = new Date(iso).valueOf();
  return Number.isFinite(millis) ? millis : null;
}
