#!/usr/bin/env python3
"""Seed: Sales Follow-Up Snapshot — daily pipeline follow-up health from CRM SharePoint."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "sales-followup-snapshot"
NAME = "Sales Follow-Up Snapshot"
SCREEN_ID = "dept-sales"

instructions = r"""Read today's SALES Follow-Up Metrics Report from the CRM SharePoint site and extract pipeline follow-up health data.

## Data Source
SharePoint CRM site → Latest SALES-Follow-up-Metrics-Report xlsx → "Follow-Up Metrics Summary" worksheet

## Retrieval Steps

### Step 1: Find the latest SALES report
```typescript
import { sharepoint } from 'tools';
const items = await sharepoint.searchItems({
  siteId: 'kiingo.sharepoint.com,8cb6f37c-91b4-4196-8c80-7a9d56f451cb,fa64a87a-e711-4141-bc08-c8ebe6a524b6',
  query: 'SALES-Follow-up-Metrics-Report',
  itemType: 'file',
  fileExtension: 'xlsx'
});
```
Sort results by `lastModifiedDateTime` descending and pick the first (most recent) item. Note its `id` (this is the `itemId`).

### Step 2: Read the Summary worksheet
```typescript
import { excel } from 'tools';
const result = await excel.getUsedRange({
  siteId: 'kiingo.sharepoint.com,8cb6f37c-91b4-4196-8c80-7a9d56f451cb,fa64a87a-e711-4141-bc08-c8ebe6a524b6',
  itemId: '<itemId from step 1>',
  worksheetName: 'Follow-Up Metrics Summary',
  valuesOnly: true
});
```

### Step 3: Parse the summary data
The worksheet rows (0-indexed):
- Row 2: "Generated at: <date string>"
- Row 5: ["Total Open Deals", <number>]
- Row 6: ["With Discovery Call", <number>]
- Row 7: ["Without Discovery Call", <number>]
- Row 8: ["Likely Cold Deals", <number>]
- Row 9: ["Overdue Follow-Ups (>14 days)", <number>]
- Row 10: ["Follow-Up Needed After Discovery", <number>]
- Row 11: ["Average Days Since Last Contact", <number>]
- Rows 14-21: Follow-up range distribution — each row is [rangeName, dealCount, ...]
  - Row 14: "01. 0-3 days"
  - Row 15: "02. 3-7 days"
  - Row 16: "03. 7-14 days"
  - Row 17: "04. 14-30 days"
  - Row 18: "05. 30-60 days"
  - Row 19: "06. 60-90 days"
  - Row 20: "07. 90-180 days"
  - Row 21: "08. 180+ days"
- Rows 44+: Per-rep breakdown — each row is [email, totalDeals, likelyCold, coldPct%, bar]
  Continue reading rows until empty.

### Step 4: Structure the data

For `followUpRanges`, create three fields per range for color-coded stacked bars:
- Ranges "01. 0-3 days" and "02. 3-7 days": put count in `healthy` field, 0 for `warning` and `danger`
- Ranges "03. 7-14 days" and "04. 14-30 days": put count in `warning` field, 0 for others
- Ranges "05." through "08.": put count in `danger` field, 0 for others

Use short labels for display: "0-3d", "3-7d", "7-14d", "14-30d", "30-60d", "60-90d", "90-180d", "180+d"

For `repBreakdown`, extract the rep name from the email (part before @), compute `active = totalDeals - likelyCold`.

## Values to Return
- `generatedAt`: date string from row 2 (just the date portion)
- `totalOpenDeals`: number
- `withDiscovery`: number
- `withoutDiscovery`: number
- `likelyCold`: number
- `overdueFollowUps`: number
- `followUpNeeded`: number
- `avgDaysSinceContact`: number
- `followUpRanges`: array of { range, healthy, warning, danger }
- `repBreakdown`: array of { rep, totalDeals, active, likelyCold, coldPct } sorted by totalDeals desc
"""

template_jsx = r"""(() => {
  const totalOpenDeals = TOTAL_OPEN_DEALS_PLACEHOLDER;
  const likelyCold = LIKELY_COLD_PLACEHOLDER;
  const overdueFollowUps = OVERDUE_FOLLOWUPS_PLACEHOLDER;
  const avgDays = AVG_DAYS_PLACEHOLDER;
  const followUpRanges = FOLLOWUP_RANGES_PLACEHOLDER;
  const repBreakdown = REP_BREAKDOWN_PLACEHOLDER;
  const generatedAt = GENERATED_AT_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Open Deals'} value={totalOpenDeals} subtitle={'Total pipeline'} />
        <StatCard label={'Likely Cold'} value={likelyCold} subtitle={((likelyCold / totalOpenDeals) * 100).toFixed(0) + '% of pipeline'} />
        <StatCard label={'Overdue >14d'} value={overdueFollowUps} subtitle={'Need attention'} />
        <StatCard label={'Avg Days Since Contact'} value={avgDays.toFixed(1)} subtitle={'Lower is better'} />
      </MetricRow>

      <div style={{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Follow-Up Range Distribution</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={followUpRanges} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="range" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} angle={-25} textAnchor="end" />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar dataKey="healthy" name="Healthy (0-7d)" stackId="a" fill="#16a34a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="warning" name="Needs Attention (7-30d)" stackId="a" fill="#eab308" radius={[0, 0, 0, 0]} />
            <Bar dataKey="danger" name="At Risk (30d+)" stackId="a" fill={theme.danger} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Sales Rep Follow-Up Health</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={repBreakdown} layout="vertical" margin={{ top: 10, right: 30, left: 60, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis type="category" dataKey="rep" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={55} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar dataKey="active" name="Active" stackId="a" fill={theme.accent} radius={[0, 0, 0, 0]} />
            <Bar dataKey="likelyCold" name="Likely Cold" stackId="a" fill={theme.danger} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricNote>Source: CRM SharePoint · SALES Follow-Up Metrics Report · {generatedAt}</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data (from Feb 18, 2026 report) ----------

followup_ranges = [
    {"range": "0-3d", "healthy": 44, "warning": 0, "danger": 0},
    {"range": "3-7d", "healthy": 82, "warning": 0, "danger": 0},
    {"range": "7-14d", "healthy": 0, "warning": 8, "danger": 0},
    {"range": "14-30d", "healthy": 0, "warning": 6, "danger": 0},
    {"range": "30-60d", "healthy": 0, "warning": 0, "danger": 12},
    {"range": "60-90d", "healthy": 0, "warning": 0, "danger": 2},
    {"range": "90-180d", "healthy": 0, "warning": 0, "danger": 1},
    {"range": "180+d", "healthy": 0, "warning": 0, "danger": 34},
]

rep_breakdown = [
    {"rep": "kym", "totalDeals": 84, "active": 51, "likelyCold": 33, "coldPct": 39.3},
    {"rep": "david", "totalDeals": 50, "active": 42, "likelyCold": 8, "coldPct": 16.0},
    {"rep": "sohrab", "totalDeals": 11, "active": 9, "likelyCold": 2, "coldPct": 18.2},
    {"rep": "michael", "totalDeals": 4, "active": 4, "likelyCold": 0, "coldPct": 0},
    {"rep": "ross", "totalDeals": 2, "active": 2, "likelyCold": 0, "coldPct": 0},
    {"rep": "josh", "totalDeals": 2, "active": 2, "likelyCold": 0, "coldPct": 0},
    {"rep": "jess", "totalDeals": 1, "active": 1, "likelyCold": 0, "coldPct": 0},
    {"rep": "jordan", "totalDeals": 1, "active": 1, "likelyCold": 0, "coldPct": 0},
]

initial_values = json.dumps({
    "generatedAt": "2/18/2026",
    "totalOpenDeals": 189,
    "withDiscovery": 132,
    "withoutDiscovery": 57,
    "likelyCold": 43,
    "overdueFollowUps": 21,
    "followUpNeeded": 0,
    "avgDaysSinceContact": 9.4,
    "followUpRanges": followup_ranges,
    "repBreakdown": rep_breakdown,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("TOTAL_OPEN_DEALS_PLACEHOLDER", "189")
    html = html.replace("LIKELY_COLD_PLACEHOLDER", "43")
    html = html.replace("OVERDUE_FOLLOWUPS_PLACEHOLDER", "21")
    html = html.replace("AVG_DAYS_PLACEHOLDER", "9.4")
    html = html.replace("FOLLOWUP_RANGES_PLACEHOLDER", json.dumps(followup_ranges))
    html = html.replace("REP_BREAKDOWN_PLACEHOLDER", json.dumps(rep_breakdown))
    html = html.replace("GENERATED_AT_PLACEHOLDER", '"2/18/2026"')
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["sales follow-up", "sales followup", "follow-up snapshot", "pipeline health"],
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
            (binding_id, SCREEN_ID, metric_id, 2, "wide", 0, 24, 8, 14),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x14)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
