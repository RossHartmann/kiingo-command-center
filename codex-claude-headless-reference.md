# Codex + Claude Code Headless CLI Reference

Last updated: 2026-02-12  
Research environment: `/Users/rosshartmann/Projects/kiingo-command-center`

## Scope

This document captures all findings from a focused CLI research pass on:

- OpenAI Codex CLI (local: `codex-cli 0.92.0`)
- Anthropic Claude Code CLI (local: `2.1.39`)

Goal: document how to run both tools headlessly and catalog their flags/parameters for later automation use.

## Versions Observed

- `codex --version` => `codex-cli 0.92.0`
- `claude --version` => `2.1.39 (Claude Code)`
- `npm view @openai/codex version` => `0.100.0` (newer than local codex)
- `npm view @anthropic-ai/claude-code version` => `2.1.39` (matches local)

## Headless Entry Points

## Codex

Primary headless commands:

- `codex exec [PROMPT]`
- `codex review [PROMPT]`
- `codex exec review [PROMPT]`
- `codex cloud exec --env <ENV_ID> [QUERY]` (cloud task submission, non-TUI)

Examples:

```bash
codex exec "Summarize this repository"
echo "Generate tests for module X" | codex exec -
codex exec --json --output-schema schema.json "Return structured output"
codex review --base main
codex exec review --uncommitted
```

## Claude Code

Primary headless mode:

- `claude -p ...` / `claude --print ...`

Examples:

```bash
claude -p "Summarize this repository"
echo "Generate tests for module X" | claude -p
claude -p --output-format json "Return JSON only"
claude -p --input-format stream-json --output-format stream-json
```

## Codex Flag Inventory

Deduped from all inspected `codex ... --help` pages:

`--add-dir`, `--all`, `--analytics-default-enabled`, `--ask-for-approval`, `--attempt`, `--attempts`, `--base`, `--bearer-token-env-var`, `--branch`, `--cd`, `--color`, `--commit`, `--config`, `--cursor`, `--dangerously-bypass-approvals-and-sandbox`, `--device-auth`, `--disable`, `--enable`, `--env`, `--full-auto`, `--help`, `--image`, `--json`, `--last`, `--limit`, `--local-provider`, `--log-denials`, `--model`, `--no-alt-screen`, `--oss`, `--out`, `--output-last-message`, `--output-schema`, `--prettier`, `--profile`, `--sandbox`, `--scopes`, `--search`, `--skip-git-repo-check`, `--title`, `--uncommitted`, `--url`, `--version`, `--with-api-key`.

### Codex headless-critical flags

- `--json` (JSONL events)
- `--output-schema <FILE>`
- `--output-last-message <FILE>`
- `--skip-git-repo-check`
- `--color <always|never|auto>`
- `--sandbox <read-only|workspace-write|danger-full-access>`
- `--full-auto`
- `--dangerously-bypass-approvals-and-sandbox`

### Codex command coverage checked

- Top level: `codex --help`
- Non-interactive: `codex exec --help`, `codex review --help`
- Resume/fork paths: `codex exec resume --help`, `codex resume --help`, `codex fork --help`
- MCP: `codex mcp --help` + all subcommands (`list|get|add|remove|login|logout`)
- MCP server: `codex mcp-server --help`
- Cloud: `codex cloud --help` + all subcommands (`exec|status|list|apply|diff`)
- Sandbox: `codex sandbox --help` + OS subcommands (`macos|linux|windows`)
- App server: `codex app-server --help` + generators
- Other: `codex login`, `codex login status`, `codex logout`, `codex apply`, `codex completion`, `codex features`

## Claude Code Flag Inventory

Deduped from all inspected `claude ... --help` pages:

`--add-dir`, `--agent`, `--agents`, `--all`, `--allow-dangerously-skip-permissions`, `--allowed-tools`, `--allowedTools`, `--append-system-prompt`, `--available`, `--betas`, `--callback-port`, `--chrome`, `--client-id`, `--client-secret`, `--continue`, `--dangerously-skip-permissions`, `--debug`, `--debug-file`, `--disable-slash-commands`, `--disallowed-tools`, `--disallowedTools`, `--effort`, `--env`, `--fallback-model`, `--file`, `--force`, `--fork-session`, `--from-pr`, `--header`, `--help`, `--ide`, `--include-partial-messages`, `--input-format`, `--json`, `--json-schema`, `--max-budget-usd`, `--mcp-config`, `--mcp-debug`, `--model`, `--no-chrome`, `--no-session-persistence`, `--output-format`, `--permission-mode`, `--plugin-dir`, `--print`, `--replay-user-messages`, `--resume`, `--scope`, `--session-id`, `--setting-sources`, `--settings`, `--strict-mcp-config`, `--system-prompt`, `--tools`, `--transport`, `--verbose`, `--version`.

### Claude headless-critical flags

- `-p`, `--print`
- `--output-format <text|json|stream-json>`
- `--input-format <text|stream-json>`
- `--json-schema <schema>`
- `--max-budget-usd <amount>`
- `--fallback-model <model>` (print mode only)
- `--no-session-persistence` (print mode only)
- `--include-partial-messages` (stream-json output)
- `--replay-user-messages` (stream-json input+output)

### Claude command coverage checked

- Top level: `claude --help`
- Utility: `doctor`, `install`, `update|upgrade`, `setup-token`
- MCP: `claude mcp --help` + subcommands (`add`, `add-json`, `add-from-claude-desktop`, `get`, `list`, `remove`, `serve`, `reset-project-choices`)
- Plugin: `claude plugin --help` + subcommands (`disable`, `enable`, `install`, `list`, `marketplace` + marketplace subcommands, `uninstall`, `update`, `validate`)

## Compatibility / Behavioral Findings

## Codex

- `--yolo` is accepted by local codex, though it is not shown in `--help`; behavior maps to approval bypass flow.
- `--ephemeral` is rejected in local `0.92.0` (`unexpected argument '--ephemeral'`).
- Error hint suggests `--experimental-json` exists in local codex.
- `codex exec --help` in local output does **not** show `--ask-for-approval`, while top-level help does; behavior may differ by command parser path/version.

## Claude Code

- Unknown flags can be hidden when combined with `--help`/`--version` (not reliable for validation).
- Unknown flags in real invocation (`-p`) fail as expected.
- `--cwd` appears in some docs/discussions but is rejected by local `2.1.39` (`unknown option '--cwd'`).
- Additional accepted flags not listed in top-level `--help` (validated by parser behavior):  
  `--append-system-prompt-file`, `--system-prompt-file`, `--permission-prompt-tool`, `--max-turns`, `--init-only`, `--maintenance`, `--remote`, `--teleport`, `--teammate-mode`.

## Data Collection Notes

- Flag inventories were pulled from live CLI `--help` output and deduped.
- The token `--some-flag` appeared only in a help example string and was excluded from the final inventory above.
- Network restrictions prevented full online validation of the newest codex package runtime behavior in this environment.
- Some runtime probes failed due sandbox/permission limits writing under home tool state directories, but help-level inspection and parser checks succeeded.

## Sources

- Codex docs: <https://developers.openai.com/codex/cli>
- Codex repository: <https://github.com/openai/codex>
- Claude Code CLI reference: <https://docs.anthropic.com/en/docs/claude-code/cli-reference>
- Claude Code SDK/headless docs: <https://docs.anthropic.com/en/docs/claude-code/sdk>

