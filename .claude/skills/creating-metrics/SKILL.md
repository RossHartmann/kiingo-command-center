---
name: creating-metrics
description: This skill should be used when creating a new metric for a dashboard screen, defining metric instructions/prompts, binding metrics to screens, or discussing how metric data is fetched and rendered. Triggers on "create a metric", "add a metric", "new KPI", "metric definition", "dashboard metric".
version: 0.1.0
---

# Creating Metrics

Create, configure, and bind dashboard metrics in the Kiingo Command Center. Metrics are declarative — define a name, instructions prompt, and JSX template, and the runner executes them via Claude CLI with full MCP tool access.

## When This Skill Applies

- Creating a new metric definition
- Writing or editing metric instruction prompts
- Binding metrics to dashboard screens
- Debugging metric refresh failures
- Choosing data sources for a metric

## Metric Definition Properties

Every metric is stored in the `metric_definitions` SQLite table. Required and key fields:

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `name` | string | yes | — | Display name shown in the UI |
| `slug` | string | yes | — | Unique identifier (kebab-case) |
| `instructions` | string | yes | — | Prompt telling Claude what data to fetch and how |
| `templateHtml` | string | no | `""` | JSX template with PLACEHOLDER tokens for rendering |
| `ttlSeconds` | number | no | `3600` | Cache duration before metric is considered stale |
| `provider` | string | no | `"claude"` | LLM provider (`"claude"` or `"codex"`) |
| `model` | string | no | null | Model override (e.g. `"sonnet"`) |
| `profileId` | string | no | null | CLI auth profile to use |
| `enabled` | boolean | no | `true` | Whether metric can be refreshed |
| `proactive` | boolean | no | `false` | Auto-refresh on interval |
| `metadataJson` | object | no | `{}` | Arbitrary metadata |

## Data Source Preference: Kiingo MCP Modules

**Always prefer Kiingo MCP modules** for source data over web scraping or hardcoded values. Available modules:

### HubSpot (`hubspot`)
```typescript
import { hubspot } from 'tools';
await hubspot.listDeals({ limit: 100, properties: ['amount','dealstage','hs_is_closed','hs_is_closed_won'], after: cursor });
await hubspot.listLeads({ limit: 100, properties: ['firstname','lastname','email'], after: cursor });
await hubspot.getDealPipelines();
await hubspot.searchAllContacts({ filters: [...], properties: [...], limit: 100 });
```

### QuickBooks (`quickbooks`)
```typescript
import { quickbooks } from 'tools';
await quickbooks.query({ query: "SELECT TotalAmt, TxnDate FROM Invoice WHERE TxnDate >= '2025-03-01'", maxResults: 1000 });
await quickbooks.profitAndLoss({ params: { start_date: '2025-03-01', end_date: '2026-02-15', summarize_column_by: 'Month' } });
await quickbooks.balanceSheet({ params: { start_date: '2025-01-01', end_date: '2026-02-15' } });
await quickbooks.cashFlow({ params: { start_date: '2025-01-01', end_date: '2026-02-15' } });
```

### TalentLMS (`talentlms`)
```typescript
import { talentlms } from 'tools';
await talentlms.getCourses();
await talentlms.getUsers({ limit: 100 });
```

Run `mcp__Kiingo__help()` to discover all current modules and methods.

## Writing the Instructions Prompt

The `instructions` field is the core of a metric. Structure it with these sections:

```
## Data Sources
- Which Kiingo MCP tools to call and why

## Retrieval Steps
1. Exact MCP call with parameters and pagination pattern
2. Second call...
3. Aggregation/computation logic

## Values to Return
- `fieldName`: description and unit
- `anotherField`: description
```

Key rules:
- Reference MCP tool calls explicitly with parameters
- Handle pagination (`after` cursor) for large datasets
- Specify date ranges relative to "today" so the metric stays current
- List every value key the JSX template will consume

## Writing the JSX Template

The template uses Recharts components and layout helpers. Available:
- **Charts**: `AreaChart`, `BarChart`, `LineChart`, `PieChart`, `RadarChart`, `ComposedChart`, `ScatterChart`, `Treemap`, `FunnelChart`
- **Layout**: `MetricSection`, `MetricRow`, `StatCard`, `MetricNote`
- **Theme**: `theme.accent`, `theme.secondary`, `theme.gridStroke`, `theme.chart[0-7]`, etc.

Use `PLACEHOLDER` tokens that Claude replaces with real data:
```jsx
(() => {
  const revenue = REVENUE_PLACEHOLDER;
  return (
    <MetricSection>
      <MetricRow>
        <StatCard label="Revenue" value={'$' + (revenue / 1000).toFixed(0) + 'K'} />
      </MetricRow>
    </MetricSection>
  );
})()
```

## Creating a Metric (Full Flow)

### 1. Save the definition
```typescript
import { saveMetricDefinition } from '../lib/tauriClient';

const metric = await saveMetricDefinition({
  name: "Pipeline by Stage",
  slug: "pipeline-by-stage",
  instructions: "...your prompt...",
  templateHtml: "...your JSX...",
  ttlSeconds: 86400,
  provider: "claude",
});
```

### 2. Bind to a screen
```typescript
import { bindMetricToScreen } from '../lib/tauriClient';

await bindMetricToScreen({
  screenId: "dashboard",    // matches a Screen union value
  metricId: metric.id,
  layoutHint: "wide",       // "card" (4x6) | "wide" (8x6) | "full" (12x8)
  gridX: 0,
  gridY: 0,
  gridW: 8,
  gridH: 6,
});
```

### 3. Refresh
```typescript
import { refreshMetric } from '../lib/tauriClient';
await refreshMetric(metric.id);
```

The runner creates a snapshot, sends the instructions to Claude with MCP tools enabled, parses the JSON response (`{ values, html }`), and stores the result.

## Output Format

Claude must return JSON with exactly two keys:
```json
{
  "values": { "fieldA": 123, "fieldB": 45.6 },
  "html": "(() => { ... JSX ... })()"
}
```

## Reference Files

- **`references/schema.md`** — Full database schema for metric tables
- See `scripts/seed_ceo_dashboard.py` for 16 real-world metric examples
- See `src-tauri/src/runner.rs:2151` for the refresh execution flow
