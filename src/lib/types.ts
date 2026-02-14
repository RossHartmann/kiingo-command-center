export type Provider = "codex" | "claude";

export type RunMode = "non-interactive" | "interactive";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

export type EventType = string;

export interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  eventType: EventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RunArtifact {
  id: string;
  runId: string;
  kind: string;
  path: string;
  metadata: Record<string, unknown>;
}

export interface RunRecord {
  id: string;
  provider: Provider;
  status: RunStatus;
  prompt: string;
  model?: string;
  mode: RunMode;
  outputFormat?: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  errorSummary?: string;
  queuePriority: number;
  profileId?: string;
  capabilitySnapshotId?: string;
  compatibilityWarnings: string[];
  conversationId?: string;
}

export interface RunDetail {
  run: RunRecord;
  events: RunEvent[];
  artifacts: RunArtifact[];
}

export interface StartRunPayload {
  provider: Provider;
  prompt: string;
  model?: string;
  mode: RunMode;
  outputFormat?: "text" | "json" | "stream-json";
  cwd: string;
  optionalFlags: Record<string, unknown>;
  profileId?: string;
  queuePriority?: number;
  timeoutSeconds?: number;
  scheduledAt?: string;
  maxRetries?: number;
  retryBackoffMs?: number;
  harness?: HarnessRequestOptions;
}

export interface ConversationRecord {
  id: string;
  provider: Provider;
  title: string;
  providerSessionId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ConversationSummary {
  id: string;
  provider: Provider;
  title: string;
  providerSessionId?: string;
  updatedAt: string;
  archivedAt?: string;
  lastRunId?: string;
  lastMessagePreview?: string;
}

export interface ConversationDetail {
  conversation: ConversationRecord;
  runs: RunRecord[];
}

export interface CreateConversationPayload {
  provider: Provider;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ListConversationsFilters {
  provider?: Provider;
  includeArchived?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SendConversationMessagePayload {
  conversationId: string;
  prompt: string;
  model?: string;
  outputFormat?: "text" | "json" | "stream-json";
  cwd?: string;
  optionalFlags?: Record<string, unknown>;
  profileId?: string;
  queuePriority?: number;
  timeoutSeconds?: number;
  scheduledAt?: string;
  maxRetries?: number;
  retryBackoffMs?: number;
  harness?: HarnessRequestOptions;
}

export type UnifiedTool =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "file_search"
  | "content_search"
  | "shell"
  | "web_fetch"
  | "web_search"
  | "mcp"
  | "task";

export type SandboxMode = "read-only" | "workspace-write" | "full-access";
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

export interface UnifiedPermission {
  sandboxMode: SandboxMode;
  autoApprove: boolean;
  networkAccess: boolean;
  approvalPolicy?: ApprovalPolicy;
}

export interface AgentLimits {
  maxBudgetUsd?: number;
  maxTurns?: number;
  timeoutMs?: number;
  maxToolResultLines?: number;
}

export interface StructuredOutputConfig {
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface CliAllowlistEntry {
  name: string;
  path: string;
  args?: string[];
  env?: Record<string, string>;
}

export type CliAllowlistMode = "shims" | "wrapper";

export interface CliAllowlistConfig {
  entries: CliAllowlistEntry[];
  mode?: CliAllowlistMode;
  wrapperName?: string;
  binDir?: string;
  keepBinDir?: boolean;
}

export interface ShellPreludeConfig {
  content: string;
  bashEnv?: boolean;
  shEnv?: boolean;
}

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  type?: "stdio" | "http" | "sse";
  enabledTools?: string[];
  disabledTools?: string[];
  enabled?: boolean;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export interface HarnessRequestOptions {
  resumeSessionId?: string;
  continueSession?: boolean;
  inputFormat?: "text" | "stream-json";
  additionalDirectories?: string[];
  tools?: UnifiedTool[];
  permissions?: UnifiedPermission;
  limits?: AgentLimits;
  mcp?: McpConfig;
  structuredOutput?: StructuredOutputConfig;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  pipedContent?: string;
  images?: ImageAttachment[];
  files?: FileAttachment[];
  processEnv?: Record<string, string>;
  cliAllowlist?: CliAllowlistConfig;
  shellPrelude?: ShellPreludeConfig;
}

export interface Profile {
  id: string;
  name: string;
  provider: Provider;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityProfile {
  provider: Provider;
  cliVersion: string;
  supported: boolean;
  degraded: boolean;
  blocked: boolean;
  supportedFlags: string[];
  supportedModes: RunMode[];
  disabledReasons: string[];
}

export interface CapabilitySnapshot {
  id: string;
  provider: Provider;
  cliVersion: string;
  profile: CapabilityProfile;
  detectedAt: string;
}

export interface WorkspaceGrant {
  id: string;
  path: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt?: string;
}

export interface SchedulerJob {
  id: string;
  runId: string;
  priority: number;
  state: "queued" | "running" | "completed" | "failed";
  queuedAt: string;
  nextRunAt?: string;
  attempts: number;
  maxRetries: number;
  retryBackoffMs: number;
  lastError?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface NavOrderConfig {
  groupOrder: string[];
  itemOrder: Record<string, string[]>;
}

export interface AppSettings {
  codexPath: string;
  claudePath: string;
  conversationThreadsV1: boolean;
  retentionDays: number;
  maxStorageMb: number;
  allowAdvancedPolicy: boolean;
  remoteTelemetryOptIn: boolean;
  redactAggressive: boolean;
  storeEncryptedRawArtifacts: boolean;
  navOrder?: NavOrderConfig;
}

export interface ListRunsFilters {
  provider?: Provider;
  status?: RunStatus;
  conversationId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface StreamEnvelope {
  runId: string;
  type: EventType;
  payload: Record<string, unknown>;
  timestamp: string;
  eventId?: string;
  seq?: number;
}

// ─── Metric Library ─────────────────────────────────────────────────────────

export type MetricSnapshotStatus = "pending" | "running" | "completed" | "failed";
export type MetricLayoutHint = "card" | "wide" | "full";

export interface MetricDefinition {
  id: string;
  name: string;
  slug: string;
  instructions: string;
  templateHtml: string;
  ttlSeconds: number;
  provider: Provider;
  model?: string;
  profileId?: string;
  cwd?: string;
  enabled: boolean;
  proactive: boolean;
  metadataJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface MetricSnapshot {
  id: string;
  metricId: string;
  runId?: string;
  valuesJson: Record<string, unknown>;
  renderedHtml: string;
  status: MetricSnapshotStatus;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ScreenMetricBinding {
  id: string;
  screenId: string;
  metricId: string;
  position: number;
  layoutHint: string;
}

export interface SaveMetricDefinitionPayload {
  id?: string;
  name: string;
  slug: string;
  instructions: string;
  templateHtml?: string;
  ttlSeconds?: number;
  provider?: Provider;
  model?: string;
  profileId?: string;
  cwd?: string;
  enabled?: boolean;
  proactive?: boolean;
  metadataJson?: Record<string, unknown>;
}

export interface BindMetricToScreenPayload {
  screenId: string;
  metricId: string;
  position?: number;
  layoutHint?: MetricLayoutHint;
}

export interface ScreenMetricView {
  binding: ScreenMetricBinding;
  definition: MetricDefinition;
  latestSnapshot?: MetricSnapshot;
  isStale: boolean;
  refreshInProgress: boolean;
}

export interface MetricRefreshResponse {
  metricId: string;
  snapshotId: string;
  runId?: string;
}
