use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Provider {
    Codex,
    Claude,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunMode {
    NonInteractive,
    Interactive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Canceled,
    Interrupted,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
            Self::Interrupted => "interrupted",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunPayload {
    pub provider: Provider,
    pub prompt: String,
    pub model: Option<String>,
    pub mode: RunMode,
    pub output_format: Option<String>,
    pub cwd: String,
    pub optional_flags: BTreeMap<String, serde_json::Value>,
    pub profile_id: Option<String>,
    pub queue_priority: Option<i32>,
    pub timeout_seconds: Option<u64>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub max_retries: Option<u32>,
    pub retry_backoff_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub provider: Provider,
    pub status: RunStatus,
    pub prompt: String,
    pub model: Option<String>,
    pub mode: RunMode,
    pub output_format: Option<String>,
    pub cwd: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
    pub error_summary: Option<String>,
    pub queue_priority: i32,
    pub profile_id: Option<String>,
    pub capability_snapshot_id: Option<String>,
    pub compatibility_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventRecord {
    pub id: String,
    pub run_id: String,
    pub seq: i64,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunArtifact {
    pub id: String,
    pub run_id: String,
    pub kind: String,
    pub path: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub run: RunRecord,
    pub events: Vec<RunEventRecord>,
    pub artifacts: Vec<RunArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListRunsFilters {
    pub provider: Option<Provider>,
    pub status: Option<RunStatus>,
    pub search: Option<String>,
    pub date_from: Option<DateTime<Utc>>,
    pub date_to: Option<DateTime<Utc>>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub provider: Provider,
    pub config: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProfilePayload {
    pub id: Option<String>,
    pub name: String,
    pub provider: Provider,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityProfile {
    pub provider: Provider,
    pub cli_version: String,
    pub supported: bool,
    pub degraded: bool,
    pub blocked: bool,
    pub supported_flags: Vec<String>,
    pub supported_modes: Vec<RunMode>,
    pub disabled_reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySnapshot {
    pub id: String,
    pub provider: Provider,
    pub cli_version: String,
    pub profile: CapabilityProfile,
    pub detected_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGrant {
    pub id: String,
    pub path: String,
    pub granted_by: String,
    pub granted_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerJob {
    pub id: String,
    pub run_id: String,
    pub priority: i32,
    pub state: String,
    pub queued_at: DateTime<Utc>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub attempts: u32,
    pub max_retries: u32,
    pub retry_backoff_ms: u64,
    pub last_error: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub codex_path: String,
    pub claude_path: String,
    pub retention_days: u32,
    pub max_storage_mb: u32,
    pub allow_advanced_policy: bool,
    pub remote_telemetry_opt_in: bool,
    pub redact_aggressive: bool,
    pub store_encrypted_raw_artifacts: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_path: "codex".to_string(),
            claude_path: "claude".to_string(),
            retention_days: 90,
            max_storage_mb: 1024,
            allow_advanced_policy: false,
            remote_telemetry_opt_in: false,
            redact_aggressive: true,
            store_encrypted_raw_artifacts: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEnvelope {
    pub run_id: String,
    pub r#type: String,
    pub payload: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub event_id: String,
    pub seq: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunResponse {
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInteractiveSessionResponse {
    pub run_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RerunResponse {
    pub new_run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BooleanResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedResponse {
    pub accepted: bool,
}
