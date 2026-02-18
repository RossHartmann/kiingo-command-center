#!/usr/bin/env python3
"""Seed: Monthly Revenue Tracker metric from Sohrab's OneDrive Excel file."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

SLUG = "monthly-revenue-tracker"
NAME = "Monthly Revenue Tracker"
SCREEN_ID = "revenue"

instructions = r"""Pull the current month's revenue deals from the Revenue Tracker 2026 Excel workbook in Sohrab's OneDrive and compute summary metrics.

## Data Source
Kiingo MCP `excel` module reading from Sohrab Azad's OneDrive.

**File location**: Search for the file or use the known item ID.

    import { sharepoint, excel } from 'tools';

    // Find the file
    const files = await sharepoint.searchItems({
      userId: 'sohrab@kiingo.com',
      query: 'Revenue Tracker 2026',
      fileExtension: 'xlsx'
    });
    const itemId = files[0].id;

## Retrieval Steps

1. Determine the current month name and year (e.g., "February 2026").
2. Construct the worksheet name: `[Month] [Year] MASTER` (e.g., "February 2026 MASTER").
3. Read the worksheet's used range:

       const data = await excel.getUsedRange({
         itemId: itemId,
         userId: 'sohrab@kiingo.com',
         worksheetName: 'February 2026 MASTER',
         valuesOnly: true
       });
       const rows = data.range.values;

4. The first row is headers: Client, Close Date, $ Amount, $ Invoiced, Service, New Biz/Upsell, Start Date, One-time/Subscription, CC/ACH
5. Parse data rows (skip header row 0). Stop when you hit the TOTAL row (client = "TOTAL") or empty rows.
6. **Close Date conversion**: Close dates are Excel serial numbers (days since 1899-12-30). Convert to human-readable dates:
   - `new Date((serialNumber - 25569) * 86400 * 1000)` gives a JS Date.
   - Some dates may be strings instead of numbers — handle both.
7. Filter out rows where Client is empty/null/blank.
8. Filter out cancelled deals (service containing "CANCELLED" or "BACKED OUT").
9. Exclude the TOTAL summary row from the deals list.

## Computations

- `totalRevenue`: sum of all $ Amount values
- `totalInvoiced`: sum of all $ Invoiced values
- `outstandingInvoice`: totalRevenue - totalInvoiced
- `dealCount`: number of valid deals
- `avgDealSize`: totalRevenue / dealCount (rounded to nearest dollar)
- `newBizCount` / `newBizRevenue`: count and sum where New Biz/Upsell contains "New"
- `upsellCount` / `upsellRevenue`: count and sum where New Biz/Upsell contains "Upsell"
- `byService`: array of { service, count, revenue } grouped by Service column (clean up service names — remove user count parentheticals for grouping, e.g., "Private AI Foundational Bootcamp (24 users)" becomes "Private AI Foundational Bootcamp"). Sort by revenue descending.
- `deals`: array of all deals sorted by close date, each with:
  - `client`: string
  - `amount`: number
  - `invoiced`: number or 0
  - `service`: string (full, with user counts)
  - `type`: "New Biz" or "Upsell"
  - `closeDate`: formatted string (e.g., "Feb 3")
  - `payment`: "ACH", "CC", or ""
- `monthLabel`: e.g., "February 2026"

## Values to Return
- `totalRevenue`: number
- `totalInvoiced`: number
- `outstandingInvoice`: number
- `dealCount`: number
- `avgDealSize`: number
- `newBizCount`: number
- `newBizRevenue`: number
- `upsellCount`: number
- `upsellRevenue`: number
- `byService`: array of { service, count, revenue }
- `deals`: array of { client, amount, invoiced, service, type, closeDate, payment }
- `monthLabel`: string
"""

template_jsx = r"""(() => {
  const totalRevenue = TOTAL_REVENUE_PLACEHOLDER;
  const totalInvoiced = TOTAL_INVOICED_PLACEHOLDER;
  const outstanding = OUTSTANDING_PLACEHOLDER;
  const dealCount = DEAL_COUNT_PLACEHOLDER;
  const avgDeal = AVG_DEAL_PLACEHOLDER;
  const newBizCount = NEW_BIZ_COUNT_PLACEHOLDER;
  const newBizRevenue = NEW_BIZ_REVENUE_PLACEHOLDER;
  const upsellCount = UPSELL_COUNT_PLACEHOLDER;
  const upsellRevenue = UPSELL_REVENUE_PLACEHOLDER;
  const byService = BY_SERVICE_PLACEHOLDER;
  const deals = DEALS_PLACEHOLDER;
  const monthLabel = MONTH_LABEL_PLACEHOLDER;

  const fmt = (n) => '$' + (n || 0).toLocaleString();

  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Total Revenue" value={fmt(totalRevenue)} subtitle={monthLabel} />
        <StatCard label="Invoiced" value={fmt(totalInvoiced)} subtitle={outstanding > 0 ? fmt(outstanding) + ' outstanding' : 'All invoiced'} />
        <StatCard label="Deals" value={dealCount} subtitle={'Avg ' + fmt(avgDeal)} />
      </MetricRow>
      <MetricRow>
        <StatCard label="New Business" value={fmt(newBizRevenue)} subtitle={newBizCount + ' deals'} />
        <StatCard label="Upsells" value={fmt(upsellRevenue)} subtitle={upsellCount + ' deals'} />
      </MetricRow>

      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: 20, border: '1px solid ' + theme.line }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={byService} margin={{ top: 10, right: 10, left: 10, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="service" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={(v) => ['$' + v.toLocaleString(), 'Revenue']} />
            <Bar dataKey="revenue" fill={theme.accent} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ marginTop: 16, background: theme.panel, borderRadius: 16, padding: 16, border: '1px solid ' + theme.line, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid ' + theme.line }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600 }}>Client</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600 }}>Amount</th>
              <th style={{ textAlign: 'right', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600 }}>Invoiced</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600 }}>Service</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600 }}>Type</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: theme.inkMuted, fontWeight: 600 }}>Closed</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d, i) => (
              <tr key={i} style={{ borderBottom: '1px solid ' + theme.line }}>
                <td style={{ padding: '8px 12px', color: theme.ink }}>{d.client}</td>
                <td style={{ padding: '8px 12px', color: theme.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(d.amount)}</td>
                <td style={{ padding: '8px 12px', color: d.invoiced ? theme.ink : theme.inkMuted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.invoiced ? fmt(d.invoiced) : '—'}</td>
                <td style={{ padding: '8px 12px', color: theme.inkMuted, fontSize: 12 }}>{d.service}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: d.type === 'New Biz' ? theme.accent + '22' : theme.secondary + '22', color: d.type === 'New Biz' ? theme.accent : theme.secondary }}>{d.type}</span></td>
                <td style={{ padding: '8px 12px', color: theme.inkMuted, fontSize: 12 }}>{d.closeDate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <MetricNote>Source: Revenue Tracker 2026.xlsx (Sohrab Azad, OneDrive) via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()"""

# Build initial values from the February data we already pulled
feb_deals = [
    {"client": "SVN (1st cohort)", "amount": 9600, "invoiced": 9600, "service": "Private AI Foundational Bootcamp (24 users)", "type": "New Biz", "closeDate": "Feb 1", "payment": ""},
    {"client": "Nowak Dental", "amount": 749, "invoiced": 749, "service": "AI Champions Group", "type": "Upsell", "closeDate": "Feb 1", "payment": ""},
    {"client": "SN Transport", "amount": 1250, "invoiced": 1250, "service": "AI Foundational Bootcamp", "type": "Upsell", "closeDate": "Feb 1", "payment": ""},
    {"client": "Immatics", "amount": 9000, "invoiced": 9000, "service": "AI Agents Bootcamp (3 users)", "type": "Upsell", "closeDate": "Feb 4", "payment": "ACH"},
    {"client": "Commander Concrete", "amount": 1250, "invoiced": 1250, "service": "AI Foundational Bootcamp", "type": "New Biz", "closeDate": "Feb 5", "payment": ""},
    {"client": "Dillabaughs", "amount": 2500, "invoiced": 2500, "service": "AI Foundational Bootcamp (2 users)", "type": "New Biz", "closeDate": "Feb 5", "payment": "ACH"},
    {"client": "Preservation Equity Fund Advisors", "amount": 10450, "invoiced": 10450, "service": "Private AI Foundational Bootcamp (11 users)", "type": "New Biz", "closeDate": "Feb 8", "payment": "ACH"},
    {"client": "Total Package HR", "amount": 10000, "invoiced": 10000, "service": "Private AI Foundational Bootcamp (10 users)", "type": "New Biz", "closeDate": "Feb 9", "payment": "ACH"},
    {"client": "ATS Construction", "amount": 5000, "invoiced": 5000, "service": "AI Foundational Bootcamp (4 users)", "type": "New Biz", "closeDate": "Feb 10", "payment": "ACH"},
    {"client": "Juana", "amount": 1250, "invoiced": 0, "service": "AI Foundational Bootcamp", "type": "New Biz", "closeDate": "Feb 10", "payment": ""},
    {"client": "Tire Discounter Group", "amount": 14000, "invoiced": 0, "service": "Private AI Foundational Bootcamp (14 users)", "type": "New Biz", "closeDate": "Feb 12", "payment": ""},
    {"client": "Bradley Landscape", "amount": 1250, "invoiced": 0, "service": "AI Foundational Bootcamp", "type": "New Biz", "closeDate": "Feb 15", "payment": ""},
    {"client": "Brody Brothers", "amount": 2500, "invoiced": 0, "service": "AI Foundational Bootcamp (2 users)", "type": "New Biz", "closeDate": "Feb 15", "payment": ""},
]

by_service_map = {}
for d in feb_deals:
    svc = d["service"].split("(")[0].strip()
    if svc not in by_service_map:
        by_service_map[svc] = {"service": svc, "count": 0, "revenue": 0}
    by_service_map[svc]["count"] += 1
    by_service_map[svc]["revenue"] += d["amount"]
by_service = sorted(by_service_map.values(), key=lambda x: -x["revenue"])

total_rev = sum(d["amount"] for d in feb_deals)
total_inv = sum(d["invoiced"] for d in feb_deals)
new_biz = [d for d in feb_deals if "New" in d["type"]]
upsells = [d for d in feb_deals if "Upsell" in d["type"]]

initial_values = json.dumps({
    "totalRevenue": total_rev,
    "totalInvoiced": total_inv,
    "outstandingInvoice": total_rev - total_inv,
    "dealCount": len(feb_deals),
    "avgDealSize": round(total_rev / len(feb_deals)),
    "newBizCount": len(new_biz),
    "newBizRevenue": sum(d["amount"] for d in new_biz),
    "upsellCount": len(upsells),
    "upsellRevenue": sum(d["amount"] for d in upsells),
    "byService": by_service,
    "deals": feb_deals,
    "monthLabel": "February 2026",
})

# Build initial rendered HTML by substituting placeholders
def make_initial_html():
    fmt_deals = json.dumps(feb_deals)
    fmt_by_service = json.dumps(by_service)
    new_biz_rev = sum(d["amount"] for d in new_biz)
    upsell_rev = sum(d["amount"] for d in upsells)

    # Use the template_jsx and substitute PLACEHOLDER tokens with actual values
    html = template_jsx
    html = html.replace("TOTAL_REVENUE_PLACEHOLDER", str(total_rev))
    html = html.replace("TOTAL_INVOICED_PLACEHOLDER", str(total_inv))
    html = html.replace("OUTSTANDING_PLACEHOLDER", str(total_rev - total_inv))
    html = html.replace("DEAL_COUNT_PLACEHOLDER", str(len(feb_deals)))
    html = html.replace("AVG_DEAL_PLACEHOLDER", str(round(total_rev / len(feb_deals))))
    html = html.replace("NEW_BIZ_COUNT_PLACEHOLDER", str(len(new_biz)))
    html = html.replace("NEW_BIZ_REVENUE_PLACEHOLDER", str(new_biz_rev))
    html = html.replace("UPSELL_COUNT_PLACEHOLDER", str(len(upsells)))
    html = html.replace("UPSELL_REVENUE_PLACEHOLDER", str(upsell_rev))
    html = html.replace("BY_SERVICE_PLACEHOLDER", fmt_by_service)
    html = html.replace("DEALS_PLACEHOLDER", fmt_deals)
    html = html.replace("MONTH_LABEL_PLACEHOLDER", '"February 2026"')
    return html


initial_html = make_initial_html()


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
               VALUES (?, ?, ?, ?, ?, ?, 'claude', 1, 0, '{}', ?, ?)""",
            (metric_id, NAME, SLUG, instructions, template_jsx, 259200, NOW, NOW)
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
            (binding_id, SCREEN_ID, metric_id, 0, "full", 0, 0, 12, 14),
        )
        print(f"  BIND  {SLUG} -> {SCREEN_ID} (12x14)")

    conn.commit()
    conn.close()
    print("\nDone")


if __name__ == "__main__":
    main()
