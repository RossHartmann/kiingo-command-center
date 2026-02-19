#!/usr/bin/env python3
"""Seed: Upcoming Cohort Calendar — scheduled cohorts and active office hours from Asana + Calendar."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "upcoming-cohort-calendar"
NAME = "Upcoming Cohort Calendar"
SCREEN_ID = "dept-operations"

instructions = r"""Show upcoming and active bootcamp cohorts by combining the Asana Ops board (with session date custom fields) and the Office Hours calendar for a full picture of cohort activity.

## Data Sources
1. Asana → "AI Bootcamp Ops" project (GID: 1208309967533974) — all sections (Scheduling/Underway/Completed)
2. Microsoft Calendar → "AI Bootcamp Office Hours" calendar (ID: AAMkAGMxNTQyZjUyLWE5MjYtNDQ2ZS1iYWMxLTA0ZTgxMmZiOGYxOABGAAAAAAA1aYnhhmn8TIASxaX7OOulBwCme88kvStVQZzo4G036zUXAAAAAAEGAACme88kvStVQZzo4G036zUXAAFiW2tzAAA=) — shows all cohorts with active office hours

## Important Notes
- The Asana board sections are **NOT reliably maintained** — completed cohorts often remain in Scheduling or Underway.
- Use `Session N Date` custom fields + the `completed` flag to determine true cohort status.
- The office hours calendar is the **best real-time signal** for which cohorts are currently active — 42+ unique cohorts had OH events in Feb 2026, far more than the ~10 in the "Underway" section.

## Retrieval Steps

### Step 1: Get ALL Asana Ops board tasks with session dates
```typescript
import { asana } from 'tools';
const underway = await asana.getTasksForSection({
  sectionGid: '1208335145873011',
  opt_fields: ['name','assignee.name','completed','custom_fields']
});
const scheduling = await asana.getTasksForSection({
  sectionGid: '1208309967533979',
  opt_fields: ['name','assignee.name','completed','custom_fields']
});
```

Combine all tasks. For each, find Session 1 Date through Session 8 Date custom fields. Classify using session dates + completed flag:
- **truly active**: NOT completed AND has session dates spanning today (Session 1 in past, last session in future or within 2 weeks)
- **truly scheduled**: NOT completed AND Session 1 Date is in the future (or no dates yet)
- **truly completed**: completed flag is true AND all session dates are in the past

### Step 2: Get office hours events for next 60 days
```typescript
import { calendar } from 'tools';
const now = new Date();
const future = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
const ohEvents = await calendar.getCalendarView({
  calendarId: 'AAMkAGMxNTQyZjUyLWE5MjYtNDQ2ZS1iYWMxLTA0ZTgxMmZiOGYxOABGAAAAAAA1aYnhhmn8TIASxaX7OOulBwCme88kvStVQZzo4G036zUXAAAAAAEGAACme88kvStVQZzo4G036zUXAAFiW2tzAAA=',
  startDateTime: now.toISOString(),
  endDateTime: future.toISOString()
});
```

### Step 3: Extract unique cohorts from office hours
Parse each event subject to extract the cohort name. Subjects follow patterns like:
- "AI Bootcamp Office Hours (Optional) <Cohort Name>"
- "AI for Marketing Bootcamp Office Hours <Cohort Name> (Optional)"

Extract the cohort identifier. Deduplicate. Count events per cohort to estimate remaining sessions.

### Step 4: Merge data
Build two lists:
- `activeCohorts`: cohorts with upcoming OH events, each with { name, sessions (remaining OH count) }
- `scheduledCohorts`: truly scheduled cohorts from Asana (not completed, session dates in future), each with { name, instructor }

The office hours calendar is the primary source for active cohorts. The Asana board supplements with instructor assignments and pipeline data.

### Step 5: Build weekly event density
Group office hours events by week (Mon-Sun). For each week: { week (short label like "2/17"), sessions (count of events) }. Show next 8 weeks.

## Values to Return
- `activeCount`: number (unique cohorts with upcoming OH events — the most reliable active count)
- `scheduledCount`: number (truly scheduled on Asana, not yet started)
- `officeHourCohorts`: number (unique cohorts with OH events)
- `totalSessions`: number (total OH events in next 60 days)
- `activeCohorts`: array of { name, instructor }
- `scheduledCohorts`: array of { name, instructor }
- `weeklyDensity`: array of { week, sessions }
"""

template_jsx = r"""(() => {
  const activeCount = ACTIVE_COUNT_PLACEHOLDER;
  const scheduledCount = SCHEDULED_COUNT_PLACEHOLDER;
  const officeHourCohorts = OH_COHORTS_PLACEHOLDER;
  const totalSessions = TOTAL_SESSIONS_PLACEHOLDER;
  const activeCohorts = ACTIVE_COHORTS_PLACEHOLDER;
  const scheduledCohorts = SCHEDULED_COHORTS_PLACEHOLDER;
  const weeklyDensity = WEEKLY_DENSITY_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Active'} value={activeCount} subtitle={'Underway now'} />
        <StatCard label={'Scheduling'} value={scheduledCount} subtitle={'Being set up'} />
        <StatCard label={'OH Cohorts'} value={officeHourCohorts} subtitle={'With office hours'} />
        <StatCard label={'OH Sessions'} value={totalSessions} subtitle={'Next 60 days'} />
      </MetricRow>

      <div style={{ height: 220, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Weekly Office Hours Density</div>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={weeklyDensity} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="sessions" name="OH Sessions" fill={theme.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Active Cohorts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeCohorts.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderRadius: 8, background: theme.accent + '0a', border: '1px solid ' + theme.line }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>{c.name}</span>
                <span style={{ fontSize: 11, color: theme.inkMuted }}>{c.instructor}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Scheduling Pipeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scheduledCohorts.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 12px', borderRadius: 8, background: '#eab308' + '0a', border: '1px solid ' + theme.line }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: theme.ink }}>{c.name}</span>
                <span style={{ fontSize: 11, color: theme.inkMuted }}>{c.instructor}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <MetricNote>Source: Asana Ops board + Microsoft Calendar office hours</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

active_cohorts = [
    {"name": "DealNews Cohort 1", "instructor": "Isabelle"},
    {"name": "DealNews Cohort 2", "instructor": "Isabelle"},
    {"name": "DealNews Cohort 3", "instructor": "Isabelle"},
    {"name": "Total Package HR", "instructor": "Isabelle"},
    {"name": "SPMB Cohort 3", "instructor": "Isabelle"},
    {"name": "02.04 Cohort", "instructor": "—"},
    {"name": "02.13.26 Cohort", "instructor": "—"},
    {"name": "02.25.26 Cohort", "instructor": "—"},
    {"name": "01.20.26 Cohort", "instructor": "—"},
    {"name": "01.05.26 Cohort", "instructor": "—"},
    {"name": "85C Bakery", "instructor": "—"},
    {"name": "Anderson Howard", "instructor": "—"},
    {"name": "Preservation Equity", "instructor": "James"},
    {"name": "Heller Consulting", "instructor": "—"},
    {"name": "DMT Law Firm", "instructor": "—"},
    {"name": "Cush Plaza Properties", "instructor": "—"},
    {"name": "Gibbs Construction", "instructor": "—"},
    {"name": "SVN", "instructor": "—"},
    {"name": "Phoenix Manufacturing", "instructor": "—"},
    {"name": "Immatics 1", "instructor": "—"},
    {"name": "Immatics 2", "instructor": "—"},
    {"name": "InOvate", "instructor": "—"},
    {"name": "Netgain", "instructor": "—"},
    {"name": "Parron Hall", "instructor": "—"},
    {"name": "Partner4Work", "instructor": "—"},
    {"name": "Sadoff", "instructor": "—"},
    {"name": "Scimitar", "instructor": "—"},
    {"name": "10 Fitness", "instructor": "—"},
    {"name": "Total Environmental Mgmt", "instructor": "—"},
    {"name": "True Movement Tech", "instructor": "—"},
    {"name": "Tarlton", "instructor": "—"},
    {"name": "Statewide PA", "instructor": "—"},
    {"name": "Anglepoint", "instructor": "—"},
    {"name": "Citadel CPM", "instructor": "—"},
    {"name": "Nolan Consulting", "instructor": "—"},
    {"name": "12.02 Marketing", "instructor": "—"},
    {"name": "12.05 Cohort", "instructor": "—"},
    {"name": "12.12 Cohort", "instructor": "—"},
    {"name": "12.18 Cohort", "instructor": "—"},
    {"name": "11.19 Cohort", "instructor": "—"},
    {"name": "01.14.26 Cohort", "instructor": "—"},
    {"name": "01.26.26 Agents", "instructor": "—"},
]

scheduled_cohorts = []

weekly_density = [
    {"week": "2/17", "sessions": 52},
    {"week": "2/24", "sessions": 48},
    {"week": "3/2", "sessions": 45},
    {"week": "3/9", "sessions": 42},
    {"week": "3/16", "sessions": 38},
    {"week": "3/23", "sessions": 35},
    {"week": "3/30", "sessions": 30},
    {"week": "4/6", "sessions": 25},
]

initial_values = json.dumps({
    "activeCount": 42,
    "scheduledCount": 0,
    "officeHourCohorts": 42,
    "totalSessions": 315,
    "activeCohorts": active_cohorts,
    "scheduledCohorts": scheduled_cohorts,
    "weeklyDensity": weekly_density,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("ACTIVE_COUNT_PLACEHOLDER", "42")
    html = html.replace("SCHEDULED_COUNT_PLACEHOLDER", "0")
    html = html.replace("OH_COHORTS_PLACEHOLDER", "42")
    html = html.replace("TOTAL_SESSIONS_PLACEHOLDER", "315")
    html = html.replace("ACTIVE_COHORTS_PLACEHOLDER", json.dumps(active_cohorts))
    html = html.replace("SCHEDULED_COHORTS_PLACEHOLDER", json.dumps(scheduled_cohorts))
    html = html.replace("WEEKLY_DENSITY_PLACEHOLDER", json.dumps(weekly_density))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["upcoming cohorts", "cohort calendar", "bootcamp schedule", "office hours schedule"],
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
            (binding_id, SCREEN_ID, metric_id, 5, "wide", 0, 60, 8, 16),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x16)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
