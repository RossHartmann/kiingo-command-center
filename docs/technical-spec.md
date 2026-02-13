# Technical Spec (Implemented)

## IPC Commands

- `start_run(payload)`
- `cancel_run(run_id)`
- `get_run(run_id)`
- `list_runs(filters)`
- `rerun(run_id, overrides)`
- `start_interactive_session(payload)`
- `send_session_input(run_id, data)`
- `end_session(run_id)`
- `resume_session(run_id)`
- `list_capabilities()`
- `list_profiles()`
- `save_profile(payload)`
- `list_queue_jobs()`
- `get_settings()`
- `update_settings(settings)`
- `list_workspace_grants()`
- `grant_workspace(path)`
- `export_run(run_id, format)`
- `save_provider_token(provider, token)`
- `clear_provider_token(provider)`
- `has_provider_token(provider)`

## Stream Events

- `run.started`
- `run.chunk.stdout`
- `run.chunk.stderr`
- `run.progress`
- `run.policy_audit`
- `run.compatibility_warning`
- `run.completed`
- `run.failed`
- `run.canceled`
- `session.opened`
- `session.input_accepted`
- `session.closed`

All are emitted as a `run_event` envelope from Tauri backend to frontend.

## Persistence

SQLite tables are defined in `/src-tauri/src/db/schema.sql`:

- `runs`
- `run_events`
- `run_artifacts`
- `profiles`
- `settings`
- `capability_snapshots`
- `workspace_grants`
- `scheduler_jobs`
- `retention_policies`

WAL mode is enabled.

## Scheduler Defaults

- Global concurrent runs: 2
- Per-provider concurrent runs: 1
- Queue capacity: 512 pending jobs
- Priority queue with aging-based starvation mitigation

## Redaction

Regex and token-length heuristics are applied before event persistence and UI emission.

## Runtime Guardrails

- Queue priority range: `-10..=10`
- Timeout range: `5..=10800` seconds
- Max retries: `<= 10`
- Retry backoff range: `100..=600000` ms
- Profile merge is null-safe: missing payload fields inherit selected profile defaults.

## Compatibility

Startup/runtime detects `codex --version` and `claude --version`, then maps to compatibility profiles with `supported/degraded/blocked` state.
