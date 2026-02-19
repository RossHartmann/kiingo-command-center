#!/usr/bin/env python3
"""Seed: Sales Response Rate — email response rate from Kiingo CRM database."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "sales-response-rate"
NAME = "Sales Response Rate"
SCREEN_ID = "sales-followup"

instructions = r"""Calculate email response rates for deal-linked outreach by querying the Kiingo CRM database.

## Data Source
Kiingo PostgreSQL database → `crm_email`, `crm_deal_email`, `crm_deal` tables

## Retrieval Steps

### Step 1: Overall response rate
For conversations linked to open deals where Kiingo sent the first message, calculate how many got an external reply.

```typescript
import { sql } from 'tools';
const overall = await sql.query({
  database: 'kiingo',
  sql: `
    WITH deal_emails AS (
      SELECT DISTINCT e.id, e."conversationId", e."from", e."receivedDateTime"
      FROM crm_email e
      JOIN crm_deal_email de ON de."crmEmailId" = e.id
      JOIN crm_deal d ON d.id = de."crmDealId"
      WHERE e."conversationId" IS NOT NULL
        AND d."isClosed" = false
    ),
    thread_first AS (
      SELECT "conversationId",
        MIN("receivedDateTime") as first_time,
        (ARRAY_AGG("from" ORDER BY "receivedDateTime" ASC))[1] as first_sender
      FROM deal_emails GROUP BY "conversationId"
    ),
    initiated AS (
      SELECT "conversationId", first_time FROM thread_first
      WHERE first_sender LIKE '%@kiingo.com'
    ),
    replied AS (
      SELECT DISTINCT i."conversationId"
      FROM initiated i
      JOIN deal_emails e ON e."conversationId" = i."conversationId"
        AND e."from" NOT LIKE '%@kiingo.com'
        AND e."receivedDateTime" > i.first_time
    )
    SELECT
      (SELECT COUNT(*) FROM thread_first) as total_deal_threads,
      (SELECT COUNT(*) FROM initiated) as total_initiated,
      (SELECT COUNT(*) FROM replied) as total_replied,
      ROUND((SELECT COUNT(*) FROM replied)::numeric / NULLIF((SELECT COUNT(*) FROM initiated), 0) * 100, 1) as rate
  `
});
```

### Step 2: Response time statistics
For threads that did get a reply, measure how long it took.

```typescript
const timing = await sql.query({
  database: 'kiingo',
  sql: `
    WITH deal_emails AS (
      SELECT DISTINCT e.id, e."conversationId", e."from", e."receivedDateTime"
      FROM crm_email e
      JOIN crm_deal_email de ON de."crmEmailId" = e.id
      JOIN crm_deal d ON d.id = de."crmDealId"
      WHERE e."conversationId" IS NOT NULL
        AND d."isClosed" = false
    ),
    thread_first AS (
      SELECT "conversationId",
        MIN("receivedDateTime") as first_time,
        (ARRAY_AGG("from" ORDER BY "receivedDateTime" ASC))[1] as first_sender
      FROM deal_emails GROUP BY "conversationId"
    ),
    initiated AS (
      SELECT "conversationId", first_time FROM thread_first
      WHERE first_sender LIKE '%@kiingo.com'
    ),
    first_reply AS (
      SELECT i."conversationId", i.first_time,
        MIN(e."receivedDateTime") as reply_time
      FROM initiated i
      JOIN deal_emails e ON e."conversationId" = i."conversationId"
        AND e."from" NOT LIKE '%@kiingo.com'
        AND e."receivedDateTime" > i.first_time
      GROUP BY i."conversationId", i.first_time
    )
    SELECT
      ROUND(AVG(EXTRACT(EPOCH FROM (reply_time - first_time)) / 3600), 1) as avg_hours,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reply_time - first_time)) / 3600)::numeric, 1) as median_hours,
      ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reply_time - first_time)) / 3600)::numeric, 1) as p25_hours,
      ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (reply_time - first_time)) / 3600)::numeric, 1) as p75_hours
    FROM first_reply
  `
});
```

### Step 3: Monthly response rate trend
Calculate response rate per month for the last 8 months.

```typescript
const monthly = await sql.query({
  database: 'kiingo',
  sql: `
    WITH deal_emails AS (
      SELECT DISTINCT e.id, e."conversationId", e."from", e."receivedDateTime"
      FROM crm_email e
      JOIN crm_deal_email de ON de."crmEmailId" = e.id
      JOIN crm_deal d ON d.id = de."crmDealId"
      WHERE e."conversationId" IS NOT NULL
        AND d."isClosed" = false
    ),
    thread_first AS (
      SELECT "conversationId",
        MIN("receivedDateTime") as first_time,
        (ARRAY_AGG("from" ORDER BY "receivedDateTime" ASC))[1] as first_sender
      FROM deal_emails GROUP BY "conversationId"
    ),
    initiated AS (
      SELECT "conversationId", first_time,
        TO_CHAR(first_time, 'YYYY-MM') as ym
      FROM thread_first WHERE first_sender LIKE '%@kiingo.com'
    ),
    replied AS (
      SELECT DISTINCT i."conversationId", i.ym
      FROM initiated i
      JOIN deal_emails e ON e."conversationId" = i."conversationId"
        AND e."from" NOT LIKE '%@kiingo.com'
        AND e."receivedDateTime" > i.first_time
    )
    SELECT
      i.ym as month,
      COUNT(DISTINCT i."conversationId") as initiated,
      COUNT(DISTINCT r."conversationId") as replied,
      ROUND(COUNT(DISTINCT r."conversationId")::numeric / NULLIF(COUNT(DISTINCT i."conversationId"), 0) * 100, 1) as rate
    FROM initiated i
    LEFT JOIN replied r ON r."conversationId" = i."conversationId"
    WHERE i.ym >= TO_CHAR(NOW() - INTERVAL '8 months', 'YYYY-MM')
    GROUP BY i.ym ORDER BY i.ym
  `
});
```

### Step 4: Per-rep response rate
Response rate broken down by the Kiingo rep who initiated the thread. Exclude reps with fewer than 10 threads.

```typescript
const byRep = await sql.query({
  database: 'kiingo',
  sql: `
    WITH deal_emails AS (
      SELECT DISTINCT e.id, e."conversationId", e."from", e."receivedDateTime"
      FROM crm_email e
      JOIN crm_deal_email de ON de."crmEmailId" = e.id
      JOIN crm_deal d ON d.id = de."crmDealId"
      WHERE e."conversationId" IS NOT NULL
        AND d."isClosed" = false
    ),
    thread_first AS (
      SELECT "conversationId",
        MIN("receivedDateTime") as first_time,
        (ARRAY_AGG("from" ORDER BY "receivedDateTime" ASC))[1] as first_sender
      FROM deal_emails GROUP BY "conversationId"
    ),
    initiated AS (
      SELECT "conversationId", first_time,
        SPLIT_PART(first_sender, '@', 1) as rep
      FROM thread_first WHERE first_sender LIKE '%@kiingo.com'
    ),
    replied AS (
      SELECT DISTINCT i."conversationId", i.rep
      FROM initiated i
      JOIN deal_emails e ON e."conversationId" = i."conversationId"
        AND e."from" NOT LIKE '%@kiingo.com'
        AND e."receivedDateTime" > i.first_time
    )
    SELECT
      i.rep,
      COUNT(DISTINCT i."conversationId") as initiated,
      COUNT(DISTINCT r."conversationId") as replied,
      ROUND(COUNT(DISTINCT r."conversationId")::numeric / NULLIF(COUNT(DISTINCT i."conversationId"), 0) * 100, 1) as rate
    FROM initiated i
    LEFT JOIN replied r ON r."conversationId" = i."conversationId"
    GROUP BY i.rep
    HAVING COUNT(DISTINCT i."conversationId") >= 10
    ORDER BY COUNT(DISTINCT i."conversationId") DESC
  `
});
```

### Step 5: Structure the data

For `monthlyData`, convert month strings to short labels (e.g. "2025-06" → "Jun", "2025-12" → "Dec", "2026-01" → "Jan"). Each entry: { month, initiated, replied, rate }.

For `repData`, capitalize the first letter of the rep name. Exclude system accounts (names containing "MicrosoftExchange", "clientsolutions", "support"). Sort by initiated descending. Each entry: { rep, initiated, replied, rate }.

## Values to Return
- `overallRate`: number (percentage)
- `totalInitiated`: number
- `totalReplied`: number
- `medianReplyHours`: number
- `p25ReplyHours`: number
- `p75ReplyHours`: number
- `monthlyData`: array of { month, initiated, replied, rate }
- `repData`: array of { rep, initiated, replied, rate }
"""

template_jsx = r"""(() => {
  const overallRate = OVERALL_RATE_PLACEHOLDER;
  const totalInitiated = TOTAL_INITIATED_PLACEHOLDER;
  const totalReplied = TOTAL_REPLIED_PLACEHOLDER;
  const medianReplyHours = MEDIAN_REPLY_HOURS_PLACEHOLDER;
  const monthlyData = MONTHLY_DATA_PLACEHOLDER;
  const repData = REP_DATA_PLACEHOLDER;

  const medianDisplay = medianReplyHours < 24
    ? medianReplyHours.toFixed(1) + 'h'
    : (medianReplyHours / 24).toFixed(1) + 'd';

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Response Rate'} value={overallRate + '%'} subtitle={'Deal-linked threads'} />
        <StatCard label={'Median Reply Time'} value={medianDisplay} subtitle={'When they reply'} />
        <StatCard label={'Threads Initiated'} value={totalInitiated.toLocaleString()} subtitle={'Kiingo-sent first'} />
        <StatCard label={'Got Reply'} value={totalReplied.toLocaleString()} subtitle={'External reply received'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Monthly Response Rate</div>
        <ResponsiveContainer width="100%" height="90%">
          <ComposedChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis yAxisId="left" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} domain={[0, 60]} unit="%" />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar yAxisId="left" dataKey="initiated" name="Initiated" fill={theme.accent} opacity={0.25} radius={[4, 4, 0, 0]} />
            <Bar yAxisId="left" dataKey="replied" name="Replied" fill={theme.accent} radius={[4, 4, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="Rate %" stroke={theme.danger} strokeWidth={2} dot={{ fill: theme.danger, r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Response Rate by Rep</div>
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={repData} layout="vertical" margin={{ top: 10, right: 30, left: 60, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} domain={[0, 70]} unit="%" />
            <YAxis type="category" dataKey="rep" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={70} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={(v, name, props) => [v + '% (' + props.payload.replied + '/' + props.payload.initiated + ')', 'Response Rate']} />
            <Bar dataKey="rate" name="Response Rate %" fill={theme.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <MetricNote>Source: Kiingo CRM Database · Deal-linked email threads · Open deals only</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data (from Feb 18, 2026 queries) ----------

monthly_data = [
    {"month": "Jul", "initiated": 753, "replied": 312, "rate": 41.4},
    {"month": "Aug", "initiated": 891, "replied": 345, "rate": 38.7},
    {"month": "Sep", "initiated": 824, "replied": 349, "rate": 42.4},
    {"month": "Oct", "initiated": 876, "replied": 371, "rate": 42.4},
    {"month": "Nov", "initiated": 1042, "replied": 389, "rate": 37.3},
    {"month": "Dec", "initiated": 1285, "replied": 498, "rate": 38.8},
    {"month": "Jan", "initiated": 943, "replied": 401, "rate": 42.5},
    {"month": "Feb", "initiated": 512, "replied": 164, "rate": 32.0},
]

rep_data = [
    {"rep": "Ross", "initiated": 3185, "replied": 1254, "rate": 39.4},
    {"rep": "Kym", "initiated": 2623, "replied": 1131, "rate": 43.1},
    {"rep": "Sohrab", "initiated": 1807, "replied": 1012, "rate": 56.0},
    {"rep": "David", "initiated": 1602, "replied": 597, "rate": 37.3},
    {"rep": "Josh", "initiated": 607, "replied": 370, "rate": 61.0},
    {"rep": "James", "initiated": 541, "replied": 186, "rate": 34.4},
    {"rep": "Jordan", "initiated": 339, "replied": 133, "rate": 39.2},
    {"rep": "Isabelle", "initiated": 122, "replied": 38, "rate": 31.1},
    {"rep": "Logan", "initiated": 100, "replied": 44, "rate": 44.0},
]

initial_values = json.dumps({
    "overallRate": 41.2,
    "totalInitiated": 11952,
    "totalReplied": 4929,
    "medianReplyHours": 14.7,
    "p25ReplyHours": 0.8,
    "p75ReplyHours": 131.8,
    "monthlyData": monthly_data,
    "repData": rep_data,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("OVERALL_RATE_PLACEHOLDER", "41.2")
    html = html.replace("TOTAL_INITIATED_PLACEHOLDER", "11952")
    html = html.replace("TOTAL_REPLIED_PLACEHOLDER", "4929")
    html = html.replace("MEDIAN_REPLY_HOURS_PLACEHOLDER", "14.7")
    html = html.replace("MONTHLY_DATA_PLACEHOLDER", json.dumps(monthly_data))
    html = html.replace("REP_DATA_PLACEHOLDER", json.dumps(rep_data))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["response rate", "email response rate", "reply rate", "outreach response"],
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
            (binding_id, SCREEN_ID, metric_id, 2, "wide", 0, 14, 8, 12),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x12)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
