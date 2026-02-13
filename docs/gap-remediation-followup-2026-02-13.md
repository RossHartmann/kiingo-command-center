# Gap Remediation Follow-up (2026-02-13)

This document captures the additional gaps found after the initial remediation pass and their implementation status.

## Gaps Closed

1. Dual execution-policy best-practice paths
- Implemented scoped shell alias execution (`codex` / `claude`) as the default path.
- Implemented advanced-mode verified absolute-path execution (non-interactive) with strict validation.

2. `profileId` runtime application
- Implemented profile lookup, provider-match enforcement, and deep merge into the run payload before policy/adapter validation.

3. Run metadata linkage
- Added per-run linkage fields for `profile_id` and `capability_snapshot_id`.

4. History filtering behavior
- Fixed server filter flow so returned filtered runs are displayed directly.

5. Structured-output rendering/parsing
- Improved adapter chunk/final parsing to capture JSON payloads where available.
- Improved live screen rendering for text vs structured payload display.

6. Queue/buffer/session hardening
- Added scheduler queue capacity limits.
- Added bounded in-memory stream/event buffers.
- Switched session input channels to bounded channels.
- Improved session resume replay by re-emitting replay chunk events.

7. Additional hardening and cleanup
- Added backend runtime bounds validation in policy engine for:
  - queue priority range
  - timeout range
  - max retries cap
  - retry backoff range
- Fixed profile merge semantics so omitted (`null`) payload fields no longer erase profile defaults.
- Removed dead-code warnings by trimming unused adapter trait methods and unused error variants.
- Expanded integration tests to verify fixture version reporting and expected non-interactive stream shapes.

## Validation

- `cargo check`: pass
- `cargo test`: pass
- `npm run lint`: pass
- `npm run test -- --run`: pass
- `npm run build`: pass
