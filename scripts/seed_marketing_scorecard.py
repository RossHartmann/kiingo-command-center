#!/usr/bin/env python3
"""Seed: Marketing Scorecard metric — pulls weekly marketing data from Notion Leadership Team scorecard."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "marketing-scorecard"
NAME = "Marketing Scorecard"
SCREEN_ID = "ceo-dashboard"

instructions = r"""Pull weekly marketing metrics from the Sales/Marketing Scorecard table in Notion.

## Data Sources
Notion page: Sales/Marketing Scorecard
Page ID: 2f001bab-c077-8037-bcfa-fd46eacbdc68

## Retrieval Steps
1. Call `notion.listBlockChildren({ blockId: '2f001bab-c077-8037-bcfa-fd46eacbdc68' })` to get page blocks.
2. Find the block with `type: 'table'`. Note its `id`.
3. Call `notion.listBlockChildren({ blockId: <tableId> })` to get all table rows.
4. Skip row index 0 (header) and row index 1 (owner row — cells contain "Sales"/"Marketing").
5. For each remaining row, call `notion.getBlock({ blockId: row.id, includeRaw: true })`.
6. Extract cell text from `raw.table_row.cells[colIndex]` — each cell is an array of rich text objects, join their `plain_text`.

## Column Mapping (0-indexed)
- Col 0: Week (date range string, e.g. "01/12 - 01/16")
- Col 7: Number of Leads (trailing 30 days) — integer
- Col 8: Newsletter Open Rate — percentage string like "55.65% (CTR 4.1%)" — extract the first percentage
- Col 9: Webinar Signups — integer or "NA"
- Col 10: New Website Visitors via Organic Search (trailing 30 days) — integer or "—"
- Col 11: Website page views (trailing 30 days) — integer or "—"
- Col 12: LinkedIn Engagement Rate (Ross/Kiingo, 7 days trailing) — string like "2.60% / 11.32%" — split on "/" to get two percentages

## Parsing Rules
- For integers (cols 7, 9, 10, 11): parseInt, treat empty/"—"/"NA" as 0 or null.
- For newsletter open rate (col 8): extract first number before "%" with regex, e.g. "55.65% (CTR 4.1%)" → 55.65. Also extract CTR if present.
- For LinkedIn (col 12): split on "/" and parse each as float percentage. First value is Ross, second is Kiingo.
- Extract a short week label from col 0: use just the start date portion (e.g. "01/12 - 01/16" → "1/12").
- Skip rows where col 0 is empty or is the owner row.
- If a data row has all marketing columns empty, still include it but with null values.

## Values to Return
- `weeks`: array of objects, each with:
  - `week`: short label (e.g. "1/12")
  - `leads`: number or null
  - `newsletterRate`: number (percentage) or null
  - `newsletterCtr`: number (percentage) or null
  - `webinarSignups`: number or null
  - `organicVisitors`: number or null
  - `pageViews`: number or null
  - `linkedinRoss`: number (percentage) or null
  - `linkedinKiingo`: number (percentage) or null
- `latestWeek`: the last complete row's week label (skip rows with all nulls)
- `latestLeads`: latest non-null leads value
- `latestNewsletter`: latest non-null newsletter open rate
- `latestWebinar`: latest non-null webinar signups
- `latestOrganic`: latest non-null organic visitors
- `latestPageViews`: latest non-null page views
"""

template_jsx = r"""(() => {
  const weeks = WEEKS_PLACEHOLDER;
  const latestWeek = LATEST_WEEK_PLACEHOLDER;
  const latestLeads = LATEST_LEADS_PLACEHOLDER;
  const latestNewsletter = LATEST_NEWSLETTER_PLACEHOLDER;
  const latestWebinar = LATEST_WEBINAR_PLACEHOLDER;
  const latestOrganic = LATEST_ORGANIC_PLACEHOLDER;
  const latestPageViews = LATEST_PAGE_VIEWS_PLACEHOLDER;

  const validWeeks = weeks.filter(w => w.leads != null || w.organicVisitors != null);

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={'Leads (30d)'} value={latestLeads || '—'} subtitle={'Week of ' + latestWeek} />
        <StatCard label={'Newsletter Open'} value={latestNewsletter ? latestNewsletter + '%' : '—'} subtitle={'Open rate'} />
        <StatCard label={'Webinar Signups'} value={latestWebinar || '—'} subtitle={'Latest week'} />
        <StatCard label={'Organic Visitors'} value={latestOrganic || '—'} subtitle={'Trailing 30 days'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: '1px solid ' + theme.line }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Leads & Organic Traffic</div>
        <ResponsiveContainer width="100%" height="90%">
          <ComposedChart data={validWeeks} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Legend />
            <Bar dataKey="leads" name="Leads" fill={theme.accent} radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="organicVisitors" name="Organic Visitors" stroke="#16a34a" strokeWidth={2} dot={{ fill: '#16a34a', r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Newsletter Open Rate %</div>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={validWeeks.filter(w => w.newsletterRate != null)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
              <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} tickFormatter={(v) => v + '%'} domain={[40, 65]} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [v + '%', 'Open Rate']} />
              <Line type="monotone" dataKey="newsletterRate" stroke={theme.accent} strokeWidth={2} dot={{ fill: theme.accent, r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>Website Page Views (30d)</div>
          <ResponsiveContainer width="100%" height="85%">
            <AreaChart data={validWeeks.filter(w => w.pageViews != null && w.pageViews > 0)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="mktgPvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
              <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
              <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [v.toLocaleString(), 'Page Views']} />
              <Area type="monotone" dataKey="pageViews" stroke="#8b5cf6" strokeWidth={2} fill="url(#mktgPvGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: 16, marginTop: 16, border: '1px solid ' + theme.line }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: theme.ink }}>LinkedIn Engagement Rate %</div>
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={validWeeks.filter(w => w.linkedinRoss != null)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="week" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} tickFormatter={(v) => v + '%'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [v + '%']} />
            <Legend />
            <Line type="monotone" dataKey="linkedinRoss" name="Ross" stroke={theme.accent} strokeWidth={2} dot={{ fill: theme.accent, r: 3 }} />
            <Line type="monotone" dataKey="linkedinKiingo" name="Kiingo" stroke={theme.secondary} strokeWidth={2} dot={{ fill: theme.secondary, r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <MetricNote>Source: Notion Leadership Team · Sales/Marketing Scorecard</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Initial snapshot data ----------

weeks_data = [
    {"week": "1/1", "leads": 25, "newsletterRate": 52.95, "newsletterCtr": None, "webinarSignups": 42, "organicVisitors": None, "pageViews": None, "linkedinRoss": 2.60, "linkedinKiingo": 11.32},
    {"week": "1/12", "leads": None, "newsletterRate": 55.65, "newsletterCtr": 4.1, "webinarSignups": 80, "organicVisitors": 73, "pageViews": 530, "linkedinRoss": 2.17, "linkedinKiingo": 2.39},
    {"week": "1/19", "leads": 38, "newsletterRate": 57.36, "newsletterCtr": 3.99, "webinarSignups": None, "organicVisitors": 172, "pageViews": 813, "linkedinRoss": 0.0, "linkedinKiingo": 5.67},
    {"week": "1/26", "leads": 54, "newsletterRate": 57.38, "newsletterCtr": 0.9, "webinarSignups": None, "organicVisitors": 181, "pageViews": 946, "linkedinRoss": 1.61, "linkedinKiingo": 7.78},
    {"week": "2/2", "leads": 66, "newsletterRate": 58.28, "newsletterCtr": 2.9, "webinarSignups": 29, "organicVisitors": 172, "pageViews": 890, "linkedinRoss": 4.60, "linkedinKiingo": 6.67},
    {"week": "2/9", "leads": 77, "newsletterRate": 54.03, "newsletterCtr": 4.0, "webinarSignups": 73, "organicVisitors": 175, "pageViews": 907, "linkedinRoss": 3.89, "linkedinKiingo": 9.35},
    {"week": "2/16", "leads": None, "newsletterRate": None, "newsletterCtr": None, "webinarSignups": None, "organicVisitors": None, "pageViews": None, "linkedinRoss": None, "linkedinKiingo": None},
]

# Latest non-null values
latest_leads = 77
latest_newsletter = 54.03
latest_webinar = 73
latest_organic = 175
latest_page_views = 907

initial_values = json.dumps({
    "weeks": weeks_data,
    "latestWeek": "2/9",
    "latestLeads": latest_leads,
    "latestNewsletter": latest_newsletter,
    "latestWebinar": latest_webinar,
    "latestOrganic": latest_organic,
    "latestPageViews": latest_page_views,
})


def make_initial_html():
    html = template_jsx
    html = html.replace("WEEKS_PLACEHOLDER", json.dumps(weeks_data))
    html = html.replace("LATEST_WEEK_PLACEHOLDER", '"2/9"')
    html = html.replace("LATEST_LEADS_PLACEHOLDER", str(latest_leads))
    html = html.replace("LATEST_NEWSLETTER_PLACEHOLDER", str(latest_newsletter))
    html = html.replace("LATEST_WEBINAR_PLACEHOLDER", str(latest_webinar))
    html = html.replace("LATEST_ORGANIC_PLACEHOLDER", str(latest_organic))
    html = html.replace("LATEST_PAGE_VIEWS_PLACEHOLDER", str(latest_page_views))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "aliases": ["marketing scorecard", "marketing metrics", "weekly marketing"],
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
            (metric_id, NAME, SLUG, instructions, template_jsx, 259200, METADATA, NOW, NOW)
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
            (binding_id, SCREEN_ID, metric_id, 1, "wide", 0, 12, 8, 14),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (8x14)")

    conn.commit()
    conn.close()
    print("Done")


if __name__ == "__main__":
    main()
