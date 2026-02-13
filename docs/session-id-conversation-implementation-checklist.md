# Session-ID Conversation Implementation Checklist

Last updated: 2026-02-13
Status: complete
Source plan: `/Users/rosshartmann/Projects/kiingo-command-center/docs/session-id-centric-conversation-plan.md`

## Phase 0 - Tracking

- [x] Create implementation checklist file.
- [x] Keep this checklist updated as work lands.

## Phase 1 - Backend Schema + Models

- [x] Add `runs.conversation_id` to schema for fresh DBs.
- [x] Add `conversations` table to schema.
- [x] Add `conversation_runs` table to schema.
- [x] Add conversation indexes to schema.
- [x] Add `conversation_threads_v1` to `AppSettings` (Rust + TS types).
- [x] Add conversation Rust models and payload DTOs in `src-tauri/src/models.rs`.
- [x] Add `conversation_id` field to run models/types (Rust + TS).

## Phase 2 - DB Migration + Repository Methods

- [x] Enable `PRAGMA foreign_keys = ON` in DB initialization/migrations.
- [x] Extend `ensure_schema_extensions()` for conversation schema upgrades.
- [x] Add migration marker (`migration:conversation_threads_v1`) logic.
- [x] Add one-time idempotent backfill (`one-run-per-conversation`) for legacy runs.
- [x] Add DB methods for conversation CRUD/list/detail/archive/rename.
- [x] Add DB methods for run<->conversation linking and session ID updates.
- [x] Add DB methods for conversation touch/update utilities.
- [x] Add `list_runs` filter support for `conversation_id`.

## Phase 3 - Runner + IPC

- [x] Add Tauri commands: create/list/get/send/rename/archive conversation.
- [x] Add `RunnerCore` conversation methods wrapping DB/queue logic.
- [x] Implement conversation-aware send path that injects resume session from conversation.
- [x] Persist run linkage to conversation on send.
- [x] Handle semantic `session_complete` to update `conversations.provider_session_id`.
- [x] Emit conversation events (`conversation.*`) from backend.
- [x] Touch conversation timestamps on run completion/failure/cancel/interrupted.
- [x] Implement resume-invalid detection and one automatic no-resume retry for conversation sends.
- [x] Enforce single-provider conversations at backend boundary.

## Phase 4 - Frontend Client + State + UI

- [x] Add conversation APIs in `src/lib/tauriClient.ts` (Tauri + mock paths).
- [x] Add conversation types in `src/lib/types.ts`.
- [x] Extend app state with conversation store/actions/selection state.
- [x] Persist selected conversation per provider across restarts.
- [x] Convert chat UI to conversation-centric sidebar + timeline behavior.
- [x] Wire `New chat` to `createConversation`.
- [x] Wire send to `sendConversationMessage` only (no frontend resume parsing).
- [x] Add archive/rename interactions in UI.
- [x] Add history filter by `conversation_id` (or documented deferral if intentionally postponed).
- [x] Surface feature flag setting (`conversation_threads_v1`) in settings UI.

## Phase 5 - Tests + Verification

- [x] Update/add Rust unit tests for conversation DB/retry/session behavior.
- [x] Update/add integration tests for codex/claude resume continuity + resume-invalid fallback.
- [x] Update/add frontend tests for sidebar/new chat/send/selection persistence.
- [x] Update/add tauriClient mock tests for conversation APIs.
- [x] Run frontend tests.
- [x] Run Rust tests.
- [x] Run typecheck/build smoke tests.

## Phase 6 - Cleanup + Documentation

- [x] Reconcile any plan-vs-implementation deltas.
- [x] Update this checklist to all done.
- [x] Add final implementation notes and residual risks.

## Final Notes

- Verification completed:
- `npm test -- --run`
- `npm run build`
- `cargo test --lib`
- `cargo test --test integration_runner`
- `cargo check`
- Residual risk:
- `cargo fmt` was not executed because `rustfmt` is not installed for `stable-aarch64-apple-darwin` in this environment.
