# Harness Integration Plan (brain-llm-utils -> kiingo-command-center)

Last updated: 2026-02-13

## 1. Objective

Integrate the full headless harness functionality from:

`/Users/rosshartmann/Projects/kiingo/packages/brain-llm-utils/src/harness`

into:

`/Users/rosshartmann/Projects/kiingo-command-center`

while preserving existing strengths in this app: SQLite run history, scheduler queueing, policy enforcement, redaction, artifact storage, and Tauri event streaming.

## 2. Upstream Harness Capability Inventory

The upstream harness provides these capability groups:

1. Unified request model for Codex and Claude; includes tools, permissions, limits, MCP, system prompts, structured output, images/files, session resume, and process env shaping.
2. Capability-aware request adjustment (`applyHarnessCapabilities`) that drops unsupported options and emits warnings.
3. Hardened process runner; includes spawn retry/backoff, abort signal handling, line buffering limits, truncation diagnostics, runner metrics, no-output warnings, and CLI/CWD missing detection.
4. Rich adapter argument builders for both providers; includes permission mapping, MCP wiring, structured output handling, image/piped input handling, and resume controls.
5. Rich stream parsers that emit normalized semantic events; includes text, thinking, tool lifecycle, usage, rate-limit, and session-complete signals.
6. Tooling hardening utilities; includes CLI allowlist wrapper/shim mode, virtual MCP server lifecycle, and shell prelude injection via `BASH_ENV`/`ENV`.
7. Transcript and structured-output helpers; includes transcript collection, JSON/schema resolution, and dry-run planning outputs.

## 3. Current Project Snapshot vs Harness

| Area | Current command-center state | Gap vs harness |
| --- | --- | --- |
| Runner process lifecycle | Queueing, retries, cancellation, timeouts, redaction, interactive PTY support | Missing runner metrics/no-output warnings/CLI-missing parity; shell alias path is less robust for headless Claude |
| Adapter args | Basic Codex/Claude args, resume support added | Missing full permission/tool mapping, structured-output file flow, image/file handling, MCP argument parity, advanced Claude controls |
| Stream parsing | Basic `run.progress` + final summary extraction | Missing normalized semantic events (tool_start/tool_result, thinking, usage, rate-limited, session-complete) |
| Capability handling | Version matrix and policy flag gating | Missing request-time capability adjustment layer with deterministic warnings |
| Security hardening | Workspace grants, optional flag allowlist, advanced-policy gate | Missing CLI allowlist wrapper/shims and shell prelude interception parity |
| MCP integration | Partial CLI-level flag support | Missing virtual MCP server lifecycle and handler bridge |
| Structured output | Minimal final artifact parsing | Missing schema validation pipeline and `structured_output_invalid` signaling |
| API and UX contract | Run-centric events (`run.*`, `session.*`) | Missing higher-level harness event envelope and tool/usage UX surfaces |

## 4. Recommended Strategy

Recommended path: **native Rust parity with direct logic lift from upstream TypeScript**, not a permanent Node sidecar.

Rationale:

1. This app is already Rust-centric for execution, policy, storage, and lifecycle.
2. Avoids dual-runtime operational complexity in production packaging.
3. Upstream TypeScript remains a strong executable spec for parity fixtures/tests.
4. Parser and arg-builder behavior can be ported nearly 1:1 and validated against fixtures.

## 5. Implementation Plan

## Phase 0: Baseline and Fixture Parity

1. Capture deterministic upstream fixtures for command-spec outputs, parser event sequences, and capability-adjustment warnings.
2. Store fixtures in this repo under `docs/harness-fixtures/` and `src-tauri/tests/fixtures/`.
3. Add a parity matrix document mapping each upstream feature to target file(s) in this repo.

Acceptance criteria:

1. Fixture set covers all capability groups in Section 2.
2. CI can run parser/arg parity checks against fixtures.

## Phase 1: Unified Harness Domain Model

1. Add new Rust harness domain modules: `src-tauri/src/harness/types.rs`, `src-tauri/src/harness/events.rs`, `src-tauri/src/harness/capabilities.rs`, and `src-tauri/src/harness/errors.rs`.
2. Extend `src-tauri/src/models.rs` to support harness request fields: tools, permissions, limits, structured output config, resume/continue controls, process env, cleanup paths, and attachment metadata.
3. Extend frontend types in `src/lib/types.ts` to support expanded harness event taxonomy.

Acceptance criteria:

1. New types serialize cleanly across Tauri IPC.
2. Existing run APIs remain backward compatible.

## Phase 2: Runner Hardening Parity

1. Implement a unified non-interactive execution path that does not depend on shell alias behavior for headless runs.
2. Port runner hardening primitives: spawn retry/backoff, line-buffer byte caps, line truncation diagnostics, no-output warning event, runner metrics event, and CLI/CWD missing detection.
3. Preserve existing scheduler, redaction, run/event persistence, and encrypted artifact behavior.

Acceptance criteria:

1. Claude and Codex non-interactive runs complete reliably under the same scenarios where current shell path can stall.
2. Every run emits deterministic start/exit/metrics diagnostics.

## Phase 3: Adapter Argument Parity

1. Port Codex argument parity in `src-tauri/src/adapters/codex.rs`; include sandbox/approval mapping, MCP config args, structured-output files, image temp-file flow, and resume controls.
2. Port Claude argument parity in `src-tauri/src/adapters/claude.rs`; include stream-json input generation, output-format strategy, partial message flags, model/fallback, budget/turn limits, system prompt/agent controls, MCP config wiring, and schema mode.

Acceptance criteria:

1. Command-spec fixture parity is green for both providers.
2. Policy audit and allowlist controls remain enforced.

## Phase 4: Parser Semantic Event Parity

1. Port Codex parser semantics to Rust; include text/thinking deltas/completes, tool start/result events, usage/session completion, and rate-limit normalization.
2. Port Claude parser semantics to Rust; include content-block tool lifecycle, text/thinking extraction, usage/cost/duration/session extraction, and rate-limit normalization.
3. Persist semantic events in DB while maintaining compatibility with existing `run.*` consumers.

Acceptance criteria:

1. Parser fixture parity is green.
2. UI renders single logical assistant responses without duplicate concatenation artifacts.

## Phase 5: Capability Adjustment Layer

1. Add a Rust request-adjustment layer equivalent to upstream `applyHarnessCapabilities`.
2. Drop unsupported request options deterministically and emit warning events with explicit reasons.
3. Integrate adjustment behavior with compatibility snapshots and policy engine.

Acceptance criteria:

1. Unsupported options no longer cause brittle run failures.
2. Warning messages are user-visible and actionable.

## Phase 6: Tooling Hardening Parity

1. Implement CLI allowlist runtime in Rust; include shim mode, wrapper mode, PATH prepend, and cleanup lifecycle.
2. Implement shell prelude injection in Rust with temp-file lifecycle (`BASH_ENV`/`ENV`).
3. Implement virtual MCP runtime in Rust; include local HTTP MCP server startup, provider config injection, and teardown.

Acceptance criteria:

1. When enabled, harness processes can resolve only explicitly allowlisted commands.
2. Virtual MCP handlers work for both Codex and Claude execution paths.

## Phase 7: Structured Output and Transcript Parity

1. Add structured-output resolver/validator in Rust (JSON parsing + schema validation).
2. Emit `structured_output` and `structured_output_invalid` events.
3. Add transcript collector utility aligned with semantic event stream.

Acceptance criteria:

1. Structured output validation failures are deterministic and diagnosable.
2. Final text and structured payload are both recoverable from run history.

## Phase 8: API and UI Integration

1. Extend Tauri commands and frontend client interfaces for harness semantic events.
2. Update reducers/state (`src/state/appState.tsx`) to consume expanded event taxonomy while keeping `run.*` compatibility.
3. Update chat/live UI to render tool activity, thinking stream, retry/rate-limit diagnostics, and clearer in-progress state.

Acceptance criteria:

1. Chat UX remains simple by default.
2. Advanced diagnostics are available in live/history views.

## Phase 9: Rollout and Cleanup

1. Introduce feature flag `harness_v2` for staged rollout.
2. Run side-by-side validation against current runner on sampled prompts and providers.
3. Remove obsolete code paths after parity soak and sign-off.
4. Update `docs/technical-spec.md` and release checklist docs.

Acceptance criteria:

1. No regression in completion rate, reliability, or perceived latency.
2. Legacy path removal happens only after parity and soak criteria pass.

## 6. Module Mapping (Source -> Target)

| Upstream harness module | Primary target in command-center |
| --- | --- |
| `core/types.ts`, `core/capabilities.ts`, `core/errors.ts` | `src-tauri/src/harness/types.rs`, `src-tauri/src/harness/capabilities.rs`, `src-tauri/src/harness/errors.rs`, `src/lib/types.ts` |
| `run-harness.ts` | `src-tauri/src/harness/orchestrator.rs` (new) + `src-tauri/src/runner.rs` integration |
| `runner/process-runner.ts`, `runner/line-buffer.ts`, `runner/cli-missing.ts` | `src-tauri/src/harness/process_runner.rs` (new) + shared usage from `src-tauri/src/runner.rs` |
| `adapters/codex/args.ts`, `adapters/claude/args.ts` | `src-tauri/src/adapters/codex.rs`, `src-tauri/src/adapters/claude.rs` |
| `adapters/codex/parser.ts`, `adapters/claude/parser.ts` | `src-tauri/src/adapters/codex_parser.rs`, `src-tauri/src/adapters/claude_parser.rs` (or merged into adapter files) |
| `utils/capabilities.ts` | `src-tauri/src/harness/capability_adjuster.rs` |
| `utils/cli-allowlist.ts` | `src-tauri/src/harness/cli_allowlist.rs` |
| `utils/virtual-mcp.ts` | `src-tauri/src/harness/virtual_mcp.rs` |
| `utils/shell-prelude.ts` | `src-tauri/src/harness/shell_prelude.rs` |
| `utils/structured-output.ts` | `src-tauri/src/harness/structured_output.rs` |
| `utils/transcript.ts` | `src-tauri/src/harness/transcript.rs` + frontend summarization helpers |

## 7. Test Plan

1. Unit tests for argument builders against upstream fixture cases.
2. Unit tests for parsers using captured JSONL lines from both CLIs.
3. Integration tests for timeout/cancel/retry, CLI/CWD missing behavior, no-output warnings, structured-output validation, and allowlist/virtual-MCP lifecycle.
4. End-to-end smoke tests in Tauri dev mode for Codex and Claude with session resume continuity checks.

## 8. Risks and Mitigations

1. Risk: CLI version drift breaks parser assumptions. Mitigation: maintain fixture updates and compatibility matrix version gates.
2. Risk: virtual MCP complexity in Rust. Mitigation: implement behind feature flag and start with a small validated tool set.
3. Risk: event model expansion destabilizes existing reducers. Mitigation: preserve `run.*` compatibility while incrementally enabling semantic events.
4. Risk: security regressions from broader tooling support. Mitigation: default-off advanced tooling, explicit policy gates, allowlist-first defaults.

## 9. Definition of Done

Integration is complete when:

1. All capability groups in Section 2 are implemented in this project.
2. Adapter command and parser fixture parity is fully green.
3. Codex and Claude non-interactive chat runs are stable, resumable, and observable.
4. Tooling hardening (allowlist, shell prelude, virtual MCP) is available behind policy controls.
5. Chat UX stays simple while diagnostics are available in history/live views.
