# Kiingo Command Center

## Debugging

### Log files
Tauri app logs are stored at:
```
~/Library/Application Support/com.kiingo.localcli/logs/runner.log.<date>
```
Daily-rolling JSON files at `info` level. Use these to diagnose metric refresh failures, run errors, and scheduler issues.

### Database
SQLite database at:
```
~/Library/Application Support/com.kiingo.localcli/state.sqlite
```
Key tables: `runs`, `run_events`, `metric_definitions`, `metric_snapshots`, `screen_metrics`.

To inspect failed metric refreshes:
```sql
SELECT id, status, error_message, created_at FROM metric_snapshots ORDER BY created_at DESC LIMIT 10;
```

To see what a run actually output:
```sql
SELECT event_type, substr(payload_json, 1, 300) FROM run_events WHERE run_id = '<id>' ORDER BY seq DESC LIMIT 10;
```

### CLI output format
The Claude CLI outputs NDJSON to stdout. The final line is a result envelope:
```json
{"type":"result", "result":"<LLM text response>"}
```
The metric parser must unwrap this envelope before extracting `{ values, html }` JSON from the LLM's response text.
