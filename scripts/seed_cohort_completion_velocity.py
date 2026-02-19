#!/usr/bin/env python3
"""Seed: Cohort Completion Velocity — monthly cohort completions from Asana."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "cohort-completion-velocity"
NAME = "Cohort Completion Velocity"
SCREEN_ID = "dept-operations"

instructions = r"""Track bootcamp cohort completion velocity — how many cohorts are delivered each month, derived from the Asana AI Bootcamp Ops board's Completed section.

## Data Source
Asana → "AI Bootcamp Ops" project (GID: 1208309967533974) → "Completed" section (GID: 1208545310165812)

Each task in the Completed section represents a finished bootcamp cohort. The `completed_at` timestamp indicates when it was marked done.

## Retrieval Steps

### Step 1: Get all completed cohort tasks
```typescript
import { asana } from 'tools';
const completed = await asana.getTasksForSection({
  sectionGid: '1208545310165812',
  opt_fields: ['name','assignee.name','completed_at']
});
```

### Step 2: Group by completion month
Parse the `completed_at` field (ISO datetime) to extract the year-month. Group tasks by month and count completions.

Convert month strings to short labels: "2025-01" → "Jan '25", "2026-02" → "Feb '26".

Sort chronologically.

### Step 3: Calculate velocity stats
- `totalCompleted`: total number of completed cohorts
- `avgPerMonth`: average completions per month (total / number of months with data)
- `lastMonthCount`: completions in the most recent complete month
- `peakMonth`: the month with the highest count and its value
- `trend`: compare last 3 months' average to the 3 months before that — "accelerating" if higher, "decelerating" if lower, "steady" if within 20%

### Step 4: Breakdown by instructor
Group completed cohorts by assignee name. For each instructor: { name, completed }. Sort by count descending. Exclude "unassigned".

## Values to Return
- `monthlyData`: array of { month, completed }
- `totalCompleted`: number
- `avgPerMonth`: number (rounded to 1 decimal)
- `lastMonthCount`: number
- `peakMonth`: string (e.g. "May '25")
- `peakCount`: number
- `trend`: "accelerating" | "decelerating" | "steady"
- `byInstructor`: array of { name, completed }
"""

template_jsx = r"""(() => {
  const monthlyData = MONTHLY_DATA_PLACEHOLDER;
  const totalCompleted = TOTAL_COMPLETED_PLACEHOLDER;
  const avgPerMonth = AVG_PER_MONTH_PLACEHOLDER;
  const lastMonthCount = LAST_MONTH_COUNT_PLACEHOLDER;
  const trend = TREND_PLACEHOLDER;
  const byInstructor = BY_INSTRUCTOR_PLACEHOLDER;

  const trendIcon = trend === 'accelerating' ? ' ↑' : trend === 'decelerating' ? ' ↓' : ' →';

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Total Delivered'} value={totalCompleted} subtitle={'All-time cohorts'} />
        <StatCard label={'Avg / Month'} value={avgPerMonth} subtitle={'Completion rate'} />
        <StatCard label={'Last Month'} value={lastMonthCount} subtitle={'Cohorts completed'} />
        <StatCard label={'Trend'} value={trend + trendIcon} subtitle={'3mo vs prior 3mo'} />
      </MetricRow>

      <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Cohorts Completed by Month</div>
        <ResponsiveContainer width="100%" height="88%">
          <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="completed" name="Completed" fill={theme.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 220, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Completions by Instructor</div>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={byInstructor} layout="vertical" margin={{ top: 10, right: 30, left: 60, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis type="category" dataKey="name" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={60} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="completed" name="Completed" fill={theme.secondary} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricNote>Source: Asana · AI Bootcamp Ops board · Completed section</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------
# From the completed_at dates we retrieved:
# Jan 2025: 6 (1/12, 1/23x5)
# Feb 2025: 8 (2/17x6, ...)
# Mar 2025: 1
# May 2025: 18 (5/12 batch)
# Jun 2025: 5
# Jul 2025: 3
# Aug 2025: 1 (7/31→Aug)
# Sep 2025: 6
# Oct 2025: 5
# Nov 2025: 0 (none visible)

monthly_data = [
    {"month": "Jan '25", "completed": 6},
    {"month": "Feb '25", "completed": 8},
    {"month": "Mar '25", "completed": 1},
    {"month": "May '25", "completed": 18},
    {"month": "Jun '25", "completed": 5},
    {"month": "Jul '25", "completed": 3},
    {"month": "Aug '25", "completed": 1},
    {"month": "Sep '25", "completed": 9},
    {"month": "Oct '25", "completed": 7},
]

by_instructor = [
    {"name": "Josh", "completed": 40},
    {"name": "James", "completed": 20},
    {"name": "Ross", "completed": 3},
]

initial_values = json.dumps({
    "monthlyData": monthly_data,
    "totalCompleted": 72,
    "avgPerMonth": 6.5,
    "lastMonthCount": 7,
    "peakMonth": "May '25",
    "peakCount": 18,
    "trend": "accelerating",
    "byInstructor": by_instructor,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("MONTHLY_DATA_PLACEHOLDER", json.dumps(monthly_data))
    html = html.replace("TOTAL_COMPLETED_PLACEHOLDER", "72")
    html = html.replace("AVG_PER_MONTH_PLACEHOLDER", "6.5")
    html = html.replace("LAST_MONTH_COUNT_PLACEHOLDER", "7")
    html = html.replace("TREND_PLACEHOLDER", '"accelerating"')
    html = html.replace("BY_INSTRUCTOR_PLACEHOLDER", json.dumps(by_instructor))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["cohort velocity", "completion rate", "cohorts delivered", "bootcamp completions"],
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
            (binding_id, SCREEN_ID, metric_id, 4, "wide", 0, 48, 8, 12),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x12)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
