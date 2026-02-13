use super::{Adapter, CommandMeta, ValidatedCommand};
use crate::errors::{AppError, AppResult};
use crate::models::{
    CapabilityProfile, RunMode, SandboxMode, StartRunPayload, UnifiedTool,
};
use base64::Engine;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;

#[derive(Debug, Default, Clone)]
struct CodexItemRecord {
    item_type: String,
}

#[derive(Debug, Default, Clone)]
struct CodexParserState {
    session_id: Option<String>,
    model: Option<String>,
    items: BTreeMap<String, CodexItemRecord>,
}

#[derive(Debug, Default)]
pub struct CodexAdapter {
    parser_states: Mutex<BTreeMap<String, CodexParserState>>,
}

impl Adapter for CodexAdapter {
    fn build_command(
        &self,
        payload: &StartRunPayload,
        capability: &CapabilityProfile,
        binary_path: &str,
    ) -> AppResult<ValidatedCommand> {
        if capability.blocked {
            return Err(AppError::Cli("Codex CLI is blocked by compatibility profile".to_string()));
        }

        let mut args = Vec::new();
        let mut meta = CommandMeta::default();
        let mut prompt_suffix: Option<String> = None;

        match payload.mode {
            RunMode::NonInteractive => {
                args.push("exec".to_string());
                let continue_session = payload
                    .harness
                    .as_ref()
                    .and_then(|harness| harness.continue_session)
                    .unwrap_or(false);
                if continue_session {
                    args.push("resume".to_string());
                    args.push("--last".to_string());
                } else if let Some(session_id) = resume_session_id(payload) {
                    args.push("resume".to_string());
                    args.push(session_id.to_string());
                }
                prompt_suffix = Some(payload.prompt.clone());
            }
            RunMode::Interactive => {
                // Interactive runs attach to the default codex TTY workflow.
            }
        }

        if let Some(model) = &payload.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        if !is_git_repo(&payload.cwd) {
            args.push("--skip-git-repo-check".to_string());
        }

        if payload.mode == RunMode::NonInteractive {
            if let Some(output_format) = &payload.output_format {
                if output_format == "json" || output_format == "stream-json" || output_format == "text" {
                    args.push("--json".to_string());
                }
            } else {
                args.push("--json".to_string());
            }
        }

        if let Some(harness) = &payload.harness {
            if let Some(permissions) = &harness.permissions {
                let approval = if permissions.auto_approve {
                    "never".to_string()
                } else {
                    match permissions.approval_policy {
                        Some(crate::models::ApprovalPolicy::Untrusted) => "untrusted".to_string(),
                        Some(crate::models::ApprovalPolicy::OnFailure) => "on-failure".to_string(),
                        Some(crate::models::ApprovalPolicy::Never) => "never".to_string(),
                        Some(crate::models::ApprovalPolicy::OnRequest) | None => "on-request".to_string(),
                    }
                };
                args.push("--ask-for-approval".to_string());
                args.push(approval);

                let sandbox = match permissions.sandbox_mode {
                    SandboxMode::ReadOnly => "read-only",
                    SandboxMode::WorkspaceWrite => "workspace-write",
                    SandboxMode::FullAccess => "danger-full-access",
                };
                args.push("--sandbox".to_string());
                args.push(sandbox.to_string());

                let search_enabled = permissions.network_access
                    && harness
                        .tools
                        .as_ref()
                        .map(|tools| tools.contains(&UnifiedTool::WebSearch))
                        .unwrap_or(false);
                if search_enabled {
                    args.push("--search".to_string());
                }
            }

            if let Some(directories) = &harness.additional_directories {
                for dir in directories {
                    args.push("--add-dir".to_string());
                    args.push(dir.clone());
                }
            }

            if let Some(mcp) = &harness.mcp {
                for server in &mcp.servers {
                    if server.enabled == Some(false) {
                        continue;
                    }
                    let key = sanitize_mcp_key(&server.name);
                    if let Some(command) = &server.command {
                        args.push("--config".to_string());
                        args.push(format!(
                            "mcp_servers.{}.command={}",
                            key,
                            to_toml_value(command)
                        ));
                    }
                    if let Some(url) = &server.url {
                        args.push("--config".to_string());
                        args.push(format!("mcp_servers.{}.url={}", key, to_toml_value(url)));
                    }
                    if let Some(r#type) = &server.r#type {
                        args.push("--config".to_string());
                        args.push(format!(
                            "mcp_servers.{}.transport={}",
                            key,
                            to_toml_value(r#type)
                        ));
                    }
                    if let Some(values) = &server.args {
                        args.push("--config".to_string());
                        args.push(format!(
                            "mcp_servers.{}.args={}",
                            key,
                            to_toml_value(values)
                        ));
                    }
                    if let Some(env) = &server.env {
                        for (env_key, env_value) in env {
                            args.push("--config".to_string());
                            args.push(format!(
                                "mcp_servers.{}.env.{}={}",
                                key,
                                env_key,
                                to_toml_value(env_value)
                            ));
                        }
                    }
                    if let Some(enabled_tools) = &server.enabled_tools {
                        args.push("--config".to_string());
                        args.push(format!(
                            "mcp_servers.{}.enabled_tools={}",
                            key,
                            to_toml_value(enabled_tools)
                        ));
                    }
                    if let Some(disabled_tools) = &server.disabled_tools {
                        args.push("--config".to_string());
                        args.push(format!(
                            "mcp_servers.{}.disabled_tools={}",
                            key,
                            to_toml_value(disabled_tools)
                        ));
                    }
                    args.push("--config".to_string());
                    args.push(format!("mcp_servers.{}.enabled=true", key));
                }
            }

            if let Some(structured_output) = &harness.structured_output {
                let schema_path = std::env::temp_dir().join(format!("codex-schema-{}.json", uuid::Uuid::new_v4()));
                std::fs::write(
                    &schema_path,
                    serde_json::to_vec_pretty(&structured_output.schema)
                        .map_err(|error| AppError::Cli(error.to_string()))?,
                )
                .map_err(|error| AppError::Io(error.to_string()))?;

                let output_path =
                    std::env::temp_dir().join(format!("codex-output-{}.json", uuid::Uuid::new_v4()));
                args.push("--output-schema".to_string());
                args.push(schema_path.to_string_lossy().to_string());
                args.push("--output-last-message".to_string());
                args.push(output_path.to_string_lossy().to_string());

                meta.structured_output_path = Some(output_path.to_string_lossy().to_string());
                meta.structured_output_schema = Some(structured_output.schema.clone());
                meta.structured_output_strict = structured_output.strict.unwrap_or(false);
                meta.cleanup_paths.push(schema_path.to_string_lossy().to_string());
                meta.cleanup_paths.push(output_path.to_string_lossy().to_string());
            }

            let mut image_paths = Vec::new();
            if let Some(images) = &harness.images {
                for image in images {
                    let extension = if image.mime_type.to_ascii_lowercase().contains("png") {
                        "png"
                    } else {
                        "jpg"
                    };
                    let image_path =
                        std::env::temp_dir().join(format!("harness-image-{}.{}", image.id, extension));
                    let base64 = extract_base64_data_url(&image.data_url);
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(base64)
                        .map_err(|error| AppError::Cli(format!("Invalid image base64 payload: {}", error)))?;
                    std::fs::write(&image_path, bytes).map_err(|error| AppError::Io(error.to_string()))?;
                    image_paths.push(image_path);
                }
            }

            let mut added_dirs = BTreeSet::new();
            for image_path in &image_paths {
                if let Some(parent) = image_path.parent() {
                    let as_string = parent.to_string_lossy().to_string();
                    if added_dirs.insert(as_string.clone()) {
                        args.push("--add-dir".to_string());
                        args.push(as_string);
                    }
                }
            }

            for image_path in &image_paths {
                args.push("--image".to_string());
                args.push(image_path.to_string_lossy().to_string());
                meta.cleanup_paths
                    .push(image_path.to_string_lossy().to_string());
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
                _ => {
                    return Err(AppError::Cli(format!(
                        "Unsupported codex flag value type for '{}'.",
                        key
                    )));
                }
            }
        }

        let mut env = BTreeMap::new();
        if payload.mode == RunMode::NonInteractive {
            env.insert("CODEX_NON_INTERACTIVE".to_string(), "1".to_string());
        }

        if let Some(prompt) = prompt_suffix {
            if payload
                .harness
                .as_ref()
                .and_then(|harness| harness.images.as_ref())
                .map(|images| !images.is_empty())
                .unwrap_or(false)
            {
                args.push("--".to_string());
            }
            args.push(prompt);
        }

        Ok(ValidatedCommand {
            program: binary_path.to_string(),
            args,
            cwd: payload.cwd.clone(),
            env,
            stdin: None,
            meta,
        })
    }

    fn parse_chunk(&self, stream: &str, raw_chunk: &str) -> Option<serde_json::Value> {
        if let Some(structured) = parse_first_json(raw_chunk) {
            let stage = structured
                .get("type")
                .or_else(|| structured.get("event"))
                .and_then(|value| value.as_str())
                .unwrap_or("json_event");
            return Some(serde_json::json!({
                "provider": "codex",
                "stage": stage,
                "structured": structured
            }));
        }

        if stream == "stderr" && raw_chunk.to_ascii_lowercase().contains("progress") {
            return Some(serde_json::json!({
                "provider": "codex",
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
            let line_event_start = events.len();
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

            capture_codex_model(state, &parsed);

            let parsed_obj = match parsed.as_object() {
                Some(obj) => obj,
                None => continue,
            };
            let event_type = normalize_type(parsed_obj.get("type"));
            let item = parsed_obj.get("item").and_then(|value| value.as_object());
            let item_id = item_id(parsed_obj, item);
            let item_type = item_type(parsed_obj, item, item_id.as_deref(), state);

            if event_type == "thread.started" {
                if let Some(thread_id) = parsed_obj.get("thread_id").and_then(|value| value.as_str()) {
                    state.session_id = Some(thread_id.to_string());
                    events.push(serde_json::json!({
                        "type": "session_complete",
                        "sessionId": thread_id,
                        "model": state.model,
                    }));
                }
                continue;
            }

            if event_type == "item.started" {
                if let Some(item_obj) = item {
                    if let (Some(id), Some(item_type)) = (
                        item_obj.get("id").and_then(|value| value.as_str()),
                        item_obj.get("type").and_then(|value| value.as_str()),
                    ) {
                        state.items.insert(
                            id.to_string(),
                            CodexItemRecord {
                                item_type: item_type.to_string(),
                            },
                        );
                    }

                    match item_obj.get("type").and_then(|value| value.as_str()).unwrap_or_default() {
                        "command_execution" => {
                            events.push(serde_json::json!({
                                "type": "tool_start",
                                "tool": {
                                    "id": item_obj.get("id").cloned().unwrap_or_else(|| serde_json::json!("tool")),
                                    "name": "Bash",
                                    "input": {
                                        "command": item_obj.get("command").cloned().unwrap_or(serde_json::Value::Null)
                                    }
                                }
                            }));
                        }
                        "file_change" => {
                            events.push(serde_json::json!({
                                "type": "tool_start",
                                "tool": {
                                    "id": item_obj.get("id").cloned().unwrap_or_else(|| serde_json::json!("tool")),
                                    "name": "FileChange",
                                    "input": {
                                        "path": item_obj.get("path").cloned().unwrap_or(serde_json::Value::Null),
                                        "operation": item_obj.get("operation").cloned().unwrap_or(serde_json::Value::Null)
                                    }
                                }
                            }));
                        }
                        "mcp_tool_call" => {
                            events.push(serde_json::json!({
                                "type": "tool_start",
                                "tool": build_mcp_tool(item_obj)
                            }));
                        }
                        _ => {}
                    }
                }
                continue;
            }

            if event_type.contains("delta") {
                let delta = parsed_obj
                    .get("delta")
                    .and_then(|value| value.as_object())
                    .or_else(|| item.and_then(|item_obj| item_obj.get("delta").and_then(|value| value.as_object())));
                let delta_type = normalize_type(delta.and_then(|obj| obj.get("type")));
                let is_reasoning = format!("{} {} {}", event_type, item_type, delta_type)
                    .to_ascii_lowercase()
                    .contains("reason")
                    || format!("{} {} {}", event_type, item_type, delta_type)
                        .to_ascii_lowercase()
                        .contains("thinking")
                    || format!("{} {} {}", event_type, item_type, delta_type)
                        .to_ascii_lowercase()
                        .contains("summary");

                let reasoning_text = pick_string(&[
                    delta.and_then(|obj| obj.get("summary_text").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("summaryText").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("summary").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("thinking").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("reasoning").and_then(|value| value.as_str())),
                ]);
                if let Some(text) = reasoning_text {
                    if !text.is_empty() {
                        events.push(serde_json::json!({
                            "type": "thinking_delta",
                            "text": text
                        }));
                    }
                }

                let delta_text = pick_string(&[
                    delta.and_then(|obj| obj.get("text").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("content").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("value").and_then(|value| value.as_str())),
                    delta.and_then(|obj| obj.get("partial").and_then(|value| value.as_str())),
                    parsed_obj.get("text").and_then(|value| value.as_str()),
                    item.and_then(|obj| obj.get("text").and_then(|value| value.as_str())),
                ]);
                if let Some(text) = delta_text {
                    if !text.is_empty() {
                        events.push(serde_json::json!({
                            "type": if is_reasoning { "thinking_delta" } else { "text_delta" },
                            "text": text
                        }));
                    }
                }
                if events.len() > line_event_start {
                    continue;
                }
            }

            if event_type == "item.completed" {
                if let Some(item_obj) = item {
                    match item_obj.get("type").and_then(|value| value.as_str()).unwrap_or_default() {
                        "agent_message" => {
                            if let Some(text) = item_obj.get("text").and_then(|value| value.as_str()) {
                                if !text.is_empty() {
                                    events.push(serde_json::json!({
                                        "type": "text_complete",
                                        "text": text
                                    }));
                                }
                            }
                        }
                        "reasoning" => {
                            let text = item_obj
                                .get("text")
                                .and_then(|value| value.as_str())
                                .or_else(|| item_obj.get("summary").and_then(|value| value.as_str()))
                                .unwrap_or_default();
                            if !text.is_empty() {
                                events.push(serde_json::json!({
                                    "type": "thinking_complete",
                                    "text": text
                                }));
                            }
                        }
                        "command_execution" => {
                            let output = item_obj
                                .get("output")
                                .and_then(|value| value.as_str())
                                .map(ToString::to_string)
                                .or_else(|| {
                                    item_obj
                                        .get("aggregated_output")
                                        .and_then(|value| value.as_str())
                                        .map(ToString::to_string)
                                })
                                .or_else(|| {
                                    item_obj
                                        .get("output_lines")
                                        .and_then(|value| value.as_array())
                                        .map(|lines| {
                                            lines
                                                .iter()
                                                .filter_map(|line| line.as_str())
                                                .collect::<Vec<_>>()
                                                .join("\n")
                                        })
                                })
                                .unwrap_or_default();
                            events.push(serde_json::json!({
                                "type": "tool_result",
                                "tool": {
                                    "id": item_obj.get("id").cloned().unwrap_or_else(|| serde_json::json!("tool")),
                                    "name": "Bash",
                                    "input": {
                                        "command": item_obj.get("command").cloned().unwrap_or(serde_json::Value::Null)
                                    }
                                },
                                "result": output
                            }));
                        }
                        "file_change" => {
                            let result = item_obj
                                .get("summary")
                                .and_then(|value| value.as_str())
                                .or_else(|| item_obj.get("diff").and_then(|value| value.as_str()))
                                .unwrap_or_default();
                            events.push(serde_json::json!({
                                "type": "tool_result",
                                "tool": {
                                    "id": item_obj.get("id").cloned().unwrap_or_else(|| serde_json::json!("tool")),
                                    "name": "FileChange",
                                    "input": {
                                        "path": item_obj.get("path").cloned().unwrap_or(serde_json::Value::Null),
                                        "operation": item_obj.get("operation").cloned().unwrap_or(serde_json::Value::Null),
                                        "diff": item_obj.get("diff").cloned().unwrap_or(serde_json::Value::Null)
                                    }
                                },
                                "result": result
                            }));
                        }
                        "web_search" => {
                            events.push(serde_json::json!({
                                "type": "tool_result",
                                "tool": {
                                    "id": item_obj.get("id").cloned().unwrap_or_else(|| serde_json::json!("tool")),
                                    "name": "WebSearch",
                                    "input": {
                                        "query": item_obj.get("query").cloned().unwrap_or(serde_json::Value::Null)
                                    }
                                },
                                "result": serde_json::to_string(item_obj.get("results").unwrap_or(&serde_json::Value::Array(Vec::new())))
                                    .unwrap_or_else(|_| "[]".to_string())
                            }));
                        }
                        "mcp_tool_call" => {
                            let result_source = item_obj
                                .get("result")
                                .or_else(|| item_obj.get("output"))
                                .or_else(|| item_obj.get("response"))
                                .or_else(|| item_obj.get("content"))
                                .or_else(|| item_obj.get("error"))
                                .or_else(|| item_obj.get("summary"))
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);
                            events.push(serde_json::json!({
                                "type": "tool_result",
                                "tool": build_mcp_tool(item_obj),
                                "result": stringify_json_value(&result_source)
                            }));
                        }
                        _ => {}
                    }
                }
                continue;
            }

            if event_type == "turn.completed" {
                let usage = codex_usage(parsed_obj.get("usage"));
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

            if event_type == "turn.failed" || event_type == "error" {
                let message = parsed_obj
                    .get("message")
                    .and_then(|value| value.as_str())
                    .or_else(|| {
                        parsed_obj
                            .get("error")
                            .and_then(|value| value.as_object())
                            .and_then(|err| err.get("message"))
                            .and_then(|value| value.as_str())
                    })
                    .unwrap_or("Codex error");

                let lower = message.to_ascii_lowercase();
                if lower.contains("rate limit") || lower.contains("too many requests") || lower.contains("429") {
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
        let summary = extract_last_agent_message(buffered_output).unwrap_or_else(|| {
            buffered_output
                .lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .unwrap_or_default()
                .to_string()
        });
        let structured = parse_last_json(buffered_output);
        serde_json::json!({
            "provider": "codex",
            "exitCode": exit_code,
            "summary": summary,
            "structured": structured
        })
    }
}

fn sanitize_mcp_key(name: &str) -> String {
    let sanitized = regex::Regex::new(r"[^a-zA-Z0-9_-]")
        .expect("valid regex")
        .replace_all(name, "_")
        .to_string();
    if sanitized.is_empty() {
        "mcp_server".to_string()
    } else {
        sanitized
    }
}

fn is_git_repo(cwd: &str) -> bool {
    let output = std::process::Command::new("git")
        .args(["-C", cwd, "rev-parse", "--is-inside-work-tree"])
        .output();
    match output {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .trim()
            .eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn normalize_type(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn pick_string<'a>(candidates: &[Option<&'a str>]) -> Option<&'a str> {
    candidates
        .iter()
        .flatten()
        .copied()
        .find(|value| !value.is_empty())
}

fn capture_codex_model(state: &mut CodexParserState, parsed: &serde_json::Value) {
    let model = parsed
        .get("model")
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("model_id").and_then(|value| value.as_str()))
        .or_else(|| parsed.get("model_name").and_then(|value| value.as_str()));
    if let Some(model) = model {
        state.model = Some(model.to_string());
    }
}

fn item_id(
    parsed: &serde_json::Map<String, serde_json::Value>,
    item: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Option<String> {
    parsed
        .get("item_id")
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("itemId").and_then(|value| value.as_str()))
        .or_else(|| item.and_then(|obj| obj.get("id")).and_then(|value| value.as_str()))
        .or_else(|| parsed.get("id").and_then(|value| value.as_str()))
        .map(ToString::to_string)
}

fn item_type(
    parsed: &serde_json::Map<String, serde_json::Value>,
    item: Option<&serde_json::Map<String, serde_json::Value>>,
    item_id: Option<&str>,
    state: &CodexParserState,
) -> String {
    item.and_then(|obj| obj.get("type"))
        .and_then(|value| value.as_str())
        .or_else(|| parsed.get("item_type").and_then(|value| value.as_str()))
        .or_else(|| parsed.get("itemType").and_then(|value| value.as_str()))
        .or_else(|| {
            item_id
                .and_then(|id| state.items.get(id))
                .map(|record| record.item_type.as_str())
        })
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn build_mcp_tool(item: &serde_json::Map<String, serde_json::Value>) -> serde_json::Value {
    let id = item
        .get("id")
        .and_then(|value| value.as_str())
        .or_else(|| item.get("tool_call_id").and_then(|value| value.as_str()))
        .or_else(|| item.get("request_id").and_then(|value| value.as_str()))
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("mcp_{}", uuid::Uuid::new_v4()));
    let raw_name = item
        .get("tool_name")
        .and_then(|value| value.as_str())
        .or_else(|| item.get("name").and_then(|value| value.as_str()))
        .or_else(|| item.get("tool").and_then(|value| value.as_str()))
        .or_else(|| item.get("server").and_then(|value| value.as_str()))
        .unwrap_or("MCP");
    let name = if raw_name.starts_with("mcp") {
        raw_name.to_string()
    } else {
        format!("MCP:{}", raw_name)
    };
    let input_source = item
        .get("input")
        .or_else(|| item.get("arguments"))
        .or_else(|| item.get("args"))
        .or_else(|| item.get("params"))
        .or_else(|| item.get("payload"))
        .or_else(|| item.get("request"))
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let input = if input_source.is_object() {
        input_source
    } else if let Some(raw) = input_source.as_str() {
        serde_json::from_str::<serde_json::Value>(raw)
            .unwrap_or_else(|_| serde_json::json!({ "raw": raw }))
    } else {
        serde_json::json!({})
    };
    serde_json::json!({
        "id": id,
        "name": name,
        "input": input
    })
}

fn stringify_json_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Null => String::new(),
        _ => serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
    }
}

fn codex_usage(value: Option<&serde_json::Value>) -> serde_json::Value {
    let usage = value.and_then(|value| value.as_object());
    serde_json::json!({
        "inputTokens": usage
            .and_then(|usage| usage.get("input_tokens"))
            .and_then(|value| value.as_i64())
            .unwrap_or(0),
        "outputTokens": usage
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(|value| value.as_i64())
            .unwrap_or(0),
        "cachedTokens": usage
            .and_then(|usage| usage.get("cached_input_tokens"))
            .and_then(|value| value.as_i64())
            .unwrap_or(0),
    })
}

fn to_toml_value<T: serde::Serialize>(value: T) -> String {
    serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string())
}

fn extract_base64_data_url(data_url: &str) -> &str {
    if let Some(index) = data_url.find("base64,") {
        &data_url[index + 7..]
    } else {
        data_url
    }
}

fn is_internal_optional_flag(key: &str) -> bool {
    key.starts_with("__")
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

fn extract_last_agent_message(raw: &str) -> Option<String> {
    let mut last: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
            continue;
        }
        let Some(parsed) = serde_json::from_str::<serde_json::Value>(trimmed).ok() else {
            continue;
        };
        let event_type = parsed.get("type").and_then(|value| value.as_str());
        if event_type != Some("item.completed") {
            continue;
        }
        let item = parsed.get("item")?;
        if item.get("type").and_then(|value| value.as_str()) != Some("agent_message") {
            continue;
        }
        let text = item.get("text").and_then(|value| value.as_str())?.trim();
        if !text.is_empty() {
            last = Some(text.to_string());
        }
    }
    last
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

#[cfg(test)]
mod tests {
    use super::{extract_last_agent_message, resume_session_id, CodexAdapter};
    use crate::adapters::Adapter;
    use crate::models::{
        CapabilityProfile, HarnessRequestOptions, Provider, RunMode, SandboxMode, StartRunPayload, UnifiedPermission,
        UnifiedTool,
    };
    use std::collections::BTreeMap;

    fn base_payload() -> StartRunPayload {
        StartRunPayload {
            provider: Provider::Codex,
            prompt: "hello".to_string(),
            model: Some("gpt-5-codex".to_string()),
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
            provider: Provider::Codex,
            cli_version: "0.92.0".to_string(),
            supported: true,
            degraded: false,
            blocked: false,
            supported_flags: vec!["--model".to_string(), "--json".to_string()],
            supported_modes: vec![RunMode::NonInteractive, RunMode::Interactive],
            disabled_reasons: vec![],
        }
    }

    #[test]
    fn builds_resume_command_when_internal_resume_id_is_present() {
        let adapter = CodexAdapter::default();
        let mut payload = base_payload();
        payload
            .optional_flags
            .insert("__resume_session_id".to_string(), serde_json::json!("session-123"));

        let built = adapter
            .build_command(&payload, &capability(), "codex")
            .expect("build command");
        assert_eq!(built.args[0], "exec");
        assert_eq!(built.args[1], "resume");
        assert_eq!(built.args[2], "session-123");
        assert!(built.args.contains(&"--json".to_string()));
    }

    #[test]
    fn extracts_last_agent_message_from_jsonl() {
        let raw = r#"{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}
{"type":"item.completed","item":{"type":"agent_message","text":"first"}}
{"type":"item.completed","item":{"type":"agent_message","text":"second"}}"#;
        assert_eq!(
            extract_last_agent_message(raw).as_deref(),
            Some("second")
        );
    }

    #[test]
    fn reads_internal_resume_session_id() {
        let mut payload = base_payload();
        payload
            .optional_flags
            .insert("__resume_session_id".to_string(), serde_json::json!("  abc-123  "));
        assert_eq!(resume_session_id(&payload), Some("abc-123"));
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
    fn builds_permission_and_structured_output_flags_from_harness() {
        let adapter = CodexAdapter::default();
        let mut payload = base_payload();
        payload.harness = Some(HarnessRequestOptions {
            tools: Some(vec![UnifiedTool::WebSearch]),
            permissions: Some(UnifiedPermission {
                sandbox_mode: SandboxMode::WorkspaceWrite,
                auto_approve: false,
                network_access: true,
                approval_policy: None,
            }),
            structured_output: Some(crate::models::StructuredOutputConfig {
                schema: serde_json::json!({ "type": "object" }),
                strict: Some(false),
            }),
            ..Default::default()
        });

        let built = adapter
            .build_command(&payload, &capability(), "codex")
            .expect("build command");

        assert!(built.args.contains(&"--ask-for-approval".to_string()));
        assert!(built.args.contains(&"--sandbox".to_string()));
        assert!(built.args.contains(&"--search".to_string()));
        assert!(built.args.contains(&"--output-schema".to_string()));
        assert!(built.args.contains(&"--output-last-message".to_string()));
        assert!(!built.meta.cleanup_paths.is_empty());
    }

    #[test]
    fn parses_semantic_tool_lifecycle_events() {
        let adapter = CodexAdapter::default();
        let started = adapter.parse_semantic_events(
            "run-1",
            "stdout",
            r#"{"type":"item.started","item":{"id":"cmd-1","type":"command_execution","command":"ls -la"}}"#,
        );
        assert!(started.iter().any(|event| {
            event.get("type").and_then(|value| value.as_str()) == Some("tool_start")
        }));

        let completed = adapter.parse_semantic_events(
            "run-1",
            "stdout",
            r#"{"type":"item.completed","item":{"id":"cmd-1","type":"command_execution","command":"ls -la","output":"done"}}"#,
        );
        assert!(completed.iter().any(|event| {
            event.get("type").and_then(|value| value.as_str()) == Some("tool_result")
        }));

        let turn = adapter.parse_semantic_events(
            "run-1",
            "stdout",
            r#"{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":20,"cached_input_tokens":5}}"#,
        );
        assert!(turn.iter().any(|event| {
            event.get("type").and_then(|value| value.as_str()) == Some("turn_complete")
        }));
    }
}
