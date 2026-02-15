# Metric Database Schema

SQLite database at `~/Library/Application Support/com.kiingo.localcli/state.sqlite`.

## metric_definitions

Stores the declarative configuration for each metric.

```sql
CREATE TABLE IF NOT EXISTS metric_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  instructions TEXT NOT NULL,
  template_html TEXT DEFAULT '',
  ttl_seconds INTEGER DEFAULT 3600,
  provider TEXT DEFAULT 'claude',
  model TEXT,
  profile_id TEXT,
  cwd TEXT,
  enabled INTEGER DEFAULT 1,
  proactive INTEGER DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
```

Indexes:
- `idx_metric_definitions_slug` on `(slug)`
- `idx_metric_definitions_enabled` on `(enabled, archived_at)`

## metric_snapshots

Stores each refresh result (values + rendered HTML).

```sql
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL,
  run_id TEXT,
  values_json TEXT DEFAULT '{}',
  rendered_html TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE
);
```

Statuses: `pending` → `running` → `completed` | `failed`

Indexes:
- `idx_metric_snapshots_metric_created` on `(metric_id, created_at DESC)`
- `idx_metric_snapshots_run` on `(run_id)`
- `idx_metric_snapshots_status` on `(status)`

## screen_metrics

Binds metrics to dashboard screens with grid layout positioning.

```sql
CREATE TABLE IF NOT EXISTS screen_metrics (
  id TEXT PRIMARY KEY,
  screen_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  layout_hint TEXT DEFAULT 'card',
  grid_x INTEGER DEFAULT -1,
  grid_y INTEGER DEFAULT -1,
  grid_w INTEGER DEFAULT 4,
  grid_h INTEGER DEFAULT 6,
  FOREIGN KEY(metric_id) REFERENCES metric_definitions(id) ON DELETE CASCADE
);
```

Layout hints and default grid sizes:
- `"card"`: 4w × 6h
- `"wide"`: 8w × 6h
- `"full"`: 12w × 8h

Multiple widgets of the same metric on the same screen are allowed.

Indexes:
- `idx_screen_metrics_screen` on `(screen_id, position)`
- `idx_screen_metrics_metric` on `(metric_id)`

## Staleness Logic

A snapshot is considered stale when:
- No snapshot exists for the metric
- Latest snapshot status is `failed`
- Latest snapshot has no `completed_at`
- `(now - completed_at) / 1000 >= ttl_seconds`

## Debugging Queries

```sql
-- Recent snapshot results
SELECT id, status, error_message, created_at FROM metric_snapshots ORDER BY created_at DESC LIMIT 10;

-- What a run actually output
SELECT event_type, substr(payload_json, 1, 300) FROM run_events WHERE run_id = '<id>' ORDER BY seq DESC LIMIT 10;
```
