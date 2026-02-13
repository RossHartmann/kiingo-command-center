use super::{Adapter, ValidatedCommand};
use crate::errors::{AppError, AppResult};
use crate::models::{CapabilityProfile, RunMode, StartRunPayload};
use std::collections::BTreeMap;

#[derive(Debug, Default)]
pub struct CodexAdapter;

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

        match payload.mode {
            RunMode::NonInteractive => {
                args.push("exec".to_string());
                if let Some(session_id) = resume_session_id(payload) {
                    args.push("resume".to_string());
                    args.push(session_id.to_string());
                }
                args.push(payload.prompt.clone());
            }
            RunMode::Interactive => {
                // Interactive runs attach to the default codex TTY workflow.
            }
        }

        if let Some(model) = &payload.model {
            args.push("--model".to_string());
            args.push(model.clone());
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

        Ok(ValidatedCommand {
            program: binary_path.to_string(),
            args,
            cwd: payload.cwd.clone(),
            env,
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
    use crate::models::{CapabilityProfile, Provider, RunMode, StartRunPayload};
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
        let adapter = CodexAdapter;
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
}
