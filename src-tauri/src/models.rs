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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UnifiedTool {
    #[serde(rename = "file_read")]
    FileRead,
    #[serde(rename = "file_write")]
    FileWrite,
    #[serde(rename = "file_edit")]
    FileEdit,
    #[serde(rename = "file_search")]
    FileSearch,
    #[serde(rename = "content_search")]
    ContentSearch,
    #[serde(rename = "shell")]
    Shell,
    #[serde(rename = "web_fetch")]
    WebFetch,
    #[serde(rename = "web_search")]
    WebSearch,
    #[serde(rename = "mcp")]
    Mcp,
    #[serde(rename = "task")]
    Task,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    FullAccess,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    Untrusted,
    OnFailure,
    OnRequest,
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedPermission {
    pub sandbox_mode: SandboxMode,
    pub auto_approve: bool,
    pub network_access: bool,
    pub approval_policy: Option<ApprovalPolicy>,
}

impl Default for UnifiedPermission {
    fn default() -> Self {
        Self {
            sandbox_mode: SandboxMode::ReadOnly,
            auto_approve: false,
            network_access: false,
            approval_policy: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentLimits {
    pub max_budget_usd: Option<f64>,
    pub max_turns: Option<u32>,
    pub timeout_ms: Option<u64>,
    pub max_tool_result_lines: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StructuredOutputConfig {
    pub schema: serde_json::Value,
    pub strict: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAllowlistEntry {
    pub name: String,
    pub path: String,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CliAllowlistMode {
    Shims,
    Wrapper,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAllowlistConfig {
    pub entries: Vec<CliAllowlistEntry>,
    pub mode: Option<CliAllowlistMode>,
    pub wrapper_name: Option<String>,
    pub bin_dir: Option<String>,
    pub keep_bin_dir: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellPreludeConfig {
    pub content: String,
    pub bash_env: Option<bool>,
    pub sh_env: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, String>>,
    pub url: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub r#type: Option<String>,
    pub enabled_tools: Option<Vec<String>>,
    pub disabled_tools: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub servers: Vec<McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAttachment {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRequestOptions {
    pub resume_session_id: Option<String>,
    pub continue_session: Option<bool>,
    pub input_format: Option<String>,
    pub additional_directories: Option<Vec<String>>,
    pub tools: Option<Vec<UnifiedTool>>,
    pub permissions: Option<UnifiedPermission>,
    pub limits: Option<AgentLimits>,
    pub mcp: Option<McpConfig>,
    pub structured_output: Option<StructuredOutputConfig>,
    pub system_prompt: Option<String>,
    pub append_system_prompt: Option<String>,
    pub piped_content: Option<String>,
    pub images: Option<Vec<ImageAttachment>>,
    pub files: Option<Vec<FileAttachment>>,
    pub process_env: Option<BTreeMap<String, String>>,
    pub cli_allowlist: Option<CliAllowlistConfig>,
    pub shell_prelude: Option<ShellPreludeConfig>,
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
    #[serde(default)]
    pub harness: Option<HarnessRequestOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub provider: Provider,
    pub title: String,
    pub provider_session_id: Option<String>,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub provider: Provider,
    pub title: String,
    pub provider_session_id: Option<String>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
    pub last_run_id: Option<String>,
    pub last_message_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDetail {
    pub conversation: ConversationRecord,
    pub runs: Vec<RunRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationPayload {
    pub provider: Provider,
    pub title: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListConversationsFilters {
    pub provider: Option<Provider>,
    pub include_archived: Option<bool>,
    pub search: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendConversationMessagePayload {
    pub conversation_id: String,
    pub prompt: String,
    pub model: Option<String>,
    pub output_format: Option<String>,
    pub cwd: Option<String>,
    pub optional_flags: Option<BTreeMap<String, serde_json::Value>>,
    pub profile_id: Option<String>,
    pub queue_priority: Option<i32>,
    pub timeout_seconds: Option<u64>,
    pub scheduled_at: Option<DateTime<Utc>>,
    pub max_retries: Option<u32>,
    pub retry_backoff_ms: Option<u64>,
    pub harness: Option<HarnessRequestOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameConversationPayload {
    pub conversation_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveConversationPayload {
    pub conversation_id: String,
    pub archived: Option<bool>,
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
    pub conversation_id: Option<String>,
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
    pub conversation_id: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NavOrderConfig {
    #[serde(default)]
    pub group_order: Vec<String>,
    #[serde(default)]
    pub item_order: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub codex_path: String,
    pub claude_path: String,
    pub conversation_threads_v1: bool,
    pub retention_days: u32,
    pub max_storage_mb: u32,
    pub allow_advanced_policy: bool,
    pub remote_telemetry_opt_in: bool,
    pub redact_aggressive: bool,
    pub store_encrypted_raw_artifacts: bool,
    pub nav_order: Option<NavOrderConfig>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_path: "codex".to_string(),
            claude_path: "claude".to_string(),
            conversation_threads_v1: cfg!(debug_assertions),
            retention_days: 90,
            max_storage_mb: 1024,
            allow_advanced_policy: false,
            remote_telemetry_opt_in: false,
            redact_aggressive: true,
            store_encrypted_raw_artifacts: false,
            nav_order: None,
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

// ─── Metric Library ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MetricSnapshotStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

impl MetricSnapshotStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub instructions: String,
    pub template_html: String,
    pub ttl_seconds: i64,
    pub provider: Provider,
    pub model: Option<String>,
    pub profile_id: Option<String>,
    pub cwd: Option<String>,
    pub enabled: bool,
    pub proactive: bool,
    pub metadata_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSnapshot {
    pub id: String,
    pub metric_id: String,
    pub run_id: Option<String>,
    pub values_json: serde_json::Value,
    pub rendered_html: String,
    pub status: MetricSnapshotStatus,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMetricBinding {
    pub id: String,
    pub screen_id: String,
    pub metric_id: String,
    pub position: i32,
    pub layout_hint: String,
    pub grid_x: i32,
    pub grid_y: i32,
    pub grid_w: i32,
    pub grid_h: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMetricDefinitionPayload {
    pub id: Option<String>,
    pub name: String,
    pub slug: String,
    pub instructions: String,
    pub template_html: Option<String>,
    pub ttl_seconds: Option<i64>,
    pub provider: Option<Provider>,
    pub model: Option<String>,
    pub profile_id: Option<String>,
    pub cwd: Option<String>,
    pub enabled: Option<bool>,
    pub proactive: Option<bool>,
    pub metadata_json: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindMetricToScreenPayload {
    pub screen_id: String,
    pub metric_id: String,
    pub position: Option<i32>,
    pub layout_hint: Option<String>,
    pub grid_x: Option<i32>,
    pub grid_y: Option<i32>,
    pub grid_w: Option<i32>,
    pub grid_h: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScreenMetricLayoutPayload {
    pub screen_id: String,
    pub layouts: Vec<ScreenMetricLayoutItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMetricLayoutItem {
    pub binding_id: String,
    pub grid_x: i32,
    pub grid_y: i32,
    pub grid_w: i32,
    pub grid_h: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMetricView {
    pub binding: ScreenMetricBinding,
    pub definition: MetricDefinition,
    pub latest_snapshot: Option<MetricSnapshot>,
    pub is_stale: bool,
    pub refresh_in_progress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnbindMetricResponse {
    pub success: bool,
    pub screen_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRefreshResponse {
    pub metric_id: String,
    pub snapshot_id: String,
    pub run_id: Option<String>,
}

// ─── Workspace (Tasks + Notepad Platform) ───────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FacetKind {
    Task,
    Note,
    Meta,
    Attention,
    Commitment,
    Blocking,
    Recurrence,
    Energy,
    Agent,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Todo,
    Doing,
    Blocked,
    Done,
    Archived,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::Doing => "doing",
            Self::Blocked => "blocked",
            Self::Done => "done",
            Self::Archived => "archived",
        }
    }
}

impl Default for TaskStatus {
    fn default() -> Self {
        Self::Todo
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CommitmentLevel {
    Soft,
    Hard,
}

impl Default for CommitmentLevel {
    fn default() -> Self {
        Self::Soft
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttentionLayer {
    L3,
    Ram,
    Short,
    Long,
    Archive,
}

impl Default for AttentionLayer {
    fn default() -> Self {
        Self::Ram
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CaptureSource {
    Ui,
    Manual,
    Import,
    Agent,
}

impl Default for CaptureSource {
    fn default() -> Self {
        Self::Ui
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClassificationSource {
    Manual,
    Heuristic,
    Llm,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SensitivityLevel {
    Public,
    Internal,
    Confidential,
    Restricted,
}

impl Default for SensitivityLevel {
    fn default() -> Self {
        Self::Internal
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EncryptionScope {
    None,
    Vault,
    Field,
}

impl Default for EncryptionScope {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskFacet {
    pub title: String,
    pub status: TaskStatus,
    pub priority: i32,
    pub soft_due_at: Option<DateTime<Utc>>,
    pub hard_due_at: Option<DateTime<Utc>>,
    pub snoozed_until: Option<DateTime<Utc>>,
    pub commitment_level: Option<CommitmentLevel>,
    pub attention_layer: Option<AttentionLayer>,
    pub dread_level: Option<i32>,
    pub assignee: Option<String>,
    pub estimate_minutes: Option<i32>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteFacet {
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetaFacet {
    pub labels: Option<Vec<String>>,
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttentionFacet {
    pub layer: AttentionLayer,
    pub last_promoted_at: Option<DateTime<Utc>>,
    pub decay_eligible_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommitmentFacet {
    pub level: CommitmentLevel,
    pub rationale: Option<String>,
    pub must_review_by: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlockingFacet {
    pub mode: String,
    pub blocked_until: Option<DateTime<Utc>>,
    pub waiting_on_person: Option<String>,
    pub waiting_cadence_days: Option<i32>,
    pub blocked_by_atom_id: Option<String>,
    pub last_followup_at: Option<DateTime<Utc>>,
    pub followup_count: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceFacet {
    pub template_id: String,
    pub frequency: String,
    pub interval: Option<i32>,
    pub by_day: Option<Vec<String>>,
    pub instance_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnergyFacet {
    pub dread_level: Option<i32>,
    pub last_capacity_match: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentFacet {
    pub conversation_id: Option<String>,
    pub workflow_id: Option<String>,
    pub last_agent_action_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AtomFacets {
    pub task: Option<TaskFacet>,
    pub note: Option<NoteFacet>,
    pub meta: Option<MetaFacet>,
    pub attention: Option<AttentionFacet>,
    pub commitment: Option<CommitmentFacet>,
    pub blocking: Option<BlockingFacet>,
    pub recurrence: Option<RecurrenceFacet>,
    pub energy: Option<EnergyFacet>,
    pub agent: Option<AgentFacet>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AtomRelations {
    pub parent_id: Option<String>,
    pub blocked_by_atom_id: Option<String>,
    pub thread_ids: Vec<String>,
    pub derived_from_atom_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GovernanceMeta {
    pub sensitivity: SensitivityLevel,
    pub retention_policy_id: Option<String>,
    pub origin: String,
    pub source_ref: Option<String>,
    pub encryption_scope: EncryptionScope,
    pub allowed_agent_scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomRecord {
    pub id: String,
    pub schema_version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub raw_text: String,
    pub capture_source: CaptureSource,
    pub facets: Vec<FacetKind>,
    pub facet_data: AtomFacets,
    pub relations: AtomRelations,
    pub governance: GovernanceMeta,
    pub body: Option<String>,
    pub revision: i64,
    pub archived_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    pub primary_facet: String,
    pub confidence: f64,
    pub source: ClassificationSource,
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotepadFilter {
    pub facet: Option<FacetKind>,
    pub statuses: Option<Vec<TaskStatus>>,
    pub thread_ids: Option<Vec<String>>,
    pub parent_id: Option<String>,
    pub attention_layers: Option<Vec<AttentionLayer>>,
    pub commitment_levels: Option<Vec<CommitmentLevel>>,
    pub due_from: Option<String>,
    pub due_to: Option<String>,
    pub text_query: Option<String>,
    pub include_archived: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotepadSort {
    pub field: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotepadViewDefinition {
    pub id: String,
    pub schema_version: i32,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub filters: NotepadFilter,
    pub sorts: Vec<NotepadSort>,
    pub layout_mode: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEventRecord {
    pub id: String,
    pub r#type: String,
    pub occurred_at: DateTime<Utc>,
    pub actor: String,
    pub actor_id: Option<String>,
    pub atom_id: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListAtomsRequest {
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    pub filter: Option<NotepadFilter>,
    pub sort: Option<Vec<NotepadSort>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsRequest {
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    pub r#type: Option<String>,
    pub atom_id: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResponse<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub total_approx: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateAtomRequest {
    pub raw_text: String,
    pub capture_source: CaptureSource,
    pub initial_facets: Option<Vec<FacetKind>>,
    pub facet_data: Option<AtomFacets>,
    pub relations: Option<AtomRelations>,
    pub governance: Option<GovernanceMeta>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyPatch {
    pub mode: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAtomRequest {
    pub expected_revision: i64,
    pub raw_text: Option<String>,
    pub facet_data_patch: Option<AtomFacets>,
    pub relations_patch: Option<AtomRelations>,
    pub body_patch: Option<BodyPatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskStatusRequest {
    pub expected_revision: i64,
    pub status: TaskStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAtomRequest {
    pub expected_revision: i64,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNotepadViewRequest {
    pub expected_revision: Option<i64>,
    pub definition: NotepadViewDefinitionInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotepadViewDefinitionInput {
    pub id: String,
    pub schema_version: i32,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    pub filters: NotepadFilter,
    pub sorts: Vec<NotepadSort>,
    pub layout_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskReopenRequest {
    pub expected_revision: i64,
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilities {
    pub obsidian_cli_available: bool,
    pub base_query_available: bool,
    pub selected_vault: Option<String>,
    pub supported_commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHealth {
    pub adapter_healthy: bool,
    pub vault_accessible: bool,
    pub last_successful_command_at: Option<DateTime<Utc>>,
    pub message: Option<String>,
}
