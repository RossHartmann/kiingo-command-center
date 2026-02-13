pub mod claude;
pub mod codex;
pub mod compatibility;

use crate::errors::AppResult;
use crate::models::{CapabilityProfile, StartRunPayload};
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct ValidatedCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub env: BTreeMap<String, String>,
}

pub trait Adapter: Send + Sync {
    fn validate(&self, payload: &StartRunPayload) -> AppResult<()> {
        if payload.prompt.trim().is_empty() {
            return Err(crate::errors::AppError::Cli("Prompt cannot be empty".to_string()));
        }
        Ok(())
    }
    fn build_command(
        &self,
        payload: &StartRunPayload,
        capability: &CapabilityProfile,
        binary_path: &str,
    ) -> AppResult<ValidatedCommand>;
    fn parse_chunk(&self, stream: &str, raw_chunk: &str) -> Option<serde_json::Value>;
    fn parse_final(&self, exit_code: Option<i32>, buffered_output: &str) -> serde_json::Value;
}
