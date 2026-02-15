#!/usr/bin/env python3
"""Seed batch 2: Team, Marketing, Client, and Rocks metrics from Asana data."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

EXISTING = {
    "monthly-revenue": "35231c42-b088-4da4-b2f2-f25ebce87e36",
    "monthly-net-income": "6353801b-e51e-491d-ab5e-a780ed36b62a",
    "sales-pipeline-value": "6978d569-0b74-452b-b3e7-5de51c90d239",
    "closed-won-monthly": "93ba384c-b172-4072-9e74-c4705f38c349",
    "cash-position-ar": "53ac482e-61fd-4faf-9cd2-829ea591372d",
    "trailing-30-day-leads": "7c765544-15a4-4c66-a458-1f5db331f2f8",
}

metrics = []

# ═══════════════════════════════════════════════════════════════════════
# TEAM SCORECARD SCREEN
# ═══════════════════════════════════════════════════════════════════════

# Team workload from Asana
team_workload = [
    {"name": "Josh Sullivan", "open": 18, "dueThisWeek": 8, "overdue": 3},
    {"name": "Jordan McDaniel", "open": 22, "dueThisWeek": 12, "overdue": 5},
    {"name": "James Hill-Jiang", "open": 14, "dueThisWeek": 5, "overdue": 1},
    {"name": "Schuyler Dragoo", "open": 12, "dueThisWeek": 10, "overdue": 8},
    {"name": "Kym Parodo", "open": 6, "dueThisWeek": 3, "overdue": 1},
    {"name": "Isabelle Coloma", "open": 4, "dueThisWeek": 1, "overdue": 0},
    {"name": "Sohrab Azad", "open": 3, "dueThisWeek": 1, "overdue": 0},
]
team_json = json.dumps(team_workload)

metrics.append({
    "slug": "team-workload",
    "name": "Team Workload",
    "screen_id": "team-scorecard",
    "instructions": r"""Track team member task load from Asana.

## Data Source
Asana Tasks via Kiingo MCP `asana` module.

## Retrieval Steps
1. Get all workspace users from Asana.
2. For each team member, search tasks: `asana.searchTasks({ assignee: '<user_gid>', completed: false })`.
3. Count: total open tasks, tasks due this week, overdue tasks (due_on < today and not completed).
4. Build workload array sorted by open task count descending.

## Values to Return
- `teamWorkload`: array of { name, open, dueThisWeek, overdue }
- `totalOpenTasks`: sum of all open tasks
- `totalOverdue`: sum of all overdue tasks""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const totalOpen = data.reduce((s, d) => s + d.open, 0);
  const totalOverdue = data.reduce((s, d) => s + d.overdue, 0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Total Open Tasks" value={totalOpen} subtitle="Across team" />
        <StatCard label="Overdue" value={totalOverdue} subtitle="Past due date" trendDirection={totalOverdue > 5 ? 'down' : 'flat'} />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis type="category" dataKey="name" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={95} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="open" name="Open" fill={theme.accent} radius={[0,4,4,0]} stackId="a" />
            <Bar dataKey="overdue" name="Overdue" fill={theme.danger} radius={[0,4,4,0]} stackId="b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: Asana Tasks via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"teamWorkload": team_workload, "totalOpenTasks": sum(t["open"] for t in team_workload), "totalOverdue": sum(t["overdue"] for t in team_workload)}),
    "initial_html": f"""(() => {{
  const data = {team_json};
  const totalOpen = data.reduce((s, d) => s + d.open, 0);
  const totalOverdue = data.reduce((s, d) => s + d.overdue, 0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Total Open Tasks" value={{totalOpen}} subtitle="Across team" />
        <StatCard label="Overdue" value={{totalOverdue}} subtitle="Past due date" trendDirection={{totalOverdue > 5 ? 'down' : 'flat'}} />
      </MetricRow>
      <div style={{{{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={{data}} layout="vertical" margin={{{{ top: 5, right: 20, left: 100, bottom: 5 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis type="number" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis type="category" dataKey="name" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} width={{95}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} />
            <Bar dataKey="open" name="Open" fill={{theme.accent}} radius={{[0,4,4,0]}} stackId="a" />
            <Bar dataKey="overdue" name="Overdue" fill={{theme.danger}} radius={{[0,4,4,0]}} stackId="b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: Asana Tasks via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 43200,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# TEAM ROCKS SCREEN
# ═══════════════════════════════════════════════════════════════════════

rocks_data = [
    {"rock": "1. Bootcamp Scaling", "projects": 3, "tasksComplete": 12, "tasksTotal": 28, "pct": 43},
    {"rock": "2. Content & Vault", "projects": 4, "tasksComplete": 8, "tasksTotal": 32, "pct": 25},
    {"rock": "3. Self-Service Course", "projects": 3, "tasksComplete": 5, "tasksTotal": 20, "pct": 25},
    {"rock": "4. Platform Infrastructure", "projects": 2, "tasksComplete": 6, "tasksTotal": 16, "pct": 38},
    {"rock": "5. Dev Curriculum", "projects": 3, "tasksComplete": 4, "tasksTotal": 18, "pct": 22},
    {"rock": "6. Content Systems", "projects": 3, "tasksComplete": 10, "tasksTotal": 24, "pct": 42},
    {"rock": "7. Capacity Planning", "projects": 3, "tasksComplete": 7, "tasksTotal": 15, "pct": 47},
]
rocks_json = json.dumps(rocks_data)

metrics.append({
    "slug": "quarterly-rocks-progress",
    "name": "Q1 2026 Rocks Progress",
    "screen_id": "team-rocks",
    "instructions": r"""Track quarterly rocks (strategic objectives) progress from Asana projects.

## Data Source
Asana Projects and Tasks via Kiingo MCP.

## Retrieval Steps
1. Search Asana projects matching rock pattern (numbered projects like "1.1:", "2.1:", etc.).
2. Group by rock number (1-7). For each rock:
   - Count total sub-projects
   - Count completed vs total tasks across all sub-projects
   - Compute completion percentage
3. Build rocks array sorted by rock number.

## Values to Return
- `rocks`: array of { rock (name), projects, tasksComplete, tasksTotal, pct }
- `overallProgress`: weighted average completion across all rocks
- `atRiskRocks`: rocks with < 20% completion past quarter midpoint""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const overall = Math.round(data.reduce((s, d) => s + d.pct, 0) / data.length);
  return (
    <MetricSection>
      <StatCard label="Overall Rock Progress" value={overall + '%'} subtitle="Q1 2026 average" trendDirection={overall > 40 ? 'up' : overall > 25 ? 'flat' : 'down'} />
      <div style={{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 130, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => v + '%'} domain={[0, 100]} />
            <YAxis type="category" dataKey="rock" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} width={125} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => v + '%'} />
            <Bar dataKey="pct" name="Progress" fill={theme.accent} radius={[0,4,4,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: Asana Projects via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"rocks": rocks_data, "overallProgress": 35}),
    "initial_html": f"""(() => {{
  const data = {rocks_json};
  const overall = Math.round(data.reduce((s, d) => s + d.pct, 0) / data.length);
  return (
    <MetricSection>
      <StatCard label="Overall Rock Progress" value={{overall + '%'}} subtitle="Q1 2026 average" trendDirection={{overall > 40 ? 'up' : overall > 25 ? 'flat' : 'down'}} />
      <div style={{{{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={{data}} layout="vertical" margin={{{{ top: 5, right: 30, left: 130, bottom: 5 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis type="number" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => v + '%'}} domain={{[0, 100]}} />
            <YAxis type="category" dataKey="rock" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 10 }}}} width={{125}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => v + '%'}} />
            <Bar dataKey="pct" name="Progress" fill={{theme.accent}} radius={{[0,4,4,0]}} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: Asana Projects via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 43200,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# DEPT-MARKETING SCREEN
# ═══════════════════════════════════════════════════════════════════════

mktg_data = [
    {"initiative": "LinkedIn Content", "status": "In Progress", "tasksComplete": 3, "tasksTotal": 8},
    {"initiative": "Vistage Systems", "status": "In Progress", "tasksComplete": 2, "tasksTotal": 5},
    {"initiative": "Demo Videos", "status": "In Progress", "tasksComplete": 1, "tasksTotal": 3},
    {"initiative": "Ad Campaigns", "status": "In Progress", "tasksComplete": 1, "tasksTotal": 4},
    {"initiative": "Website Pages", "status": "In Progress", "tasksComplete": 0, "tasksTotal": 3},
    {"initiative": "Alumni Group", "status": "Not Started", "tasksComplete": 0, "tasksTotal": 2},
]

metrics.append({
    "slug": "marketing-initiatives",
    "name": "Marketing Initiatives",
    "screen_id": "dept-marketing",
    "instructions": r"""Track marketing initiatives and their task completion from Asana.

## Data Source
Asana Tasks via search for marketing-related tasks (assigned to marketing team member Schuyler Dragoo and marketing-tagged projects).

## Retrieval Steps
1. Search Asana tasks assigned to the marketing team member(s) or in marketing projects.
2. Group by initiative/project.
3. For each initiative, count completed vs total tasks.
4. Determine status: Not Started, In Progress, At Risk, Complete.

## Values to Return
- `initiatives`: array of { initiative, status, tasksComplete, tasksTotal }
- `totalInitiatives`: count of initiatives
- `completionRate`: overall tasks completed / total""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const total = data.reduce((s, d) => s + d.tasksTotal, 0);
  const done = data.reduce((s, d) => s + d.tasksComplete, 0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Initiatives" value={data.length} subtitle="Marketing Q1" />
        <StatCard label="Tasks Done" value={done + '/' + total} subtitle={Math.round(done/total*100) + '% complete'} />
      </MetricRow>
      <div style={{ marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: i % 2 === 0 ? theme.panel : 'transparent', borderRadius: 8 }}>
            <span style={{ flex: 1, color: theme.ink, fontSize: 13 }}>{d.initiative}</span>
            <span style={{ color: theme.inkMuted, fontSize: 12, minWidth: 60 }}>{d.tasksComplete}/{d.tasksTotal}</span>
            <div style={{ width: 100, height: 6, background: theme.line, borderRadius: 3 }}>
              <div style={{ width: (d.tasksTotal > 0 ? d.tasksComplete / d.tasksTotal * 100 : 0) + '%', height: '100%', background: theme.accent, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>
      <MetricNote>Source: Asana Tasks via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"initiatives": mktg_data}),
    "initial_html": f"""(() => {{
  const data = {json.dumps(mktg_data)};
  const total = data.reduce((s, d) => s + d.tasksTotal, 0);
  const done = data.reduce((s, d) => s + d.tasksComplete, 0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Initiatives" value={{data.length}} subtitle="Marketing Q1" />
        <StatCard label="Tasks Done" value={{done + '/' + total}} subtitle={{Math.round(done/total*100) + '% complete'}} />
      </MetricRow>
      <div style={{{{ marginTop: 8 }}}}>
        {{data.map((d, i) => (
          <div key={{i}} style={{{{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: i % 2 === 0 ? theme.panel : 'transparent', borderRadius: 8 }}}}>
            <span style={{{{ flex: 1, color: theme.ink, fontSize: 13 }}}}> {{d.initiative}}</span>
            <span style={{{{ color: theme.inkMuted, fontSize: 12, minWidth: 60 }}}}> {{d.tasksComplete}}/{{d.tasksTotal}}</span>
            <div style={{{{ width: 100, height: 6, background: theme.line, borderRadius: 3 }}}}>
              <div style={{{{ width: (d.tasksTotal > 0 ? d.tasksComplete / d.tasksTotal * 100 : 0) + '%', height: '100%', background: theme.accent, borderRadius: 3 }}}} />
            </div>
          </div>
        ))}}
      </div>
      <MetricNote>Source: Asana Tasks via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 43200,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# CLIENT HEALTH SCREEN — Active Client Projects
# ═══════════════════════════════════════════════════════════════════════

client_projects = [
    {"client": "85C Bakery", "type": "AI Bootcamp", "status": "Active", "sessions": "4/7"},
    {"client": "ATS Construction", "type": "Foundational Bootcamp", "status": "Setup", "sessions": "0/6"},
    {"client": "Tire Discounter Group", "type": "Private Bootcamp", "status": "Setup", "sessions": "0/6"},
    {"client": "Oxford Road", "type": "Prompt Engineering", "status": "Scoping", "sessions": "0/4"},
    {"client": "Scimitar", "type": "AI Bootcamp", "status": "Active", "sessions": "3/7"},
    {"client": "Juana", "type": "Foundational Bootcamp", "status": "Setup", "sessions": "0/6"},
    {"client": "KC HiLiTES", "type": "Consulting", "status": "Active", "sessions": "N/A"},
]

metrics.append({
    "slug": "active-client-projects",
    "name": "Active Client Projects",
    "screen_id": "client-health",
    "instructions": r"""Track active client engagement projects from Asana.

## Data Source
Asana Projects via Kiingo MCP.

## Retrieval Steps
1. Search Asana projects matching client project patterns (Bootcamp, Consulting, etc.).
2. Filter to non-archived, active projects.
3. For each project, determine: client name, engagement type, status, progress.
4. Sort by status: Active first, then Setup, then Scoping.

## Values to Return
- `clientProjects`: array of { client, type, status, sessions }
- `activeCount`: number of active projects
- `totalRevenue`: estimated revenue from active projects (if deal amounts available)""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const active = data.filter(d => d.status === 'Active').length;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Projects" value={active} subtitle="In delivery" />
        <StatCard label="Total Projects" value={data.length} subtitle="All stages" />
      </MetricRow>
      <div style={{ marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: i % 2 === 0 ? theme.panel : 'transparent', borderRadius: 8 }}>
            <span style={{ flex: 1, color: theme.ink, fontSize: 13, fontWeight: 600 }}>{d.client}</span>
            <span style={{ color: theme.inkMuted, fontSize: 12, minWidth: 120 }}>{d.type}</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: d.status === 'Active' ? theme.accent : theme.line, color: d.status === 'Active' ? '#fff' : theme.ink }}>{d.status}</span>
            <span style={{ color: theme.inkMuted, fontSize: 12, minWidth: 40 }}>{d.sessions}</span>
          </div>
        ))}
      </div>
      <MetricNote>Source: Asana Projects via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"clientProjects": client_projects, "activeCount": 3}),
    "initial_html": f"""(() => {{
  const data = {json.dumps(client_projects)};
  const active = data.filter(d => d.status === 'Active').length;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Projects" value={{active}} subtitle="In delivery" />
        <StatCard label="Total Projects" value={{data.length}} subtitle="All stages" />
      </MetricRow>
      <div style={{{{ marginTop: 8 }}}}>
        {{data.map((d, i) => (
          <div key={{i}} style={{{{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: i % 2 === 0 ? theme.panel : 'transparent', borderRadius: 8 }}}}>
            <span style={{{{ flex: 1, color: theme.ink, fontSize: 13, fontWeight: 600 }}}}> {{d.client}}</span>
            <span style={{{{ color: theme.inkMuted, fontSize: 12, minWidth: 120 }}}}> {{d.type}}</span>
            <span style={{{{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: d.status === 'Active' ? theme.accent : theme.line, color: d.status === 'Active' ? '#fff' : theme.ink }}}}> {{d.status}}</span>
            <span style={{{{ color: theme.inkMuted, fontSize: 12, minWidth: 40 }}}}> {{d.sessions}}</span>
          </div>
        ))}}
      </div>
      <MetricNote>Source: Asana Projects via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 43200,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# PATH1-BOOTCAMPS SCREEN — Bootcamp pipeline
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "bootcamp-pipeline",
    "name": "Bootcamp Pipeline",
    "screen_id": "path1-bootcamps",
    "instructions": r"""Track bootcamp delivery pipeline: upcoming, active, and completed bootcamps.

## Data Sources
- Asana: bootcamp projects for delivery status
- TalentLMS: course enrollment and completion data
- HubSpot: bootcamp deal pipeline for revenue

## Retrieval Steps
1. Search Asana projects matching "Bootcamp" pattern.
2. Get TalentLMS courses via `talentlms.getCourses()`. Filter active bootcamp courses.
3. Search HubSpot deals in bootcamp pipelines ('796531479' Bootcamp, '797119779' Private Bootcamp).
4. Merge data: project status from Asana, enrollment from TalentLMS, revenue from HubSpot.

## Values to Return
- `activeBootcamps`: number of currently running bootcamps
- `upcomingBootcamps`: in setup or scheduled
- `completedBootcamps`: finished in last 12 months
- `totalParticipants`: total enrolled across active courses
- `bootcampRevenue`: total revenue from bootcamp deals (LTM)""",
    "template_jsx": r"""(() => {
  const active = ACTIVE_PLACEHOLDER;
  const upcoming = UPCOMING_PLACEHOLDER;
  const completed = COMPLETED_PLACEHOLDER;
  const participants = PARTICIPANTS_PLACEHOLDER;
  const revenue = REVENUE_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active" value={active} subtitle="Running now" />
        <StatCard label="Upcoming" value={upcoming} subtitle="In setup" />
        <StatCard label="Completed (LTM)" value={completed} subtitle="Last 12 months" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Total Participants" value={participants} subtitle="Active courses" />
        <StatCard label="Bootcamp Revenue" value={'$' + (revenue / 1000).toFixed(0) + 'K'} subtitle="LTM" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"activeBootcamps": 2, "upcomingBootcamps": 3, "completedBootcamps": 26, "totalParticipants": 85, "bootcampRevenue": 680000}),
    "initial_html": r"""(() => {
  const active = 2;
  const upcoming = 3;
  const completed = 26;
  const participants = 85;
  const revenue = 680000;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active" value={active} subtitle="Running now" />
        <StatCard label="Upcoming" value={upcoming} subtitle="In setup" />
        <StatCard label="Completed (LTM)" value={completed} subtitle="Last 12 months" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Total Participants" value={participants} subtitle="Active courses" />
        <StatCard label="Bootcamp Revenue" value={'$' + (revenue / 1000).toFixed(0) + 'K'} subtitle="LTM" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 6, "grid_x": 0, "grid_y": 0, "position": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# DEPT-ENGINEERING SCREEN — Engineering velocity
# ═══════════════════════════════════════════════════════════════════════

eng_projects = [
    {"project": "Kiingo Command Center", "openTasks": 12, "priority": "High"},
    {"project": "Kiingo MCP Server", "openTasks": 8, "priority": "High"},
    {"project": "Email CLI and Viewer", "openTasks": 6, "priority": "Medium"},
    {"project": "Claude Code Skills", "openTasks": 4, "priority": "Medium"},
]

metrics.append({
    "slug": "engineering-projects",
    "name": "Engineering Projects",
    "screen_id": "dept-engineering",
    "instructions": r"""Track engineering project status from Asana.

## Data Source
Asana Projects and Tasks via Kiingo MCP.

## Retrieval Steps
1. Search Asana projects matching engineering-related names (Kiingo Command Center, Kiingo MCP Server, Email CLI, etc.).
2. For each project, count open tasks and determine priority based on recent activity.
3. Also look for engineering tasks in the quarterly rocks.

## Values to Return
- `projects`: array of { project, openTasks, priority }
- `totalOpenTasks`: sum of all engineering open tasks""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const total = data.reduce((s, d) => s + d.openTasks, 0);
  return (
    <MetricSection>
      <StatCard label="Open Engineering Tasks" value={total} subtitle="Across projects" />
      <div style={{ marginTop: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: i % 2 === 0 ? theme.panel : 'transparent', borderRadius: 8 }}>
            <span style={{ flex: 1, color: theme.ink, fontSize: 13, fontWeight: 600 }}>{d.project}</span>
            <span style={{ color: theme.inkMuted, fontSize: 12 }}>{d.openTasks} tasks</span>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: d.priority === 'High' ? theme.danger : theme.accent, color: '#fff' }}>{d.priority}</span>
          </div>
        ))}
      </div>
      <MetricNote>Source: Asana Projects via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"projects": eng_projects}),
    "initial_html": f"""(() => {{
  const data = {json.dumps(eng_projects)};
  const total = data.reduce((s, d) => s + d.openTasks, 0);
  return (
    <MetricSection>
      <StatCard label="Open Engineering Tasks" value={{total}} subtitle="Across projects" />
      <div style={{{{ marginTop: 8 }}}}>
        {{data.map((d, i) => (
          <div key={{i}} style={{{{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: i % 2 === 0 ? theme.panel : 'transparent', borderRadius: 8 }}}}>
            <span style={{{{ flex: 1, color: theme.ink, fontSize: 13, fontWeight: 600 }}}}> {{d.project}}</span>
            <span style={{{{ color: theme.inkMuted, fontSize: 12 }}}}> {{d.openTasks}} tasks</span>
            <span style={{{{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: d.priority === 'High' ? theme.danger : theme.accent, color: '#fff' }}}}> {{d.priority}}</span>
          </div>
        ))}}
      </div>
      <MetricNote>Source: Asana Projects via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 43200,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 7, "grid_x": 0, "grid_y": 0, "position": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# EXECUTE
# ═══════════════════════════════════════════════════════════════════════

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
               VALUES (?, ?, ?, ?, ?, ?, 'claude', 1, 0, '{}', ?, ?)""",
            (metric_id, m["name"], slug, m["instructions"], m["template_jsx"], m["ttl"], NOW, NOW)
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
