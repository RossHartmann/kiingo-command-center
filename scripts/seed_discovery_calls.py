#!/usr/bin/env python3
"""Seed: Trailing Discovery Calls + Discovery Call Summary (dependent metric)."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

metrics = []

# ═══════════════════════════════════════════════════════════════════════
# 1. Trailing Discovery Calls (independent — queries HubSpot)
# ═══════════════════════════════════════════════════════════════════════

weekly_data = [
    {"weekOf": "2025-10-05", "trailing30": 5},
    {"weekOf": "2025-10-12", "trailing30": 8},
    {"weekOf": "2025-10-19", "trailing30": 12},
    {"weekOf": "2025-10-26", "trailing30": 14},
    {"weekOf": "2025-11-02", "trailing30": 16},
    {"weekOf": "2025-11-09", "trailing30": 15},
    {"weekOf": "2025-11-16", "trailing30": 18},
    {"weekOf": "2025-11-23", "trailing30": 17},
    {"weekOf": "2025-11-30", "trailing30": 14},
    {"weekOf": "2025-12-07", "trailing30": 13},
    {"weekOf": "2025-12-14", "trailing30": 11},
    {"weekOf": "2025-12-21", "trailing30": 8},
    {"weekOf": "2025-12-28", "trailing30": 6},
    {"weekOf": "2026-01-04", "trailing30": 5},
    {"weekOf": "2026-01-11", "trailing30": 7},
    {"weekOf": "2026-01-18", "trailing30": 11},
    {"weekOf": "2026-01-25", "trailing30": 15},
    {"weekOf": "2026-02-01", "trailing30": 19},
    {"weekOf": "2026-02-08", "trailing30": 22},
]

initial_values_1 = json.dumps({
    "trailing30": 22,
    "peak": 18,
    "peakWeek": "2025-11-16",
    "trough": 5,
    "troughWeek": "2026-01-04",
    "total": 89,
    "avgTrailing": 13,
    "weeklyData": weekly_data,
    "byMonth": {"2025-10": 18, "2025-11": 22, "2025-12": 14, "2026-01": 17, "2026-02": 18},
})

metrics.append({
    "slug": "trailing-discovery-calls",
    "name": "Trailing Discovery Calls",
    "screen_id": "pipeline",
    "instructions": r"""Retrieve HubSpot deals that entered the Discovery Call stage and compute the trailing 30-day discovery call count measured weekly.

## Data Source
HubSpot Deals via Kiingo MCP `hubspot.searchAllDeals()` and `hubspot.listPipelineStages()`.

## Retrieval Steps
1. Confirm the Discovery Call stage ID: call `hubspot.listPipelineStages({ pipelineId: 'default' })` and find the stage labeled "Discovery Call" (expected ID: `appointmentscheduled`). Also check upsell pipelines ('798580396', '796136972') for their discovery stages.
2. Search all deals that have entered Discovery Call: `hubspot.searchAllDeals({ filters: [{ propertyName: 'hs_date_entered_appointmentscheduled', operator: 'HAS_PROPERTY' }], properties: ['dealname', 'hs_date_entered_appointmentscheduled', 'amount', 'dealstage', 'pipeline'] })`.
3. Parse `hs_date_entered_appointmentscheduled` as the date each deal entered discovery. Sort ascending.
4. Compute trailing 30-day count for each week starting from the first full Sunday after the earliest entry:
   - For each week-ending date, count deals whose `hs_date_entered_appointmentscheduled` falls in the 30-day window ending on that date.
5. Also compute: current trailing 30 count (from today), by-month breakdown, peak/trough/average.

## Narrative Context
- Discovery calls are the top of the active sales funnel — a leading indicator of pipeline health.
- A sustained drop in trailing discovery calls signals future pipeline problems 60-90 days out.
- Holiday dips (mid-Dec through early Jan) are expected.
- Include both New Business and Upsell pipeline discovery stages if present.

## Values to Return
- `trailing30`: current trailing 30-day count
- `peak`: highest weekly trailing 30 value and which week
- `peakWeek`: ISO date of peak week
- `trough`: lowest weekly trailing 30 value (excluding ramp-up) and which week
- `troughWeek`: ISO date of trough week
- `total`: total discovery calls all-time
- `avgTrailing`: average trailing 30 across all weeks
- `weeklyData`: array of { weekOf, trailing30 } for the chart
- `byMonth`: object of month -> count""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const current = CURRENT_PLACEHOLDER;
  const peak = PEAK_PLACEHOLDER;
  const trough = TROUGH_PLACEHOLDER;
  const avgValue = AVG_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Current" value={current} subtitle="Trailing 30d" />
        <StatCard label="Peak" value={peak} subtitle="Best week" />
        <StatCard label="Trough" value={trough} subtitle="Lowest week" />
      </MetricRow>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${theme.line}` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="discoveryGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.secondary} stopOpacity={0.3} />
                <stop offset="100%" stopColor={theme.secondary} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} interval={2} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <ReferenceLine y={avgValue} stroke={theme.line} strokeDasharray="6 4" />
            <Area type="monotone" dataKey="value" stroke={theme.secondary} strokeWidth={2.5} fill="url(#discoveryGradient)" dot={{ fill: theme.secondary, r: 3, strokeWidth: 0 }} activeDot={{ fill: theme.accentStrong, r: 5, strokeWidth: 2, stroke: theme.line }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Each point = trailing 30-day discovery calls · Source: HubSpot CRM via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": initial_values_1,
    "initial_html": f"""(() => {{
  const data = {json.dumps([{"week": w["weekOf"][5:].replace("-", "/"), "value": w["trailing30"]} for w in weekly_data])};
  const current = 22;
  const peak = 18;
  const trough = 5;
  const avgValue = 13;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Current" value={{current}} subtitle="Trailing 30d" />
        <StatCard label="Peak" value={{peak}} subtitle="Best week" />
        <StatCard label="Trough" value={{trough}} subtitle="Lowest week" />
      </MetricRow>
      <div style={{{{ height: 320, background: theme.panel, borderRadius: 16, padding: 20, border: `1px solid ${{theme.line}}` }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <defs>
              <linearGradient id="discoveryGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={{theme.secondary}} stopOpacity={{0.3}} />
                <stop offset="100%" stopColor={{theme.secondary}} stopOpacity={{0.02}} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="week" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} interval={{2}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} domain={{[0, 'auto']}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: `1px solid ${{theme.tooltipBorder}}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} />
            <ReferenceLine y={{avgValue}} stroke={{theme.line}} strokeDasharray="6 4" />
            <Area type="monotone" dataKey="value" stroke={{theme.secondary}} strokeWidth={{2.5}} fill="url(#discoveryGradient)" dot={{{{ fill: theme.secondary, r: 3, strokeWidth: 0 }}}} activeDot={{{{ fill: theme.accentStrong, r: 5, strokeWidth: 2, stroke: theme.line }}}} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Each point = trailing 30-day discovery calls · Source: HubSpot CRM via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 3600,
    "position": 3,
    "layout_hint": "wide",
    "grid_w": 8,
    "grid_h": 7,
    "grid_x": 0,
    "grid_y": 18,
    "metadata_json": "{}",
})


# ═══════════════════════════════════════════════════════════════════════
# 2. Discovery Call Summary (depends on trailing-discovery-calls + sales-pipeline-value)
# ═══════════════════════════════════════════════════════════════════════

initial_values_2 = json.dumps({
    "currentTrailing30": 22,
    "priorTrailing30": 15,
    "trendDirection": "up",
    "trendPct": 46.7,
    "currentInStage": 24,
    "currentInStageValue": 32850,
    "proposalCount": 80,
    "conversionRate": 30.0,
})

metrics.append({
    "slug": "discovery-call-summary",
    "name": "Discovery Call Summary",
    "screen_id": "pipeline",
    "instructions": r"""Synthesize a CEO-level discovery call health summary from upstream dependency data. DO NOT call any HubSpot APIs — all data comes from dependency inputs.

## Dependency Inputs
You will receive two dependency inputs:
1. **trailing-discovery-calls**: contains `trailing30` (current trailing 30-day count), `weeklyData` (time series), `peak`, `trough`, `avgTrailing`, `byMonth`
2. **sales-pipeline-value**: contains `byStage` (array of { stage, count, amount, weighted }) with current pipeline snapshot

## Computation Steps
1. From `trailing-discovery-calls`:
   - `currentTrailing30`: the `trailing30` value
   - `priorTrailing30`: compute by looking at `weeklyData` 4 weeks ago
   - `trendDirection`: "up" if current > prior, "down" if current < prior, "flat" if equal
   - `trendPct`: percentage change from prior to current
2. From `sales-pipeline-value`:
   - `currentInStage`: find the "Discovery Call" entry in `byStage`, take its `count`
   - `currentInStageValue`: same entry's `amount`
   - `proposalCount`: find the "Proposal Sent" entry in `byStage`, take its `count`
   - `conversionRate`: (`proposalCount` / (`currentInStage` + `proposalCount`)) * 100 — approximation of discovery-to-proposal flow

## Values to Return
- `currentTrailing30`: current trailing 30-day discovery call count
- `priorTrailing30`: trailing 30-day count from 4 weeks ago
- `trendDirection`: "up", "down", or "flat"
- `trendPct`: percentage change
- `currentInStage`: deals currently in Discovery Call stage
- `currentInStageValue`: dollar value of deals in Discovery Call
- `proposalCount`: deals currently in Proposal Sent stage
- `conversionRate`: discovery-to-proposal conversion rate""",
    "template_jsx": r"""(() => {
  const trailing = TRAILING_PLACEHOLDER;
  const trend = TREND_PLACEHOLDER;
  const trendPct = TREND_PCT_PLACEHOLDER;
  const inStage = IN_STAGE_PLACEHOLDER;
  const stageValue = STAGE_VALUE_PLACEHOLDER;
  const conversion = CONVERSION_PLACEHOLDER;

  const trendArrow = trend === 'up' ? '\u2191' : trend === 'down' ? '\u2193' : '\u2192';
  const trendColor = trend === 'up' ? theme.success : trend === 'down' ? theme.danger : theme.inkMuted;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Trailing 30d" value={trailing} subtitle={trendArrow + ' ' + trendPct.toFixed(0) + '% vs prior'} trendDirection={trend} />
        <StatCard label="In Discovery Now" value={inStage} subtitle={'$' + (stageValue / 1000).toFixed(0) + 'K value'} />
        <StatCard label="Discovery \u2192 Proposal" value={conversion.toFixed(0) + '%'} subtitle="Conversion rate" />
      </MetricRow>
      <MetricNote>Synthesized from pipeline + trailing discovery data · No additional API calls</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": initial_values_2,
    "initial_html": f"""(() => {{
  const trailing = 22;
  const trend = 'up';
  const trendPct = 46.7;
  const inStage = 24;
  const stageValue = 32850;
  const conversion = 30.0;

  const trendArrow = trend === 'up' ? '\\u2191' : trend === 'down' ? '\\u2193' : '\\u2192';

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Trailing 30d" value={{trailing}} subtitle={{trendArrow + ' ' + trendPct.toFixed(0) + '% vs prior'}} trendDirection={{trend}} />
        <StatCard label="In Discovery Now" value={{inStage}} subtitle={{'$' + (stageValue / 1000).toFixed(0) + 'K value'}} />
        <StatCard label="Discovery \\u2192 Proposal" value={{conversion.toFixed(0) + '%'}} subtitle="Conversion rate" />
      </MetricRow>
      <MetricNote>Synthesized from pipeline + trailing discovery data · No additional API calls</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 3600,
    "position": 4,
    "layout_hint": "wide",
    "grid_w": 8,
    "grid_h": 4,
    "grid_x": 0,
    "grid_y": 25,
    "metadata_json": json.dumps({"dependencies": ["trailing-discovery-calls", "sales-pipeline-value"]}),
})


def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    inserted = 0
    skipped = 0

    for m in metrics:
        slug = m["slug"]
        cursor.execute("SELECT COUNT(*) FROM metric_definitions WHERE slug = ?", (slug,))
        if cursor.fetchone()[0] > 0:
            print(f"  SKIP  {slug} (already exists)")
            skipped += 1
            continue

        metric_id = str(uuid.uuid4())
        snapshot_id = str(uuid.uuid4())
        binding_id = str(uuid.uuid4())

        cursor.execute(
            """INSERT INTO metric_definitions
               (id, name, slug, instructions, template_html, ttl_seconds, provider, enabled, proactive, metadata_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'claude', 1, 0, ?, ?, ?)""",
            (metric_id, m["name"], slug, m["instructions"], m["template_jsx"], m["ttl"], m["metadata_json"], NOW, NOW)
        )
        cursor.execute(
            """INSERT INTO metric_snapshots
               (id, metric_id, values_json, rendered_html, status, created_at, completed_at)
               VALUES (?, ?, ?, ?, 'completed', ?, ?)""",
            (snapshot_id, metric_id, m["initial_values"], m["initial_html"], NOW, NOW)
        )
        cursor.execute(
            """INSERT INTO screen_metrics
               (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (binding_id, m["screen_id"], metric_id, m["position"], m["layout_hint"],
             m.get("grid_x", -1), m["grid_y"], m["grid_w"], m["grid_h"])
        )
        print(f"  ADD   {slug} -> {m['screen_id']} ({m['grid_w']}x{m['grid_h']})")
        inserted += 1

    conn.commit()
    conn.close()
    print(f"\nDone: {inserted} new metrics, {skipped} skipped")


if __name__ == "__main__":
    main()
