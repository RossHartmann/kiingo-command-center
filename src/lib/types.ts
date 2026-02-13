export type Provider = "codex" | "claude";

export type RunMode = "non-interactive" | "interactive";

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted";

export type EventType =
  | "run.started"
  | "run.chunk.stdout"
  | "run.chunk.stderr"
  | "run.progress"
  | "run.policy_audit"
  | "run.completed"
  | "run.failed"
  | "run.canceled"
  | "run.compatibility_warning"
  | "session.opened"
  | "session.input_accepted"
  | "session.closed";

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
  optionalFlags: Record<string, string | boolean | number>;
  profileId?: string;
  queuePriority?: number;
  timeoutSeconds?: number;
  scheduledAt?: string;
  maxRetries?: number;
  retryBackoffMs?: number;
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

export interface AppSettings {
  codexPath: string;
  claudePath: string;
  retentionDays: number;
  maxStorageMb: number;
  allowAdvancedPolicy: boolean;
  remoteTelemetryOptIn: boolean;
  redactAggressive: boolean;
  storeEncryptedRawArtifacts: boolean;
}

export interface ListRunsFilters {
  provider?: Provider;
  status?: RunStatus;
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
