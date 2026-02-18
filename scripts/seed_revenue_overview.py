#!/usr/bin/env python3
"""Seed: Revenue Overview metric — depends on monthly-revenue-tracker and monthly-revenue."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "revenue-overview"
NAME = "Revenue Overview"
SCREEN_ID = "revenue"

instructions = r"""Combine data from two dependency metrics to produce a comprehensive revenue overview.

## Data Sources
This metric has NO external data sources. It relies entirely on two dependency inputs:

1. **monthly-revenue-tracker** — Current month deals from Sohrab's Revenue Tracker Excel (OneDrive).
   Values include: totalRevenue, totalInvoiced, outstandingInvoice, dealCount, avgDealSize, newBizCount, newBizRevenue, upsellCount, upsellRevenue, byService (array), deals (array), monthLabel.

2. **monthly-revenue** — Historical invoicing and collections from QuickBooks.
   Values include: currentMonth (invoiced this month), ltmCollected, ltmTotal, priorMonth, monthlyData (array of { month, invoiced, collected, count }).

## Retrieval Steps
1. Read the dependency inputs. They are provided as a JSON array under "Dependency Inputs".
2. Find the monthly-revenue-tracker input by slug. Extract its `values` object.
3. Find the monthly-revenue input by slug. Extract its `values` object.
4. DO NOT make any MCP tool calls. All data comes from the dependency inputs.

## Computations

From monthly-revenue-tracker (tracker):
- `currentMonthRevenue`: tracker.totalRevenue — closed deals this month
- `currentMonthInvoiced`: tracker.totalInvoiced
- `outstanding`: tracker.outstandingInvoice
- `dealCount`: tracker.dealCount
- `avgDealSize`: tracker.avgDealSize
- `newBizRevenue`: tracker.newBizRevenue
- `newBizCount`: tracker.newBizCount
- `upsellRevenue`: tracker.upsellRevenue
- `upsellCount`: tracker.upsellCount
- `byService`: tracker.byService
- `topDeals`: tracker.deals sorted by amount descending, take top 5
- `monthLabel`: tracker.monthLabel

From monthly-revenue (qb):
- `monthlyTrend`: qb.monthlyData — array of { month, invoiced, collected, count } for the trailing 12+ months
- `ltmRevenue`: qb.ltmTotal — last twelve months total invoiced
- `ltmCollected`: qb.ltmCollected — last twelve months total collected
- `priorMonthRevenue`: qb.priorMonth — last month's invoiced total
- `collectionRate`: round(ltmCollected / ltmTotal * 100) — LTM collection rate %

Derived:
- `momGrowth`: round((currentMonthRevenue - priorMonthRevenue) / priorMonthRevenue * 100) — month-over-month growth %
  Note: currentMonthRevenue is from the tracker (deals closed this month), priorMonthRevenue is from QuickBooks (prior month invoiced). The month may still be in progress, so flag this.
- `avgMonthlyRevenue`: round(ltmRevenue / 12) — average monthly invoiced over LTM

## Values to Return
- `currentMonthRevenue`: number
- `currentMonthInvoiced`: number
- `outstanding`: number
- `dealCount`: number
- `avgDealSize`: number
- `newBizRevenue`: number
- `newBizCount`: number
- `upsellRevenue`: number
- `upsellCount`: number
- `byService`: array of { service, count, revenue }
- `topDeals`: array of top 5 deals { client, amount, service, type }
- `monthLabel`: string
- `monthlyTrend`: array of { month, invoiced, collected, count }
- `ltmRevenue`: number
- `ltmCollected`: number
- `collectionRate`: number (percentage)
- `priorMonthRevenue`: number
- `momGrowth`: number (percentage, may be negative)
- `avgMonthlyRevenue`: number
"""

template_jsx = r"""(() => {
  const currentMonthRevenue = CURRENT_MONTH_REVENUE_PLACEHOLDER;
  const currentMonthInvoiced = CURRENT_MONTH_INVOICED_PLACEHOLDER;
  const outstanding = OUTSTANDING_PLACEHOLDER;
  const dealCount = DEAL_COUNT_PLACEHOLDER;
  const avgDealSize = AVG_DEAL_SIZE_PLACEHOLDER;
  const newBizRevenue = NEW_BIZ_REVENUE_PLACEHOLDER;
  const newBizCount = NEW_BIZ_COUNT_PLACEHOLDER;
  const upsellRevenue = UPSELL_REVENUE_PLACEHOLDER;
  const upsellCount = UPSELL_COUNT_PLACEHOLDER;
  const byService = BY_SERVICE_PLACEHOLDER;
  const topDeals = TOP_DEALS_PLACEHOLDER;
  const monthLabel = MONTH_LABEL_PLACEHOLDER;
  const monthlyTrend = MONTHLY_TREND_PLACEHOLDER;
  const ltmRevenue = LTM_REVENUE_PLACEHOLDER;
  const ltmCollected = LTM_COLLECTED_PLACEHOLDER;
  const collectionRate = COLLECTION_RATE_PLACEHOLDER;
  const priorMonthRevenue = PRIOR_MONTH_REVENUE_PLACEHOLDER;
  const momGrowth = MOM_GROWTH_PLACEHOLDER;
  const avgMonthlyRevenue = AVG_MONTHLY_REVENUE_PLACEHOLDER;

  const fmt = (n) => '$' + (n || 0).toLocaleString();
  const fmtK = (n) => '$' + ((n || 0) / 1000).toFixed(0) + 'K';

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label={monthLabel + ' Revenue'} value={fmtK(currentMonthRevenue)} subtitle={dealCount + ' deals closed'} />
        <StatCard label="Prior Month" value={fmtK(priorMonthRevenue)} subtitle={'MoM: ' + (momGrowth >= 0 ? '+' : '') + momGrowth + '%'} />
        <StatCard label="LTM Revenue" value={fmtK(ltmRevenue)} subtitle={'Avg ' + fmtK(avgMonthlyRevenue) + '/mo'} />
        <StatCard label="Collection Rate" value={collectionRate + '%'} subtitle={fmtK(ltmCollected) + ' collected LTM'} />
      </MetricRow>

      <MetricRow>
        <StatCard label="New Business" value={fmtK(newBizRevenue)} subtitle={newBizCount + ' deals'} />
        <StatCard label="Upsells" value={fmtK(upsellRevenue)} subtitle={upsellCount + ' deals'} />
        <StatCard label="Invoiced" value={fmtK(currentMonthInvoiced)} subtitle={outstanding > 0 ? fmtK(outstanding) + ' outstanding' : 'All invoiced'} />
        <StatCard label="Avg Deal" value={fmt(avgDealSize)} />
      </MetricRow>

      <div style={{ height: 300, background: theme.panel, borderRadius: 16, padding: 20, border: '1px solid ' + theme.line }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={monthlyTrend} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="revOverviewGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={(v, name) => [fmt(v), name]} />
            <Legend />
            <Area type="monotone" dataKey="invoiced" name="Invoiced" stroke="#2563eb" strokeWidth={2} fill="url(#revOverviewGrad)" />
            <Line type="monotone" dataKey="collected" name="Collected" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" dot={{ fill: '#16a34a', r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <div style={{ background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Revenue by Service</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byService} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
                <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'K'} />
                <YAxis type="category" dataKey="service" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} width={140} />
                <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmt(v), 'Revenue']} />
                <Bar dataKey="revenue" fill={theme.accent} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: theme.ink }}>Top Deals This Month</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + theme.line }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.inkMuted }}>Client</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: theme.inkMuted }}>Amount</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: theme.inkMuted }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {topDeals.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid ' + theme.line }}>
                  <td style={{ padding: '6px 8px', color: theme.ink }}>{d.client}</td>
                  <td style={{ padding: '6px 8px', color: theme.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.amount)}</td>
                  <td style={{ padding: '6px 8px' }}><span style={{ padding: '2px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: d.type === 'New Biz' ? theme.accent + '22' : theme.secondary + '22', color: d.type === 'New Biz' ? theme.accent : theme.secondary }}>{d.type}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <MetricNote>Combines Revenue Tracker (OneDrive) + QuickBooks invoicing data · Month in progress</MetricNote>
    </MetricSection>
  );
})()"""

# ---------- Build initial snapshot from current data ----------

# From monthly-revenue-tracker February data
tracker_deals = [
    {"client": "Tire Discounter Group", "amount": 14000, "service": "Private AI Foundational Bootcamp", "type": "New Biz"},
    {"client": "Preservation Equity Fund", "amount": 10450, "service": "Private AI Foundational Bootcamp", "type": "New Biz"},
    {"client": "Total Package HR", "amount": 10000, "service": "Private AI Foundational Bootcamp", "type": "New Biz"},
    {"client": "SVN (1st cohort)", "amount": 9600, "service": "Private AI Foundational Bootcamp", "type": "New Biz"},
    {"client": "Immatics", "amount": 9000, "service": "AI Agents Bootcamp", "type": "Upsell"},
]

by_service = [
    {"service": "Private AI Foundational Bootcamp", "count": 4, "revenue": 44050},
    {"service": "AI Foundational Bootcamp", "count": 7, "revenue": 14000},
    {"service": "AI Agents Bootcamp", "count": 1, "revenue": 9000},
    {"service": "AI Champions Group", "count": 1, "revenue": 749},
]

monthly_trend = [
    {"month": "Feb '25", "invoiced": 87650, "collected": 84150, "count": 35},
    {"month": "Mar '25", "invoiced": 190174, "collected": 151123, "count": 66},
    {"month": "Apr '25", "invoiced": 106283, "collected": 117289, "count": 62},
    {"month": "May '25", "invoiced": 125354, "collected": 107693, "count": 34},
    {"month": "Jun '25", "invoiced": 139671, "collected": 126010, "count": 61},
    {"month": "Jul '25", "invoiced": 98864, "collected": 159150, "count": 48},
    {"month": "Aug '25", "invoiced": 114698, "collected": 89494, "count": 51},
    {"month": "Sep '25", "invoiced": 263725, "collected": 146281, "count": 56},
    {"month": "Oct '25", "invoiced": 197685, "collected": 191140, "count": 48},
    {"month": "Nov '25", "invoiced": 206919, "collected": 204403, "count": 48},
    {"month": "Dec '25", "invoiced": 120579, "collected": 207654, "count": 60},
    {"month": "Jan '26", "invoiced": 199568, "collected": 135066, "count": 56},
    {"month": "Feb '26", "invoiced": 152193, "collected": 108770, "count": 25},
]

ltm_revenue = 2003362
ltm_collected = 1828222
collection_rate = round(ltm_collected / ltm_revenue * 100)
prior_month = 199568
current_month_rev = 68799
mom_growth = round((current_month_rev - prior_month) / prior_month * 100)
avg_monthly = round(ltm_revenue / 12)

initial_values = json.dumps({
    "currentMonthRevenue": current_month_rev,
    "currentMonthInvoiced": 49799,
    "outstanding": 19000,
    "dealCount": 13,
    "avgDealSize": 5292,
    "newBizRevenue": 57800,
    "newBizCount": 11,
    "upsellRevenue": 10999,
    "upsellCount": 2,
    "byService": by_service,
    "topDeals": tracker_deals,
    "monthLabel": "February 2026",
    "monthlyTrend": monthly_trend,
    "ltmRevenue": ltm_revenue,
    "ltmCollected": ltm_collected,
    "collectionRate": collection_rate,
    "priorMonthRevenue": prior_month,
    "momGrowth": mom_growth,
    "avgMonthlyRevenue": avg_monthly,
})

# Build initial HTML using template substitution
def make_initial_html():
    html = template_jsx
    html = html.replace("CURRENT_MONTH_REVENUE_PLACEHOLDER", str(current_month_rev))
    html = html.replace("CURRENT_MONTH_INVOICED_PLACEHOLDER", str(49799))
    html = html.replace("OUTSTANDING_PLACEHOLDER", str(19000))
    html = html.replace("DEAL_COUNT_PLACEHOLDER", str(13))
    html = html.replace("AVG_DEAL_SIZE_PLACEHOLDER", str(5292))
    html = html.replace("NEW_BIZ_REVENUE_PLACEHOLDER", str(57800))
    html = html.replace("NEW_BIZ_COUNT_PLACEHOLDER", str(11))
    html = html.replace("UPSELL_REVENUE_PLACEHOLDER", str(10999))
    html = html.replace("UPSELL_COUNT_PLACEHOLDER", str(2))
    html = html.replace("BY_SERVICE_PLACEHOLDER", json.dumps(by_service))
    html = html.replace("TOP_DEALS_PLACEHOLDER", json.dumps(tracker_deals))
    html = html.replace("MONTH_LABEL_PLACEHOLDER", '"February 2026"')
    html = html.replace("MONTHLY_TREND_PLACEHOLDER", json.dumps(monthly_trend))
    html = html.replace("LTM_REVENUE_PLACEHOLDER", str(ltm_revenue))
    html = html.replace("LTM_COLLECTED_PLACEHOLDER", str(ltm_collected))
    html = html.replace("COLLECTION_RATE_PLACEHOLDER", str(collection_rate))
    html = html.replace("PRIOR_MONTH_REVENUE_PLACEHOLDER", str(prior_month))
    html = html.replace("MOM_GROWTH_PLACEHOLDER", str(mom_growth))
    html = html.replace("AVG_MONTHLY_REVENUE_PLACEHOLDER", str(avg_monthly))
    return html


initial_html = make_initial_html()

METADATA = json.dumps({
    "dependencies": ["monthly-revenue-tracker", "monthly-revenue"],
    "aliases": ["revenue overview", "rev overview", "full revenue"],
})


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA busy_timeout = 5000")
    cursor = conn.cursor()

    # Check if metric already exists
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

    # Bind to screen if not already bound
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
            (binding_id, SCREEN_ID, metric_id, 0, "full", 0, 0, 12, 16),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (12x16)")

    conn.commit()
    conn.close()
    print("\nDone")


if __name__ == "__main__":
    main()
