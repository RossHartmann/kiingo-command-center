#!/usr/bin/env python3
"""Seed: Ops Follow-Up Trends — multi-day trend tracking from CRM SharePoint."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "ops-followup-trends"
NAME = "Ops Follow-Up Trends"
SCREEN_ID = "ops-followup"

instructions = r"""Track daily trends in OPS follow-up pipeline health by reading the last 14 daily OPS Follow-Up Metrics Reports from the CRM SharePoint site.

## Data Source
SharePoint CRM site → Multiple OPS-Follow-up-Metrics-Report xlsx files → "Follow-Up Metrics Summary" worksheets

## Retrieval Steps

### Step 1: Find all OPS reports
```typescript
import { sharepoint } from 'tools';
const items = await sharepoint.searchItems({
  siteId: 'kiingo.sharepoint.com,8cb6f37c-91b4-4196-8c80-7a9d56f451cb,fa64a87a-e711-4141-bc08-c8ebe6a524b6',
  query: 'OPS-Follow-up-Metrics-Report',
  itemType: 'file',
  fileExtension: 'xlsx'
});
```
Sort results by `lastModifiedDateTime` descending. Extract the date from each filename (the ISO timestamp portion, e.g. "2026-02-18" from "OPS-Follow-up-Metrics-Report-2026-02-18T11-11-59.622Z.xlsx"). Group by date and keep only the latest report per day. Select up to 14 most recent days.

### Step 2: Read each Summary worksheet
For each of the selected reports, read the summary sheet:
```typescript
import { excel } from 'tools';
const result = await excel.getUsedRange({
  siteId: 'kiingo.sharepoint.com,8cb6f37c-91b4-4196-8c80-7a9d56f451cb,fa64a87a-e711-4141-bc08-c8ebe6a524b6',
  itemId: '<itemId>',
  worksheetName: 'Follow-Up Metrics Summary',
  valuesOnly: true
});
```

### Step 3: Parse summary data from each report
From each worksheet extract by row index (0-indexed):
- Row 5, col 1: Total Open Deals
- Row 8, col 1: Likely Cold Deals
- Row 9, col 1: Overdue Follow-Ups (>14 days)
- Row 11, col 1: Average Days Since Last Contact
- Rows 14-15, col 1: Healthy count (sum of "01. 0-3 days" + "02. 3-7 days" deal counts)
- Rows 18-21, col 1: At Risk count (sum of "05. 30-60 days" through "08. 180+ days" deal counts)

### Step 4: Structure as time series
Build an array sorted by date ascending. Each entry:
- `date`: short label (e.g. "2/14")
- `totalDeals`: total open deals
- `likelyCold`: likely cold count
- `overdue`: overdue >14 days count
- `avgDays`: average days since contact
- `healthy`: sum of 0-7 day buckets
- `atRisk`: sum of 30+ day buckets

Also compute:
- `latestDate`: most recent report date (full date string)
- `coldTrend`: compare the last 3 data points — "improving" if likelyCold decreased consistently, "worsening" if increased, "stable" otherwise
- `overdueTrend`: same logic for overdue count
- `daysReported`: number of days with data

## Values to Return
- `dailyData`: array of { date, totalDeals, likelyCold, overdue, avgDays, healthy, atRisk }
- `latestDate`: string
- `coldTrend`: "improving" | "worsening" | "stable"
- `overdueTrend`: "improving" | "worsening" | "stable"
- `daysReported`: number
"""

template_jsx = r"""(() => {
  const dailyData = DAILY_DATA_PLACEHOLDER;
  const latestDate = LATEST_DATE_PLACEHOLDER;
  const coldTrend = COLD_TREND_PLACEHOLDER;
  const overdueTrend = OVERDUE_TREND_PLACEHOLDER;
  const daysReported = DAYS_REPORTED_PLACEHOLDER;

  const latest = dailyData[dailyData.length - 1] || {};

  const trendIcon = (t) => t === 'improving' ? ' ↓' : t === 'worsening' ? ' ↑' : ' →';

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Likely Cold'} value={latest.likelyCold} subtitle={coldTrend + trendIcon(coldTrend)} />
        <StatCard label={'Overdue >14d'} value={latest.overdue} subtitle={overdueTrend + trendIcon(overdueTrend)} />
        <StatCard label={'Avg Contact Days'} value={latest.avgDays?.toFixed(1)} subtitle={daysReported + '-day trend'} />
        <StatCard label={'At Risk Deals'} value={latest.atRisk} subtitle={'30+ days stale'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Likely Cold & Overdue Deals Over Time</div>
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="date" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Line type="monotone" dataKey="likelyCold" name="Likely Cold" stroke={theme.danger} strokeWidth={2} dot={{ fill: theme.danger, r: 3 }} />
            <Line type="monotone" dataKey="overdue" name="Overdue >14d" stroke="#eab308" strokeWidth={2} dot={{ fill: '#eab308', r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Avg Days Since Contact</div>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="opsAvgDaysGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={theme.accent} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
              <XAxis dataKey="date" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [v.toFixed(1) + ' days', 'Avg Contact']} />
              <Area type="monotone" dataKey="avgDays" stroke={theme.accent} strokeWidth={2} fill="url(#opsAvgDaysGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Healthy vs At Risk</div>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
              <XAxis dataKey="date" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} />
              <Legend />
              <Bar dataKey="healthy" name="Healthy (0-7d)" fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="atRisk" name="At Risk (30d+)" fill={theme.danger} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <MetricNote>Source: CRM SharePoint · {daysReported} daily OPS reports · Latest: {latestDate}</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data (single day from Feb 18, 2026) ----------

daily_data = [
    {"date": "2/18", "totalDeals": 58, "likelyCold": 2, "overdue": 37, "avgDays": 39.6, "healthy": 11, "atRisk": 33},
]

initial_values = json.dumps({
    "dailyData": daily_data,
    "latestDate": "2/18/2026",
    "coldTrend": "stable",
    "overdueTrend": "stable",
    "daysReported": 1,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("DAILY_DATA_PLACEHOLDER", json.dumps(daily_data))
    html = html.replace("LATEST_DATE_PLACEHOLDER", '"2/18/2026"')
    html = html.replace("COLD_TREND_PLACEHOLDER", '"stable"')
    html = html.replace("OVERDUE_TREND_PLACEHOLDER", '"stable"')
    html = html.replace("DAYS_REPORTED_PLACEHOLDER", "1")
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["ops follow-up trends", "operations trends", "ops pipeline trends", "ops staleness"],
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
            (metric_id, NAME, SLUG, instructions, template_jsx, 86400, METADATA, NOW, NOW)
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
            (binding_id, SCREEN_ID, metric_id, 1, "wide", 0, 14, 8, 14),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x14)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
