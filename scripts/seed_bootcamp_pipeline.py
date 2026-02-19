#!/usr/bin/env python3
"""Seed: Bootcamp Pipeline — open bootcamp deals by stage and type from CRM."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "bootcamp-pipeline"
NAME = "Bootcamp Pipeline"
SCREEN_ID = "dept-operations"

instructions = r"""Show the current bootcamp deal pipeline — open deals by stage and type, giving visibility into upcoming bootcamp capacity needs.

## Data Source
Kiingo PostgreSQL database → `crm_deal` table

## Retrieval Steps

### Step 1: Pipeline by stage
```typescript
import { sql } from 'tools';
const byStage = await sql.query({
  database: 'kiingo',
  sql: `
    SELECT stage, COUNT(*) as cnt
    FROM crm_deal
    WHERE "isClosed" = false
      AND ("dealType" ILIKE '%bootcamp%' OR "dealType" ILIKE '%foundational%')
    GROUP BY stage
    ORDER BY cnt DESC
  `
});
```

### Step 2: Pipeline by deal type and stage
```typescript
const byTypeStage = await sql.query({
  database: 'kiingo',
  sql: `
    SELECT "dealType", stage, COUNT(*) as cnt
    FROM crm_deal
    WHERE "isClosed" = false
      AND ("dealType" ILIKE '%bootcamp%' OR "dealType" ILIKE '%foundational%')
    GROUP BY "dealType", stage
    ORDER BY "dealType", cnt DESC
  `
});
```

### Step 3: Deals in scheduling stages (upcoming capacity)
```typescript
const scheduling = await sql.query({
  database: 'kiingo',
  sql: `
    SELECT d.title, d."dealType", d.stage,
      c."canonicalName" as company,
      d."dateOpened",
      d."projectedCloseDate"
    FROM crm_deal d
    LEFT JOIN crm_company c ON c.id = d."crmCompanyId"
    WHERE d."isClosed" = false
      AND ("dealType" ILIKE '%bootcamp%' OR "dealType" ILIKE '%foundational%')
      AND d.stage IN ('schedule cohort', 'register cohort')
    ORDER BY d."dateOpened" DESC
  `
});
```

### Step 4: Structure the data

Map stages to a funnel order for display. Use short labels:
- "discovery" + "outreach" + "lead in" → "Discovery"
- "proposal" → "Proposal"
- "schedule cohort" → "Scheduling"
- "register cohort" → "Registering"
- "on hold" → "On Hold"
- "return to sales renewal" / "returned to sales renewal" / "cold" → "Stale/Renewal"

For `funnelData`, create an array sorted by funnel order with { stage, count }.

For `typeBreakdown`, group by dealType with total count per type. Use short labels:
- "AI Foundational Bootcamp" → "AI Foundational"
- "Private Foundational Bootcamp" → "Private"
- "AI Agents Bootcamp" → "AI Agents"
- "Specialized Bootcamp" → "Specialized"

For `schedulingDeals`, list the deals in "schedule cohort" and "register cohort" stages with company name and type.

## Values to Return
- `totalOpen`: number
- `scheduling`: number (schedule cohort + register cohort)
- `proposals`: number
- `onHold`: number
- `funnelData`: array of { stage, count }
- `typeBreakdown`: array of { type, count }
- `schedulingDeals`: array of { title, company, type }
"""

template_jsx = r"""(() => {
  const totalOpen = TOTAL_OPEN_PLACEHOLDER;
  const scheduling = SCHEDULING_PLACEHOLDER;
  const proposals = PROPOSALS_PLACEHOLDER;
  const onHold = ON_HOLD_PLACEHOLDER;
  const funnelData = FUNNEL_DATA_PLACEHOLDER;
  const typeBreakdown = TYPE_BREAKDOWN_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Open Deals'} value={totalOpen} subtitle={'All bootcamp types'} />
        <StatCard label={'Scheduling'} value={scheduling} subtitle={'Confirmed upcoming'} />
        <StatCard label={'In Proposal'} value={proposals} subtitle={'Awaiting close'} />
        <StatCard label={'On Hold'} value={onHold} subtitle={'Paused deals'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Pipeline by Stage</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={funnelData} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis type="category" dataKey="stage" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={80} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="count" name="Deals" fill={theme.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 240, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>By Bootcamp Type</div>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart data={typeBreakdown} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="type" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} angle={-15} textAnchor="end" />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="count" name="Open Deals" fill={theme.secondary} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricNote>Source: Kiingo CRM · Open bootcamp deals · Pipeline stages</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

funnel_data = [
    {"stage": "Proposal", "count": 64},
    {"stage": "On Hold", "count": 35},
    {"stage": "Scheduling", "count": 25},
    {"stage": "Stale/Renewal", "count": 18},
    {"stage": "Discovery", "count": 6},
    {"stage": "Registering", "count": 2},
]

type_breakdown = [
    {"type": "Private", "count": 104},
    {"type": "AI Foundational", "count": 35},
    {"type": "AI Agents", "count": 11},
    {"type": "Specialized", "count": 1},
]

initial_values = json.dumps({
    "totalOpen": 151,
    "scheduling": 27,
    "proposals": 64,
    "onHold": 35,
    "funnelData": funnel_data,
    "typeBreakdown": type_breakdown,
    "schedulingDeals": [],
})


def make_initial_html():
    html = template_jsx
    html = html.replace("TOTAL_OPEN_PLACEHOLDER", "151")
    html = html.replace("SCHEDULING_PLACEHOLDER", "27")
    html = html.replace("PROPOSALS_PLACEHOLDER", "64")
    html = html.replace("ON_HOLD_PLACEHOLDER", "35")
    html = html.replace("FUNNEL_DATA_PLACEHOLDER", json.dumps(funnel_data))
    html = html.replace("TYPE_BREAKDOWN_PLACEHOLDER", json.dumps(type_breakdown))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["bootcamp pipeline", "bootcamp deals", "bootcamp funnel", "upcoming bootcamps"],
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
            (binding_id, SCREEN_ID, metric_id, 0, "wide", 0, 0, 8, 12),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x12)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
