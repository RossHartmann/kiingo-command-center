PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  model TEXT,
  mode TEXT NOT NULL,
  output_format TEXT,
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  exit_code INTEGER,
  error_summary TEXT,
  queue_priority INTEGER NOT NULL DEFAULT 0,
  profile_id TEXT,
  capability_snapshot_id TEXT,
  compatibility_warnings_json TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capability_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  cli_version TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  detected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_grants (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS scheduler_jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  priority INTEGER NOT NULL,
  state TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  next_run_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 0,
  retry_backoff_ms INTEGER NOT NULL DEFAULT 1000,
  last_error TEXT,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  days_to_keep INTEGER NOT NULL,
  max_storage_mb INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  title TEXT NOT NULL,
  provider_session_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS conversation_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
  UNIQUE(conversation_id, run_id),
  UNIQUE(conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_runs_status_started ON runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_provider_started ON runs(provider, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_state_priority ON scheduler_jobs(state, priority DESC, queued_at ASC);
CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_next_run ON scheduler_jobs(state, next_run_at);
CREATE INDEX IF NOT EXISTS idx_capability_snapshots_provider_detected ON capability_snapshots(provider, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_provider_updated ON conversations(provider, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_archived_updated ON conversations(archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_runs_conversation_seq ON conversation_runs(conversation_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_runs_run ON conversation_runs(run_id);
