# Local CLI Command Center

A local-first desktop app that runs Codex and Claude headless CLIs through a policy-controlled runner with queueing, streaming output, run history, compatibility gates, and retention controls.

## Stack

- Frontend: React + TypeScript + Vite
- Desktop host: Tauri 2
- Runner core: Rust
- Persistence: SQLite (WAL)

## Implemented v1 Surface

- Non-interactive and interactive run workflows
- Run queue with priorities and per-provider concurrency limits
- Adapter-based command generation (`codex`, `claude`) with allowlisted flags
- Dual execution policy paths:
  - scoped shell-plugin aliases (`codex` / `claude`)
  - advanced-mode verified absolute binary paths
- Capability detection and compatibility snapshot tracking
- Per-run linkage to selected profile and capability snapshot metadata
- Workspace grant enforcement
- Redaction pipeline before persistence/event emission
- Streaming run events to UI (`run_event`)
- Run history, profiles, settings, queue, compatibility dashboard
- Export run artifacts (`md`, `json`, `txt`)
- Retention pruning and WAL checkpoint maintenance loop

## Project Layout

- `/src`: frontend application
- `/src-tauri/src`: Rust core (`runner`, `scheduler`, `policy`, `adapters`, `db`)
- `/src-tauri/src/db/schema.sql`: persistence schema and indexes
- `/docs`: technical and release docs

## Local Development

Prerequisites:

1. Node.js 20+
2. Rust toolchain 1.80+
3. Tauri system prerequisites for your OS

Commands:

```bash
npm install
npm run dev
npm run tauri:dev
```

Build:

```bash
npm run tauri:build
npm run tauri:build:no-bundle
```

## Test Commands

```bash
npm run test
npm run lint
```

Rust tests can be run with:

```bash
cd src-tauri
cargo test
```

## Security and Policy Defaults

- Only adapter-generated argument vectors are executed.
- Workspace path must be covered by an explicit workspace grant.
- Unknown or non-allowlisted flags are rejected.
- Advanced flags are blocked unless advanced mode is enabled.
- Output redaction is enabled by default and can be hardened further.

## Manual Update Workflow (v1)

Auto-updates are intentionally disabled in v1.

1. Check repository `version` fields.
2. Pull latest source.
3. Rebuild with `npm run tauri:build`.
4. Replace local install with latest artifact.
