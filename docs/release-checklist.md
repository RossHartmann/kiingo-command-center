# Release Checklist (v1)

1. Confirm compatibility matrix entries are updated for tested CLI versions.
2. Run frontend checks:
   - `npm run lint`
   - `npm run test`
3. Run Rust checks:
   - `cd src-tauri && cargo test`
4. Validate policy controls:
   - ungranted workspace blocked
   - unknown flags blocked
   - advanced flags gated
5. Validate lifecycle:
   - queued -> running -> completed
   - cancellation
   - timeout failure
   - rerun
6. Validate interactive path:
   - session start
   - input accepted
   - session close
7. Validate export (`md`, `json`, `txt`) and history integrity.
8. Confirm retention pruning task runs and WAL checkpoint executes.
9. Build artifacts:
   - macOS `.dmg`
   - Windows `.exe` (NSIS)
10. Verify manual update instructions and version metadata.
