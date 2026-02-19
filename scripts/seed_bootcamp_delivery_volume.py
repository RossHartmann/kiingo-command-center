#!/usr/bin/env python3
"""Seed: Bootcamp Delivery Volume — closed-won bootcamp deals over time from CRM."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "bootcamp-delivery-volume"
NAME = "Bootcamp Delivery Volume"
SCREEN_ID = "dept-operations"

instructions = r"""Track bootcamp delivery volume over time — closed-won bootcamp deals by month and type, showing scaling trajectory.

## Data Source
Kiingo PostgreSQL database → `crm_deal` table

## Retrieval Steps

### Step 1: Monthly won deals
Get closed-won bootcamp deals grouped by month. Use whichever date field is populated — prefer `actualCloseDate`, fall back to `dateOpened`.

```typescript
import { sql } from 'tools';
const monthly = await sql.query({
  database: 'kiingo',
  sql: `
    SELECT
      TO_CHAR(COALESCE("actualCloseDate", "dateOpened"), 'YYYY-MM') as month,
      COUNT(*) as deals_won
    FROM crm_deal
    WHERE "isWon" = true
      AND ("dealType" ILIKE '%bootcamp%' OR "dealType" ILIKE '%foundational%')
      AND COALESCE("actualCloseDate", "dateOpened") >= '2024-09-01'
    GROUP BY 1
    ORDER BY 1
  `
});
```

### Step 2: Breakdown by type
```typescript
const byType = await sql.query({
  database: 'kiingo',
  sql: `
    SELECT
      TO_CHAR(COALESCE("actualCloseDate", "dateOpened"), 'YYYY-MM') as month,
      CASE
        WHEN "dealType" ILIKE '%private%foundational%' THEN 'Private'
        WHEN "dealType" ILIKE '%ai foundational%' THEN 'AI Foundational'
        WHEN "dealType" ILIKE '%agents%' THEN 'AI Agents'
        WHEN "dealType" ILIKE '%specialized%' THEN 'Specialized'
        ELSE 'Other'
      END as type,
      COUNT(*) as cnt
    FROM crm_deal
    WHERE "isWon" = true
      AND ("dealType" ILIKE '%bootcamp%' OR "dealType" ILIKE '%foundational%')
      AND COALESCE("actualCloseDate", "dateOpened") >= '2024-09-01'
    GROUP BY 1, 2
    ORDER BY 1
  `
});
```

### Step 3: Totals and growth
```typescript
const totals = await sql.query({
  database: 'kiingo',
  sql: `
    SELECT
      COUNT(*) as total_won,
      COUNT(DISTINCT
        CASE
          WHEN "dealType" ILIKE '%private%foundational%' THEN "dealType" || '-' || "crmCompanyId"
          ELSE "dealType" || '-' || TO_CHAR(COALESCE("actualCloseDate", "dateOpened"), 'YYYY-MM-DD')
        END
      ) as approx_cohorts,
      COUNT(DISTINCT "crmCompanyId") as unique_companies
    FROM crm_deal
    WHERE "isWon" = true
      AND ("dealType" ILIKE '%bootcamp%' OR "dealType" ILIKE '%foundational%')
  `
});
```

### Step 4: Structure the data

For `monthlyData`, convert month strings to short labels (e.g. "2024-09" → "Sep '24", "2025-06" → "Jun '25"). Each entry: { month, won }.

For `monthlyByType`, pivot the type breakdown so each month has fields for each type count. Each entry: { month, private, foundational, agents, specialized }.

For growth calculation: compare the last 3 months' total to the first 3 months' total to get a growth multiple.

## Values to Return
- `totalWon`: number (all-time closed-won bootcamp deals)
- `uniqueCompanies`: number
- `growthMultiple`: number (rounded to 1 decimal)
- `lastMonthWon`: number (most recent complete month)
- `monthlyData`: array of { month, won }
- `monthlyByType`: array of { month, private, foundational, agents, specialized }
"""

template_jsx = r"""(() => {
  const totalWon = TOTAL_WON_PLACEHOLDER;
  const uniqueCompanies = UNIQUE_COMPANIES_PLACEHOLDER;
  const growthMultiple = GROWTH_MULTIPLE_PLACEHOLDER;
  const lastMonthWon = LAST_MONTH_WON_PLACEHOLDER;
  const monthlyData = MONTHLY_DATA_PLACEHOLDER;
  const monthlyByType = MONTHLY_BY_TYPE_PLACEHOLDER;

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Deals Won'} value={totalWon} subtitle={'All bootcamp types'} />
        <StatCard label={'Unique Companies'} value={uniqueCompanies} subtitle={'Distinct clients'} />
        <StatCard label={'Growth'} value={growthMultiple + 'x'} subtitle={'First 3mo → last 3mo'} />
        <StatCard label={'Last Month'} value={lastMonthWon} subtitle={'Deals closed'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Monthly Bootcamp Deals Won</div>
        <ResponsiveContainer width="100%" height="90%">
          <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="bootcampVolGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.accent} stopOpacity={0.2} />
                <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Area type="monotone" dataKey="won" name="Deals Won" stroke={theme.accent} strokeWidth={2} fill="url(#bootcampVolGrad)" dot={{ fill: theme.accent, r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>By Bootcamp Type</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={monthlyByType} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar dataKey="foundational" name="AI Foundational" stackId="a" fill={theme.accent} />
            <Bar dataKey="private" name="Private" stackId="a" fill={theme.secondary} />
            <Bar dataKey="agents" name="AI Agents" stackId="a" fill="#eab308" />
            <Bar dataKey="specialized" name="Specialized" stackId="a" fill="#16a34a" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricNote>Source: Kiingo CRM · Closed-won bootcamp deals · Sep 2024 - present</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

monthly_data = [
    {"month": "Sep '24", "won": 2},
    {"month": "Oct '24", "won": 5},
    {"month": "Nov '24", "won": 8},
    {"month": "Dec '24", "won": 10},
    {"month": "Jan '25", "won": 14},
    {"month": "Feb '25", "won": 22},
    {"month": "Mar '25", "won": 18},
    {"month": "Apr '25", "won": 20},
    {"month": "May '25", "won": 24},
    {"month": "Jun '25", "won": 22},
    {"month": "Jul '25", "won": 18},
    {"month": "Aug '25", "won": 20},
    {"month": "Sep '25", "won": 26},
    {"month": "Oct '25", "won": 32},
    {"month": "Nov '25", "won": 28},
    {"month": "Dec '25", "won": 24},
    {"month": "Jan '26", "won": 30},
    {"month": "Feb '26", "won": 18},
]

monthly_by_type = [
    {"month": "Sep '24", "foundational": 2, "private": 0, "agents": 0, "specialized": 0},
    {"month": "Oct '24", "foundational": 4, "private": 1, "agents": 0, "specialized": 0},
    {"month": "Nov '24", "foundational": 6, "private": 2, "agents": 0, "specialized": 0},
    {"month": "Dec '24", "foundational": 7, "private": 3, "agents": 0, "specialized": 0},
    {"month": "Jan '25", "foundational": 10, "private": 3, "agents": 1, "specialized": 0},
    {"month": "Feb '25", "foundational": 14, "private": 5, "agents": 2, "specialized": 1},
    {"month": "Mar '25", "foundational": 12, "private": 4, "agents": 1, "specialized": 1},
    {"month": "Apr '25", "foundational": 12, "private": 4, "agents": 2, "specialized": 2},
    {"month": "May '25", "foundational": 14, "private": 5, "agents": 3, "specialized": 2},
    {"month": "Jun '25", "foundational": 12, "private": 5, "agents": 3, "specialized": 2},
    {"month": "Jul '25", "foundational": 10, "private": 4, "agents": 2, "specialized": 2},
    {"month": "Aug '25", "foundational": 12, "private": 4, "agents": 2, "specialized": 2},
    {"month": "Sep '25", "foundational": 16, "private": 5, "agents": 3, "specialized": 2},
    {"month": "Oct '25", "foundational": 18, "private": 6, "agents": 4, "specialized": 4},
    {"month": "Nov '25", "foundational": 16, "private": 5, "agents": 4, "specialized": 3},
    {"month": "Dec '25", "foundational": 14, "private": 4, "agents": 3, "specialized": 3},
    {"month": "Jan '26", "foundational": 18, "private": 5, "agents": 4, "specialized": 3},
    {"month": "Feb '26", "foundational": 10, "private": 4, "agents": 2, "specialized": 2},
]

initial_values = json.dumps({
    "totalWon": 349,
    "uniqueCompanies": 142,
    "growthMultiple": 5.2,
    "lastMonthWon": 30,
    "monthlyData": monthly_data,
    "monthlyByType": monthly_by_type,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("TOTAL_WON_PLACEHOLDER", "349")
    html = html.replace("UNIQUE_COMPANIES_PLACEHOLDER", "142")
    html = html.replace("GROWTH_MULTIPLE_PLACEHOLDER", "5.2")
    html = html.replace("LAST_MONTH_WON_PLACEHOLDER", "30")
    html = html.replace("MONTHLY_DATA_PLACEHOLDER", json.dumps(monthly_data))
    html = html.replace("MONTHLY_BY_TYPE_PLACEHOLDER", json.dumps(monthly_by_type))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["bootcamp volume", "bootcamp delivery", "bootcamp growth", "bootcamp deals won"],
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
            (binding_id, SCREEN_ID, metric_id, 2, "wide", 0, 22, 8, 14),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x14)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
