use super::{Adapter, ValidatedCommand};
use crate::errors::{AppError, AppResult};
use crate::models::{CapabilityProfile, RunMode, StartRunPayload};
use std::collections::BTreeMap;

#[derive(Debug, Default)]
pub struct ClaudeAdapter;

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

        match payload.mode {
            RunMode::NonInteractive => {
                args.push("-p".to_string());
                if let Some(session_id) = resume_session_id(payload) {
                    args.push("--resume".to_string());
                    args.push(session_id.to_string());
                }
                args.push(payload.prompt.clone());
            }
            RunMode::Interactive => {
                // Interactive runs attach to the default claude TTY workflow.
            }
        }

        if let Some(model) = &payload.model {
            args.push("--model".to_string());
            args.push(model.clone());
        }

        if payload.mode == RunMode::NonInteractive {
            // Force structured output to reliably parse the assistant text and session id.
            args.push("--output-format".to_string());
            args.push("stream-json".to_string());
            args.push("--verbose".to_string());
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

        Ok(ValidatedCommand {
            program: binary_path.to_string(),
            args,
            cwd: payload.cwd.clone(),
            env,
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

fn resume_session_id(payload: &StartRunPayload) -> Option<&str> {
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

#[cfg(test)]
mod tests {
    use super::{extract_claude_result_text, resume_session_id, ClaudeAdapter};
    use crate::adapters::Adapter;
    use crate::models::{CapabilityProfile, Provider, RunMode, StartRunPayload};
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
        let adapter = ClaudeAdapter;
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
}
