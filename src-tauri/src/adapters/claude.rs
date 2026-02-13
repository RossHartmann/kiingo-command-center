use super::{Adapter, CommandMeta, ValidatedCommand};
use crate::errors::{AppError, AppResult};
use crate::models::{CapabilityProfile, RunMode, StartRunPayload, UnifiedTool};
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Debug, Default, Clone)]
struct ClaudeToolState {
    tool: serde_json::Value,
    input_buffer: String,
}

#[derive(Debug, Default, Clone)]
struct ClaudeParserState {
    tools_by_index: BTreeMap<usize, ClaudeToolState>,
    tool_names_by_id: BTreeMap<String, (String, serde_json::Value)>,
    input_tokens: i64,
    output_tokens: i64,
    cached_tokens: i64,
    cost_usd: Option<f64>,
    duration_ms: Option<f64>,
    session_id: Option<String>,
    model: Option<String>,
    has_text: bool,
}

#[derive(Debug, Default)]
pub struct ClaudeAdapter {
    parser_states: Mutex<BTreeMap<String, ClaudeParserState>>,
}

impl Adapter for ClaudeAdapter {
    fn build_command(
        &self,
        payload: &StartRunPayload,
        capability: &CapabilityProfile,
        binary_path: &str,
    ) -> AppResult<ValidatedCommand> {
        if capability.blocked {
            return Err(AppError::Cli("Claude CLI is blocked by compatibility profile".to_string()));
        }

        let mut args = Vec::new();
        let mut meta = CommandMeta::default();
        let mut stdin: Option<String> = None;

        match payload.mode {
            RunMode::NonInteractive => {
                args.push("-p".to_string());
                let continue_session = payload
                    .harness
                    .as_ref()
                    .and_then(|harness| harness.continue_session)
                    .unwrap_or(false);
                if continue_session {
                    args.push("--continue".to_string());
                }
                if let Some(session_id) = resume_session_id(payload) {
                    args.push("--resume".to_string());
                    args.push(session_id.to_string());
                }
            }
            RunMode::Interactive => {
                // Interactive runs attach to the default claude TTY workflow.
            }
        }

        if let Some(model) = &payload.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        let use_stream_input = payload
            .harness
            .as_ref()
            .map(|harness| {
                harness.input_format.as_deref() == Some("stream-json")
                    || harness.piped_content.as_deref().map(|content| !content.trim().is_empty()).unwrap_or(false)
                    || harness.images.as_ref().map(|images| !images.is_empty()).unwrap_or(false)
            })
            .unwrap_or(false);

        let output_format = if use_stream_input {
            "stream-json"
        } else if payload
            .harness
            .as_ref()
            .and_then(|harness| harness.structured_output.as_ref())
            .is_some()
        {
            "json"
        } else {
            "stream-json"
        };

        if payload.mode == RunMode::NonInteractive {
            args.push("--output-format".to_string());
            args.push(output_format.to_string());
            if output_format == "stream-json" {
                args.push("--verbose".to_string());
                args.push("--include-partial-messages".to_string());
            }
        }

        if let Some(harness) = &payload.harness {
            if let Some(limits) = &harness.limits {
                if let Some(max_turns) = limits.max_turns {
                    args.push("--max-turns".to_string());
                    args.push(max_turns.to_string());
                }
                if let Some(max_budget_usd) = limits.max_budget_usd {
                    args.push("--max-budget-usd".to_string());
                    args.push(max_budget_usd.to_string());
                }
            }

            if let Some(system_prompt) = &harness.system_prompt {
                args.push("--system-prompt".to_string());
                args.push(system_prompt.clone());
            }
            if let Some(append_system_prompt) = &harness.append_system_prompt {
                args.push("--append-system-prompt".to_string());
                args.push(append_system_prompt.clone());
            }

            if let Some(tools) = &harness.tools {
                let mapped = to_claude_tools(tools);
                if !mapped.is_empty() {
                    args.push("--tools".to_string());
                    args.push(mapped.clone());
                    if let Some(permissions) = &harness.permissions {
                        args.push("--allowedTools".to_string());
                        args.push(mapped);
                        if permissions.auto_approve {
                            args.push("--permission-mode".to_string());
                            args.push("bypassPermissions".to_string());
                        }
                    }
                }
            } else if let Some(permissions) = &harness.permissions {
                if permissions.auto_approve {
                    args.push("--permission-mode".to_string());
                    args.push("bypassPermissions".to_string());
                }
            }

            if use_stream_input {
                args.push("--input-format".to_string());
                args.push("stream-json".to_string());
                stdin = build_stream_json_input(payload);
            }

            if let Some(mcp) = &harness.mcp {
                let mut servers = serde_json::Map::new();
                for server in &mcp.servers {
                    let mut value = serde_json::Map::new();
                    if let Some(command) = &server.command {
                        value.insert("command".to_string(), serde_json::Value::String(command.clone()));
                    }
                    if let Some(args) = &server.args {
                        value.insert("args".to_string(), serde_json::json!(args));
                    }
                    if let Some(env) = &server.env {
                        value.insert("env".to_string(), serde_json::json!(env));
                    }
                    if let Some(url) = &server.url {
                        value.insert("url".to_string(), serde_json::Value::String(url.clone()));
                    }
                    if let Some(headers) = &server.headers {
                        value.insert("headers".to_string(), serde_json::json!(headers));
                    }
                    if let Some(transport) = &server.r#type {
                        value.insert("type".to_string(), serde_json::Value::String(transport.clone()));
                    }
                    servers.insert(server.name.clone(), serde_json::Value::Object(value));
                }
                args.push("--mcp-config".to_string());
                args.push(
                    serde_json::to_string_pretty(&serde_json::json!({ "mcpServers": servers }))
                        .map_err(|error| AppError::Cli(error.to_string()))?,
                );
            }

            if let Some(structured_output) = &harness.structured_output {
                if !use_stream_input {
                    let schema_path =
                        std::env::temp_dir().join(format!("claude-schema-{}.json", uuid::Uuid::new_v4()));
                    std::fs::write(
                        &schema_path,
                        serde_json::to_vec_pretty(&structured_output.schema)
                            .map_err(|error| AppError::Cli(error.to_string()))?,
                    )
                    .map_err(|error| AppError::Io(error.to_string()))?;
                    args.push("--json-schema".to_string());
                    args.push(schema_path.to_string_lossy().to_string());
                    meta.cleanup_paths.push(schema_path.to_string_lossy().to_string());
                }
                meta.structured_output_schema = Some(structured_output.schema.clone());
                meta.structured_output_strict = structured_output.strict.unwrap_or(false);
            }
        }

        for (key, value) in &payload.optional_flags {
            if is_internal_optional_flag(key) {
                continue;
            }
            match value {
                serde_json::Value::Bool(true) => args.push(format!("--{}", key)),
                serde_json::Value::Bool(false) => {}
                serde_json::Value::Number(number) => {
                    args.push(format!("--{}", key));
                    args.push(number.to_string());
                }
                serde_json::Value::String(string) => {
                    args.push(format!("--{}", key));
                    args.push(string.clone());
                }
                serde_json::Value::Array(array) => {
                    args.push(format!("--{}", key));
                    args.push(
                        serde_json::to_string(array)
                            .map_err(|error| AppError::Cli(error.to_string()))?,
                    );
                }
                serde_json::Value::Object(object) => {
                    args.push(format!("--{}", key));
                    args.push(
                        serde_json::to_string(object)
                            .map_err(|error| AppError::Cli(error.to_string()))?,
                    );
                }
                _ => {
                    return Err(AppError::Cli(format!(
                        "Unsupported claude flag value type for '{}'.",
                        key
                    )));
                }
            }
        }

        let mut env = BTreeMap::new();
        if payload.mode == RunMode::NonInteractive {
            env.insert("CLAUDE_NON_INTERACTIVE".to_string(), "1".to_string());
        }

        if !use_stream_input && payload.mode == RunMode::NonInteractive {
            args.push(payload.prompt.clone());
        }

        Ok(ValidatedCommand {
            program: binary_path.to_string(),
            args,
            cwd: payload.cwd.clone(),
            env,
            stdin,
            meta,
        })
    }

    fn parse_chunk(&self, _stream: &str, raw_chunk: &str) -> Option<serde_json::Value> {
        if let Some(structured) = parse_first_json(raw_chunk) {
            let stage = structured
                .get("type")
                .or_else(|| structured.get("event"))
                .and_then(|value| value.as_str())
                .unwrap_or("json_event");
            return Some(serde_json::json!({
                "provider": "claude",
                "stage": stage,
                "structured": structured
            }));
        }

        if raw_chunk.contains("\"type\"") && raw_chunk.contains("progress") {
            return Some(serde_json::json!({
                "provider": "claude",
                "stage": "progress",
                "message": raw_chunk
            }));
        }

        None
    }

    fn parse_semantic_events(
        &self,
        run_id: &str,
        _stream: &str,
        raw_chunk: &str,
    ) -> Vec<serde_json::Value> {
        let mut guard = self
            .parser_states
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let state = guard.entry(run_id.to_string()).or_default();
        let mut events = Vec::new();

        for line in raw_chunk.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.starts_with('{') {
                continue;
            }
            let Some(mut parsed) = serde_json::from_str::<serde_json::Value>(trimmed).ok() else {
                continue;
            };
            if parsed
                .get("type")
                .and_then(|value| value.as_str())
                .map(|value| value == "stream_event")
                .unwrap_or(false)
            {
                if let Some(event) = parsed.get("event").cloned() {
                    if event.is_object() {
                        parsed = event;
                    }
                }
            }
            let Some(parsed_obj) = parsed.as_object() else {
                continue;
            };
            let event_type = parsed_obj
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or_default();

            if event_type == "assistant" {
                if let Some(message) = parsed_obj.get("message").and_then(|value| value.as_object()) {
                    if let Some(model) = message.get("model").and_then(|value| value.as_str()) {
                        state.model = Some(model.to_string());
                    }
                    let (text, thinking) = extract_message_text(message);
                    if !text.is_empty() {
                        events.push(serde_json::json!({
                            "type": "text_complete",
                            "text": text
                        }));
                        state.has_text = true;
                    }
                    if !thinking.is_empty() {
                        events.push(serde_json::json!({
                            "type": "thinking_complete",
                            "text": thinking
                        }));
                    }
                }
                continue;
            }

            if event_type == "user" {
                if let Some(message) = parsed_obj.get("message").and_then(|value| value.as_object()) {
                    if let Some(content) = message.get("content").and_then(|value| value.as_array()) {
                        for part in content {
                            let Some(part_obj) = part.as_object() else {
                                continue;
                            };
                            if part_obj.get("type").and_then(|value| value.as_str()) != Some("tool_result") {
                                continue;
                            }
                            let tool_use_id = part_obj
                                .get("tool_use_id")
                                .and_then(|value| value.as_str())
                                .or_else(|| part_obj.get("id").and_then(|value| value.as_str()));
                            let Some(tool_use_id) = tool_use_id else {
                                continue;
                            };
                            let tool_meta = state.tool_names_by_id.remove(tool_use_id);
                            let tool_name = tool_meta
                                .as_ref()
                                .map(|(name, _)| name.clone())
                                .or_else(|| {
                                    part_obj
                                        .get("name")
                                        .and_then(|value| value.as_str())
                                        .map(ToString::to_string)
                                })
                                .unwrap_or_else(|| "ToolResult".to_string());
                            let tool_input = tool_meta
                                .as_ref()
                                .map(|(_, input)| input.clone())
                                .unwrap_or_else(|| serde_json::json!({}));
                            events.push(serde_json::json!({
                                "type": "tool_result",
                                "tool": {
                                    "id": tool_use_id,
                                    "name": tool_name,
                                    "input": tool_input
                                },
                                "result": extract_tool_result_text(part_obj)
                            }));
                        }
                    }
                }
            }

            if event_type == "message_start" {
                if let Some(message) = parsed_obj.get("message").and_then(|value| value.as_object()) {
                    if let Some(usage) = message.get("usage").and_then(|value| value.as_object()) {
                        if let Some(input_tokens) = usage.get("input_tokens").and_then(|value| value.as_i64()) {
                            state.input_tokens = input_tokens;
                        }
                    }
                    if let Some(model) = message.get("model").and_then(|value| value.as_str()) {
                        state.model = Some(model.to_string());
                    }
                }
            }

            if event_type == "message_delta" {
                if let Some(usage) = parsed_obj.get("usage").and_then(|value| value.as_object()) {
                    if let Some(output_tokens) = usage.get("output_tokens").and_then(|value| value.as_i64()) {
                        state.output_tokens = output_tokens;
                    }
                    if let Some(cached_tokens) = usage
                        .get("cache_read_input_tokens")
                        .and_then(|value| value.as_i64())
                    {
                        state.cached_tokens = cached_tokens;
                    }
                }
            }

            if event_type == "content_block_start" {
                let index = parsed_obj
                    .get("index")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as usize;
                if let Some(block) = parsed_obj
                    .get("content_block")
                    .and_then(|value| value.as_object())
                {
                    let block_type = block.get("type").and_then(|value| value.as_str()).unwrap_or_default();
                    if block_type == "tool_use" {
                        let tool_id = block.get("id").cloned().unwrap_or_else(|| serde_json::json!(format!("tool_{}", index)));
                        let tool_name = block
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or("Tool")
                            .to_string();
                        state.tools_by_index.insert(
                            index,
                            ClaudeToolState {
                                tool: serde_json::json!({
                                    "id": tool_id,
                                    "name": tool_name,
                                    "input": serde_json::json!({})
                                }),
                                input_buffer: String::new(),
                            },
                        );
                    } else if block_type == "tool_result" {
                        let tool_id = block
                            .get("tool_use_id")
                            .and_then(|value| value.as_str())
                            .or_else(|| block.get("id").and_then(|value| value.as_str()))
                            .map(ToString::to_string)
                            .unwrap_or_else(|| format!("tool_{}", index));
                        events.push(serde_json::json!({
                            "type": "tool_result",
                            "tool": {
                                "id": tool_id,
                                "name": block.get("name").and_then(|value| value.as_str()).unwrap_or("ToolResult"),
                                "input": block.get("input").cloned().unwrap_or_else(|| serde_json::json!({}))
                            },
                            "result": block.get("content").and_then(|value| value.as_str()).unwrap_or_default()
                        }));
                    }
                }
            }

            if event_type == "content_block_delta" {
                let index = parsed_obj
                    .get("index")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as usize;
                if let Some(delta) = parsed_obj.get("delta").and_then(|value| value.as_object()) {
                    let delta_type = delta.get("type").and_then(|value| value.as_str()).unwrap_or_default();
                    if delta_type == "text_delta" {
                        let text = delta.get("text").and_then(|value| value.as_str()).unwrap_or_default();
                        events.push(serde_json::json!({
                            "type": "text_delta",
                            "text": text
                        }));
                        if !text.is_empty() {
                            state.has_text = true;
                        }
                    } else if delta_type == "thinking_delta" {
                        events.push(serde_json::json!({
                            "type": "thinking_delta",
                            "text": delta.get("text").and_then(|value| value.as_str()).unwrap_or_default()
                        }));
                    } else if delta_type == "input_json_delta" {
                        if let Some(tool_state) = state.tools_by_index.get_mut(&index) {
                            let partial = delta
                                .get("partial_json")
                                .and_then(|value| value.as_str())
                                .unwrap_or_default();
                            tool_state.input_buffer.push_str(partial);
                        }
                    }
                }
            }

            if event_type == "content_block_stop" {
                let index = parsed_obj
                    .get("index")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as usize;
                if let Some(mut tool_state) = state.tools_by_index.remove(&index) {
                    let input = if tool_state.input_buffer.trim().is_empty() {
                        serde_json::json!({})
                    } else {
                        serde_json::from_str::<serde_json::Value>(&tool_state.input_buffer)
                            .unwrap_or_else(|_| serde_json::json!({ "raw": tool_state.input_buffer }))
                    };
                    if let Some(tool_obj) = tool_state.tool.as_object_mut() {
                        tool_obj.insert("input".to_string(), input.clone());
                        let tool_id = tool_obj
                            .get("id")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string();
                        let tool_name = tool_obj
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or("Tool")
                            .to_string();
                        state
                            .tool_names_by_id
                            .insert(tool_id.clone(), (tool_name, input));
                    }
                    events.push(serde_json::json!({
                        "type": "tool_start",
                        "tool": tool_state.tool
                    }));
                }
            }

            if event_type == "result" {
                if !state.has_text {
                    if let Some(result) = parsed_obj.get("result").and_then(|value| value.as_str()) {
                        if !result.trim().is_empty() {
                            events.push(serde_json::json!({
                                "type": "text_complete",
                                "text": result
                            }));
                            state.has_text = true;
                        }
                    }
                }
                if let Some(session_id) = parsed_obj.get("session_id").and_then(|value| value.as_str()) {
                    state.session_id = Some(session_id.to_string());
                }
                if let Some(model) = parsed_obj.get("model").and_then(|value| value.as_str()) {
                    state.model = Some(model.to_string());
                }
                if let Some(usage) = parsed_obj.get("usage").and_then(|value| value.as_object()) {
                    if let Some(input_tokens) = usage.get("input_tokens").and_then(|value| value.as_i64()) {
                        state.input_tokens = input_tokens;
                    }
                    if let Some(output_tokens) = usage.get("output_tokens").and_then(|value| value.as_i64()) {
                        state.output_tokens = output_tokens;
                    }
                    if let Some(cached_tokens) = usage
                        .get("cache_read_input_tokens")
                        .and_then(|value| value.as_i64())
                    {
                        state.cached_tokens = cached_tokens;
                    }
                }
                if let Some(cost) = parsed_obj.get("total_cost_usd").and_then(|value| value.as_f64()) {
                    state.cost_usd = Some(cost);
                }
                if let Some(cost) = parsed_obj.get("cost_usd").and_then(|value| value.as_f64()) {
                    state.cost_usd = Some(cost);
                }
                if let Some(duration_ms) = parsed_obj.get("duration_ms").and_then(|value| value.as_f64()) {
                    state.duration_ms = Some(duration_ms);
                } else if state.duration_ms.is_none() {
                    if let Some(duration_ms) = parsed_obj
                        .get("duration_api_ms")
                        .and_then(|value| value.as_f64())
                    {
                        state.duration_ms = Some(duration_ms);
                    }
                }

                let usage = serde_json::json!({
                    "inputTokens": state.input_tokens,
                    "outputTokens": state.output_tokens,
                    "cachedTokens": state.cached_tokens,
                    "costUsd": state.cost_usd,
                    "durationMs": state.duration_ms
                });
                events.push(serde_json::json!({
                    "type": "turn_complete",
                    "usage": usage,
                    "model": state.model
                }));
                if let Some(session_id) = &state.session_id {
                    events.push(serde_json::json!({
                        "type": "session_complete",
                        "sessionId": session_id,
                        "usage": usage,
                        "model": state.model
                    }));
                }
                continue;
            }

            if event_type == "error" {
                let message = parsed_obj
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Unknown error");
                let lower = message.to_ascii_lowercase();
                if lower.contains("rate limit")
                    || lower.contains("too many requests")
                    || lower.contains("overloaded")
                {
                    events.push(serde_json::json!({
                        "type": "rate_limited",
                        "retryAfterMs": parsed_obj
                            .get("retry_after_ms")
                            .cloned()
                            .or_else(|| parsed_obj.get("retry_after").cloned())
                    }));
                } else {
                    events.push(serde_json::json!({
                        "type": "error",
                        "message": message,
                        "detail": parsed
                    }));
                }
            }
        }

        events
    }

    fn clear_semantic_state(&self, run_id: &str) {
        if let Ok(mut guard) = self.parser_states.lock() {
            guard.remove(run_id);
        }
    }

    fn parse_final(&self, exit_code: Option<i32>, buffered_output: &str) -> serde_json::Value {
        let summary = extract_claude_result_text(buffered_output).unwrap_or_else(|| {
            buffered_output
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .unwrap_or_default()
                .to_string()
        });
        let structured = parse_last_json(buffered_output);
        serde_json::json!({
            "provider": "claude",
            "exitCode": exit_code,
            "summary": summary,
            "structured": structured
        })
    }
}

fn is_internal_optional_flag(key: &str) -> bool {
    key.starts_with("__")
}

fn extract_message_text(message: &serde_json::Map<String, serde_json::Value>) -> (String, String) {
    let mut text = String::new();
    let mut thinking = String::new();
    let content = message
        .get("content")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    for part in content {
        let Some(part_obj) = part.as_object() else {
            continue;
        };
        let part_type = part_obj.get("type").and_then(|value| value.as_str()).unwrap_or_default();
        let part_text = part_obj.get("text").and_then(|value| value.as_str()).unwrap_or_default();
        if part_type == "text" {
            text.push_str(part_text);
        } else if part_type == "thinking" {
            thinking.push_str(part_text);
        }
    }

    (text, thinking)
}

fn extract_tool_result_text(part: &serde_json::Map<String, serde_json::Value>) -> String {
    if let Some(content) = part.get("content") {
        if let Some(text) = content.as_str() {
            return text.to_string();
        }
        if let Some(items) = content.as_array() {
            let joined = items
                .iter()
                .filter_map(|item| item.as_object())
                .filter_map(|item| item.get("text"))
                .filter_map(|value| value.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            if !joined.is_empty() {
                return joined;
            }
        }
    }
    String::new()
}

fn resume_session_id(payload: &StartRunPayload) -> Option<&str> {
    if let Some(session_id) = payload
        .harness
        .as_ref()
        .and_then(|harness| harness.resume_session_id.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(session_id);
    }
    payload
        .optional_flags
        .get("__resume_session_id")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn extract_claude_result_text(raw: &str) -> Option<String> {
    let mut result_text: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        let Some(parsed) = serde_json::from_str::<serde_json::Value>(trimmed).ok() else {
            continue;
        };
        let event_type = parsed.get("type").and_then(|value| value.as_str());
        if event_type == Some("result") {
            if let Some(text) = parsed.get("result").and_then(|value| value.as_str()) {
                let cleaned = text.trim();
                if !cleaned.is_empty() {
                    result_text = Some(cleaned.to_string());
                }
            }
        }
    }
    result_text
}

fn parse_first_json(raw: &str) -> Option<serde_json::Value> {
    raw.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            serde_json::from_str::<serde_json::Value>(trimmed).ok()
        } else {
            None
        }
    })
}

fn parse_last_json(raw: &str) -> Option<serde_json::Value> {
    raw.lines().rev().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            serde_json::from_str::<serde_json::Value>(trimmed).ok()
        } else {
            None
        }
    })
}

fn to_claude_tools(tools: &[UnifiedTool]) -> String {
    let mapped = tools
        .iter()
        .map(|tool| match tool {
            UnifiedTool::FileRead => "Read",
            UnifiedTool::FileWrite => "Write",
            UnifiedTool::FileEdit => "Edit",
            UnifiedTool::FileSearch => "Glob",
            UnifiedTool::ContentSearch => "Grep",
            UnifiedTool::Shell => "Bash",
            UnifiedTool::WebFetch => "WebFetch",
            UnifiedTool::WebSearch => "WebSearch",
            UnifiedTool::Mcp => "mcp",
            UnifiedTool::Task => "Task",
        })
        .collect::<Vec<_>>();
    let dedup = {
        let mut set = std::collections::BTreeSet::new();
        let mut out = Vec::new();
        for item in mapped {
            if set.insert(item) {
                out.push(item);
            }
        }
        out
    };
    dedup.join(",")
}

fn build_stream_json_input(payload: &StartRunPayload) -> Option<String> {
    let harness = payload.harness.as_ref()?;
    let mut content = Vec::<serde_json::Value>::new();
    let mut text_parts = Vec::new();
    text_parts.push(payload.prompt.clone());
    if let Some(piped_content) = &harness.piped_content {
        if !piped_content.trim().is_empty() {
            text_parts.push(piped_content.clone());
        }
    }
    let text = text_parts.join("\n\n");
    if !text.trim().is_empty() {
        content.push(serde_json::json!({
            "type": "text",
            "text": text
        }));
    }

    if let Some(images) = &harness.images {
        for image in images {
            let data = if let Some(index) = image.data_url.find("base64,") {
                image.data_url[index + 7..].to_string()
            } else {
                image.data_url.clone()
            };
            content.push(serde_json::json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.mime_type,
                    "data": data
                }
            }));
        }
    }

    if content.is_empty() {
        return None;
    }

    Some(format!(
        "{}\n",
        serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": content
            }
        })
    ))
}

#[cfg(test)]
mod tests {
    use super::{extract_claude_result_text, resume_session_id, ClaudeAdapter};
    use crate::adapters::Adapter;
    use crate::models::{
        CapabilityProfile, HarnessRequestOptions, Provider, RunMode, StartRunPayload, UnifiedPermission, UnifiedTool,
    };
    use std::collections::BTreeMap;

    fn base_payload() -> StartRunPayload {
        StartRunPayload {
            provider: Provider::Claude,
            prompt: "hello".to_string(),
            model: Some("sonnet".to_string()),
            mode: RunMode::NonInteractive,
            output_format: Some("text".to_string()),
            cwd: "/tmp".to_string(),
            optional_flags: BTreeMap::new(),
            profile_id: None,
            queue_priority: None,
            timeout_seconds: None,
            scheduled_at: None,
            max_retries: None,
            retry_backoff_ms: None,
            harness: None,
        }
    }

    fn capability() -> CapabilityProfile {
        CapabilityProfile {
            provider: Provider::Claude,
            cli_version: "2.1.41".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec![
                "--output-format".to_string(),
                "--model".to_string(),
                "--resume".to_string(),
                "--verbose".to_string(),
            ],
            supported_modes: vec![RunMode::NonInteractive, RunMode::Interactive],
            disabled_reasons: vec![],
        }
    }

    #[test]
    fn builds_resume_command_with_stream_json_flags() {
        let adapter = ClaudeAdapter::default();
        let mut payload = base_payload();
        payload
            .optional_flags
            .insert("__resume_session_id".to_string(), serde_json::json!("session-abc"));

        let built = adapter
            .build_command(&payload, &capability(), "claude")
            .expect("build command");
        assert!(built.args.contains(&"--resume".to_string()));
        assert!(built.args.contains(&"session-abc".to_string()));
        assert!(built.args.contains(&"--output-format".to_string()));
        assert!(built.args.contains(&"stream-json".to_string()));
        assert!(built.args.contains(&"--verbose".to_string()));
    }

    #[test]
    fn parses_result_text_from_stream_json() {
        let raw = r#"{"type":"system","subtype":"init","session_id":"abc"}
{"type":"assistant","message":{"content":[{"type":"text","text":"intermediate"}]}}
{"type":"result","result":"final answer","session_id":"abc"}"#;
        assert_eq!(
            extract_claude_result_text(raw).as_deref(),
            Some("final answer")
        );
    }

    #[test]
    fn reads_internal_resume_id() {
        let mut payload = base_payload();
        payload
            .optional_flags
            .insert("__resume_session_id".to_string(), serde_json::json!("  123  "));
        assert_eq!(resume_session_id(&payload), Some("123"));
    }

    #[test]
    fn prefers_harness_resume_session_id_over_internal_flag() {
        let mut payload = base_payload();
        payload.optional_flags.insert(
            "__resume_session_id".to_string(),
            serde_json::json!("legacy-id"),
        );
        payload.harness = Some(HarnessRequestOptions {
            resume_session_id: Some("harness-id".to_string()),
            ..Default::default()
        });
        assert_eq!(resume_session_id(&payload), Some("harness-id"));
    }

    #[test]
    fn builds_stream_json_stdin_with_harness_tools_and_permissions() {
        let adapter = ClaudeAdapter::default();
        let mut payload = base_payload();
        payload.harness = Some(HarnessRequestOptions {
            input_format: Some("stream-json".to_string()),
            tools: Some(vec![UnifiedTool::Shell, UnifiedTool::FileRead]),
            permissions: Some(UnifiedPermission {
                sandbox_mode: crate::models::SandboxMode::ReadOnly,
                auto_approve: true,
                network_access: false,
                approval_policy: None,
            }),
            piped_content: Some("extra context".to_string()),
            ..Default::default()
        });

        let built = adapter
            .build_command(&payload, &capability(), "claude")
            .expect("build command");
        assert!(built.args.contains(&"--input-format".to_string()));
        assert!(built.args.contains(&"stream-json".to_string()));
        assert!(built.args.contains(&"--tools".to_string()));
        assert!(built.args.contains(&"--allowedTools".to_string()));
        assert!(built.args.contains(&"--permission-mode".to_string()));
        assert!(built.stdin.is_some());
    }

    #[test]
    fn dedupes_result_text_after_assistant_message() {
        let adapter = ClaudeAdapter::default();
        let assistant_events = adapter.parse_semantic_events(
            "run-claude-1",
            "stdout",
            r#"{"type":"assistant","message":{"model":"sonnet","content":[{"type":"text","text":"hello"}]}}"#,
        );
        assert_eq!(
            assistant_events
                .iter()
                .filter(|event| event.get("type").and_then(|value| value.as_str()) == Some("text_complete"))
                .count(),
            1
        );

        let result_events = adapter.parse_semantic_events(
            "run-claude-1",
            "stdout",
            r#"{"type":"result","result":"hello","session_id":"session-1","usage":{"input_tokens":1,"output_tokens":2}}"#,
        );
        assert_eq!(
            result_events
                .iter()
                .filter(|event| event.get("type").and_then(|value| value.as_str()) == Some("text_complete"))
                .count(),
            0
        );
        assert!(result_events.iter().any(|event| {
            event.get("type").and_then(|value| value.as_str()) == Some("turn_complete")
        }));
    }

    #[test]
    fn parses_tool_start_and_result_from_stream_blocks() {
        let adapter = ClaudeAdapter::default();
        let _ = adapter.parse_semantic_events(
            "run-claude-2",
            "stdout",
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"Read"}}"#,
        );
        let _ = adapter.parse_semantic_events(
            "run-claude-2",
            "stdout",
            r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"README.md\"}"}}"#,
        );
        let tool_start = adapter.parse_semantic_events(
            "run-claude-2",
            "stdout",
            r#"{"type":"content_block_stop","index":0}"#,
        );
        assert!(tool_start.iter().any(|event| {
            event.get("type").and_then(|value| value.as_str()) == Some("tool_start")
        }));

        let tool_result = adapter.parse_semantic_events(
            "run-claude-2",
            "stdout",
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"ok"}]}}"#,
        );
        assert!(tool_result.iter().any(|event| {
            event.get("type").and_then(|value| value.as_str()) == Some("tool_result")
        }));
    }
}
