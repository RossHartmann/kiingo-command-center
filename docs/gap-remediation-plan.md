# Gap Remediation Plan

Date: 2026-02-12

This document tracks all remaining implementation gaps against `local-cli-webapp-implementation-plan.md` and the concrete remediation work.

## Gap Inventory

1. Live stream events were not appended to in-memory run detail state in real time.
2. Command execution hardening did not provide argument-level runner validation and policy auditing at runtime.
3. Compatibility gating did not enforce supported modes/versions strongly enough for degraded installs.
4. Interactive mode was pipe-based only, with no PTY transcript lifecycle or resume workflow.
5. Cancellation lacked graceful terminate-then-kill sequencing and process-group cleanup strategy.
6. Scheduler lacked delayed scheduling, retry policy, and exponential backoff for retryable failures.
7. Run artifact persistence lacked encrypted raw artifact support and parsed summary persistence.
8. Export path safety needed strict filename sanitization and containment guarantees.
9. Automated tests were incomplete and failing; integration coverage did not test lifecycle semantics.
10. Missing plan features: `run.progress` event stream, history date filtering, keyring-backed secret storage path, and file-backed observability with rotation.

## Remediation Checklist

- [x] Real-time event append path in frontend state
- [x] Runtime command security hardening + policy audit events
- [x] Strict compatibility and mode gating
- [x] PTY interactive execution, transcript persistence, resume
- [x] Graceful cancel sequence and forced tree kill fallback
- [x] Scheduler support for scheduled start + retry/backoff
- [x] Artifact persistence (summary + optional encrypted raw)
- [x] Safe export naming/path containment
- [x] Restore and expand automated tests (unit/integration/UI)
- [x] Add progress events, date filters, keyring integration, rotating file logs

## Exit Criteria

All checklist items implemented, frontend tests passing, frontend build passing, Rust tests/check passing.

## Validation Results

- `cargo check`: pass
- `cargo test`: pass
- `npm run lint`: pass
- `npm run test`: pass
- `npm run build`: pass

## 2026-02-13 Follow-up Gap Closure

Additional gaps found during a fresh pass are now implemented:

1. Dual execution-policy paths are implemented end-to-end:
   - scoped shell-plugin alias execution (`codex` / `claude`)
   - advanced-mode verified absolute-path execution for non-interactive runs.
2. `profileId` is fully applied at runtime:
   - selected profile config is merged into run payload prior to policy/adapter validation.
3. Run metadata linkage is complete:
   - runs now persist `profile_id` and `capability_snapshot_id`.
4. History filtering now applies server query results directly instead of discarding them.
5. Structured-output handling improved:
   - adapter chunk/final parsing now captures JSON payloads where present,
   - live UI renders text vs structured payloads more intentionally.
6. Queue/session/output hardening added:
   - bounded scheduler queue capacity,
   - bounded in-memory stream/event buffers,
   - bounded session input channel and replay event emission on resume.

Follow-up validation:

- `cargo check`: pass
- `cargo test`: pass
- `npm run lint`: pass
- `npm run test -- --run`: pass
- `npm run build`: pass
