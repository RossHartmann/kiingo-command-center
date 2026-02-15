#!/usr/bin/env python3
"""Seed metrics for the remaining 7 dashboard screens: client-roi, client-journey,
path1-champions, path1-accelerator, path2-pipeline, path2-deployed, path2-fde."""

import sqlite3
import uuid
import json
import os
from datetime import datetime, timezone

DB_PATH = os.path.expanduser("~/Library/Application Support/com.kiingo.localcli/state.sqlite")
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")

metrics = []

# ═══════════════════════════════════════════════════════════════════════
# CLIENT ROI SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "client-revenue-roi",
    "name": "Client Revenue & ROI",
    "screen_id": "client-roi",
    "instructions": r"""Retrieve revenue per client and compute ROI metrics.

## Data Sources
- QuickBooks: Revenue by customer from invoices
- HubSpot: Deal values by company, lifecycle stages

## Retrieval Steps
1. QuickBooks: `quickbooks.query({ query: "SELECT CustomerRef, TotalAmt FROM Invoice WHERE TxnDate >= '<6mo ago>' ORDER BY TotalAmt DESC", maxResults: 500 })` — group by customer, sum revenue.
2. HubSpot: `hubspot.listCompanies({ properties: ['name','total_revenue','lifecyclestage'], limit: 100 })` — get lifecycle & engagement data.
3. Compute average revenue per client, identify top-10 by revenue, compute growth vs prior period.

## Values to Return
- `clients`: array of { name, revenue, dealCount, product } for top clients
- `totalClients`: number of active clients
- `avgRevenuePerClient`: average revenue per client
- `topClientRevenue`: revenue from top 5 clients""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "clients": [
            {"name": "Immatics", "revenue": 54400, "deals": 8, "products": "Bootcamp, Agents, Peer Group"},
            {"name": "AnglePoint", "revenue": 42500, "deals": 3, "products": "Bootcamp, Consulting"},
            {"name": "Deal News", "revenue": 28000, "deals": 1, "products": "Private Bootcamp"},
            {"name": "Heller Consulting", "revenue": 10000, "deals": 1, "products": "Private Bootcamp"},
            {"name": "Partner4Work", "revenue": 16000, "deals": 5, "products": "Bootcamp, Private"},
            {"name": "PR Construction", "revenue": 8000, "deals": 4, "products": "Private Bootcamp"},
            {"name": "Crimson IT", "revenue": 5000, "deals": 2, "products": "Agent Bootcamp, Partnership"},
            {"name": "Alliant Insurance", "revenue": 6000, "deals": 2, "products": "Agent Bootcamp"},
            {"name": "SRA", "revenue": 9000, "deals": 1, "products": "Agents Bootcamp"},
            {"name": "33 Degrees", "revenue": 6000, "deals": 1, "products": "Agent Bootcamp"},
            {"name": "CESG", "revenue": 7500, "deals": 2, "products": "Bootcamp"},
            {"name": "Antis Roofing", "revenue": 4000, "deals": 5, "products": "Consulting, Bootcamp"},
        ],
        "totalClients": 17,
        "avgRevenuePerClient": 14600,
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const clients = values.clients || [];
  const sorted = [...clients].sort((a, b) => b.revenue - a.revenue);
  const top = sorted.slice(0, 10);
  const total = sorted.reduce((s, c) => s + c.revenue, 0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Clients" value={values.totalClients} subtitle="With revenue" />
        <StatCard label="Avg Rev / Client" value={'$' + ((values.avgRevenuePerClient || 0) / 1000).toFixed(1) + 'K'} subtitle="Last 6 months" />
        <StatCard label="Top 5 Revenue" value={'$' + (top.slice(0, 5).reduce((s, c) => s + c.revenue, 0) / 1000).toFixed(0) + 'K'} subtitle={((top.slice(0, 5).reduce((s, c) => s + c.revenue, 0) / total) * 100).toFixed(0) + '% of total'} />
      </MetricRow>
      <div style={{ marginTop: 16 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 8 }}>Top Clients by Revenue</MetricText>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '4px 16px', fontSize: '0.8rem' }}>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Client</div>
          <div style={{ color: t.inkMuted, fontWeight: 600, textAlign: 'right' }}>Revenue</div>
          <div style={{ color: t.inkMuted, fontWeight: 600, textAlign: 'center' }}>Deals</div>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Products</div>
          {top.map((c, i) => (
            <React.Fragment key={i}>
              <div style={{ color: t.ink }}>{c.name}</div>
              <div style={{ color: t.accent, textAlign: 'right', fontWeight: 600 }}>${(c.revenue / 1000).toFixed(1)}K</div>
              <div style={{ color: t.ink, textAlign: 'center' }}>{c.deals}</div>
              <div style={{ color: t.inkMuted, fontSize: '0.7rem' }}>{c.products}</div>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={top} layout="vertical" margin={{ left: 80, right: 20, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} />
            <XAxis type="number" tickFormatter={v => '$' + (v/1000).toFixed(0) + 'K'} stroke={t.axisStroke} style={{ fontSize: '0.7rem' }} />
            <YAxis type="category" dataKey="name" stroke={t.axisStroke} style={{ fontSize: '0.7rem' }} width={75} />
            <Tooltip formatter={v => '$' + Number(v).toLocaleString()} contentStyle={{ background: t.tooltipBg, border: '1px solid ' + t.tooltipBorder, color: t.tooltipText, fontSize: '0.75rem' }} />
            <Bar dataKey="revenue" fill={t.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 14, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# CLIENT JOURNEY SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "client-journey-funnel",
    "name": "Client Journey Funnel",
    "screen_id": "client-journey",
    "instructions": r"""Track client progression through the Kiingo product journey.

## Data Sources
- HubSpot: Deal pipeline stages, company lifecycles
- Asana: Active client projects by type

## Journey Stages
1. Strategy Session → 2. AI Assessment → 3. Bootcamp (Foundational/Agents/Marketing)
4. Champion Group → 5. Accelerator → 6. AI Resources (Vault/Consulting/Managed AI)

## Retrieval Steps
1. HubSpot: Count deals by pipeline to get counts per journey stage.
2. Asana: Count active projects by type (consulting, peer group, bootcamp ops).
3. Compute conversion rates between stages.

## Values to Return
- `stages`: array of { name, count, value } for each journey stage
- `conversions`: array of { from, to, rate }
- `activeClients`: total unique clients in journey""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "stages": [
            {"name": "Strategy Session", "count": 18, "value": 0, "desc": "Initial discovery"},
            {"name": "AI Assessment", "count": 14, "value": 45500, "desc": "Roadmap & report"},
            {"name": "Bootcamp", "count": 168, "value": 485000, "desc": "Training programs"},
            {"name": "Champion Group", "count": 22, "value": 19400, "desc": "Peer membership"},
            {"name": "Accelerator", "count": 3, "value": 3000, "desc": "Advanced cohort"},
            {"name": "AI Resources", "count": 12, "value": 38000, "desc": "Vault, Agents, Consulting"},
        ],
        "conversions": [
            {"from": "Strategy Session", "to": "Assessment", "rate": 78},
            {"from": "Assessment", "to": "Bootcamp", "rate": 85},
            {"from": "Bootcamp", "to": "Champion", "rate": 13},
            {"from": "Champion", "to": "AI Resources", "rate": 35},
        ],
        "activeClients": 85,
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const stages = values.stages || [];
  const conversions = values.conversions || [];
  const maxCount = Math.max(...stages.map(s => s.count), 1);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Active Clients" value={values.activeClients} subtitle="In journey" />
        <StatCard label="Bootcamp Conv." value="85%" subtitle="Assessment → Bootcamp" />
        <StatCard label="Champion Conv." value="13%" subtitle="Bootcamp → Champion" />
      </MetricRow>
      <div style={{ marginTop: 16 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 12 }}>Client Journey Funnel</MetricText>
        {stages.map((s, i) => {
          const pct = (s.count / maxCount) * 100;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 12 }}>
              <div style={{ width: 120, fontSize: '0.75rem', color: t.ink, fontWeight: 600, textAlign: 'right' }}>{s.name}</div>
              <div style={{ flex: 1, background: t.panel, borderRadius: 4, height: 28, position: 'relative', overflow: 'hidden' }}>
                <div style={{ width: pct + '%', height: '100%', background: `linear-gradient(90deg, ${t.accent}, ${t.accentStrong})`, borderRadius: 4, transition: 'width 0.5s' }} />
                <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: '#fff', fontWeight: 600 }}>
                  {s.count} {s.value > 0 ? '· $' + (s.value / 1000).toFixed(0) + 'K' : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 8 }}>Stage Conversion Rates</MetricText>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {conversions.map((c, i) => (
            <div key={i} style={{ background: t.panel, borderRadius: 8, padding: '8px 14px', flex: '1 1 140px' }}>
              <div style={{ fontSize: '0.65rem', color: t.inkMuted }}>{c.from} → {c.to}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: c.rate >= 50 ? t.accent : c.rate >= 20 ? '#f59e0b' : t.danger }}>{c.rate}%</div>
            </div>
          ))}
        </div>
      </div>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 14, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# PATH 1 — CHAMPIONS SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "champion-group-metrics",
    "name": "Champion Group Overview",
    "screen_id": "path1-champions",
    "instructions": r"""Track AI Champion Group membership, revenue, and growth.

## Data Sources
- HubSpot: Peer Group pipeline deals (pipeline ID 808343346)
- Asana: Rock 6 subtasks, Champions-related tasks

## Retrieval Steps
1. HubSpot: `hubspot.searchAllDeals({ filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: '808343346' }] }], properties: ['dealname','amount','dealstage','closedate'] })` — get all Peer Group deals.
2. Asana: Search for tasks with "champion" or "peer group" text.
3. Compute total seats, MRR, growth trajectory.

## Values to Return
- `members`: array of { name, amount, status }
- `totalSeats`: current seat count
- `targetSeats`: Q1 target
- `mrr`: monthly recurring revenue from Champions
- `rockProgress`: Rock 6 completion percentage""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "members": [
            {"name": "Immatics (Autumn & Siegfried)", "amount": 1299, "status": "active"},
            {"name": "Allen Harrison (Arturo)", "amount": 749, "status": "active"},
            {"name": "Dumont Printing (Summer)", "amount": 749, "status": "active"},
            {"name": "Hurley Law (Paul)", "amount": 749, "status": "scheduled"},
            {"name": "Biogennix (Chris)", "amount": 749, "status": "active"},
            {"name": "Tom's Truck Center (2 seats)", "amount": 1299, "status": "active"},
            {"name": "Cure 4 Kids (Jamey)", "amount": 749, "status": "scheduled"},
            {"name": "Home of Guiding Hands", "amount": 749, "status": "scheduled"},
            {"name": "Angeles Wealth", "amount": 749, "status": "scheduled"},
            {"name": "Herdman AD (David & Maria)", "amount": 1299, "status": "scheduled"},
            {"name": "Johnson Plumbing (Kirk & Kamal)", "amount": 1299, "status": "scheduled"},
            {"name": "Legacy Concierge (Zehra)", "amount": 749, "status": "scheduled"},
            {"name": "W Machine Works", "amount": 749, "status": "scheduled"},
            {"name": "ZO Skin Health", "amount": 749, "status": "scheduled"},
            {"name": "Rich Chicks", "amount": 749, "status": "scheduled"},
            {"name": "Cush Plaza Properties", "amount": 749, "status": "scheduled"},
            {"name": "Framework Friday", "amount": 8988, "status": "scheduled"},
            {"name": "Centura Wealth Advisory", "amount": 749, "status": "scheduled"},
            {"name": "Connect Service Solutions", "amount": 749, "status": "scheduled"},
            {"name": "Shrin", "amount": 749, "status": "scheduled"},
            {"name": "SN Transport", "amount": 1799, "status": "scheduled"},
            {"name": "Nowak Dental", "amount": 749, "status": "scheduled"},
        ],
        "totalSeats": 22,
        "targetSeats": 50,
        "totalRevenue": 27914,
        "rockTasks": 19,
        "rockOwner": "Schuyler Dragoo",
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const members = values.members || [];
  const active = members.filter(m => m.status === 'active');
  const scheduled = members.filter(m => m.status === 'scheduled');
  const totalRev = members.reduce((s, m) => s + m.amount, 0);
  const pctTarget = ((values.totalSeats / values.targetSeats) * 100).toFixed(0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Total Seats" value={values.totalSeats + ' / ' + values.targetSeats} subtitle={pctTarget + '% of Q1 target'} />
        <StatCard label="Total Revenue" value={'$' + (totalRev / 1000).toFixed(1) + 'K'} subtitle="Across all members" />
        <StatCard label="Avg / Seat" value={'$' + (totalRev / members.length).toFixed(0)} subtitle="Per member" />
        <StatCard label="Active" value={active.length} subtitle={scheduled.length + ' onboarding'} />
      </MetricRow>
      <div style={{ marginTop: 16 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 4 }}>Target Progress</MetricText>
        <div style={{ background: t.panel, borderRadius: 6, height: 24, overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: pctTarget + '%', height: '100%', background: `linear-gradient(90deg, ${t.accent}, ${t.accentStrong})`, borderRadius: 6 }} />
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>
            {values.totalSeats} / {values.targetSeats} seats ({pctTarget}%)
          </div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 8 }}>Members</MetricText>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '3px 14px', fontSize: '0.75rem' }}>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Member</div>
          <div style={{ color: t.inkMuted, fontWeight: 600, textAlign: 'right' }}>Amount</div>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Status</div>
          {members.map((m, i) => (
            <React.Fragment key={i}>
              <div style={{ color: t.ink }}>{m.name}</div>
              <div style={{ color: t.accent, textAlign: 'right' }}>${m.amount.toLocaleString()}</div>
              <div style={{ color: m.status === 'active' ? t.accent : '#f59e0b', fontSize: '0.7rem' }}>
                {m.status === 'active' ? '● Active' : '◐ Onboarding'}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
      <MetricNote>Rock 6: AI Champions Group GTM — {values.rockTasks} subtasks — Owner: {values.rockOwner} — Due: Mar 31, 2026</MetricNote>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 16, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# PATH 1 — ACCELERATOR SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "accelerator-overview",
    "name": "Accelerator Program",
    "screen_id": "path1-accelerator",
    "instructions": r"""Track the Accelerator program — advanced cohort for graduates of bootcamps and champion groups.

## Data Sources
- HubSpot: Search deals with "accelerator" in dealname
- TalentLMS: Enrollment data for advanced courses

## Retrieval Steps
1. HubSpot: `hubspot.searchAllDeals({ properties: ['dealname','amount','dealstage','closedate'], filterGroups: [] })` — filter deals containing "accelerator".
2. TalentLMS: `talentlms.getCourses({})` — find accelerator-related courses.

## Values to Return
- `deals`: accelerator deal list
- `totalEnrolled`: current enrollment
- `targetEnrolled`: target enrollment
- `revenue`: total accelerator revenue""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "deals": [
            {"name": "DiaPharma - Accelerator", "amount": 500, "stage": "Proposal Sent"},
            {"name": "Nowak Dental - Accelerator", "amount": 500, "stage": "Proposal Sent"},
            {"name": "Miller Environmental - Accelerator", "amount": 2000, "stage": "Outreach"},
        ],
        "status": "Early Stage",
        "enrolled": 0,
        "pipelineValue": 3000,
        "description": "The Accelerator is an advanced offering for champion group members ready to deepen their AI adoption.",
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const deals = values.deals || [];
  const totalPipeline = deals.reduce((s, d) => s + d.amount, 0);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Status" value={values.status} subtitle="Program phase" />
        <StatCard label="Pipeline" value={'$' + (totalPipeline / 1000).toFixed(1) + 'K'} subtitle={deals.length + ' deals'} />
        <StatCard label="Enrolled" value={values.enrolled} subtitle="Current members" />
      </MetricRow>
      <div style={{ marginTop: 16, padding: 16, background: t.panel, borderRadius: 8 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 8 }}>Program Description</MetricText>
        <MetricText style={{ fontSize: '0.8rem', color: t.inkMuted, lineHeight: 1.5 }}>{values.description}</MetricText>
      </div>
      <div style={{ marginTop: 16 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 8 }}>Pipeline Deals</MetricText>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 16px', fontSize: '0.8rem' }}>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Deal</div>
          <div style={{ color: t.inkMuted, fontWeight: 600, textAlign: 'right' }}>Amount</div>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Stage</div>
          {deals.map((d, i) => (
            <React.Fragment key={i}>
              <div style={{ color: t.ink }}>{d.name}</div>
              <div style={{ color: t.accent, textAlign: 'right' }}>${d.amount}</div>
              <div style={{ color: d.stage === 'Proposal Sent' ? '#f59e0b' : t.inkMuted }}>{d.stage}</div>
            </React.Fragment>
          ))}
        </div>
      </div>
      <MetricNote>Accelerator is in early development. Targets seats from Champion Group graduates.</MetricNote>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "wide",
    "grid_w": 8, "grid_h": 10, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# PATH 2 — AGENT PIPELINE SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "ai-resource-pipeline",
    "name": "AI Resources Pipeline",
    "screen_id": "path2-pipeline",
    "instructions": r"""Track the pipeline for Path 2 offerings: Managed AI, Resource Vault, Software, Consulting, and Agent Bootcamps.

## Data Sources
- HubSpot: Deal pipelines for Managed AI (796859524), Resource Vault (796172413), Software (808730244), Consulting (93956100)
- Asana: AI Consulting Engagements project tasks

## Retrieval Steps
1. HubSpot: For each pipeline, `hubspot.searchAllDeals({ filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: '<pipelineId>' }] }], properties: ['dealname','amount','dealstage'] })`.
2. Count deals by stage for each pipeline.

## Values to Return
- `pipelines`: array of { name, deals, value, stages }
- `totalPipeline`: total open value
- `totalDeals`: total active deals""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "pipelines": [
            {"name": "Managed AI", "pipelineId": "796859524", "activeDeals": 8, "value": 24000, "stages": {"Invoicing": 3, "Set Kickoff": 1, "Delegate Project": 2, "Create Product": 1, "On Hold": 1}},
            {"name": "Resource Vault", "pipelineId": "796172413", "activeDeals": 4, "value": 7200, "stages": {"Invoicing": 2, "Requirements": 1, "On Hold": 1}},
            {"name": "Software", "pipelineId": "808730244", "activeDeals": 2, "value": 5000, "stages": {"Qualified": 1, "Presentation": 1}},
            {"name": "Ad-hoc Consulting", "pipelineId": "93956100", "activeDeals": 6, "value": 19500, "stages": {"Invoicing": 4, "Contract Sent": 1, "On Hold": 1}},
            {"name": "AI Assessment", "pipelineId": "797275671", "activeDeals": 10, "value": 45000, "stages": {"Schedule Assessment": 2, "Meeting with Client": 3, "Draft Report": 2, "Present Report": 1, "Next Steps": 2}},
        ],
        "totalPipeline": 100700,
        "totalDeals": 30,
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const pipes = values.pipelines || [];
  const total = values.totalPipeline || 0;
  const colors = [t.accent, t.accentStrong, '#8b5cf6', '#f59e0b', '#10b981'];
  const chartData = pipes.map(p => ({ name: p.name, value: p.value, deals: p.activeDeals }));
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Total Pipeline" value={'$' + (total / 1000).toFixed(0) + 'K'} subtitle="Across all AI resources" />
        <StatCard label="Active Deals" value={values.totalDeals} subtitle={pipes.length + ' pipelines'} />
        <StatCard label="Avg Deal" value={'$' + (total / Math.max(values.totalDeals, 1) / 1000).toFixed(1) + 'K'} subtitle="Per engagement" />
      </MetricRow>
      <div style={{ marginTop: 16 }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ left: 10, right: 10, top: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} />
            <XAxis dataKey="name" stroke={t.axisStroke} style={{ fontSize: '0.7rem' }} />
            <YAxis tickFormatter={v => '$' + (v/1000) + 'K'} stroke={t.axisStroke} style={{ fontSize: '0.7rem' }} />
            <Tooltip formatter={(v, n) => n === 'value' ? '$' + Number(v).toLocaleString() : v} contentStyle={{ background: t.tooltipBg, border: '1px solid ' + t.tooltipBorder, color: t.tooltipText, fontSize: '0.75rem' }} />
            <Bar dataKey="value" fill={t.accent} radius={[4, 4, 0, 0]} name="Pipeline Value" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 12 }}>
        {pipes.map((p, i) => (
          <div key={i} style={{ marginBottom: 10, padding: '8px 12px', background: t.panel, borderRadius: 8, borderLeft: '3px solid ' + (colors[i] || t.accent) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <MetricText style={{ fontWeight: 600, fontSize: '0.8rem' }}>{p.name}</MetricText>
              <MetricText style={{ color: t.accent, fontWeight: 600, fontSize: '0.8rem' }}>${(p.value / 1000).toFixed(1)}K · {p.activeDeals} deals</MetricText>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {Object.entries(p.stages || {}).map(([stage, count]) => (
                <span key={stage} style={{ fontSize: '0.65rem', color: t.inkMuted, background: t.bg, padding: '2px 6px', borderRadius: 4 }}>
                  {stage}: {count}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 16, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# PATH 2 — DEPLOYED AGENTS SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "deployed-engagements",
    "name": "Active AI Engagements",
    "screen_id": "path2-deployed",
    "instructions": r"""Track active AI consulting engagements, assessments, and custom builds.

## Data Sources
- Asana: AI Consulting Engagements project (1210918739097592)
- HubSpot: Managed AI pipeline deals, Assessment pipeline deals

## Retrieval Steps
1. Asana: `asana.getTasksForProject({ projectGid: '1210918739097592', opt_fields: ['name','assignee.name','completed','num_subtasks'] })` — get all consulting tasks.
2. HubSpot: Query Managed AI pipeline for active builds.

## Values to Return
- `engagements`: array of { client, type, status, owner, subtasks }
- `completed`: number completed
- `inProgress`: number in progress
- `totalEngagements`: total count""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "engagements": [
            {"client": "Crimson IT", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 9},
            {"client": "Reliable Source & Lynam", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 8},
            {"client": "Reliable Source & Lynam", "type": "Consulting (10 hrs)", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 0},
            {"client": "Bowman EC", "type": "Custom GPT", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 8},
            {"client": "Fehr & Peers", "type": "Custom GPT", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 8},
            {"client": "Freshbenies", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 8},
            {"client": "ArcherHall", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 9},
            {"client": "California Sheet Metal", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 8},
            {"client": "Experience DMP", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 20},
            {"client": "Vanguard Real Estate", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 11},
            {"client": "Abacus Technologies", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 8},
            {"client": "Telaid", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 9},
            {"client": "Wedgewood Weddings", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 9},
            {"client": "BroadBent Inc.", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 9},
            {"client": "BroadBent Inc.", "type": "Consulting (1 mo)", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 4},
            {"client": "American Omni", "type": "Assessment", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 10},
            {"client": "Webb Foodservice Design", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 21},
            {"client": "NuvoIron", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 20},
            {"client": "Cypress Lawn", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 20},
            {"client": "McKenna Labs", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 20},
            {"client": "Ascent Inc.", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 20},
            {"client": "Allen Harrison", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 20},
            {"client": "Fehr & Peers", "type": "Strategy Session", "status": "In Progress", "owner": "Josh Sullivan", "subtasks": 21},
        ],
        "completed": 8,
        "inProgress": 23,
        "totalEngagements": 31,
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const eng = values.engagements || [];
  const byType = {};
  eng.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
  const typeData = Object.entries(byType).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="In Progress" value={values.inProgress} subtitle="Active engagements" />
        <StatCard label="Completed" value={values.completed} subtitle="Delivered" />
        <StatCard label="Total" value={values.totalEngagements} subtitle="All time" />
      </MetricRow>
      <div style={{ marginTop: 12 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 8 }}>By Engagement Type</MetricText>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {typeData.map((td, i) => (
            <div key={i} style={{ background: t.panel, borderRadius: 8, padding: '8px 14px', minWidth: 100 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: t.accent }}>{td.count}</div>
              <div style={{ fontSize: '0.7rem', color: t.inkMuted }}>{td.name}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <MetricText style={{ fontWeight: 600, marginBottom: 6 }}>Active Engagements</MetricText>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '3px 14px', fontSize: '0.75rem', maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Client</div>
          <div style={{ color: t.inkMuted, fontWeight: 600 }}>Type</div>
          <div style={{ color: t.inkMuted, fontWeight: 600, textAlign: 'center' }}>Tasks</div>
          {eng.map((e, i) => (
            <React.Fragment key={i}>
              <div style={{ color: t.ink }}>{e.client}</div>
              <div style={{ color: t.inkMuted, fontSize: '0.7rem' }}>{e.type}</div>
              <div style={{ color: t.accent, textAlign: 'center' }}>{e.subtasks}</div>
            </React.Fragment>
          ))}
        </div>
      </div>
      <MetricNote>All engagements currently owned by Josh Sullivan</MetricNote>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 16, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# PATH 2 — FDE UTILIZATION SCREEN
# ═══════════════════════════════════════════════════════════════════════

metrics.append({
    "slug": "fde-utilization",
    "name": "FDE Utilization",
    "screen_id": "path2-fde",
    "instructions": r"""Track Fractional Digital Employee (FDE) utilization — consulting capacity and engagement load.

## Data Sources
- Asana: AI Consulting Engagements project, strategy session tasks, assessment tasks
- HubSpot: Active consulting/managed AI deals

## Retrieval Steps
1. Asana: `asana.getTasksForProject({ projectGid: '1210918739097592' })` — count by assignee and completion status.
2. HubSpot: Count active managed AI and consulting pipeline deals.
3. Compute utilization rate per consultant (active engagements vs capacity).

## Values to Return
- `consultants`: array of { name, activeEngagements, completed, capacity }
- `totalCapacity`: aggregate capacity hours
- `utilization`: overall utilization percentage""",
    "template_jsx": "",
    "initial_values": json.dumps({
        "consultants": [
            {"name": "Josh Sullivan", "role": "Head of Delivery", "active": 23, "completed": 8, "capacity": 30, "types": {"Strategy Session": 7, "Assessment": 10, "Consulting": 3, "Custom GPT": 2, "Other": 1}},
        ],
        "totalActive": 23,
        "totalCompleted": 8,
        "overallUtilization": 77,
    }),
    "initial_html": r"""(() => {
  const t = theme;
  const consultants = values.consultants || [];
  const utilPct = values.overallUtilization || 0;
  const utilColor = utilPct >= 90 ? t.danger : utilPct >= 70 ? '#f59e0b' : t.accent;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Overall Utilization" value={utilPct + '%'} subtitle={utilPct >= 90 ? 'At capacity' : utilPct >= 70 ? 'Heavy load' : 'Available'} />
        <StatCard label="Active" value={values.totalActive} subtitle="Engagements" />
        <StatCard label="Completed" value={values.totalCompleted} subtitle="Delivered" />
      </MetricRow>
      {consultants.map((c, ci) => {
        const pct = Math.round((c.active / c.capacity) * 100);
        const typeData = Object.entries(c.types || {}).map(([name, count]) => ({ name, value: count }));
        return (
          <div key={ci} style={{ marginTop: 16, padding: 16, background: t.panel, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <MetricText style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.name}</MetricText>
                <MetricText style={{ color: t.inkMuted, fontSize: '0.75rem' }}>{c.role}</MetricText>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: utilColor }}>{pct}%</div>
                <div style={{ fontSize: '0.7rem', color: t.inkMuted }}>{c.active} / {c.capacity} capacity</div>
              </div>
            </div>
            <div style={{ background: t.bg, borderRadius: 6, height: 20, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ width: Math.min(pct, 100) + '%', height: '100%', background: utilColor, borderRadius: 6, transition: 'width 0.5s' }} />
            </div>
            <MetricText style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: 6 }}>Engagement Mix</MetricText>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={typeData} cx="50%" cy="50%" innerRadius={35} outerRadius={65} dataKey="value" nameKey="name" label={({ name, value }) => name + ': ' + value}>
                  {typeData.map((_, i) => (
                    <Cell key={i} fill={[t.accent, t.accentStrong, '#8b5cf6', '#f59e0b', '#10b981'][i % 5]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: t.tooltipBg, border: '1px solid ' + t.tooltipBorder, color: t.tooltipText, fontSize: '0.75rem' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        );
      })}
      <MetricNote>Capacity needs to grow — consider hiring or contracting additional consultants to scale Path 2.</MetricNote>
    </MetricSection>
  );
})()""",
    "ttl": 86400,
    "layout_hint": "full",
    "grid_w": 12, "grid_h": 14, "grid_y": 0,
})

# ═══════════════════════════════════════════════════════════════════════
# Also rebind some existing metrics to the client screens
# ═══════════════════════════════════════════════════════════════════════

rebindings = [
    # Bind top-customers-revenue to client-roi (already on dept-sales)
    {"screen_id": "client-roi", "slug": "top-customers-revenue"},
    # Bind deal-funnel-stage to client-journey (already on pipeline)
    {"screen_id": "client-journey", "slug": "deal-funnel-stage"},
]


# ═══════════════════════════════════════════════════════════════════════
# INSERTION LOGIC
# ═══════════════════════════════════════════════════════════════════════

def run():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    inserted = 0
    skipped = 0

    for m in metrics:
        slug = m["slug"]
        cur.execute("SELECT id FROM metric_definitions WHERE slug = ?", (slug,))
        row = cur.fetchone()
        if row:
            print(f"  SKIP {slug} (already exists)")
            skipped += 1
            continue

        metric_id = str(uuid.uuid4())
        snapshot_id = str(uuid.uuid4())
        binding_id = str(uuid.uuid4())

        # Insert metric definition
        cur.execute("""
            INSERT INTO metric_definitions (id, slug, name, provider, instructions, template_html, ttl_seconds, created_at, updated_at)
            VALUES (?, ?, ?, 'kiingo-mcp', ?, ?, ?, ?, ?)
        """, (metric_id, slug, m["name"], m["instructions"], m.get("template_jsx", ""), m.get("ttl", 86400), NOW, NOW))

        # Insert initial snapshot
        cur.execute("""
            INSERT INTO metric_snapshots (id, metric_id, status, values_json, rendered_html, created_at)
            VALUES (?, ?, 'success', ?, ?, ?)
        """, (snapshot_id, metric_id, m.get("initial_values", "{}"), m.get("initial_html", ""), NOW))

        # Bind to screen
        cur.execute("""
            INSERT INTO screen_metrics (id, screen_id, metric_id, position, layout_hint, grid_w, grid_h, grid_x, grid_y)
            VALUES (?, ?, ?, 0, ?, ?, ?, 0, ?)
        """, (binding_id, m["screen_id"], metric_id, m.get("layout_hint", "card"), m.get("grid_w", 4), m.get("grid_h", 6), m.get("grid_y", 0)))

        print(f"  + {slug} → {m['screen_id']} (metric={metric_id[:8]})")
        inserted += 1

    # Handle rebindings
    rebound = 0
    for rb in rebindings:
        cur.execute("SELECT id FROM metric_definitions WHERE slug = ?", (rb["slug"],))
        row = cur.fetchone()
        if not row:
            print(f"  SKIP rebind {rb['slug']} (metric not found)")
            continue
        metric_id = row[0]
        binding_id = str(uuid.uuid4())
        cur.execute("""
            INSERT INTO screen_metrics (id, screen_id, metric_id, position, layout_hint, grid_w, grid_h, grid_x, grid_y)
            VALUES (?, ?, ?, 99, 'wide', 8, 8, 0, 20)
        """, (binding_id, rb["screen_id"], metric_id))
        print(f"  ↳ rebind {rb['slug']} → {rb['screen_id']}")
        rebound += 1

    conn.commit()
    conn.close()
    print(f"\nDone: {inserted} inserted, {skipped} skipped, {rebound} rebound")


if __name__ == "__main__":
    run()
