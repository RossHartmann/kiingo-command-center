#!/usr/bin/env python3
"""Seed: Sales Scorecard metric — pulls weekly sales data from Notion Leadership Team scorecard."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "sales-scorecard"
NAME = "Sales Scorecard"
SCREEN_ID = "ceo-dashboard"

instructions = r"""Pull weekly sales metrics from the Sales/Marketing Scorecard table in Notion.

## Data Sources
Notion page: Sales/Marketing Scorecard
Page ID: 2f001bab-c077-8037-bcfa-fd46eacbdc68

## Retrieval Steps
1. Call `notion.listBlockChildren({ blockId: '2f001bab-c077-8037-bcfa-fd46eacbdc68' })` to get page blocks.
2. Find the block with `type: 'table'`. Note its `id`.
3. Call `notion.listBlockChildren({ blockId: <tableId> })` to get all table rows.
4. Skip row index 0 (header) and row index 1 (owner row — cells contain "Sales"/"Marketing").
5. For each remaining row, call `notion.getBlock({ blockId: row.id, includeRaw: true })`.
6. Extract cell text from `raw.table_row.cells[colIndex]` — each cell is an array of rich text objects, join their `plain_text`.

## Column Mapping (0-indexed)
- Col 0: Week (date range string, e.g. "01/12 - 01/16")
- Col 1: # of discovery calls (this week) — integer
- Col 2: # of next steps calls (this week) — integer
- Col 3: $ Opps created total (trailing 4 weeks) — dollar string like "$351,746"
- Col 4: Closed won (prior week) — dollar string like "$83,098"
- Col 5: Close rate (trailing 4 weeks) — percentage string like "45.6%"
- Col 6: Avg. deal size closed (trailing 4 weeks) — string like "$4.0k"

## Parsing Rules
- For dollar values (cols 3, 4): strip "$" and "," then parseFloat. If col 6 contains "k", multiply by 1000.
- For percentages (col 5): strip "%" then parseFloat.
- For integers (cols 1, 2): parseInt, treat empty as 0.
- Extract a short week label from col 0: use just the start date portion (e.g. "01/12 - 01/16" → "1/12").
- Skip rows where col 0 is empty or is the owner row.

## Values to Return
- `weeks`: array of objects, each with:
  - `week`: short label (e.g. "1/12")
  - `discoveryCalls`: number
  - `nextStepsCalls`: number
  - `oppsCreated`: number (dollars)
  - `closedWon`: number (dollars)
  - `closeRate`: number (percentage, e.g. 45.6)
  - `avgDealSize`: number (dollars)
- `latestWeek`: the last row's week label
- `latestDiscovery`: last row's discovery calls
- `latestNextSteps`: last row's next steps calls
- `latestClosedWon`: last row's closed won (dollars)
- `latestCloseRate`: last row's close rate (percentage)
- `latestOpps`: last row's opps created (dollars)
- `latestAvgDeal`: last row's avg deal size (dollars)
- `totalClosedWon`: sum of closedWon across all weeks
"""

template_jsx = r"""(() => {
  const weeks = WEEKS_PLACEHOLDER;
  const latestWeek = LATEST_WEEK_PLACEHOLDER;
  const latestDiscovery = LATEST_DISCOVERY_PLACEHOLDER;
  const latestNextSteps = LATEST_NEXT_STEPS_PLACEHOLDER;
  const latestClosedWon = LATEST_CLOSED_WON_PLACEHOLDER;
  const latestCloseRate = LATEST_CLOSE_RATE_PLACEHOLDER;
  const latestOpps = LATEST_OPPS_PLACEHOLDER;
  const latestAvgDeal = LATEST_AVG_DEAL_PLACEHOLDER;
  const totalClosedWon = TOTAL_CLOSED_WON_PLACEHOLDER;

  const fmt = (n) => '$' + (n || 0).toLocaleString();
  const fmtK = (n) => '$' + ((n || 0) / 1000).toFixed(0) + 'K';

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Discovery Calls'} value={latestDiscovery} subtitle={'Week of ' + latestWeek} />
        <StatCard label={'Next Steps Calls'} value={latestNextSteps} subtitle={'Week of ' + latestWeek} />
        <StatCard label={'Closed Won'} value={fmtK(latestClosedWon)} subtitle={'Prior week'} />
        <StatCard label={'Close Rate (T4W)'} value={latestCloseRate + '%'} subtitle={'Avg deal ' + fmt(latestAvgDeal)} />
      </MetricRow>

      <MetricRow>
        <StatCard label={'Pipeline (T4W)'} value={fmtK(latestOpps)} subtitle={'Opps created'} />
        <StatCard label={'Total Closed Won'} value={fmtK(totalClosedWon)} subtitle={'All weeks tracked'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: '1px solid ' + theme.line }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Weekly Call Activity</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={weeks} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar dataKey="discoveryCalls" name="Discovery" fill={theme.accent} radius={[4, 4, 0, 0]} />
            <Bar dataKey="nextStepsCalls" name="Next Steps" fill={theme.secondary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Closed Won by Week</div>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={weeks} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesClosedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
              <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'K'} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt(v), 'Closed Won']} />
              <Area type="monotone" dataKey="closedWon" stroke="#16a34a" strokeWidth={2} fill="url(#salesClosedGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Close Rate % (Trailing 4 Weeks)</div>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={weeks} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
              <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} tickFormatter={(v) => v + '%'} domain={[0, 60]} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [v + '%', 'Close Rate']} />
              <Line type="monotone" dataKey="closeRate" stroke={theme.accent} strokeWidth={2} dot={{ fill: theme.accent, r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <MetricNote>Source: Notion Leadership Team · Sales/Marketing Scorecard</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

weeks_data = [
    {"week": "1/1", "discoveryCalls": 17, "nextStepsCalls": 2, "oppsCreated": 351746, "closedWon": 15300, "closeRate": 34.6, "avgDealSize": 2900},
    {"week": "1/12", "discoveryCalls": 17, "nextStepsCalls": 7, "oppsCreated": 324500, "closedWon": 83098, "closeRate": 45.6, "avgDealSize": 4000},
    {"week": "1/19", "discoveryCalls": 17, "nextStepsCalls": 8, "oppsCreated": 401340, "closedWon": 42050, "closeRate": 23.6, "avgDealSize": 5800},
    {"week": "1/26", "discoveryCalls": 3, "nextStepsCalls": 14, "oppsCreated": 346090, "closedWon": 67549, "closeRate": 29.4, "avgDealSize": 4100},
    {"week": "2/2", "discoveryCalls": 4, "nextStepsCalls": 7, "oppsCreated": 351140, "closedWon": 60500, "closeRate": 37.5, "avgDealSize": 3100},
    {"week": "2/9", "discoveryCalls": 9, "nextStepsCalls": 9, "oppsCreated": 378340, "closedWon": 24349, "closeRate": 29.7, "avgDealSize": 6600},
    {"week": "2/16", "discoveryCalls": 3, "nextStepsCalls": 10, "oppsCreated": 225750, "closedWon": 40700, "closeRate": 35.7, "avgDealSize": 2900},
]

total_closed = sum(w["closedWon"] for w in weeks_data)
latest = weeks_data[-1]

initial_values = json.dumps({
    "weeks": weeks_data,
    "latestWeek": latest["week"],
    "latestDiscovery": latest["discoveryCalls"],
    "latestNextSteps": latest["nextStepsCalls"],
    "latestClosedWon": latest["closedWon"],
    "latestCloseRate": latest["closeRate"],
    "latestOpps": latest["oppsCreated"],
    "latestAvgDeal": latest["avgDealSize"],
    "totalClosedWon": total_closed,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("WEEKS_PLACEHOLDER", json.dumps(weeks_data))
    html = html.replace("LATEST_WEEK_PLACEHOLDER", json.dumps(latest["week"]))
    html = html.replace("LATEST_DISCOVERY_PLACEHOLDER", str(latest["discoveryCalls"]))
    html = html.replace("LATEST_NEXT_STEPS_PLACEHOLDER", str(latest["nextStepsCalls"]))
    html = html.replace("LATEST_CLOSED_WON_PLACEHOLDER", str(latest["closedWon"]))
    html = html.replace("LATEST_CLOSE_RATE_PLACEHOLDER", str(latest["closeRate"]))
    html = html.replace("LATEST_OPPS_PLACEHOLDER", str(latest["oppsCreated"]))
    html = html.replace("LATEST_AVG_DEAL_PLACEHOLDER", str(latest["avgDealSize"]))
    html = html.replace("TOTAL_CLOSED_WON_PLACEHOLDER", str(total_closed))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["sales scorecard", "sales metrics", "weekly sales"],
})


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout = 5000")
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM metric_definitions WHERE slug = ?", (SLUG,))
    if cursor.fetchone()[0] > 0:
        print(f"  SKIP  {SLUG} (already exists)")
        cursor.execute("SELECT id FROM metric_definitions WHERE slug = ?", (SLUG,))
        metric_id = cursor.fetchone()[0]
    else:
        metric_id = str(uuid.uuid4())
        snapshot_id = str(uuid.uuid4())

        cursor.execute(
            """INSERT INTO metric_definitions
               (id, name, slug, instructions, template_html, ttl_seconds, provider, enabled, proactive, metadata_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'claude', 1, 0, ?, ?, ?)""",
            (metric_id, NAME, SLUG, instructions, template_jsx, 259200, METADATA, NOW, NOW)
        )
        cursor.execute(
            """INSERT INTO metric_snapshots
               (id, metric_id, values_json, rendered_html, status, created_at, completed_at)
               VALUES (?, ?, ?, ?, 'completed', ?, ?)""",
            (snapshot_id, metric_id, initial_values, initial_html, NOW, NOW)
        )
        print(f"  ADD   {SLUG}")

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
            (binding_id, SCREEN_ID, metric_id, 0, "wide", 0, 0, 8, 12),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x12)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
