#!/usr/bin/env python3
"""Seed: Bootcamp Learner Engagement — TalentLMS learner and course activity."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "bootcamp-learner-engagement"
NAME = "Bootcamp Learner Engagement"
SCREEN_ID = "dept-operations"

instructions = r"""Track bootcamp learner engagement from TalentLMS — total learners, active courses, and recent login activity.

## Data Source
TalentLMS portal: kiingo.talentlms.com

## Retrieval Steps

### Step 1: Get portal statistics
```typescript
import { talentlms } from 'tools';
const stats = await talentlms.getStatistics({ portalHost: 'kiingo.talentlms.com' });
```
Extract: total_users, total_courses, total_groups

### Step 2: Count active vs completed courses
```typescript
const allCourses = [];
let page = 1;
while (page <= 5) {
  const c = await talentlms.listCourses({ portalHost: 'kiingo.talentlms.com', limit: 100, page });
  if (!c.items || c.items.length === 0) break;
  allCourses.push(...c.items);
  if (c.items.length < 100) break;
  page++;
}
```
Deduplicate courses by ID. Count courses with status "active" vs "inactive".
Active courses = currently running cohorts. Inactive = completed.
Extract active course names for display.

### Step 3: Get recent login activity
```typescript
const timeline = await talentlms.listTimeline({ portalHost: 'kiingo.talentlms.com', limit: 100 });
```
Count unique users who logged in today (matching today's date).
Count unique users who logged in in the last 7 days.
Group logins by day for the last 7 days to show daily activity trend.

### Step 4: Structure the data

For `activeCourses`, list each active course name.

For `dailyLogins`, create an array of the last 7 days with { day (short label like "Mon", "Tue"), logins (unique user count) }.

## Values to Return
- `totalLearners`: number (total_users from stats)
- `totalCourses`: number (total_courses from stats)
- `activeCourses`: number (count of active-status courses)
- `completedCourses`: number (count of inactive-status courses)
- `totalGroups`: number (total_groups from stats)
- `activeCourseNames`: array of strings
- `loginsToday`: number
- `loginsWeek`: number
- `dailyLogins`: array of { day, logins }
"""

template_jsx = r"""(() => {
  const totalLearners = TOTAL_LEARNERS_PLACEHOLDER;
  const activeCourses = ACTIVE_COURSES_PLACEHOLDER;
  const completedCourses = COMPLETED_COURSES_PLACEHOLDER;
  const totalGroups = TOTAL_GROUPS_PLACEHOLDER;
  const activeCourseNames = ACTIVE_COURSE_NAMES_PLACEHOLDER;
  const loginsToday = LOGINS_TODAY_PLACEHOLDER;
  const loginsWeek = LOGINS_WEEK_PLACEHOLDER;
  const dailyLogins = DAILY_LOGINS_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Total Learners'} value={totalLearners.toLocaleString()} subtitle={'All-time enrolled'} />
        <StatCard label={'Active Cohorts'} value={activeCourses} subtitle={completedCourses + ' completed'} />
        <StatCard label={'Logins Today'} value={loginsToday} subtitle={'Unique learners'} />
        <StatCard label={'Logins This Week'} value={loginsWeek} subtitle={'7-day unique'} />
      </MetricRow>

      <div style={{ height: 220, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Daily Login Activity (Last 7 Days)</div>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={dailyLogins} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="day" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="logins" name="Unique Logins" fill={theme.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {activeCourseNames.length > 0 && (
        <div style={{ background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Active Courses</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {activeCourseNames.map((name, i) => (
              <div key={i} style={{ padding: '6px 14px', borderRadius: 20, background: theme.accent + '22', color: theme.accent, fontSize: 12, fontWeight: 600, border: '1px solid ' + theme.accent + '44' }}>{name}</div>
            ))}
          </div>
        </div>
      )}

      <MetricNote>Source: TalentLMS · kiingo.talentlms.com · {totalGroups} groups</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

daily_logins = [
    {"day": "Wed", "logins": 18},
    {"day": "Thu", "logins": 22},
    {"day": "Fri", "logins": 15},
    {"day": "Sat", "logins": 4},
    {"day": "Sun", "logins": 2},
    {"day": "Mon", "logins": 28},
    {"day": "Tue", "logins": 35},
]

active_course_names = [
    "AI Bootcamp 02.06.26 Cohort",
    "Vistage Chair AI Bootcamp February 2025",
    "Kiingo Asynchronous Content",
    "AI Bootcamp 04.17.25 Cohort",
]

initial_values = json.dumps({
    "totalLearners": 2167,
    "totalCourses": 148,
    "activeCourses": 4,
    "completedCourses": 46,
    "totalGroups": 134,
    "activeCourseNames": active_course_names,
    "loginsToday": 35,
    "loginsWeek": 124,
    "dailyLogins": daily_logins,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("TOTAL_LEARNERS_PLACEHOLDER", "2167")
    html = html.replace("ACTIVE_COURSES_PLACEHOLDER", "4")
    html = html.replace("COMPLETED_COURSES_PLACEHOLDER", "46")
    html = html.replace("TOTAL_GROUPS_PLACEHOLDER", "134")
    html = html.replace("ACTIVE_COURSE_NAMES_PLACEHOLDER", json.dumps(active_course_names))
    html = html.replace("LOGINS_TODAY_PLACEHOLDER", "35")
    html = html.replace("LOGINS_WEEK_PLACEHOLDER", "124")
    html = html.replace("DAILY_LOGINS_PLACEHOLDER", json.dumps(daily_logins))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["learner engagement", "talentlms", "bootcamp learners", "lms activity"],
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
            (binding_id, SCREEN_ID, metric_id, 1, "wide", 0, 12, 8, 10),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x10)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
