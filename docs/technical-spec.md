# Technical Spec (Implemented)

## IPC Commands

- `start_run(payload)`
- `create_conversation(payload)`
- `list_conversations(filters)`
- `get_conversation(conversation_id)`
- `send_conversation_message(payload)`
- `rename_conversation(payload)`
- `archive_conversation(payload)`
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
- `conversation.created`
- `conversation.updated`
- `conversation.archived`
- `conversation.renamed`
- `conversation.session_updated`
- `conversation.message_sent`
- `run.chunk.stdout`
- `run.chunk.stderr`
- `run.progress`
- `run.policy_audit`
- `run.compatibility_warning`
- `run.semantic`
- `run.warning`
- `run.cli_missing`
- `run.cwd_missing`
- `run.runner_metrics`
- `run.cli_exit`
- `run.structured_output`
- `run.structured_output_invalid`
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
- `conversations`
- `conversation_runs`
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
- Harness timeout range: `5000..=10800000` ms
- Harness `maxToolResultLines` limit: `<= 20000`
- `autoApprove + full-access sandbox` is denied by policy.
- Profile merge is null-safe: missing payload fields inherit selected profile defaults.
- Conversation sends reject archived conversations and enforce single-provider threads.
- Resume-invalid session failures trigger one automatic retry without resume.

## Harness Hardening

- Start payload supports a `harness` block for:
  - permissions and tools,
  - limits,
  - MCP config,
  - structured output schema,
  - shell prelude,
  - CLI allowlist,
  - process env injection,
  - resume/continue session controls.
- Runner applies capability adjustment before execution and emits compatibility warnings when unsupported harness options are dropped.
- Non-interactive execution uses hardened tokio process flow with:
  - spawn retry backoff,
  - stream buffer trimming and line truncation warnings,
  - CLI/CWD missing diagnostics,
  - runner metrics emission,
  - optional structured output validation.

## Compatibility

Startup/runtime detects `codex --version` and `claude --version`, then maps to compatibility profiles with `supported/degraded/blocked` state.
