#!/usr/bin/env python3
"""Seed: Trailing Follow-Up Calls metric + bind to follow-up-calls screen."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "trailing-followup-calls"
NAME = "Trailing Follow-Up Calls"
SCREEN_ID = "follow-up-calls"

# Build initial values from the existing weekly-followup-calls snapshot data
weekly_data = [
    {"weekOf": "2025-11-24", "trailing30": 0},
    {"weekOf": "2025-12-01", "trailing30": 0},
    {"weekOf": "2025-12-08", "trailing30": 0},
    {"weekOf": "2025-12-15", "trailing30": 0},
    {"weekOf": "2025-12-22", "trailing30": 0},
    {"weekOf": "2025-12-29", "trailing30": 0},
    {"weekOf": "2026-01-05", "trailing30": 0},
    {"weekOf": "2026-01-12", "trailing30": 1},
    {"weekOf": "2026-01-19", "trailing30": 1},
    {"weekOf": "2026-01-26", "trailing30": 8},
    {"weekOf": "2026-02-02", "trailing30": 22},
    {"weekOf": "2026-02-09", "trailing30": 44},
    {"weekOf": "2026-02-16", "trailing30": 44},
]

initial_values = json.dumps({
    "trailing30": 44,
    "peak": 44,
    "peakWeek": "2026-02-09",
    "trough": 0,
    "troughWeek": "2025-11-24",
    "total": 44,
    "avgTrailing": 9,
    "weeklyData": weekly_data,
    "byMonth": {"2025-11": 0, "2025-12": 0, "2026-01": 8, "2026-02": 36},
})

instructions = r"""Compute trailing 30-day follow-up call metrics using dependency input from `weekly-followup-calls`. Do not call calendar APIs in this metric.

## Dependency Input
You will receive one dependency input:
1. **weekly-followup-calls** with values like:
   - `weeklyData`: array of `{ weekOf, count }`
   - `currentWeek`, `priorWeek`, `total`, `avgPerWeek`, `trend`
   - optionally richer fields such as `dailyData` (`{ date, count }`) or `followupCalls` (ISO timestamps)

## Computation Steps
1. Locate dependency input where `slug == "weekly-followup-calls"` and read its `values`.
2. Build a trailing-30 weekly series:
   - Preferred: if `followupCalls` or `dailyData` are present, compute exact 30-day windows for each week ending date in chronological order.
   - Fallback: if only `weeklyData` exists, estimate each trailing 30 value as:
     current week + prior 3 full weeks + (2/7 * week-4), rounded to nearest integer.
3. Compute summary metrics from that trailing series:
   - `trailing30`: most recent trailing value
   - `peak`, `peakWeek`: max trailing value and week
   - `trough`, `troughWeek`: min trailing value and week
   - `avgTrailing`: average trailing value
4. Compute total/monthly context:
   - `total`: use dependency `total` if present, else sum of weekly follow-up counts
   - `byMonth`: if daily timestamps exist, aggregate by month exactly; otherwise derive a best-effort monthly rollup from weekly buckets.

## Narrative Context
- Follow-up calls are a leading indicator of account engagement and pipeline progression.
- This metric is calendar-derived through `weekly-followup-calls`, anchored to Michael's ongoing account engagement activity.
- A sustained trailing decline signals relationship or execution gaps.

## Values to Return
- `trailing30`: current trailing 30-day count
- `peak`: highest weekly trailing 30 value
- `peakWeek`: ISO date of peak week
- `trough`: lowest weekly trailing 30 value
- `troughWeek`: ISO date of trough week
- `total`: total follow-up calls in dependency lookback
- `avgTrailing`: average trailing 30 across all weeks
- `weeklyData`: array of { weekOf, trailing30 } for the chart
- `byMonth`: object of month -> count"""

template_jsx = r"""(() => {
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
              <linearGradient id="followupGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.secondary} stopOpacity={0.3} />
                <stop offset="100%" stopColor={theme.secondary} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} interval={2} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: `1px solid ${theme.tooltipBorder}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <ReferenceLine y={avgValue} stroke={theme.line} strokeDasharray="6 4" />
            <Area type="monotone" dataKey="value" stroke={theme.secondary} strokeWidth={2.5} fill="url(#followupGradient)" dot={{ fill: theme.secondary, r: 3, strokeWidth: 0 }} activeDot={{ fill: theme.accentStrong, r: 5, strokeWidth: 2, stroke: theme.line }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Each point = trailing 30-day follow-up calls · Source: Weekly Follow-Up Calls dependency (calendar-derived)</MetricNote>
    </MetricSection>
  );
})()"""

chart_data = json.dumps([
    {"week": w["weekOf"][5:].replace("-", "/"), "value": w["trailing30"]}
    for w in weekly_data
])

initial_html = f"""(() => {{
  const data = {chart_data};
  const current = 44;
  const peak = 44;
  const trough = 0;
  const avgValue = 9;

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
              <linearGradient id="followupGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={{theme.secondary}} stopOpacity={{0.3}} />
                <stop offset="100%" stopColor={{theme.secondary}} stopOpacity={{0.02}} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="week" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} interval={{2}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} domain={{[0, 'auto']}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: `1px solid ${{theme.tooltipBorder}}`, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} />
            <ReferenceLine y={{avgValue}} stroke={{theme.line}} strokeDasharray="6 4" />
            <Area type="monotone" dataKey="value" stroke={{theme.secondary}} strokeWidth={{2.5}} fill="url(#followupGradient)" dot={{{{ fill: theme.secondary, r: 3, strokeWidth: 0 }}}} activeDot={{{{ fill: theme.accentStrong, r: 5, strokeWidth: 2, stroke: theme.line }}}} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Each point = trailing 30-day follow-up calls · Source: Weekly Follow-Up Calls dependency (calendar-derived)</MetricNote>
    </MetricSection>
  );
}})()"""


def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Check if metric already exists
    cursor.execute("SELECT COUNT(*) FROM metric_definitions WHERE slug = ?", (SLUG,))
    if cursor.fetchone()[0] > 0:
        print(f"  SKIP  {SLUG} (already exists)")
        # Still try to bind to screen
        cursor.execute("SELECT id FROM metric_definitions WHERE slug = ?", (SLUG,))
        metric_id = cursor.fetchone()[0]
    else:
        metric_id = str(uuid.uuid4())
        snapshot_id = str(uuid.uuid4())

        cursor.execute(
            """INSERT INTO metric_definitions
               (id, name, slug, instructions, template_html, ttl_seconds, provider, enabled, proactive, metadata_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'claude', 1, 0, ?, ?, ?)""",
            (
                metric_id,
                NAME,
                SLUG,
                instructions,
                template_jsx,
                3600,
                json.dumps({"dependencies": ["weekly-followup-calls"]}),
                NOW,
                NOW,
            ),
        )
        cursor.execute(
            """INSERT INTO metric_snapshots
               (id, metric_id, values_json, rendered_html, status, created_at, completed_at)
               VALUES (?, ?, ?, ?, 'completed', ?, ?)""",
            (snapshot_id, metric_id, initial_values, initial_html, NOW, NOW)
        )
        print(f"  ADD   {SLUG}")

    # Bind to screen if not already bound
    cursor.execute(
        "SELECT COUNT(*) FROM screen_metrics WHERE screen_id = ? AND metric_id = ?",
        (SCREEN_ID, metric_id),
    )
    if cursor.fetchone()[0] > 0:
        print(f"  SKIP  {SLUG} already bound to {SCREEN_ID}")
    else:
        binding_id = str(uuid.uuid4())
        cursor.execute(
            """INSERT INTO screen_metrics
               (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (binding_id, SCREEN_ID, metric_id, 1, "wide", 0, 15, 8, 7),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x7)")

    conn.commit()
    conn.close()
    print("\nDone")


if __name__ == "__main__":
    main()
