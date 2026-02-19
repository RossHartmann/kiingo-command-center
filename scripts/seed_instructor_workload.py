#!/usr/bin/env python3
"""Seed: Instructor Workload — bootcamp cohort assignments by instructor from Asana."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "instructor-workload"
NAME = "Instructor Workload"
SCREEN_ID = "dept-operations"

instructions = r"""Track instructor workload distribution — active, scheduled, and completed bootcamp cohorts per instructor from the Asana AI Bootcamp Ops board.

## Data Source
Asana → "AI Bootcamp Ops" project (GID: 1208309967533974)

The project has sections (Scheduling, Underway, Completed) but **sections are NOT reliably maintained** — many completed cohorts remain in Scheduling or Underway. Instead, determine true status using:
1. The task's `completed` boolean flag
2. Custom fields `Session 1 Date` through `Session 8 Date` — the actual bootcamp session schedule

Each task represents a bootcamp cohort. The **task assignee** is the lead instructor.

## Retrieval Steps

### Step 1: Get ALL tasks from all three sections with custom fields
```typescript
import { asana } from 'tools';

const underway = await asana.getTasksForSection({
  sectionGid: '1208335145873011',
  opt_fields: ['name','assignee.name','completed','completed_at','custom_fields']
});
const scheduling = await asana.getTasksForSection({
  sectionGid: '1208309967533979',
  opt_fields: ['name','assignee.name','completed','completed_at','custom_fields']
});
const completed = await asana.getTasksForSection({
  sectionGid: '1208545310165812',
  opt_fields: ['name','assignee.name','completed','completed_at','custom_fields']
});
```

Combine all tasks into one list.

### Step 2: Classify each cohort's true status
For each task, determine its real status (ignore which section it's in):

1. Find the last populated `Session N Date` custom field (check Session 1 through Session 8; use the highest-numbered one that has a value).
2. Parse that date and compare to today.
3. Classify:
   - **completed**: `completed` flag is true AND last session date is in the past (or no session dates set)
   - **active**: `completed` flag is false AND Session 1 Date is in the past AND last session date is in the future (or within the last 2 weeks)
   - **scheduled**: `completed` flag is false AND Session 1 Date is in the future (or no session dates yet)
   - If `completed` is true but last session date is in the future, treat as **active** (incorrectly marked done early)

### Step 3: Aggregate by instructor
Group by assignee name. For each instructor, count active, scheduled, and completed cohorts.

Sort by active count descending.

Skip tasks with no assignee (group as "Unassigned" separately).

### Step 4: Build active cohort list
From the truly active cohorts, list each with: { cohort (task name, cleaned by removing " - AI Bootcamp Cohort" suffix), instructor (assignee first name) }. Sort by instructor.

## Values to Return
- `instructors`: array of { name, active, scheduled, completed, total }
- `totalActive`: number
- `totalScheduled`: number
- `totalCompleted`: number
- `totalCohorts`: number
- `activeCohorts`: array of { cohort, instructor }
"""

template_jsx = r"""(() => {
  const instructors = INSTRUCTORS_PLACEHOLDER;
  const totalActive = TOTAL_ACTIVE_PLACEHOLDER;
  const totalScheduled = TOTAL_SCHEDULED_PLACEHOLDER;
  const totalCompleted = TOTAL_COMPLETED_PLACEHOLDER;
  const totalCohorts = TOTAL_COHORTS_PLACEHOLDER;
  const activeCohorts = ACTIVE_COHORTS_PLACEHOLDER;

  const colors = [theme.accent, theme.secondary, '#eab308', '#16a34a', '#e879f9', '#f97316'];

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Active Cohorts'} value={totalActive} subtitle={'Currently underway'} />
        <StatCard label={'Scheduled'} value={totalScheduled} subtitle={'Being set up'} />
        <StatCard label={'Completed'} value={totalCompleted} subtitle={'All-time delivered'} />
        <StatCard label={'Total Cohorts'} value={totalCohorts} subtitle={'All stages'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Cohorts by Instructor</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={instructors} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis type="category" dataKey="name" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={80} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar dataKey="active" name="Active" stackId="a" fill={theme.accent} />
            <Bar dataKey="scheduled" name="Scheduled" stackId="a" fill="#eab308" />
            <Bar dataKey="completed" name="Completed" stackId="a" fill={theme.secondary} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {activeCohorts.length > 0 && (
        <div style={{ background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Active Cohorts</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {activeCohorts.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderRadius: 10, background: theme.accent + '0a', border: '1px solid ' + theme.line }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>{c.cohort.replace(' - AI Bootcamp Cohort', '')}</span>
                <span style={{ fontSize: 11, color: theme.inkMuted, marginLeft: 8 }}>{c.instructor}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <MetricNote>Source: Asana · AI Bootcamp Ops board · Instructor = task assignee</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

instructors_data = [
    {"name": "Josh", "active": 0, "scheduled": 0, "completed": 43, "total": 43},
    {"name": "James", "active": 0, "scheduled": 0, "completed": 27, "total": 27},
    {"name": "Jordan", "active": 0, "scheduled": 0, "completed": 12, "total": 12},
    {"name": "Ross", "active": 0, "scheduled": 0, "completed": 5, "total": 5},
]

active_cohorts = []

initial_values = json.dumps({
    "instructors": instructors_data,
    "totalActive": 0,
    "totalScheduled": 0,
    "totalCompleted": 87,
    "totalCohorts": 87,
    "activeCohorts": active_cohorts,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("INSTRUCTORS_PLACEHOLDER", json.dumps(instructors_data))
    html = html.replace("TOTAL_ACTIVE_PLACEHOLDER", "9")
    html = html.replace("TOTAL_SCHEDULED_PLACEHOLDER", "15")
    html = html.replace("TOTAL_COMPLETED_PLACEHOLDER", "63")
    html = html.replace("TOTAL_COHORTS_PLACEHOLDER", "87")
    html = html.replace("ACTIVE_COHORTS_PLACEHOLDER", json.dumps(active_cohorts))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["instructor workload", "instructor distribution", "bootcamp instructors", "cohort assignments"],
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
            (metric_id, NAME, SLUG, instructions, template_jsx, 43200, METADATA, NOW, NOW)
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
            (binding_id, SCREEN_ID, metric_id, 3, "wide", 0, 36, 8, 12),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x12)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
