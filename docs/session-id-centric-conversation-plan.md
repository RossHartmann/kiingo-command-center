# Session-ID Centric Conversations Plan

Last updated: 2026-02-13
Owner: local-cli-command-center
Status: proposed

## 1. Goal

Implement first-class conversation history (ChatGPT/Gemini/Claude-style) with a sidebar and deterministic thread continuity by centering each conversation on provider session IDs (`codex` thread/session id or `claude` session id).

## 2. Current State (What Exists Today)

1. Persistence is local SQLite (`state.sqlite`) under app data dir.
2. Runs/events/artifacts are persisted (`runs`, `run_events`, `run_artifacts`).
3. Chat screen currently reconstructs chat-like history from runs, not from true conversation entities.
4. Resume behavior is best-effort in frontend by parsing prior run output and forwarding `harness.resumeSessionId` for the next message.
5. There is no first-class `conversations` table, no per-conversation metadata, and no sidebar navigation model.
6. Tauri command surface is run-centric (`start_run`, `list_runs`, `get_run`, ...).
7. Dev browser/mock mode is implemented in `src/lib/tauriClient.ts` and must be updated with any new API contracts.

## 3. Design Principles

1. Preserve existing run/event diagnostics model; do not replace it.
2. Add conversation layer as an index over runs.
3. Session continuity is automatic per conversation; user does not manually manage session IDs.
4. Backend is source-of-truth for session persistence and resume behavior.
5. Degrade safely when resume session is invalid or stale.
6. Keep compatibility with current IPC and screens while introducing new conversation APIs.
7. Keep each conversation provider-immutable in v1 (no mixed-provider threads).

## 4. Target User Experience

1. Left sidebar contains conversations (title, provider badge, last update, short preview).
2. New chat creates a conversation immediately and selects it.
3. Sending a message always targets selected conversation.
4. Conversation continuity is automatic:
   1. Conversation stores provider session id.
   2. New message reuses that session id.
   3. New returned session id updates conversation.
5. If resume fails, app transparently retries once without resume and shows a clear warning.
6. Existing run history remains available via History/advanced views.

## 5. Data Model

## 5.1 Canonical Relationship Strategy

Use both linkage forms with explicit ownership/invariants:

1. `runs.conversation_id` is the canonical direct pointer used for primary querying and filtering.
2. `conversation_runs` is an ordered index for timeline sequencing and future advanced operations (reordering metadata, import/export).
3. Invariant: every run with non-null `runs.conversation_id` must have exactly one row in `conversation_runs` for the same `conversation_id` and `run_id`.
4. All new conversation-driven writes must populate both.
5. Conversations are single-provider entities; all attached runs must match `conversations.provider`.

## 5.2 New Tables and Columns (Target Schema)

### `conversations`

Columns:
1. `id TEXT PRIMARY KEY`
2. `provider TEXT NOT NULL`
3. `title TEXT NOT NULL`
4. `provider_session_id TEXT`
5. `metadata_json TEXT NOT NULL DEFAULT '{}'`
6. `created_at TEXT NOT NULL`
7. `updated_at TEXT NOT NULL`
8. `archived_at TEXT`

Indexes:
1. `idx_conversations_provider_updated` on `(provider, updated_at DESC)`
2. `idx_conversations_archived_updated` on `(archived_at, updated_at DESC)`

### `conversation_runs`

Columns:
1. `id TEXT PRIMARY KEY`
2. `conversation_id TEXT NOT NULL`
3. `run_id TEXT NOT NULL`
4. `seq INTEGER NOT NULL`
5. `created_at TEXT NOT NULL`

Constraints:
1. FK `conversation_id -> conversations(id)` ON DELETE CASCADE
2. FK `run_id -> runs(id)` ON DELETE CASCADE
3. Unique `(conversation_id, run_id)`
4. Unique `(conversation_id, seq)`

Indexes:
1. `idx_conversation_runs_conversation_seq` on `(conversation_id, seq ASC)`
2. `idx_conversation_runs_run` on `(run_id)`

### `runs` extension

Add:
1. `conversation_id TEXT` nullable initially
2. FK `conversation_id -> conversations(id)` ON DELETE SET NULL
3. Index `idx_runs_conversation_started` on `(conversation_id, started_at ASC)`

## 5.3 Concrete SQL DDL (to place in `schema.sql`)

```sql
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

CREATE INDEX IF NOT EXISTS idx_conversations_provider_updated
  ON conversations(provider, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_archived_updated
  ON conversations(archived_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_runs_conversation_seq
  ON conversation_runs(conversation_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_runs_run
  ON conversation_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_conversation_started
  ON runs(conversation_id, started_at ASC);
```

## 6. Migration and DB Boot Strategy (Repo-Specific)

This repository does not have a versioned SQL migration framework. It uses:
1. `schema.sql` for table/index bootstrap.
2. `Database::ensure_schema_extensions()` for idempotent runtime `ALTER TABLE` and one-time data backfill.

Implementation details:

1. In `Database::new`:
   1. Execute `schema.sql` (already done).
   2. Execute `ensure_schema_extensions()` (already done).
2. Extend `ensure_schema_extensions()` to:
   1. Ensure `PRAGMA foreign_keys = ON` for the connection.
   2. Add `runs.conversation_id` if missing.
   3. Create new conversation tables/indexes via `CREATE TABLE/INDEX IF NOT EXISTS` (safe to re-run).
   4. Run idempotent backfill only once.
3. Add migration marker row in `settings` table:
   1. Key: `migration:conversation_threads_v1`
   2. Value JSON example: `{"completedAt":"...","strategy":"one-run-per-conversation"}`
4. Backfill runs inside transaction:
   1. Select runs where `conversation_id IS NULL`, ordered by `started_at ASC`.
   2. For each run, create synthetic conversation.
   3. Set `runs.conversation_id`.
   4. Insert `conversation_runs` with `seq = 1`.
5. Backfill idempotency:
   1. If marker exists, skip.
   2. If partial writes exist (crash), reconciliation query enforces invariants and fills missing rows.

## 7. Backfill Strategy

1. Strategy: one synthetic conversation per legacy run.
2. No heuristic grouping of historical runs by parsed session id.
3. Conversation title source for backfill:
   1. Use first line of run prompt.
   2. Trim whitespace.
   3. Limit to 80 chars with ellipsis.
4. Provider copied from run.
5. `provider_session_id` remains null in backfilled conversations.

## 8. Backend Contract and Rust Model Additions

## 8.1 New Rust Types (`src-tauri/src/models.rs`)

Add:
1. `ConversationRecord`
2. `ConversationSummary` (lightweight list shape)
3. `ConversationDetail` (conversation + ordered runs)
4. `CreateConversationPayload`
5. `ListConversationsFilters`
6. `SendConversationMessagePayload`
7. `RenameConversationPayload`
8. `ArchiveConversationPayload`

Recommended shape:

```text
ConversationRecord {
  id, provider, title, provider_session_id, metadata, created_at, updated_at, archived_at
}

ConversationSummary {
  id, provider, title, provider_session_id, updated_at, archived_at,
  last_run_id, last_message_preview
}

SendConversationMessagePayload {
  conversation_id,
  prompt,
  model?,
  output_format?,
  cwd?,
  optional_flags?,
  profile_id?,
  queue_priority?,
  timeout_seconds?,
  scheduled_at?,
  max_retries?,
  retry_backoff_ms?,
  harness?
}
```

Notes:
1. `provider` is immutable after creation.
2. `cwd` defaults from active workspace grant when omitted.
3. `harness.resume_session_id` is backend-controlled in this command.
4. `send_conversation_message` must reject payloads attempting provider override.

## 8.2 Database methods (`src-tauri/src/db/mod.rs`)

Add methods:
1. `create_conversation(provider, title, metadata_json)`
2. `list_conversations(filters)`
3. `get_conversation(conversation_id)`
4. `get_conversation_detail(conversation_id)`
5. `rename_conversation(conversation_id, title)`
6. `archive_conversation(conversation_id, archived)`
7. `next_conversation_seq(conversation_id)`
8. `attach_run_to_conversation(conversation_id, run_id)`
9. `set_run_conversation_id(run_id, conversation_id)`
10. `set_conversation_session_id(conversation_id, session_id)`
11. `clear_conversation_session_id(conversation_id)`
12. `touch_conversation_updated_at(conversation_id)`
13. `find_conversation_id_by_run(run_id)`

Invariant guard helpers:
1. `repair_missing_conversation_links()`
2. `validate_conversation_link_consistency()` (debug/test assertions)

## 9. Tauri IPC Contract (Explicit)

Add commands in `src-tauri/src/lib.rs`:

1. `create_conversation(payload: CreateConversationPayload) -> ConversationRecord`
2. `list_conversations(filters: ListConversationsFilters) -> Vec<ConversationSummary>`
3. `get_conversation(conversation_id: String) -> Option<ConversationDetail>`
4. `send_conversation_message(payload: SendConversationMessagePayload) -> StartRunResponse`
5. `rename_conversation(payload: RenameConversationPayload) -> ConversationRecord`
6. `archive_conversation(payload: ArchiveConversationPayload) -> BooleanResponse`

Keep existing run commands unchanged for advanced screens and compatibility.

## 10. Runner/Orchestration Changes

## 10.1 New conversation-aware send flow (`RunnerCore`)

Add `RunnerCore::send_conversation_message(payload)`:

1. Load conversation by id.
2. Validate conversation not archived (or allow with explicit override if desired).
3. Build `StartRunPayload`:
   1. `provider = conversation.provider`
   2. `prompt = payload.prompt`
   3. Merge other fields from payload.
4. Inject resume session id from conversation:
   1. if `conversation.provider_session_id` non-empty, set `harness.resume_session_id`.
5. Queue run through existing `queue_run` path.
6. Immediately link run to conversation (`runs.conversation_id` + `conversation_runs`).
7. Emit `conversation.message_sent` event.

## 10.2 Session update capture from semantic events

During run event processing (backend):

1. On `run.semantic` with payload `{ type: "session_complete", sessionId }`:
   1. Resolve `conversation_id` via `runs.conversation_id`.
   2. Update `conversations.provider_session_id`.
   3. Emit `conversation.session_updated`.
2. On run terminal events (`run.completed`, `run.failed`, `run.canceled`, `run.interrupted`):
   1. `touch_conversation_updated_at`.
   2. Emit `conversation.updated`.

Important: this removes frontend responsibility for parsing session ids.

## 11. Resume-Invalid Handling (Concrete)

## 11.1 Detection sources

Use semantic and stderr/failed-message matching. Initial matchers:

Codex indicators:
1. `NOT_FOUND: No active session for run`
2. `No active session`
3. `thread not found`

Claude indicators:
1. `Invalid session id`
2. `Could not resume`
3. `session not found`
4. explicit error payload indicating resume failure

## 11.2 Behavior

For `send_conversation_message` originated runs only:

1. If run fails and message matches resume-invalid matcher:
   1. Emit `run.warning` with `code=session_resume_invalid`.
   2. Clear `conversations.provider_session_id`.
   3. Emit `conversation.session_updated` with `sessionId = null`.
   4. Retry exactly once with identical payload but no resume id.
2. Persist retry linkage to same conversation.
3. If retry fails, surface normal failure.
4. Mark retry attempt metadata in `run_events` payload for diagnostics.

## 11.3 Safety guards

1. Never infinite-loop retries.
2. Retry only for detected resume-invalid failures.
3. Respect existing queue retry policy independently.

## 12. Event Contract Additions

Add new event types over the existing `run_event` channel envelope:

1. `conversation.created`
2. `conversation.updated`
3. `conversation.archived`
4. `conversation.session_updated`
5. `conversation.message_sent`
6. `conversation.renamed`

Payload minimums:

1. Include `conversationId` on all conversation events.
2. Include `provider` and `updatedAt` on `conversation.updated`.
3. Include `sessionId` on `conversation.session_updated` (nullable).

Retain current `run.*` event schema unchanged.

## 13. Frontend Changes

## 13.1 Types and client API (`src/lib/types.ts`, `src/lib/tauriClient.ts`)

Add conversation types and client methods matching IPC commands.

Critical requirement:
1. Update both Tauri invoke path and non-Tauri mock store path.
2. Extend `MockStore` with conversation entities and link logic.

## 13.2 App state (`src/state/appState.tsx`)

Add state:
1. `conversations: ConversationSummary[]`
2. `selectedConversationId?: string`
3. `conversationDetails: Record<string, ConversationDetail>`
4. `conversationLoading: boolean`
5. `conversationError?: string`
6. `selectedConversationByProvider: Record<Provider, string | undefined>` (persisted)

Add actions:
1. `refreshConversations`
2. `createConversation`
3. `selectConversation`
4. `sendConversationMessage`
5. `renameConversation`
6. `archiveConversation`

Backward compatibility:
1. Keep `runs`/`runDetails` for advanced screens.
2. Chat screen migrates to conversation-centric rendering.
3. Persist selected conversation across restarts (per provider); validate on boot and fallback to first active conversation.

## 13.3 Chat screen conversion

1. Sidebar list from `conversations`.
2. Main timeline from selected conversation runs.
3. New chat creates conversation and focuses input.
4. Send action calls `sendConversationMessage` only.
5. Remove frontend session parsing helpers for continuity.
6. Keep loading/typing indicators as run status projection.

## 13.4 History screen

1. Keep run-centric default.
2. Add optional filter by `conversation_id`.

## 14. Feature Flag and Rollout Mechanism

Current codebase has no generic feature-flag system. Implement explicit local flag in settings:

1. Add `conversation_threads_v1: bool` in `AppSettings` (default `false`).
2. Expose in settings update API.
3. UI uses legacy chat flow when false, conversation flow when true.
4. Internal/dev default is true for dogfooding; general default remains false until rollout gates pass.

Rollout phases:

1. Phase A: backend schema + APIs + hidden UI behind flag.
2. Phase B: enable in dev/internal builds by default.
3. Phase C: keep default false for broader users while migration/reliability SLO gates are validated.
4. Phase D: remove legacy timestamp-boundary chat fallback.

## 15. Conversation Title Strategy

v1:
1. Initial title from first user message (trim + sanitize + 80-char cap).
2. Manual rename supported via sidebar context action.

v1.1:
1. Optional async title generation after first assistant response.

## 15.1 v1 Product Decisions (Locked)

1. Provider policy: single-provider conversations only; provider is immutable post-create.
2. Retention behavior: keep conversation shells even when all runs are pruned.
3. Selection persistence: persist last selected conversation id per provider across app restarts.
4. Resume matcher governance: static, versioned matcher list in code for v1; instrument misses for later tuning.
5. Archive semantics: archive-only in v1 (soft hide + restore path), no hard delete UI.
6. Rollout default: enabled in dev/internal dogfood, disabled by default for general rollout until gates pass.

## 16. Security and Privacy

1. Session IDs treated as sensitive operational identifiers:
   1. Persist plain text locally in SQLite (acceptable local-app tradeoff).
   2. Never show full session id in user-facing banners; display short prefix/hash.
2. Continue redaction pipeline for run chunks/events.
3. Preserve workspace policy enforcement and CLI capability checks.
4. Avoid logging full provider session ids in warning/error logs.

## 17. Retention and Archival Interaction

1. Retention currently deletes from `runs`; conversation linkage must remain consistent.
2. Ensure FK behavior works (requires `PRAGMA foreign_keys = ON`).
3. Post-retention cleanup task:
   1. v1 decision: do not auto-delete emptied conversations.
   2. Optional future: background cleanup policy for archived+empty conversations after grace period.
4. Recommended v1 behavior:
   1. Keep conversation rows even if runs pruned.
   2. Show empty-state in timeline: "Older messages were pruned by retention policy."
5. Archive behavior:
   1. Archived conversations are hidden by default.
   2. Provide restore/unarchive.
   3. No permanent delete endpoint in v1 UI.

## 17.1 Selection Persistence Details

1. Persist selection in frontend local storage by provider key.
2. On boot:
   1. Rehydrate selection map.
   2. Verify each selected id exists and is not archived (unless viewing archived mode).
   3. Fallback order: most recently updated active conversation, else create new conversation.
3. On archive/delete-like state transitions:
   1. If selected conversation is archived, auto-select next active conversation.

## 18. Testing Plan (Mapped to Existing Test Topology)

## 18.1 Rust unit tests

Add tests for:

1. DB conversation CRUD.
2. `attach_run_to_conversation` invariants.
3. Backfill marker idempotency.
4. Session update on semantic `session_complete`.
5. Resume-invalid one-time fallback path.
6. Foreign key enforcement and cascade behavior.
7. Provider immutability guard for `send_conversation_message`.
8. Resume matcher table coverage (positive and negative cases).

## 18.2 Rust integration tests (`src-tauri/tests`)

Extend fixture strategy:

1. Codex fixture emits session id then supports resume across second call.
2. Claude fixture emits session id then supports resume across second call.
3. Fixture failure path for invalid resume id string.
4. Assert retry-without-resume occurs exactly once.

## 18.3 Frontend tests

1. Sidebar renders conversations and switches context.
2. New chat creates/selects conversation.
3. Sending message appends only selected conversation.
4. Ctrl/Cmd+Enter submits in chat input.
5. Session indicator updates from backend conversation detail.
6. Mock mode: conversation APIs and timeline behavior match Tauri behavior.
7. Selected conversation persists across reload (per provider) with safe fallback when missing/archived.
8. Archived conversations hidden by default and restored correctly.

## 18.4 Manual QA checklist

1. Create two conversations, send messages in both, verify isolation.
2. Restart app, verify selected conversation persists and continuity works.
3. Simulate invalid resume id, verify warning + auto-retry behavior.
4. Verify History view still lists all runs.
5. Verify archived conversations hidden from default list and restorable if implemented.

## 19. Acceptance Criteria

1. User can create, view, rename, archive, and switch conversations from sidebar.
2. Every new chat message is associated with a `conversation_id`.
3. Session id is reused automatically per conversation when available.
4. Session id updates automatically from provider semantic events.
5. Resume-invalid errors self-heal via one transparent no-resume retry.
6. Existing run history remains accessible and intact.
7. Frontend no longer depends on parsing stdout/stderr to maintain continuity.
8. Tests cover migration, session reuse, retry fallback, and conversation isolation for both providers.
