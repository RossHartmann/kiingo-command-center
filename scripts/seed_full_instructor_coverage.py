#!/usr/bin/env python3
"""Seed: Full Instructor Coverage — all instructor activity from Asana Ops board + individual cohort projects."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "full-instructor-coverage"
NAME = "Full Instructor Coverage"
SCREEN_ID = "dept-operations"

instructions = r"""Track all instructor and coordinator activity across bootcamp cohorts. Combines the Asana Ops board (lead instructors) with individual cohort project tasks (Isabelle who runs sessions and handles admin).

## Data Sources
1. Asana → "AI Bootcamp Ops" project (GID: 1208309967533974) — all sections
2. Asana → Individual cohort projects — task assignments reveal who actually runs sessions
3. Asana workspace search — find Isabelle's open bootcamp tasks

## Important Notes
- The Ops board sections (Scheduling/Underway/Completed) are **NOT reliably maintained**. Many completed cohorts sit in Scheduling or Underway.
- Use the task `completed` flag AND `Session N Date` custom fields to determine true cohort status.
- Isabelle Coloma (GID: 1211901589146535) is assigned "Run session N" tasks within individual cohort projects — she actually runs bootcamp sessions, not just coordinates.

## Known Team
- **Lead instructors** (Ops board task assignees): Jordan McDaniel, James Hill-Jiang, Josh Sullivan, Ross Hartmann
- **Session runners** (individual project task assignees): Isabelle Coloma (GID: 1211901589146535)

## Retrieval Steps

### Step 1: Get ALL Ops board tasks with custom fields
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
const completedSection = await asana.getTasksForSection({
  sectionGid: '1208545310165812',
  opt_fields: ['name','assignee.name','completed','completed_at','custom_fields']
});
```

Combine all tasks. For each, find the last populated `Session N Date` custom field (Session 1 through Session 8). Classify:
- **completed**: `completed` is true AND last session date is in the past
- **active**: NOT completed AND Session 1 Date is in the past AND last session date is recent (within last 2 weeks) or in the future
- **scheduled**: NOT completed AND (no session dates OR Session 1 Date is in the future)

Group by assignee, counting active/scheduled/completed per instructor.

### Step 2: Find Isabelle's active cohort involvement
```typescript
const isabelleTasks = await asana.searchTasksInWorkspace({
  workspaceGid: '1208310016661037',
  searchParams: {
    'assignee.any': '1211901589146535',
    'completed': false
  },
  opt_fields: ['name','memberships.project.name','due_on'],
  limit: 100
});
```

Filter to tasks whose project name contains "Bootcamp" or "AI Bootcamp". Extract unique project names — each represents a cohort she's actively running. Look specifically for "Run session" tasks to confirm she's the session runner.

Also get her recently completed bootcamp tasks:
```typescript
const ninetyDaysAgo = new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0];
const isabelleCompleted = await asana.searchTasksInWorkspace({
  workspaceGid: '1208310016661037',
  searchParams: {
    'assignee.any': '1211901589146535',
    'completed': true,
    'completed_on.after': ninetyDaysAgo
  },
  opt_fields: ['name','memberships.project.name'],
  limit: 100
});
```

Count unique completed bootcamp projects for her completed tally.

### Step 3: Build combined instructor table
Merge all instructors. Each entry:
- `name`: first name
- `role`: "Lead Instructor" for Ops board assignees, "Session Runner" for Isabelle
- `active`: truly active cohorts (using session date logic for leads, open project tasks for Isabelle)
- `scheduled`: scheduled cohorts (Ops board leads only; 0 for Isabelle)
- `completed`: completed cohorts
- `total`: sum

Sort by active count descending.

### Step 4: Build active cohort-to-team mapping
For each truly active cohort, show the lead instructor (from Ops board assignee). Cross-reference with Isabelle's active projects to find which cohorts she's also running sessions for. Build: { cohort, lead, coordinator }.

## Values to Return
- `instructors`: array of { name, role, active, scheduled, completed, total }
- `totalTeamMembers`: number
- `totalActiveCohorts`: number (truly active, not stale)
- `cohortsWithCoordinator`: number (active cohorts where Isabelle is also assigned)
- `cohortTeams`: array of { cohort, lead, coordinator }
"""

template_jsx = r"""(() => {
  const instructors = INSTRUCTORS_PLACEHOLDER;
  const totalTeamMembers = TOTAL_TEAM_PLACEHOLDER;
  const totalActiveCohorts = TOTAL_ACTIVE_PLACEHOLDER;
  const cohortsWithCoordinator = COHORTS_WITH_COORD_PLACEHOLDER;
  const cohortTeams = COHORT_TEAMS_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Team Size'} value={totalTeamMembers} subtitle={'Instructors + coordinators'} />
        <StatCard label={'Active Cohorts'} value={totalActiveCohorts} subtitle={'Currently running'} />
        <StatCard label={'With Coordinator'} value={cohortsWithCoordinator} subtitle={'Isabelle supporting'} />
        <StatCard label={'Utilization'} value={Math.round(totalActiveCohorts / totalTeamMembers * 10) / 10 + 'x'} subtitle={'Cohorts per person'} />
      </MetricRow>

      <div style={{ background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Team Overview</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid ' + theme.line }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600, fontSize: 11 }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600, fontSize: 11 }}>Role</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600, fontSize: 11 }}>Active</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600, fontSize: 11 }}>Scheduled</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600, fontSize: 11 }}>Completed</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600, fontSize: 11 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {instructors.map((inst, i) => (
              <tr key={i} style={{ borderBottom: '1px solid ' + theme.line }}>
                <td style={{ padding: '8px 12px', fontWeight: 600, color: theme.ink }}>{inst.name}</td>
                <td style={{ padding: '8px 12px', color: theme.inkMuted }}>{inst.role}</td>
                <td style={{ textAlign: 'center', padding: '8px 12px', color: inst.active > 0 ? theme.accent : theme.inkMuted, fontWeight: 700 }}>{inst.active}</td>
                <td style={{ textAlign: 'center', padding: '8px 12px', color: inst.scheduled > 0 ? '#eab308' : theme.inkMuted, fontWeight: 600 }}>{inst.scheduled}</td>
                <td style={{ textAlign: 'center', padding: '8px 12px', color: theme.inkMuted }}>{inst.completed}</td>
                <td style={{ textAlign: 'center', padding: '8px 12px', fontWeight: 600, color: theme.ink }}>{inst.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cohortTeams.length > 0 && (
        <div style={{ background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Active Cohort Teams</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {cohortTeams.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderRadius: 10, background: theme.accent + '0a', border: '1px solid ' + theme.line }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>{c.cohort}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: theme.accent, fontWeight: 600 }}>{c.lead}</span>
                  {c.coordinator && <span style={{ fontSize: 10, color: theme.secondary, background: theme.secondary + '22', padding: '2px 8px', borderRadius: 10 }}>+ {c.coordinator}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <MetricNote>Source: Asana Ops board + individual cohort projects · Lead instructors + coordinators</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

instructors_data = [
    {"name": "Isabelle", "role": "Session Runner", "active": 3, "scheduled": 0, "completed": 4, "total": 7},
    {"name": "Josh", "role": "Lead Instructor", "active": 0, "scheduled": 0, "completed": 43, "total": 43},
    {"name": "James", "role": "Lead Instructor", "active": 0, "scheduled": 0, "completed": 27, "total": 27},
    {"name": "Jordan", "role": "Lead Instructor", "active": 0, "scheduled": 0, "completed": 12, "total": 12},
    {"name": "Ross", "role": "Lead Instructor", "active": 0, "scheduled": 0, "completed": 5, "total": 5},
]

cohort_teams = [
    {"cohort": "DealNews Cohort 3", "lead": "—", "coordinator": "Isabelle"},
    {"cohort": "Total Package HR", "lead": "—", "coordinator": "Isabelle"},
    {"cohort": "SPMB Cohort 3", "lead": "—", "coordinator": "Isabelle"},
]

initial_values = json.dumps({
    "instructors": instructors_data,
    "totalTeamMembers": 5,
    "totalActiveCohorts": 3,
    "cohortsWithCoordinator": 3,
    "cohortTeams": cohort_teams,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("INSTRUCTORS_PLACEHOLDER", json.dumps(instructors_data))
    html = html.replace("TOTAL_TEAM_PLACEHOLDER", "5")
    html = html.replace("TOTAL_ACTIVE_PLACEHOLDER", "9")
    html = html.replace("COHORTS_WITH_COORD_PLACEHOLDER", "3")
    html = html.replace("COHORT_TEAMS_PLACEHOLDER", json.dumps(cohort_teams))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["instructor coverage", "full team", "bootcamp team", "isabelle workload", "coordinator coverage"],
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
            (binding_id, SCREEN_ID, metric_id, 6, "wide", 0, 76, 8, 14),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x14)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
