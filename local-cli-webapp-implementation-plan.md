# Local Codex/Claude Headless Runner - Implementation Plan

Last updated: 2026-02-12

## 1. Executive Summary

This plan defines how to build a local application that:

1. Accepts user requests from a web-style UI.
2. Executes Codex and Claude Code headless CLIs locally.
3. Supports both non-interactive and managed interactive session flows.
4. Persists run history and artifacts.
5. Ships reliably on macOS and Windows with a small binary footprint.
6. Includes strong local safety, observability, and reliability foundations in v1.

Recommended stack: **Tauri + React UI + Rust runner core + SQLite**.

## 2. Goals and Non-Goals

## Goals

1. Cross-platform support for macOS and Windows.
2. Reliable process execution with cancellation, timeout, retries, and logs.
3. Safe command execution with strict allowlists and secret handling.
4. Responsive UI with streaming output, run status, and history.
5. Local-first architecture with minimal external dependencies.

## Non-Goals (v1)

1. Remote multi-user orchestration.
2. Arbitrary shell execution from UI.
3. Full plugin marketplace.
4. Cloud synchronization by default.

## 2.1 V1 Baseline Decisions (Comprehensive)

These decisions are locked for the initial implementation baseline:

1. **Interaction model**: v1 supports non-interactive and interactive session workflows.
2. **Version policy**: compatibility matrix from day one with runtime version detection and capability gates.
3. **Command surface**: curated adapters by default plus policy-controlled advanced flags.
4. **Filesystem scope**: explicit workspace grants only; additional roots require user approval.
5. **Redaction**: aggressive multi-layer secret masking by default.
6. **Telemetry**: comprehensive local observability by default; remote telemetry opt-in.
7. **Packaging**: unsigned local installers/build artifacts are acceptable for personal use.
8. **Auto-update**: deferred; manual update workflow in v1.
9. **Concurrency**: scheduler-based execution with queueing, priorities, and per-provider limits.
10. **Retention**: 90-day default retention with configurable policy and storage caps.

## 3. High-Level Architecture

## Components

1. **Frontend UI (React + TypeScript)**  
   Displays forms, run status, streaming output, history, and settings.

2. **Desktop Host (Tauri)**  
   Hosts web UI, manages app lifecycle, bridges UI <-> Rust runner.

3. **Runner Core (Rust service module)**  
   Owns command validation, process spawning, streaming, cancellation, and persistence.

4. **CLI Adapters (Rust)**  
   Adapter per tool:
   - Codex adapter (`codex exec`, `codex review`, etc.)
   - Claude adapter (`claude -p`, output format controls)

5. **Persistence (SQLite)**  
   Stores runs, output chunks, metadata, settings, and redaction events.

6. **Telemetry and Logging**
   - Structured local logs (JSON lines).
   - Local metrics/traces for reliability diagnostics.
   - Remote telemetry optional and disabled by default.

7. **Policy Engine**
   - Enforces workspace grants, adapter allowlists, and advanced-mode controls.

8. **Scheduler**
   - Coordinates queueing, priorities, and concurrency limits across providers.

## Data Flow

1. User submits run request in UI.
2. UI calls Tauri command/API (`start_run`).
3. Runner validates request and builds allowed CLI args.
4. Runner spawns process and streams stdout/stderr chunks.
5. Stream events go to UI over Tauri event channel.
6. Final result, exit status, metadata, and artifacts persist in SQLite.

## 4. Technology Choices

## Core

1. **Tauri 2.x**
2. **Rust 1.8x+**
3. **React + Vite + TypeScript**
4. **SQLite** via `sqlx` or `rusqlite`
5. **Process management** via `tokio::process`
6. **Streaming/event bus** via Tauri events + async channels

## Supporting Libraries

1. `serde`, `serde_json` for protocol models.
2. `uuid`, `chrono` for run IDs and timestamps.
3. `tracing` + `tracing-subscriber` for logs.
4. `regex` for secret redaction.
5. `portable-pty` (or equivalent) for interactive session support.
6. `keyring` crate for secure token/config secret storage where applicable.
7. `tauri-plugin-shell` for process spawn/stream/kill (use this plugin for child processes).
8. Do not use `tauri-plugin-process` for command execution; it is for current-app process controls.

## 5. Functional Requirements

## Run Management

1. Start run for Codex or Claude.
2. Show live output stream.
3. Cancel running process.
4. Retry failed run.
5. Re-run with edited parameters.
6. Start managed interactive sessions and capture session transcript/events.
7. Resume supported sessions where CLI and adapter capabilities allow.
8. Queue runs with priorities and scheduled execution.
9. Normalize stream handling by provider:
   - Codex non-interactive: progress stream on `stderr`, final message on `stdout`, optional JSONL via `--json`.
   - Claude non-interactive: use `-p` with `--output-format` (`text|json|stream-json`) and optional schema validation.

## Input and Profiles

1. Structured run form with:
   - Provider (`codex` or `claude`)
   - Prompt
   - Model
   - Mode/output format
   - Run mode (`non-interactive`, `interactive`)
   - Workspace path
   - Optional flags from allowlisted set
   - Advanced policy profile selector
2. Saved profiles for common command templates.

## Output and Artifacts

1. Stream chunked output in terminal-style panel.
2. Render structured JSON output when present.
3. Store raw logs and parsed summary.
4. Export run result (`.md`, `.json`, `.txt`).
5. Optionally store encrypted raw artifacts (explicitly enabled setting).

## History

1. List past runs with filters.
2. View run details and replay logs.
3. Search by prompt, provider, status, date.
4. Show compatibility warnings and adapter capability metadata per run.

## 6. Non-Functional Requirements

1. Startup under 2s on typical laptop.
2. Stream latency under 300ms from process output to UI display.
3. Correct cancellation within 2s under normal conditions.
4. No secrets written to logs without masking.
5. Stable behavior under repeated runs (100+ continuous runs).
6. Works across supported CLI versions defined by compatibility matrix.
7. Safe startup and data consistency across app version upgrades.

## 7. Security Model

## Command Execution Policy

1. Use adapter-generated argument lists only.
2. Disallow arbitrary shell command strings.
3. Validate binary path (`codex`/`claude`) before run.
4. Restrict flags to approved schema per provider.
5. Enforce per-profile advanced flag policies and deny unknown flags.
6. Enforce Tauri capability permissions with explicit `shell:allow-execute` scopes and argument validators.
7. Enable `shell:allow-kill` only where run cancellation is required.

## Filesystem and Path Safety

1. Normalize and validate workspace path.
2. Enforce run roots allowlist by default.
3. Reject path traversal in artifact exports.
4. Require explicit user grant for new workspace roots.

## Secret Handling

1. Redact known secret patterns from output before persistence.
2. Apply context-aware masking on common auth/token fields.
3. Store a redaction audit marker when masking occurs.
4. Never log configured tokens directly.
5. Store sensitive settings in OS keychain where possible.
6. Use `keyring` entries keyed by `<service, username[,target]>`; avoid parallel writes to the same credential entry.

## UI Security

1. Disable remote content by default.
2. Strict CSP in frontend.
3. Validate all IPC payloads with typed schemas.

## 8. CLI Adapter Design

## Adapter Interface

Each adapter should implement:

1. `validate(request) -> validated_request`
2. `build_command(validated_request) -> program + args + env + cwd`
3. `parse_chunk(raw_chunk) -> normalized_event`
4. `parse_final(exit_code, buffered_output) -> run_summary`
5. `capabilities(cli_version) -> capability_profile`

## Codex Adapter (v1)

Primary commands:

1. `codex exec`
2. `codex review`
3. interactive command path support where version/capability allows

Supported options:

1. `--model`
2. `--json`
3. `--output-schema`
4. `--output-last-message`
5. `--sandbox`
6. `--skip-git-repo-check`
7. version-gated options from compatibility profile

## Claude Adapter (v1)

Primary command:

1. `claude -p`
2. interactive command path support where version/capability allows

Supported options:

1. `--output-format`
2. `--input-format`
3. `--json-schema`
4. `--model`
5. `--max-budget-usd`
6. `--no-session-persistence`
7. version-gated options from compatibility profile

## 9. IPC/API Contract (UI <-> Runner)

## Core Commands

1. `start_run(payload)` -> `{ run_id }`
2. `cancel_run({ run_id })` -> `{ success }`
3. `get_run({ run_id })` -> full run detail
4. `list_runs(filters)` -> paged list
5. `rerun({ run_id, overrides })` -> `{ new_run_id }`
6. `start_interactive_session(payload)` -> `{ run_id, session_id }`
7. `send_session_input({ run_id, data })` -> `{ accepted }`
8. `end_session({ run_id })` -> `{ success }`
9. `list_capabilities()` -> provider/version capability map

## Stream Events

1. `run.started`
2. `run.chunk.stdout`
3. `run.chunk.stderr`
4. `run.progress` (optional parsed milestones)
5. `run.completed`
6. `run.failed`
7. `run.canceled`
8. `run.compatibility_warning`
9. `session.opened`
10. `session.input_accepted`
11. `session.closed`

## 10. Persistence Schema (SQLite)

## Tables

1. `runs`
   - `id`, `provider`, `status`, `prompt`, `model`, `cwd`, `started_at`, `ended_at`, `exit_code`, `error_summary`
2. `run_events`
   - `id`, `run_id`, `seq`, `event_type`, `payload_json`, `created_at`
3. `run_artifacts`
   - `id`, `run_id`, `kind`, `path`, `metadata_json`
4. `profiles`
   - `id`, `name`, `provider`, `config_json`, `created_at`, `updated_at`
5. `settings`
   - `key`, `value_json`, `updated_at`
6. `capability_snapshots`
   - `id`, `provider`, `cli_version`, `profile_json`, `detected_at`
7. `workspace_grants`
   - `id`, `path`, `granted_by`, `granted_at`, `revoked_at`
8. `scheduler_jobs`
   - `id`, `run_id`, `priority`, `state`, `queued_at`, `started_at`, `finished_at`
9. `retention_policies`
   - `id`, `scope`, `days_to_keep`, `max_storage_mb`, `created_at`, `updated_at`

## Indexes

1. `runs(status, started_at desc)`
2. `runs(provider, started_at desc)`
3. `run_events(run_id, seq)`
4. `profiles(name unique)`
5. `scheduler_jobs(state, priority, queued_at)`
6. `capability_snapshots(provider, detected_at desc)`

## 11. UX Plan

## Screens

1. **Run Composer**
   - Provider selector, prompt input, model/options panel.
2. **Live Run View**
   - Status badge, streaming output, cancel/retry actions.
3. **History**
   - Filterable run list + detail drawer.
4. **Profiles**
   - Create/edit default run templates.
5. **Settings**
   - Binary paths, log retention, redaction rules, diagnostics.
6. **Compatibility**
   - Installed CLI versions, compatibility status, and remediation guidance.
7. **Queue**
   - Active jobs, queued jobs, priorities, and resource/concurrency status.

## UX Requirements

1. No blocking UI during long runs.
2. Clear status transitions.
3. Copy/export output quickly.
4. Fast keyboard flow for power users.
5. Clear distinction between safe defaults and advanced policy-controlled options.

## 12. Resilience and Robustness

1. Process watchdog for hung commands.
2. Configurable per-run timeout.
3. Graceful cancel sequence:
   - soft terminate
   - force kill after grace period
4. Backpressure-safe event buffering.
5. Automatic recovery on app restart:
   - mark orphan runs as `interrupted`.
6. Log rotation and retention policy.
7. Scheduler with bounded queues and starvation prevention.
8. Restart-safe recovery for queued and in-progress jobs.
9. Process lifecycle guarantees:
   - Never drop child handles without explicit cleanup.
   - On cancel: send terminate/kill, then always `wait` to avoid zombies/resource leaks.
   - Configure Tokio `kill_on_drop` deliberately; default behavior is not cancellation.
10. Windows process-tree strategy:
    - Prefer explicit process-group/job-object management for descendant cleanup.
    - Use `GenerateConsoleCtrlEvent` only where console-group semantics are guaranteed.

## 13. Cross-Platform Implementation Notes

## macOS

1. Local packaging workflow for personal distribution/use.
2. Validate shell/path behavior in zsh environments.

## Windows

1. Handle `.exe` discovery and PATH differences.
2. Correct process tree termination semantics.
3. Local installer/build workflow for personal distribution/use.

## Shared

1. Normalize path separators.
2. Avoid shell quoting issues by using argv arrays.
3. Dedicated compatibility tests for both OS targets.
4. Cross-version capability tests against pinned CLI fixtures.
5. Avoid Windows raw commandline composition unless required; prefer structured args over `raw_arg`.

## 14. Testing Strategy

## Unit Tests

1. Adapter argument validation/build logic.
2. Output parser and redaction rules.
3. SQLite repository layer.
4. Scheduler fairness and queue policy logic.
5. Compatibility matrix resolution logic.

## Integration Tests

1. Spawn mocked CLIs and assert streaming behavior.
2. Cancellation and timeout correctness.
3. Crash recovery and restart behavior.
4. Interactive session stream handling and transcript integrity.

## E2E Tests

1. UI + runner run lifecycle.
2. Profile save/load and rerun.
3. Export and history integrity.
4. Compatibility warnings and fallback behavior.
5. Queue and priority UX flows.

## Manual QA Matrix

1. macOS Intel/Apple Silicon.
2. Windows 10/11.
3. Different CLI install locations and auth states.
4. Mixed provider concurrent runs with queue limits.

## 15. Implementation Phases

## Phase 0 - Discovery and Spec (1 week)

1. Lock v1 CLI options and validation schemas.
2. Finalize IPC contract and DB schema.
3. Build mocked CLI fixtures.
4. Define compatibility matrix and capability profiles.
5. Define policy schema for advanced mode.

Deliverables:

1. Technical spec.
2. API/IPC schema docs.
3. Test harness baseline.

## Phase 1 - Runner Core + Scheduler (2 weeks)

1. Implement run lifecycle state machine.
2. Add process spawn, stream, cancel, timeout.
3. Add SQLite persistence.
4. Implement queueing, priorities, and concurrency controls.

Deliverables:

1. Runnable backend core.
2. Integration tests for lifecycle.

## Phase 2 - Adapters + Security + Compatibility (2 weeks)

1. Codex and Claude adapters.
2. Arg allowlist enforcement.
3. Output redaction and audit log hooks.
4. Version detection and capability profile resolution.
5. Workspace grant and policy engine enforcement.

Deliverables:

1. Adapter package.
2. Security checks and tests.

## Phase 3 - UI Comprehensive v1 (2 weeks)

1. Run composer, live stream view, history list.
2. Retry/rerun flows.
3. Basic settings panel.
4. Interactive session UI.
5. Queue/priority management UI.
6. Compatibility dashboard.

Deliverables:

1. Usable desktop MVP.

## Phase 4 - Hardening and Packaging (2 weeks)

1. Crash recovery and robustness improvements.
2. Packaging for macOS and Windows.
3. Release checklist and QA signoff.

Deliverables:

1. Local test installers/build artifacts.
2. Release candidate.

## Phase 5 - Stabilization and Launch Readiness (1 week)

1. Soak testing with long-running mixed workloads.
2. Final security and redaction audit.
3. Performance profiling and startup optimization.
4. Documentation and operational runbook completion.

Deliverables:

1. Production launch candidate.
2. Release artifacts and validation checklist.
3. Launch checklist signoff.

## 16. CI/CD and Release

1. CI stages:
   - lint
   - unit tests
   - integration tests
   - build artifacts
2. Matrix builds for macOS + Windows.
3. Artifacts:
   - macOS `.dmg`
   - Windows installer `.exe`
4. Optional artifact checksums for local verification.
5. Build flow for local distribution:
   - `tauri build` for full build+bundle.
   - `tauri build -- --no-bundle` + `tauri bundle` when splitting compile and bundle steps.

## 17. Risks and Mitigations

1. **CLI flag drift across versions**
   - Mitigation: version detection + compatibility map.
2. **Auth/setup friction on user machines**
   - Mitigation: startup diagnostics and guided checks.
3. **Streaming quirks across OS**
   - Mitigation: integration tests + optional PTY mode.
4. **Sensitive data leakage in logs**
   - Mitigation: redaction pipeline + test corpus.
5. **Process hangs**
   - Mitigation: watchdog + hard-kill fallback.
6. **Queue starvation or resource contention**
   - Mitigation: bounded queues + fairness rules + circuit breakers.

## 18. Locked Policy Defaults

1. v1 includes non-interactive and interactive workflows.
2. Compatibility matrix enforced at runtime with clear fallback messaging.
3. Curated adapters are default; advanced flags require policy-enabled mode.
4. Workspace grants are required for all execution roots.
5. Aggressive redaction is always on by default.
6. Local observability is enabled; remote telemetry is opt-in.
7. Unsigned local installers/build artifacts are acceptable for personal use.
8. Auto-update is deferred in v1; manual updates are used.
9. Scheduler enforces per-provider concurrency and global queue limits.
10. Default retention is 90 days with configurable age/storage caps.

## 19. Pre-Implementation Clarifications (with Proposed Defaults)

1. **Interactive scope by provider**
   - Proposed default: support managed interactive sessions for `codex` and `claude` using adapter-approved commands only; enable resume only where provider capability profile explicitly supports it.
2. **Compatibility matrix ownership**
   - Proposed default: ship with pinned tested ranges, store matrix in versioned app config, and update matrix on each release cycle with a compatibility test gate in CI.
3. **Advanced policy model**
   - Proposed default: advanced mode is disabled by default and can be enabled only by local admin-level action; policies are validated against strict schemas on load.
4. **Workspace grant lifecycle**
   - Proposed default: persistent grants per absolute path, revocable in settings, with separate explicit approval for symlink targets and network-mounted paths.
5. **Redaction specification**
   - Proposed default: combine regex and context-based masking, mark redacted spans in metadata, and disallow unredacted re-display unless an explicit encrypted raw-artifact setting is enabled.
6. **Secret storage boundaries**
   - Proposed default: credentials/tokens in OS keychain only; operational settings in SQLite; never store plaintext secrets in logs, events, or exports.
7. **Scheduler semantics**
   - Proposed default: priority queue with weighted-fair scheduling, defaults of max 2 global concurrent runs and max 1 per provider, exponential backoff retries for retryable failures, and starvation prevention aging.
8. **Interactive IO protocol**
   - Proposed default: PTY-backed UTF-8 text stream with bounded buffers, terminal control sequence filtering for safe rendering, and explicit handling for multiline input/paste.
9. **Updater guardrails**
   - Proposed default: updater disabled in v1; manual in-app “check for update instructions” link only.
10. **Retention and storage policy details**
    - Proposed default: 90-day run/event retention, compressed artifacts after 7 days, per-install storage cap, and configurable secure-purge workflow.
11. **Error taxonomy and UX contract**
    - Proposed default: stable error code set (`AUTH_*`, `CLI_*`, `POLICY_*`, `IO_*`, `UPDATE_*`) with user remediation guidance and machine-readable diagnostics.
12. **Authentication onboarding**
    - Proposed default: startup diagnostics verify CLI install/auth state, guided login checks per provider, and clear blocked-state UI with actionable steps.
13. **Observability schema**
    - Proposed default: structured local events for lifecycle, queue, policy, and update outcomes; explicit PII suppression rules; selectable log verbosity.
14. **Performance budgets**
    - Proposed default: startup <=2s, stream latency p95 <=300ms, cancel p95 <=2s, and memory budget targets defined per OS in CI perf checks.
15. **Release and security process**
    - Proposed default: release checklist, dependency/license scan gates, and repeatable local build verification.

## 20. Research-Backed Implementation Details

## 20.1 Codex-Specific Integration Rules

1. Non-interactive entrypoint is `codex exec`; use it for CI/automation pipelines.
2. In default non-interactive mode, Codex progress events appear on `stderr` and the final message on `stdout`.
3. Use `--json` for JSONL event streams when machine-parsing workflow state.
4. Use `--output-schema` + `-o/--output-last-message` for deterministic artifact generation.
5. Use `--ephemeral` for runs where session rollout artifacts must not persist.
6. For CI auth, prefer `CODEX_API_KEY` for `codex exec` jobs; treat it as scoped to that command family.
7. For headless ChatGPT login paths, support device auth and auth-cache copy fallback in diagnostics/help text.

## 20.2 Claude-Specific Integration Rules

1. Non-interactive entrypoint is `claude -p/--print`.
2. Expose `--output-format` and `--input-format` controls in run profiles.
3. Support `--json-schema` for schema-validated structured outputs.
4. Support bounded-run controls (`--max-budget-usd`, `--max-turns`) in policy presets.
5. For strict remote-tool governance, expose `--mcp-config` + `--strict-mcp-config` in advanced policy mode.

## 20.3 Tauri Process and Permissions Model

1. Use `tauri-plugin-shell` for command spawn/stream/kill and wire command events:
   - `Stdout`, `Stderr`, `Error`, `Terminated`.
2. Enforce plugin capabilities:
   - `shell:allow-execute` with command allowlists and argument validators.
   - `shell:allow-kill` only for cancellation pathways.
3. For sidecars, ensure target-triple-specific binaries are packaged correctly and referenced by sidecar name.
4. Use Tauri events (`emit`, `emit_to`) for backend-to-frontend run streaming.

## 20.4 Cancellation and Process-Tree Handling

1. Rust/Tokio caveat: child processes continue after handle drop unless explicitly killed/waited.
2. Cancellation contract:
   - attempt graceful stop where applicable,
   - escalate to kill,
   - always await termination/reap.
3. Windows tree cleanup:
   - design for job-object-based termination where possible,
   - understand console control signal limits (`GenerateConsoleCtrlEvent`) before using process-group interrupts.

## 20.5 SQLite and Data Retention Tuning

1. Use WAL mode for local concurrent read/write behavior and predictable durability/perf balance.
2. Use checkpoint policy and journal-size controls to bound WAL growth over long sessions.
3. Apply periodic maintenance:
   - retention pruning by age/size,
   - scheduled `VACUUM` for space reclamation after heavy churn.
4. Keep database + WAL artifacts together during file moves/copies.

## 20.6 Compatibility Matrix Operations

1. Keep a versioned capability map for Codex and Claude in source control.
2. At startup, detect installed CLI version and map to:
   - supported,
   - degraded (with explicit feature disables),
   - blocked (with remediation).
3. Update matrix on every release using:
   - docs review (`codex` changelog, Claude CLI reference),
   - automated integration tests against pinned fixture versions.
4. Surface compatibility decisions in UI and run metadata.

## 20.7 Local Distribution Constraints

1. Personal-use distribution can remain unsigned; signing/notarization is optional.
2. Prefer per-user installers on Windows for minimal privilege friction.
3. Keep manual update workflow explicit in settings/help (current version, latest known, upgrade steps).

## 20.8 Primary Sources

1. [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
2. [Codex authentication](https://developers.openai.com/codex/auth)
3. [Codex Windows guidance](https://developers.openai.com/codex/windows)
4. [Codex advanced config](https://developers.openai.com/codex/config-advanced)
5. [Codex config reference](https://developers.openai.com/codex/config-reference)
6. [Codex changelog](https://developers.openai.com/codex/changelog)
7. [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
8. [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
9. [Tauri shell plugin docs](https://v2.tauri.app/plugin/shell/)
10. [Tauri sidecar docs](https://v2.tauri.app/develop/sidecar/)
11. [Tauri frontend event docs](https://v2.tauri.app/develop/calling-frontend/)
12. [Tauri distribute docs](https://v2.tauri.app/distribute/)
13. [tokio::process::Command docs](https://docs.rs/tokio/latest/tokio/process/struct.Command.html)
14. [tokio::process::Child docs](https://docs.rs/tokio/latest/tokio/process/struct.Child.html)
15. [std::process::Child docs](https://doc.rust-lang.org/std/process/struct.Child.html)
16. [Windows CommandExt (Rust)](https://doc.rust-lang.org/std/os/windows/process/trait.CommandExt.html)
17. [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
18. [GenerateConsoleCtrlEvent](https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent)
19. [portable_pty crate](https://docs.rs/portable-pty/)
20. [SQLite WAL](https://sqlite.org/wal.html)
21. [SQLite PRAGMA reference](https://www.sqlite.org/pragma.html)
22. [SQLite VACUUM](https://www.sqlite.org/lang_vacuum.html)
23. [Rust keyring crate](https://docs.rs/keyring)

## 21. Definition of Done (v1)

1. Users can run Codex and Claude headless commands from UI.
2. Users can run managed interactive sessions with streamed IO and transcript capture.
3. Capability matrix correctly gates options by detected CLI versions.
4. Queueing, priorities, and concurrency controls are functional and tested.
5. Workspace grants and policy engine enforce execution boundaries.
6. Aggressive redaction and audit markers protect sensitive output.
7. Local observability is available; remote telemetry remains opt-in.
8. Local installers/build artifacts are produced for macOS and Windows.
9. Manual update workflow is documented and validated.
10. Retention policy defaults to 90 days and supports configurable caps.
11. Security controls and automated test suite pass across supported OS matrix.
12. Known failure modes have clear user-facing diagnostics and remediation steps.
