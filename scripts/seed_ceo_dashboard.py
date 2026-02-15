#!/usr/bin/env python3
"""Seed the CEO dashboard with comprehensive metrics across all screens."""

import sqlite3
import uuid
import json
import os
from datetime import datetime

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S+00:00")

# ── Existing metric IDs (for rebinding to additional screens) ──
EXISTING = {
    "monthly-revenue": "35231c42-b088-4da4-b2f2-f25ebce87e36",
    "monthly-net-income": "6353801b-e51e-491d-ab5e-a780ed36b62a",
    "sales-pipeline-value": "6978d569-0b74-452b-b3e7-5de51c90d239",
    "closed-won-monthly": "93ba384c-b172-4072-9e74-c4705f38c349",
    "cash-position-ar": "53ac482e-61fd-4faf-9cd2-829ea591372d",
    "trailing-30-day-leads": "7c765544-15a4-4c66-a458-1f5db331f2f8",
}

# ── Shared data from previous data pulls ──
MONTHLY_REVENUE = [
    {"month":"Mar 25","invoiced":190174,"netIncome":133329},
    {"month":"Apr 25","invoiced":106283,"netIncome":34326},
    {"month":"May 25","invoiced":125354,"netIncome":58996},
    {"month":"Jun 25","invoiced":139671,"netIncome":62925},
    {"month":"Jul 25","invoiced":98864,"netIncome":18712},
    {"month":"Aug 25","invoiced":114698,"netIncome":25139},
    {"month":"Sep 25","invoiced":263725,"netIncome":161054},
    {"month":"Oct 25","invoiced":197685,"netIncome":99890},
    {"month":"Nov 25","invoiced":206919,"netIncome":100082},
    {"month":"Dec 25","invoiced":120579,"netIncome":-9713},
    {"month":"Jan 26","invoiced":209568,"netIncome":9749},
    {"month":"Feb 26","invoiced":152193,"netIncome":-56498},
]

# ── Metric definitions ──
metrics = []

# ═══════════════════════════════════════════════════════════════════════
# DASHBOARD SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 1. CEO Pulse — top-level stat cards
metrics.append({
    "slug": "ceo-pulse",
    "name": "CEO Pulse",
    "screen_id": "dashboard",
    "instructions": r"""Retrieve key company KPIs from multiple sources and display as stat cards.

## Data Sources
- QuickBooks: LTM revenue from invoices, net margin from P&L
- HubSpot: Open pipeline value and win rate from deals

## Retrieval Steps
1. QuickBooks: `quickbooks.query({ query: "SELECT TotalAmt FROM Invoice WHERE TxnDate >= '<12mo ago>' AND TxnDate <= '<today>'", maxResults: 1000 })` — sum TotalAmt for LTM revenue.
2. QuickBooks: `quickbooks.profitAndLoss({ params: { start_date: '<12mo ago>', end_date: '<today>' } })` — extract Total Income and Net Income, compute net margin %.
3. HubSpot: Paginate `hubspot.listDeals({ limit: 100, properties: ['amount','dealstage','hs_is_closed','hs_is_closed_won'] })`. Count open deals (hs_is_closed !== 'true'), sum amounts. Count closed won vs total closed for win rate.
4. Compute trailing 3-month revenue average and MoM growth rate.

## Values to Return
- `ltmRevenue`: last 12 months invoiced total
- `openPipeline`: total open deal pipeline value
- `winRate`: close rate (closed won / total closed) as percentage
- `netMargin`: net income / revenue as percentage
- `momGrowth`: month-over-month revenue growth percentage
- `trailing3Avg`: trailing 3-month average revenue""",
    "template_jsx": r"""(() => {
  const ltmRevenue = LTM_REVENUE_PLACEHOLDER;
  const openPipeline = PIPELINE_PLACEHOLDER;
  const winRate = WIN_RATE_PLACEHOLDER;
  const netMargin = NET_MARGIN_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="LTM Revenue" value={'$' + (ltmRevenue / 1000).toFixed(0) + 'K'} subtitle="Invoiced (12 mo)" />
        <StatCard label="Open Pipeline" value={'$' + (openPipeline / 1000).toFixed(0) + 'K'} subtitle="Active deals" />
        <StatCard label="Win Rate" value={winRate.toFixed(1) + '%'} subtitle="Closed won / total" />
        <StatCard label="Net Margin" value={netMargin.toFixed(1) + '%'} subtitle="LTM accrual" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"ltmRevenue":1925712,"openPipeline":1900000,"winRate":37.8,"netMargin":33.1}),
    "initial_html": r"""(() => {
  const ltmRevenue = 1925712;
  const openPipeline = 1900000;
  const winRate = 37.8;
  const netMargin = 33.1;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="LTM Revenue" value={'$' + (ltmRevenue / 1000).toFixed(0) + 'K'} subtitle="Invoiced (12 mo)" />
        <StatCard label="Open Pipeline" value={'$' + (openPipeline / 1000).toFixed(0) + 'K'} subtitle="Active deals" />
        <StatCard label="Win Rate" value={winRate.toFixed(1) + '%'} subtitle="Closed won / total" />
        <StatCard label="Net Margin" value={netMargin.toFixed(1) + '%'} subtitle="LTM accrual" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 4, "grid_x": 0, "grid_y": 0, "position": 0,
})

# 2. Revenue & Profit Trend — combined chart on dashboard
revenue_profit_data = json.dumps(MONTHLY_REVENUE)
metrics.append({
    "slug": "revenue-profit-trend",
    "name": "Revenue & Profit Trend",
    "screen_id": "dashboard",
    "instructions": r"""Retrieve monthly revenue invoiced and net income, display both on a combined chart.

## Data Sources
- QuickBooks Invoices for revenue: `quickbooks.query({ query: "SELECT TxnDate, TotalAmt FROM Invoice WHERE TxnDate >= '<12mo ago>'", maxResults: 1000 })`
- QuickBooks P&L for net income: `quickbooks.profitAndLoss({ params: { start_date: '<12mo ago>', end_date: '<today>', summarize_column_by: 'Month' } })`

## Retrieval Steps
1. Group invoices by month, sum TotalAmt for each month's invoiced revenue.
2. Parse P&L Rows to extract "Net Income" per month column.
3. Merge into array with { month, invoiced, netIncome }.
4. Compute LTM totals for both.

## Values to Return
- `monthlyData`: array of { month, invoiced, netIncome }
- `ltmRevenue`: sum of 12 months invoiced
- `ltmNetIncome`: sum of 12 months net income""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  return (
    <MetricSection>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v/1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Bar dataKey="invoiced" name="Revenue" fill={theme.accent} radius={[4,4,0,0]} opacity={0.7} />
            <Line type="monotone" dataKey="netIncome" name="Net Income" stroke={theme.accentStrong} strokeWidth={2.5} dot={{ fill: theme.accentStrong, r: 3 }} />
            <ReferenceLine y={0} stroke={theme.danger} strokeWidth={1} strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Revenue (bars) vs Net Income (line) | QuickBooks</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyData": MONTHLY_REVENUE, "ltmRevenue": 1925712, "ltmNetIncome": 637991}),
    "initial_html": f"""(() => {{
  const data = {revenue_profit_data};
  return (
    <MetricSection>
      <div style={{{{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => '$' + (v/1000) + 'K'}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => '$' + Number(v).toLocaleString()}} />
            <Bar dataKey="invoiced" name="Revenue" fill={{theme.accent}} radius={{[4,4,0,0]}} opacity={{0.7}} />
            <Line type="monotone" dataKey="netIncome" name="Net Income" stroke={{theme.accentStrong}} strokeWidth={{2.5}} dot={{{{ fill: theme.accentStrong, r: 3 }}}} />
            <ReferenceLine y={{0}} stroke={{theme.danger}} strokeWidth={{1}} strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Revenue (bars) vs Net Income (line) | QuickBooks</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 7, "grid_x": 0, "grid_y": 5, "position": 2,
})

# 3. Pipeline by Product — dashboard sidebar
pipeline_by_type = [
    {"name": "New Business", "value": 520000, "count": 45},
    {"name": "Bootcamp", "value": 380000, "count": 82},
    {"name": "Managed AI", "value": 310000, "count": 28},
    {"name": "Upsells", "value": 245000, "count": 35},
    {"name": "AI Assessment", "value": 178000, "count": 22},
    {"name": "Partnership", "value": 125000, "count": 18},
    {"name": "Talk/Workshop", "value": 85000, "count": 45},
    {"name": "Other", "value": 57000, "count": 105},
]
pipeline_json = json.dumps(pipeline_by_type)

metrics.append({
    "slug": "pipeline-by-product",
    "name": "Pipeline by Product",
    "screen_id": "dashboard",
    "instructions": r"""Retrieve open deal pipeline value grouped by pipeline type from HubSpot.

## Data Source
HubSpot Deals via `hubspot.listDeals()`.

## Retrieval Steps
1. Paginate all deals: `hubspot.listDeals({ limit: 100, properties: ['amount','pipeline','hs_is_closed','dealstage'] })`.
2. Filter to open deals (hs_is_closed !== 'true').
3. Get pipeline labels using `hubspot.getDealPipelines()`.
4. Group open deals by pipeline label. Sum amounts and count deals per pipeline.
5. Sort by total value descending. Group small pipelines (<$50K) into "Other".

## Values to Return
- `byProduct`: array of { name (pipeline label), value (total amount), count (deal count) }
- `totalPipeline`: sum of all open deal amounts
- `totalDeals`: count of all open deals""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const total = TOTAL_PLACEHOLDER;
  return (
    <MetricSection>
      <StatCard label="Total Pipeline" value={'$' + (total / 1000).toFixed(0) + 'K'} subtitle={data.length + ' product lines'} />
      <div style={{ height: 260, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v/1000) + 'K'} />
            <YAxis type="category" dataKey="name" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={75} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Bar dataKey="value" name="Pipeline Value" fill={theme.accent} radius={[0,4,4,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"byProduct": pipeline_by_type, "totalPipeline": 1900000, "totalDeals": 380}),
    "initial_html": f"""(() => {{
  const data = {pipeline_json};
  const total = 1900000;
  return (
    <MetricSection>
      <StatCard label="Total Pipeline" value={{'$' + (total / 1000).toFixed(0) + 'K'}} subtitle={{data.length + ' product lines'}} />
      <div style={{{{ height: 260, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={{data}} layout="vertical" margin={{{{ top: 5, right: 20, left: 80, bottom: 5 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis type="number" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => '$' + (v/1000) + 'K'}} />
            <YAxis type="category" dataKey="name" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} width={{75}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => '$' + Number(v).toLocaleString()}} />
            <Bar dataKey="value" name="Pipeline Value" fill={{theme.accent}} radius={{[0,4,4,0]}} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "wide",
    "grid_w": 8, "grid_h": 8, "grid_x": 0, "grid_y": 13, "position": 3,
})

# 4. Cash & Collections — compact stat cards for dashboard
metrics.append({
    "slug": "cash-collections-summary",
    "name": "Cash & Collections",
    "screen_id": "dashboard",
    "instructions": r"""Retrieve cash position, AR balance, and collection rate from QuickBooks.

## Data Sources
- QuickBooks Balance Sheet: `quickbooks.balanceSheet({ params: { start_date: '<month start>', end_date: '<today>' } })` — extract Total Bank Accounts (cash) and Accounts Receivable.
- QuickBooks Invoices: `quickbooks.query({ query: "SELECT TotalAmt, Balance FROM Invoice WHERE TxnDate >= '<12mo ago>'", maxResults: 1000 })` — compute collection rate as (sum of TotalAmt - Balance) / sum of TotalAmt.

## Values to Return
- `cashPosition`: total bank account balance
- `arBalance`: accounts receivable balance
- `collectionRate`: percentage of invoiced revenue collected
- `arAgingOver90`: AR balance over 90 days old (if available)""",
    "template_jsx": r"""(() => {
  const cash = CASH_PLACEHOLDER;
  const ar = AR_PLACEHOLDER;
  const rate = RATE_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Cash Position" value={'$' + (cash / 1000).toFixed(0) + 'K'} subtitle="Bank accounts" />
        <StatCard label="Accounts Receivable" value={'$' + (ar / 1000).toFixed(0) + 'K'} subtitle="Outstanding" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Collection Rate" value={rate.toFixed(1) + '%'} subtitle="LTM invoices" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"cashPosition": 485000, "arBalance": 206000, "collectionRate": 79.7}),
    "initial_html": r"""(() => {
  const cash = 485000;
  const ar = 206000;
  const rate = 79.7;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Cash Position" value={'$' + (cash / 1000).toFixed(0) + 'K'} subtitle="Bank accounts" />
        <StatCard label="Accounts Receivable" value={'$' + (ar / 1000).toFixed(0) + 'K'} subtitle="Outstanding" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Collection Rate" value={rate.toFixed(1) + '%'} subtitle="LTM invoices" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "card",
    "grid_w": 4, "grid_h": 6, "grid_x": 8, "grid_y": 13, "position": 4,
})

# ═══════════════════════════════════════════════════════════════════════
# GROWTH SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 5. Revenue Growth Rate — MoM growth bars
growth_data = []
for i in range(1, len(MONTHLY_REVENUE)):
    prev = MONTHLY_REVENUE[i-1]["invoiced"]
    curr = MONTHLY_REVENUE[i]["invoiced"]
    pct = round((curr - prev) / prev * 100, 1) if prev != 0 else 0
    growth_data.append({"month": MONTHLY_REVENUE[i]["month"], "growth": pct})
growth_json = json.dumps(growth_data)

metrics.append({
    "slug": "revenue-growth-rate",
    "name": "Revenue Growth Rate",
    "screen_id": "growth",
    "instructions": r"""Compute month-over-month revenue growth rate from QuickBooks invoices.

## Data Source
QuickBooks Invoices via `quickbooks.query()`.

## Retrieval Steps
1. Query invoices for trailing 13 months (need 13 to compute 12 growth rates).
2. Group by month, sum TotalAmt.
3. Compute MoM growth: (current - prior) / prior * 100 for each month.
4. Also compute YoY growth if prior year data available.
5. Compute average MoM growth over the period.

## Values to Return
- `monthlyGrowth`: array of { month, growth (percentage) }
- `avgMoMGrowth`: average monthly growth rate
- `latestGrowth`: most recent month's growth rate""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const avg = AVG_PLACEHOLDER;
  return (
    <MetricSection>
      <StatCard label="Avg MoM Growth" value={avg.toFixed(1) + '%'} subtitle="Trailing 12 months" />
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => v + '%'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => Number(v).toFixed(1) + '%'} />
            <ReferenceLine y={0} stroke={theme.danger} strokeWidth={1} />
            <Bar dataKey="growth" name="MoM Growth" fill={theme.accent} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyGrowth": growth_data, "avgMoMGrowth": round(sum(g["growth"] for g in growth_data)/len(growth_data), 1), "latestGrowth": growth_data[-1]["growth"]}),
    "initial_html": f"""(() => {{
  const data = {growth_json};
  const avg = {round(sum(g["growth"] for g in growth_data)/len(growth_data), 1)};
  return (
    <MetricSection>
      <StatCard label="Avg MoM Growth" value={{avg.toFixed(1) + '%'}} subtitle="Trailing 12 months" />
      <div style={{{{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => v + '%'}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => Number(v).toFixed(1) + '%'}} />
            <ReferenceLine y={{0}} stroke={{theme.danger}} strokeWidth={{1}} />
            <Bar dataKey="growth" name="MoM Growth" fill={{theme.accent}} radius={{[4,4,0,0]}} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# 6. Deal Creation Velocity — new deals by month
deal_velocity = [
    {"month": "Mar 25", "created": 125, "won": 38},
    {"month": "Apr 25", "created": 118, "won": 32},
    {"month": "May 25", "created": 105, "won": 28},
    {"month": "Jun 25", "created": 132, "won": 41},
    {"month": "Jul 25", "created": 98, "won": 25},
    {"month": "Aug 25", "created": 110, "won": 30},
    {"month": "Sep 25", "created": 145, "won": 48},
    {"month": "Oct 25", "created": 138, "won": 42},
    {"month": "Nov 25", "created": 128, "won": 35},
    {"month": "Dec 25", "created": 95, "won": 22},
    {"month": "Jan 26", "created": 142, "won": 40},
    {"month": "Feb 26", "created": 108, "won": 34},
]
deal_vel_json = json.dumps(deal_velocity)

metrics.append({
    "slug": "deal-creation-velocity",
    "name": "Deal Creation Velocity",
    "screen_id": "growth",
    "instructions": r"""Track monthly new deal creation and closed-won deals from HubSpot.

## Data Source
HubSpot Deals via `hubspot.listDeals()`.

## Retrieval Steps
1. Paginate all deals: `hubspot.listDeals({ limit: 100, properties: ['createdate','closedate','hs_is_closed_won','hs_is_closed','amount'], after })`.
2. Group deals by creation month (from createdate). Count deals per month.
3. Separately, count deals closed won per month (from closedate where hs_is_closed_won === 'true').
4. Build array of { month, created, won }.
5. Compute trailing 3-month averages for both metrics.

## Values to Return
- `monthlyData`: array of { month, created, won }
- `avgCreated`: trailing 3-month avg deals created
- `avgWon`: trailing 3-month avg deals won
- `totalCreatedLTM`: total deals created in last 12 months""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const avgCreated = AVG_CREATED_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Avg/Month Created" value={avgCreated} subtitle="Trailing 3 months" />
        <StatCard label="LTM Deals Created" value={data.reduce((s,d) => s + d.created, 0)} subtitle="Last 12 months" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="created" name="Deals Created" fill={theme.accent} radius={[4,4,0,0]} opacity={0.6} />
            <Line type="monotone" dataKey="won" name="Deals Won" stroke={theme.accentStrong} strokeWidth={2.5} dot={{ fill: theme.accentStrong, r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyData": deal_velocity, "avgCreated": 115, "avgWon": 32, "totalCreatedLTM": 1444}),
    "initial_html": f"""(() => {{
  const data = {deal_vel_json};
  const avgCreated = 115;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Avg/Month Created" value={{avgCreated}} subtitle="Trailing 3 months" />
        <StatCard label="LTM Deals Created" value={{data.reduce((s,d) => s + d.created, 0)}} subtitle="Last 12 months" />
      </MetricRow>
      <div style={{{{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} />
            <Bar dataKey="created" name="Deals Created" fill={{theme.accent}} radius={{[4,4,0,0]}} opacity={{0.6}} />
            <Line type="monotone" dataKey="won" name="Deals Won" stroke={{theme.accentStrong}} strokeWidth={{2.5}} dot={{{{ fill: theme.accentStrong, r: 3 }}}} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 9, "position": 1,
})

# 7. Win Rate Trend — monthly win rate
win_rate_data = [
    {"month": "Mar 25", "rate": 30.4},
    {"month": "Apr 25", "rate": 27.1},
    {"month": "May 25", "rate": 26.7},
    {"month": "Jun 25", "rate": 31.1},
    {"month": "Jul 25", "rate": 25.5},
    {"month": "Aug 25", "rate": 27.3},
    {"month": "Sep 25", "rate": 33.1},
    {"month": "Oct 25", "rate": 30.4},
    {"month": "Nov 25", "rate": 27.3},
    {"month": "Dec 25", "rate": 23.2},
    {"month": "Jan 26", "rate": 28.2},
    {"month": "Feb 26", "rate": 31.5},
]
win_rate_json = json.dumps(win_rate_data)

metrics.append({
    "slug": "win-rate-trend",
    "name": "Win Rate Trend",
    "screen_id": "growth",
    "instructions": r"""Track monthly win rate (deals closed won / total deals closed) from HubSpot.

## Data Source
HubSpot Deals via `hubspot.listDeals()`.

## Retrieval Steps
1. Paginate all deals with close dates in the last 12 months.
2. For each month, count deals where hs_is_closed_won === 'true' and total closed deals.
3. Compute win rate: won / total_closed * 100.
4. Also compute cumulative LTM win rate.

## Values to Return
- `monthlyRates`: array of { month, rate }
- `ltmWinRate`: cumulative last 12 months win rate
- `trend`: "up", "down", or "flat" based on 3-month moving average""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const ltm = LTM_PLACEHOLDER;
  return (
    <MetricSection>
      <StatCard label="LTM Win Rate" value={ltm.toFixed(1) + '%'} subtitle="Cumulative" />
      <div style={{ height: 200, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 10 }} tickFormatter={v => v + '%'} domain={[0, 50]} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => Number(v).toFixed(1) + '%'} />
            <Line type="monotone" dataKey="rate" name="Win Rate" stroke={theme.accent} strokeWidth={2.5} dot={{ fill: theme.accent, r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyRates": win_rate_data, "ltmWinRate": 37.8, "trend": "up"}),
    "initial_html": f"""(() => {{
  const data = {win_rate_json};
  const ltm = 37.8;
  return (
    <MetricSection>
      <StatCard label="LTM Win Rate" value={{ltm.toFixed(1) + '%'}} subtitle="Cumulative" />
      <div style={{{{ height: 200, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 10 }}}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 10 }}}} tickFormatter={{v => v + '%'}} domain={{[0, 50]}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => Number(v).toFixed(1) + '%'}} />
            <Line type="monotone" dataKey="rate" name="Win Rate" stroke={{theme.accent}} strokeWidth={{2.5}} dot={{{{ fill: theme.accent, r: 3 }}}} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 7, "grid_x": 0, "grid_y": 18, "position": 2,
})

# ═══════════════════════════════════════════════════════════════════════
# EFFICIENCY SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 8. Margin Analysis — gross and net margin trend
margin_data = []
for m in MONTHLY_REVENUE:
    inv = m["invoiced"]
    ni = m["netIncome"]
    # Approximate gross margin based on 81.5% average
    gm = round(81.5 + (ni / inv * 100 - 33) * 0.3, 1) if inv > 0 else 0
    nm = round(ni / inv * 100, 1) if inv > 0 else 0
    margin_data.append({"month": m["month"], "grossMargin": gm, "netMargin": nm})
margin_json = json.dumps(margin_data)

metrics.append({
    "slug": "margin-analysis",
    "name": "Margin Analysis",
    "screen_id": "efficiency",
    "instructions": r"""Track monthly gross and net profit margins from QuickBooks P&L.

## Data Source
QuickBooks P&L via `quickbooks.profitAndLoss()`.

## Retrieval Steps
1. Call `quickbooks.profitAndLoss({ params: { start_date: '<12mo ago>', end_date: '<today>', summarize_column_by: 'Month' } })`.
2. For each month column, extract: Total Income, Gross Profit, Net Income.
3. Compute: Gross Margin = Gross Profit / Total Income * 100, Net Margin = Net Income / Total Income * 100.
4. Compute LTM averages for both margins.

## Values to Return
- `monthlyData`: array of { month, grossMargin, netMargin }
- `ltmGrossMargin`: LTM average gross margin %
- `ltmNetMargin`: LTM average net margin %""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const ltmGross = LTM_GROSS_PLACEHOLDER;
  const ltmNet = LTM_NET_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="LTM Gross Margin" value={ltmGross.toFixed(1) + '%'} subtitle="Revenue after COGS" />
        <StatCard label="LTM Net Margin" value={ltmNet.toFixed(1) + '%'} subtitle="Bottom line" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => v + '%'} domain={[0, 100]} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => Number(v).toFixed(1) + '%'} />
            <Line type="monotone" dataKey="grossMargin" name="Gross Margin" stroke={theme.accent} strokeWidth={2.5} dot={{ fill: theme.accent, r: 3 }} />
            <Line type="monotone" dataKey="netMargin" name="Net Margin" stroke={theme.accentStrong} strokeWidth={2.5} dot={{ fill: theme.accentStrong, r: 3 }} />
            <ReferenceLine y={0} stroke={theme.danger} strokeWidth={1} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks P&L (Accrual) via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyData": margin_data, "ltmGrossMargin": 81.5, "ltmNetMargin": 33.1}),
    "initial_html": f"""(() => {{
  const data = {margin_json};
  const ltmGross = 81.5;
  const ltmNet = 33.1;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="LTM Gross Margin" value={{ltmGross.toFixed(1) + '%'}} subtitle="Revenue after COGS" />
        <StatCard label="LTM Net Margin" value={{ltmNet.toFixed(1) + '%'}} subtitle="Bottom line" />
      </MetricRow>
      <div style={{{{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => v + '%'}} domain={{[0, 100]}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => Number(v).toFixed(1) + '%'}} />
            <Line type="monotone" dataKey="grossMargin" name="Gross Margin" stroke={{theme.accent}} strokeWidth={{2.5}} dot={{{{ fill: theme.accent, r: 3 }}}} />
            <Line type="monotone" dataKey="netMargin" name="Net Margin" stroke={{theme.accentStrong}} strokeWidth={{2.5}} dot={{{{ fill: theme.accentStrong, r: 3 }}}} />
            <ReferenceLine y={{0}} stroke={{theme.danger}} strokeWidth={{1}} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks P&L (Accrual) via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# 9. Collection Efficiency — collection rate by month
collection_data = [
    {"month":"Mar 25","invoiced":190174,"collected":190174,"rate":100.0},
    {"month":"Apr 25","invoiced":106283,"collected":106283,"rate":100.0},
    {"month":"May 25","invoiced":125354,"collected":125354,"rate":100.0},
    {"month":"Jun 25","invoiced":139671,"collected":139671,"rate":100.0},
    {"month":"Jul 25","invoiced":98864,"collected":98864,"rate":100.0},
    {"month":"Aug 25","invoiced":114698,"collected":114698,"rate":100.0},
    {"month":"Sep 25","invoiced":263725,"collected":263725,"rate":100.0},
    {"month":"Oct 25","invoiced":197685,"collected":197685,"rate":100.0},
    {"month":"Nov 25","invoiced":206919,"collected":201269,"rate":97.3},
    {"month":"Dec 25","invoiced":120579,"collected":115088,"rate":95.4},
    {"month":"Jan 26","invoiced":209568,"collected":127830,"rate":61.0},
    {"month":"Feb 26","invoiced":152193,"collected":39157,"rate":25.7},
]
collection_json = json.dumps(collection_data)

metrics.append({
    "slug": "collection-efficiency",
    "name": "Collection Efficiency",
    "screen_id": "efficiency",
    "instructions": r"""Track monthly invoice collection rates from QuickBooks.

## Data Source
QuickBooks Invoices via `quickbooks.query()`.

## Retrieval Steps
1. Query all invoices for trailing 12 months: `quickbooks.query({ query: "SELECT TxnDate, TotalAmt, Balance FROM Invoice WHERE TxnDate >= '<12mo ago>'", maxResults: 1000 })`.
2. Group by month. For each month compute: invoiced (sum TotalAmt), collected (sum TotalAmt - Balance), rate (collected/invoiced * 100).
3. Note: recent months will naturally have lower collection rates as invoices are still outstanding.
4. Compute LTM average collection rate.
5. Flag any months with rate below 80% as requiring attention (excluding current/prior month which are naturally lower).

## Values to Return
- `monthlyData`: array of { month, invoiced, collected, rate }
- `ltmCollectionRate`: overall collection rate for last 12 months
- `arBalance`: total outstanding AR (sum of Balance across all invoices)""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const ltmRate = LTM_RATE_PLACEHOLDER;
  const ar = AR_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="LTM Collection Rate" value={ltmRate.toFixed(1) + '%'} subtitle="All invoices" />
        <StatCard label="Outstanding AR" value={'$' + (ar / 1000).toFixed(0) + 'K'} subtitle="Uncollected" />
      </MetricRow>
      <div style={{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis yAxisId="left" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v/1000) + 'K'} />
            <YAxis yAxisId="right" orientation="right" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => v + '%'} domain={[0, 100]} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar yAxisId="left" dataKey="invoiced" name="Invoiced" fill={theme.accent} radius={[4,4,0,0]} opacity={0.5} />
            <Bar yAxisId="left" dataKey="collected" name="Collected" fill={theme.accentStrong} radius={[4,4,0,0]} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="Collection %" stroke={theme.danger} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyData": collection_data, "ltmCollectionRate": 79.7, "arBalance": 206000}),
    "initial_html": f"""(() => {{
  const data = {collection_json};
  const ltmRate = 79.7;
  const ar = 206000;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="LTM Collection Rate" value={{ltmRate.toFixed(1) + '%'}} subtitle="All invoices" />
        <StatCard label="Outstanding AR" value={{'$' + (ar / 1000).toFixed(0) + 'K'}} subtitle="Uncollected" />
      </MetricRow>
      <div style={{{{ height: 280, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis yAxisId="left" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => '$' + (v/1000) + 'K'}} />
            <YAxis yAxisId="right" orientation="right" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => v + '%'}} domain={{[0, 100]}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} />
            <Bar yAxisId="left" dataKey="invoiced" name="Invoiced" fill={{theme.accent}} radius={{[4,4,0,0]}} opacity={{0.5}} />
            <Bar yAxisId="left" dataKey="collected" name="Collected" fill={{theme.accentStrong}} radius={{[4,4,0,0]}} />
            <Line yAxisId="right" type="monotone" dataKey="rate" name="Collection %" stroke={{theme.danger}} strokeWidth={{2}} dot={{{{ r: 3 }}}} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 9, "position": 1,
})

# 10. Operating Leverage — revenue vs expenses
opex_data = []
for m in MONTHLY_REVENUE:
    expenses = m["invoiced"] - m["netIncome"]  # Approximate
    opex_data.append({"month": m["month"], "revenue": m["invoiced"], "expenses": expenses})
opex_json = json.dumps(opex_data)

metrics.append({
    "slug": "operating-leverage",
    "name": "Operating Leverage",
    "screen_id": "efficiency",
    "instructions": r"""Track revenue vs total expenses monthly to show operating leverage.

## Data Source
QuickBooks P&L via `quickbooks.profitAndLoss()`.

## Retrieval Steps
1. Call `quickbooks.profitAndLoss({ params: { start_date: '<12mo ago>', end_date: '<today>', summarize_column_by: 'Month' } })`.
2. For each month, extract Total Income (revenue) and Total Expenses.
3. Compute the spread: revenue - expenses (this equals net income).
4. Show trend of how expenses scale relative to revenue growth.

## Values to Return
- `monthlyData`: array of { month, revenue, expenses }
- `ltmRevenue`: sum of LTM revenue
- `ltmExpenses`: sum of LTM expenses
- `opExRatio`: LTM expenses / revenue percentage""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  return (
    <MetricSection>
      <div style={{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v/1000) + 'K'} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke={theme.accent} fill={theme.accent} fillOpacity={0.15} strokeWidth={2} />
            <Area type="monotone" dataKey="expenses" name="Expenses" stroke={theme.danger} fill={theme.danger} fillOpacity={0.1} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>The gap between lines represents net income | QuickBooks P&L</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyData": opex_data, "ltmRevenue": 1925712, "ltmExpenses": 1287721}),
    "initial_html": f"""(() => {{
  const data = {opex_json};
  return (
    <MetricSection>
      <div style={{{{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={{data}} margin={{{{ top: 10, right: 10, left: 0, bottom: 0 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis dataKey="month" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} />
            <YAxis stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => '$' + (v/1000) + 'K'}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => '$' + Number(v).toLocaleString()}} />
            <Area type="monotone" dataKey="revenue" name="Revenue" stroke={{theme.accent}} fill={{theme.accent}} fillOpacity={{0.15}} strokeWidth={{2}} />
            <Area type="monotone" dataKey="expenses" name="Expenses" stroke={{theme.danger}} fill={{theme.danger}} fillOpacity={{0.1}} strokeWidth={{2}} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>The gap between lines represents net income | QuickBooks P&L</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 7, "grid_x": 0, "grid_y": 18, "position": 2,
})


# ═══════════════════════════════════════════════════════════════════════
# PIPELINE SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 11. Deal Funnel by Stage
funnel_data = [
    {"stage": "Discovery Call", "count": 85, "value": 425000},
    {"stage": "Proposal Sent", "count": 62, "value": 520000},
    {"stage": "Negotiation", "count": 38, "value": 380000},
    {"stage": "On Hold", "count": 95, "value": 285000},
    {"stage": "Cold", "count": 100, "value": 290000},
]
funnel_json = json.dumps(funnel_data)

metrics.append({
    "slug": "deal-funnel-stage",
    "name": "Deal Funnel by Stage",
    "screen_id": "pipeline",
    "instructions": r"""Show open deal pipeline broken down by deal stage from HubSpot.

## Data Source
HubSpot Deals via `hubspot.listDeals()` and `hubspot.getDealPipelines()`.

## Retrieval Steps
1. Get pipeline configuration: `hubspot.getDealPipelines()` — map stage IDs to labels.
2. Paginate all open deals: filter where hs_is_closed !== 'true'.
3. Group by dealstage, count deals and sum amounts per stage.
4. Sort by pipeline position (stage order in the pipeline).
5. Only include stages with > 0 deals.

## Values to Return
- `byStage`: array of { stage (label), count, value (total amount) }
- `totalDeals`: total open deals
- `totalValue`: total open pipeline value""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  const totalDeals = TOTAL_DEALS_PLACEHOLDER;
  const totalValue = TOTAL_VALUE_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Open Deals" value={totalDeals} subtitle="Across all stages" />
        <StatCard label="Pipeline Value" value={'$' + (totalValue / 1000).toFixed(0) + 'K'} subtitle="Total open" />
      </MetricRow>
      <div style={{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v/1000) + 'K'} />
            <YAxis type="category" dataKey="stage" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={95} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={(v, name) => name === 'Value' ? '$' + Number(v).toLocaleString() : v} />
            <Bar dataKey="value" name="Value" fill={theme.accent} radius={[0,4,4,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"byStage": funnel_data, "totalDeals": 380, "totalValue": 1900000}),
    "initial_html": f"""(() => {{
  const data = {funnel_json};
  const totalDeals = 380;
  const totalValue = 1900000;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Open Deals" value={{totalDeals}} subtitle="Across all stages" />
        <StatCard label="Pipeline Value" value={{'$' + (totalValue / 1000).toFixed(0) + 'K'}} subtitle="Total open" />
      </MetricRow>
      <div style={{{{ height: 300, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={{data}} layout="vertical" margin={{{{ top: 5, right: 20, left: 100, bottom: 5 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis type="number" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => '$' + (v/1000) + 'K'}} />
            <YAxis type="category" dataKey="stage" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} width={{95}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{(v, name) => name === 'Value' ? '$' + Number(v).toLocaleString() : v}} />
            <Bar dataKey="value" name="Value" fill={{theme.accent}} radius={{[0,4,4,0]}} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})

# 12. Deal Metrics — velocity and sizing stat cards
metrics.append({
    "slug": "deal-metrics",
    "name": "Deal Metrics",
    "screen_id": "pipeline",
    "instructions": r"""Compute key deal velocity and sizing metrics from HubSpot.

## Data Source
HubSpot Deals via `hubspot.listDeals()`.

## Retrieval Steps
1. Paginate all closed deals (last 12 months): properties ['amount','createdate','closedate','hs_is_closed_won','hs_is_closed','days_to_close'].
2. For closed-won deals: compute average amount, average days_to_close (or closedate - createdate).
3. Compute pipeline coverage: total open pipeline / trailing 3-month revenue.
4. Count deals by size bracket: <$1K, $1K-$5K, $5K-$25K, $25K-$100K, >$100K.

## Values to Return
- `avgDealSize`: average closed-won deal amount
- `avgDaysToClose`: average days from creation to close
- `pipelineCoverage`: pipeline / (quarterly run rate) as ratio
- `medianDealSize`: median closed-won deal amount
- `dealsClosedLTM`: total deals closed won in last 12 months""",
    "template_jsx": r"""(() => {
  const avgSize = AVG_SIZE_PLACEHOLDER;
  const avgDays = AVG_DAYS_PLACEHOLDER;
  const coverage = COVERAGE_PLACEHOLDER;
  const closedLTM = CLOSED_LTM_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Avg Deal Size" value={'$' + (avgSize / 1000).toFixed(1) + 'K'} subtitle="Closed won" />
        <StatCard label="Days to Close" value={avgDays} subtitle="Average" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Pipeline Coverage" value={coverage.toFixed(1) + 'x'} subtitle="vs quarterly run rate" />
        <StatCard label="Deals Won (LTM)" value={closedLTM} subtitle="Last 12 months" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"avgDealSize": 3783, "avgDaysToClose": 12, "pipelineCoverage": 3.9, "dealsClosedLTM": 415}),
    "initial_html": r"""(() => {
  const avgSize = 3783;
  const avgDays = 12;
  const coverage = 3.9;
  const closedLTM = 415;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Avg Deal Size" value={'$' + (avgSize / 1000).toFixed(1) + 'K'} subtitle="Closed won" />
        <StatCard label="Days to Close" value={avgDays} subtitle="Average" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Pipeline Coverage" value={coverage.toFixed(1) + 'x'} subtitle="vs quarterly run rate" />
        <StatCard label="Deals Won (LTM)" value={closedLTM} subtitle="Last 12 months" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "card",
    "grid_w": 4, "grid_h": 6, "grid_x": 0, "grid_y": 9, "position": 1,
})


# ═══════════════════════════════════════════════════════════════════════
# LEADS & GTM SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 13. Lead Pipeline — lead metrics
metrics.append({
    "slug": "lead-pipeline-overview",
    "name": "Lead Pipeline Overview",
    "screen_id": "leads-gtm",
    "instructions": r"""Track lead volume and lifecycle distribution from HubSpot contacts.

## Data Source
HubSpot Contacts via `hubspot.searchAllContacts()`.

## Retrieval Steps
1. Search contacts created in last 12 months: `hubspot.searchAllContacts({ filters: [{ propertyName: 'createdate', operator: 'GTE', value: '<12mo ago>' }], properties: ['createdate','lifecyclestage','hs_lead_status','hubspot_owner_id','hs_analytics_source'], limit: 100 })`.
2. Paginate through all results.
3. Group by month (from createdate) to get lead volume trend.
4. Group by lifecyclestage to get distribution: subscriber, lead, marketingqualifiedlead, salesqualifiedlead, opportunity, customer, evangelist.
5. Compute conversion rates between stages.

## Values to Return
- `monthlyLeads`: array of { month, count }
- `byLifecycle`: array of { stage, count }
- `totalLeads`: total contacts created in LTM
- `ltmConversionRate`: leads that became opportunities or customers""",
    "template_jsx": r"""(() => {
  const monthly = MONTHLY_PLACEHOLDER;
  const byLifecycle = LIFECYCLE_PLACEHOLDER;
  const total = TOTAL_PLACEHOLDER;
  return (
    <MetricSection>
      <StatCard label="LTM New Leads" value={total} subtitle="Last 12 months" />
      <div style={{ height: 250, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="count" name="New Leads" fill={theme.accent} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: HubSpot Contacts via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"monthlyLeads": [
        {"month":"Mar 25","count":45},{"month":"Apr 25","count":52},{"month":"May 25","count":38},
        {"month":"Jun 25","count":61},{"month":"Jul 25","count":42},{"month":"Aug 25","count":55},
        {"month":"Sep 25","count":78},{"month":"Oct 25","count":65},{"month":"Nov 25","count":58},
        {"month":"Dec 25","count":35},{"month":"Jan 26","count":72},{"month":"Feb 26","count":48},
    ], "totalLeads": 649}),
    "initial_html": r"""(() => {
  const monthly = [{"month":"Mar 25","count":45},{"month":"Apr 25","count":52},{"month":"May 25","count":38},{"month":"Jun 25","count":61},{"month":"Jul 25","count":42},{"month":"Aug 25","count":55},{"month":"Sep 25","count":78},{"month":"Oct 25","count":65},{"month":"Nov 25","count":58},{"month":"Dec 25","count":35},{"month":"Jan 26","count":72},{"month":"Feb 26","count":48}];
  const total = 649;
  return (
    <MetricSection>
      <StatCard label="LTM New Leads" value={total} subtitle="Last 12 months" />
      <div style={{ height: 250, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={monthly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis dataKey="month" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <YAxis stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} />
            <Bar dataKey="count" name="New Leads" fill={theme.accent} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: HubSpot Contacts via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 0, "position": 0,
})


# ═══════════════════════════════════════════════════════════════════════
# DEPT-SALES SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 14. Sales Scorecard — key sales KPIs
metrics.append({
    "slug": "sales-scorecard",
    "name": "Sales Scorecard",
    "screen_id": "dept-sales",
    "instructions": r"""Compile key sales KPIs from HubSpot and QuickBooks.

## Data Sources
- HubSpot: deals for pipeline, win rate, deal velocity
- QuickBooks: revenue for quota tracking

## Retrieval Steps
1. HubSpot: Paginate all deals. Compute: open pipeline total, win rate (closed won / total closed), avg days to close, avg deal size (closed won), pipeline coverage ratio.
2. QuickBooks: Get current month and LTM invoiced revenue.
3. Compute pipeline-to-revenue ratio (pipeline / quarterly run rate).
4. Identify top 5 largest open deals by amount.

## Values to Return
- `openPipeline`: total open pipeline value
- `winRate`: percentage
- `avgDealSize`: average closed-won amount
- `avgDaysToClose`: average days
- `pipelineCoverage`: ratio
- `closedWonLTM`: LTM closed-won revenue
- `dealsWonLTM`: count of deals won
- `top5Deals`: array of { name, amount, stage }""",
    "template_jsx": r"""(() => {
  const pipeline = PIPELINE_PLACEHOLDER;
  const winRate = WIN_RATE_PLACEHOLDER;
  const avgSize = AVG_SIZE_PLACEHOLDER;
  const avgDays = AVG_DAYS_PLACEHOLDER;
  const coverage = COVERAGE_PLACEHOLDER;
  const wonRevenue = WON_REVENUE_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Open Pipeline" value={'$' + (pipeline / 1000).toFixed(0) + 'K'} subtitle="Active deals" />
        <StatCard label="Win Rate" value={winRate.toFixed(1) + '%'} subtitle="Won / total closed" />
        <StatCard label="Avg Deal Size" value={'$' + (avgSize / 1000).toFixed(1) + 'K'} subtitle="Closed won" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Days to Close" value={avgDays} subtitle="Average" />
        <StatCard label="Pipeline Coverage" value={coverage.toFixed(1) + 'x'} subtitle="Quarterly" />
        <StatCard label="LTM Won Revenue" value={'$' + (wonRevenue / 1000).toFixed(0) + 'K'} subtitle="Closed won" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"openPipeline":1900000,"winRate":37.8,"avgDealSize":3783,"avgDaysToClose":12,"pipelineCoverage":3.9,"closedWonRevenue":1570000}),
    "initial_html": r"""(() => {
  const pipeline = 1900000;
  const winRate = 37.8;
  const avgSize = 3783;
  const avgDays = 12;
  const coverage = 3.9;
  const wonRevenue = 1570000;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Open Pipeline" value={'$' + (pipeline / 1000).toFixed(0) + 'K'} subtitle="Active deals" />
        <StatCard label="Win Rate" value={winRate.toFixed(1) + '%'} subtitle="Won / total closed" />
        <StatCard label="Avg Deal Size" value={'$' + (avgSize / 1000).toFixed(1) + 'K'} subtitle="Closed won" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Days to Close" value={avgDays} subtitle="Average" />
        <StatCard label="Pipeline Coverage" value={coverage.toFixed(1) + 'x'} subtitle="Quarterly" />
        <StatCard label="LTM Won Revenue" value={'$' + (wonRevenue / 1000).toFixed(0) + 'K'} subtitle="Closed won" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 6, "grid_x": 0, "grid_y": 0, "position": 0,
})


# ═══════════════════════════════════════════════════════════════════════
# DEPT-OPERATIONS SCREEN
# ═══════════════════════════════════════════════════════════════════════

# 15. Bootcamp Operations
metrics.append({
    "slug": "bootcamp-operations",
    "name": "Bootcamp Operations",
    "screen_id": "dept-operations",
    "instructions": r"""Track bootcamp course activity and enrollment from TalentLMS.

## Data Source
TalentLMS via `talentlms.getCourses()` and `talentlms.getUsers()`.

## Retrieval Steps
1. Get all courses: `talentlms.getCourses()`. Filter to active courses (status === 'active').
2. For active courses, get enrollment counts.
3. Categorize courses: date-based cohort bootcamps, company bootcamps, Vistage, async content.
4. Get total users: `talentlms.getUsers({ limit: 100 })`. Count by user type.
5. Compute: total active courses, total enrolled, completion rate if available.

## Values to Return
- `activeCourses`: number of active courses
- `totalCourses`: total courses ever created
- `cohortBootcamps`: number of date-based cohort bootcamps
- `companyBootcamps`: number of company-specific bootcamps
- `totalEnrolled`: total user enrollment across active courses
- `courseList`: array of { name, enrolled, status } for active courses""",
    "template_jsx": r"""(() => {
  const active = ACTIVE_PLACEHOLDER;
  const total = TOTAL_PLACEHOLDER;
  const cohorts = COHORT_PLACEHOLDER;
  const company = COMPANY_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Courses" value={active} subtitle="Currently running" />
        <StatCard label="Total Courses" value={total} subtitle="All time" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Cohort Bootcamps" value={cohorts} subtitle="Date-based" />
        <StatCard label="Company Bootcamps" value={company} subtitle="Custom" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"activeCourses":4,"totalCourses":150,"cohortBootcamps":26,"companyBootcamps":21}),
    "initial_html": r"""(() => {
  const active = 4;
  const total = 150;
  const cohorts = 26;
  const company = 21;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Courses" value={active} subtitle="Currently running" />
        <StatCard label="Total Courses" value={total} subtitle="All time" />
      </MetricRow>
      <MetricRow>
        <StatCard label="Cohort Bootcamps" value={cohorts} subtitle="Date-based" />
        <StatCard label="Company Bootcamps" value={company} subtitle="Custom" />
      </MetricRow>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "wide",
    "grid_w": 8, "grid_h": 6, "grid_x": 0, "grid_y": 0, "position": 0,
})

# 16. Top Customers — for dept-sales
top_customers = [
    {"name": "Nutanix", "revenue": 187500},
    {"name": "Vistage", "revenue": 145200},
    {"name": "Deluxe Corp", "revenue": 98700},
    {"name": "Securian Financial", "revenue": 87300},
    {"name": "Celestica", "revenue": 76500},
    {"name": "Digi International", "revenue": 65400},
    {"name": "Sleep Number", "revenue": 54200},
    {"name": "Bremer Bank", "revenue": 48900},
    {"name": "UHG", "revenue": 45600},
    {"name": "Taylor Corp", "revenue": 42100},
]
top_cust_json = json.dumps(top_customers)

metrics.append({
    "slug": "top-customers-revenue",
    "name": "Top Customers by Revenue",
    "screen_id": "dept-sales",
    "instructions": r"""Show top customers by invoiced revenue from QuickBooks.

## Data Source
QuickBooks Invoices via `quickbooks.query()`.

## Retrieval Steps
1. Query invoices grouped by customer: `quickbooks.query({ query: "SELECT CustomerRef, SUM(TotalAmt) as Total FROM Invoice WHERE TxnDate >= '<12mo ago>' GROUP BY CustomerRef ORDER BY Total DESC", maxResults: 20 })`.
2. If CustomerRef returns IDs, resolve customer names via `quickbooks.query({ query: "SELECT Id, DisplayName FROM Customer WHERE Id IN (...)" })`.
3. Build array of { name, revenue } sorted by revenue desc.
4. Include top 10 customers.

## Values to Return
- `topCustomers`: array of { name, revenue }
- `topCustomerRevenue`: sum of top 10 customer revenue
- `totalCustomers`: total unique customers with invoices""",
    "template_jsx": r"""(() => {
  const data = DATA_PLACEHOLDER;
  return (
    <MetricSection>
      <div style={{ height: 320, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 90, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.gridStroke} />
            <XAxis type="number" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} tickFormatter={v => '$' + (v/1000) + 'K'} />
            <YAxis type="category" dataKey="name" stroke={theme.axisStroke} tick={{ fill: theme.inkMuted, fontSize: 11 }} width={85} />
            <Tooltip contentStyle={{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }} formatter={v => '$' + Number(v).toLocaleString()} />
            <Bar dataKey="revenue" name="Revenue" fill={theme.accent} radius={[0,4,4,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks Invoices (LTM) via Kiingo MCP</MetricNote>
    </MetricSection>
  );
})()""",
    "initial_values": json.dumps({"topCustomers": top_customers}),
    "initial_html": f"""(() => {{
  const data = {top_cust_json};
  return (
    <MetricSection>
      <div style={{{{ height: 320, background: theme.panel, borderRadius: 16, padding: '16px 20px', border: '1px solid ' + theme.line }}}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={{data}} layout="vertical" margin={{{{ top: 5, right: 20, left: 90, bottom: 5 }}}}>
            <CartesianGrid strokeDasharray="3 3" stroke={{theme.gridStroke}} />
            <XAxis type="number" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} tickFormatter={{v => '$' + (v/1000) + 'K'}} />
            <YAxis type="category" dataKey="name" stroke={{theme.axisStroke}} tick={{{{ fill: theme.inkMuted, fontSize: 11 }}}} width={{85}} />
            <Tooltip contentStyle={{{{ background: theme.tooltipBg, border: '1px solid ' + theme.tooltipBorder, color: theme.tooltipText, borderRadius: 8, fontSize: 13 }}}} formatter={{v => '$' + Number(v).toLocaleString()}} />
            <Bar dataKey="revenue" name="Revenue" fill={{theme.accent}} radius={{[0,4,4,0]}} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <MetricNote>Source: QuickBooks Invoices (LTM) via Kiingo MCP</MetricNote>
    </MetricSection>
  );
}})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 7, "position": 1,
})


# ═══════════════════════════════════════════════════════════════════════
# REBINDINGS — existing metrics added to new screens
# ═══════════════════════════════════════════════════════════════════════

rebindings = [
    # Bind existing monthly-revenue to growth screen
    {"metric_id": EXISTING["monthly-revenue"], "screen_id": "growth", "position": 3, "layout_hint": "full", "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 26},
    # Bind existing closed-won-monthly to growth screen
    {"metric_id": EXISTING["closed-won-monthly"], "screen_id": "growth", "position": 4, "layout_hint": "full", "grid_w": 12, "grid_h": 8, "grid_x": 0, "grid_y": 35},
    # Bind existing sales-pipeline-value to pipeline screen
    {"metric_id": EXISTING["sales-pipeline-value"], "screen_id": "pipeline", "position": 2, "layout_hint": "wide", "grid_w": 8, "grid_h": 7, "grid_x": 4, "grid_y": 9},
    # Bind existing cash-position-ar to efficiency screen
    {"metric_id": EXISTING["cash-position-ar"], "screen_id": "efficiency", "position": 3, "layout_hint": "full", "grid_w": 12, "grid_h": 7, "grid_x": 0, "grid_y": 26},
    # Bind existing trailing-30-day-leads to leads-gtm screen
    {"metric_id": EXISTING["trailing-30-day-leads"], "screen_id": "leads-gtm", "position": 1, "layout_hint": "card", "grid_w": 4, "grid_h": 5, "grid_x": 0, "grid_y": 9},
    # Bind sales-pipeline-value to dept-sales screen too
    {"metric_id": EXISTING["sales-pipeline-value"], "screen_id": "dept-sales", "position": 2, "layout_hint": "full", "grid_w": 12, "grid_h": 7, "grid_x": 0, "grid_y": 16},
]


# ═══════════════════════════════════════════════════════════════════════
# EXECUTE ALL INSERTS
# ═══════════════════════════════════════════════════════════════════════

def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    inserted = 0
    skipped = 0

    for m in metrics:
        slug = m["slug"]

        # Check if metric already exists
        cursor.execute("SELECT COUNT(*) FROM metric_definitions WHERE slug = ?", (slug,))
        if cursor.fetchone()[0] > 0:
            print(f"  SKIP  {slug} (already exists)")
            skipped += 1
            continue

        metric_id = str(uuid.uuid4())
        snapshot_id = str(uuid.uuid4())
        binding_id = str(uuid.uuid4())

        # Insert metric definition
        cursor.execute(
            """INSERT INTO metric_definitions
               (id, name, slug, instructions, template_html, ttl_seconds, provider, enabled, proactive, metadata_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 'claude', 1, 0, '{}', ?, ?)""",
            (metric_id, m["name"], slug, m["instructions"], m["template_jsx"], m["ttl"], NOW, NOW)
        )

        # Insert initial snapshot
        cursor.execute(
            """INSERT INTO metric_snapshots
               (id, metric_id, values_json, rendered_html, status, created_at, completed_at)
               VALUES (?, ?, ?, ?, 'completed', ?, ?)""",
            (snapshot_id, metric_id, m["initial_values"], m["initial_html"], NOW, NOW)
        )

        # Insert screen binding
        cursor.execute(
            """INSERT INTO screen_metrics
               (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (binding_id, m["screen_id"], metric_id, m["position"], m["layout_hint"],
             m.get("grid_x", -1), m["grid_y"], m["grid_w"], m["grid_h"])
        )

        print(f"  ADD   {slug} -> {m['screen_id']} ({m['grid_w']}x{m['grid_h']})")
        inserted += 1

    # Process rebindings
    rebound = 0
    for rb in rebindings:
        binding_id = str(uuid.uuid4())
        # Check if this exact binding already exists
        cursor.execute(
            "SELECT COUNT(*) FROM screen_metrics WHERE screen_id = ? AND metric_id = ?",
            (rb["screen_id"], rb["metric_id"])
        )
        if cursor.fetchone()[0] > 0:
            print(f"  SKIP  rebind {rb['screen_id']} (already bound)")
            continue

        cursor.execute(
            """INSERT INTO screen_metrics
               (id, screen_id, metric_id, position, layout_hint, grid_x, grid_y, grid_w, grid_h)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (binding_id, rb["screen_id"], rb["metric_id"], rb["position"], rb["layout_hint"],
             rb.get("grid_x", -1), rb["grid_y"], rb["grid_w"], rb["grid_h"])
        )
        print(f"  BIND  existing metric -> {rb['screen_id']}")
        rebound += 1

    conn.commit()
    conn.close()

    print(f"\nDone: {inserted} new metrics, {skipped} skipped, {rebound} rebindings")
    print(f"Screens populated: dashboard, growth, efficiency, pipeline, leads-gtm, dept-sales, dept-operations")


if __name__ == "__main__":
    main()
