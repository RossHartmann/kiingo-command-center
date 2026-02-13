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
            if let Some(output_format) = &payload.output_format {
                args.push("--output-format".to_string());
                args.push(output_format.clone());
            }
        }

        for (key, value) in &payload.optional_flags {
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
        let summary = buffered_output
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_default();
        let structured = parse_last_json(buffered_output);
        serde_json::json!({
            "provider": "claude",
            "exitCode": exit_code,
            "summary": summary,
            "structured": structured
        })
    }
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
