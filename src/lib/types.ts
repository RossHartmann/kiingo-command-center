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
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
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
  gridX?: number;
  gridY?: number;
  gridW?: number;
  gridH?: number;
}

export interface UpdateScreenMetricLayoutPayload {
  screenId: string;
  layouts: ScreenMetricLayoutItem[];
}

export interface ScreenMetricLayoutItem {
  bindingId: string;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
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

// ─── Workspace (Tasks + Notepad Platform) ───────────────────────────────────

export type IsoDateTime = string;
export type IsoDate = string;
export type EntityId = string;

export type FacetKind =
  | "task"
  | "note"
  | "meta"
  | "attention"
  | "commitment"
  | "blocking"
  | "recurrence"
  | "energy"
  | "agent";

export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "archived";
export type CommitmentLevel = "soft" | "hard";
export type AttentionLayer = "l3" | "ram" | "short" | "long" | "archive";
export type CaptureSource = "ui" | "manual" | "import" | "agent";
export type ClassificationSource = "manual" | "heuristic" | "llm";
export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";
export type EncryptionScope = "none" | "vault" | "field";

export interface TaskFacet {
  title: string;
  status: TaskStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  softDueAt?: IsoDateTime;
  hardDueAt?: IsoDateTime;
  snoozedUntil?: IsoDateTime;
  commitmentLevel?: CommitmentLevel;
  attentionLayer?: AttentionLayer;
  dreadLevel?: 0 | 1 | 2 | 3;
  assignee?: string;
  estimateMinutes?: number;
  completedAt?: IsoDateTime;
}

export interface NoteFacet {
  kind?: "freeform" | "journal" | "context" | "commentary";
}

export interface MetaFacet {
  labels?: string[];
  categories?: string[];
}

export interface AttentionFacet {
  layer: AttentionLayer;
  lastPromotedAt?: IsoDateTime;
  decayEligibleAt?: IsoDateTime;
  heatScore?: number;
  dwellStartedAt?: IsoDateTime;
  hiddenReason?: string;
}

export interface CommitmentFacet {
  level: CommitmentLevel;
  rationale?: string;
  mustReviewBy?: IsoDateTime;
}

export interface BlockingFacet {
  mode: "date" | "person" | "task";
  blockedUntil?: IsoDateTime;
  waitingOnPerson?: string;
  waitingCadenceDays?: number;
  blockedByAtomId?: EntityId;
  lastFollowupAt?: IsoDateTime;
  followupCount?: number;
}

export interface RecurrenceFacet {
  templateId: EntityId;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  interval?: number;
  byDay?: string[];
  instanceIndex?: number;
}

export interface EnergyFacet {
  dreadLevel?: 0 | 1 | 2 | 3;
  lastCapacityMatch?: "full" | "normal" | "low";
}

export interface AgentFacet {
  conversationId?: string;
  workflowId?: string;
  lastAgentActionAt?: IsoDateTime;
}

export interface AtomFacets {
  task?: TaskFacet;
  note?: NoteFacet;
  meta?: MetaFacet;
  attention?: AttentionFacet;
  commitment?: CommitmentFacet;
  blocking?: BlockingFacet;
  recurrence?: RecurrenceFacet;
  energy?: EnergyFacet;
  agent?: AgentFacet;
}

export interface AtomRelations {
  parentId?: EntityId;
  blockedByAtomId?: EntityId;
  threadIds: EntityId[];
  derivedFromAtomId?: EntityId;
}

export interface GovernanceMeta {
  sensitivity: SensitivityLevel;
  retentionPolicyId?: EntityId;
  origin: "user_input" | "system_generated" | "agent_generated" | "imported" | "synced";
  sourceRef?: string;
  encryptionScope: EncryptionScope;
  allowedAgentScopes?: string[];
}

export interface AtomRecord {
  id: EntityId;
  schemaVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  rawText: string;
  captureSource: CaptureSource;
  facets: FacetKind[];
  facetData: AtomFacets;
  relations: AtomRelations;
  governance: GovernanceMeta;
  body?: string;
  revision: number;
  archivedAt?: IsoDateTime;
}

export interface ClassificationResult {
  primaryFacet: "task" | "note" | "meta";
  confidence: number;
  source: ClassificationSource;
  reasoning?: string;
}

export interface NotepadFilter {
  facet?: FacetKind;
  statuses?: TaskStatus[];
  threadIds?: EntityId[];
  labels?: string[];
  categories?: string[];
  parentId?: EntityId;
  attentionLayers?: AttentionLayer[];
  commitmentLevels?: CommitmentLevel[];
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
  textQuery?: string;
  includeArchived?: boolean;
}

export interface NotepadSort {
  field:
    | "createdAt"
    | "updatedAt"
    | "priority"
    | "softDueAt"
    | "hardDueAt"
    | "attentionLayer"
    | "title";
  direction: "asc" | "desc";
}

export interface NotepadCaptureDefaults {
  initialFacets?: FacetKind[];
  taskStatus?: TaskStatus;
  taskPriority?: 1 | 2 | 3 | 4 | 5;
  threadIds?: EntityId[];
  categories?: string[];
  labels?: string[];
  commitmentLevel?: CommitmentLevel;
  attentionLayer?: AttentionLayer;
}

export interface NotepadViewDefinition {
  id: EntityId;
  schemaVersion: number;
  name: string;
  description?: string;
  isSystem: boolean;
  filters: NotepadFilter;
  sorts: NotepadSort[];
  captureDefaults?: NotepadCaptureDefaults;
  layoutMode: "outline" | "list" | "focus";
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export type WorkspaceEventType =
  | "atom.created"
  | "atom.updated"
  | "atom.classified"
  | "task.status_changed"
  | "task.completed"
  | "atom.archived"
  | "relation.linked"
  | "relation.unlinked"
  | "placement.saved"
  | "placement.deleted"
  | "placement.reordered"
  | "condition.set"
  | "condition.followup_logged"
  | "condition.transitioned"
  | "notepad.view_opened"
  | "triage.prompted"
  | "rule.evaluated"
  | "job.run.started"
  | "job.run.completed"
  | "job.run.failed"
  | "decision.created"
  | "decision.resolved"
  | "work.session.started"
  | "work.session.noted"
  | "work.session.ended"
  | "work.session.canceled"
  | "notification.sent"
  | "notification.failed"
  | "projection.refreshed"
  | "projection.failed"
  | "registry.updated"
  | "governance.retention_applied"
  | "migration.run.started"
  | "migration.schema.backfilled"
  | "migration.run.completed"
  | "migration.run.failed";

export interface WorkspaceEventRecord {
  id: EntityId;
  type: WorkspaceEventType;
  occurredAt: IsoDateTime;
  actor: "user" | "system" | "agent";
  actorId?: string;
  atomId?: EntityId;
  payload: Record<string, unknown>;
}

export interface PageRequest {
  limit?: number;
  cursor?: string;
}

export interface PageResponse<T> {
  items: T[];
  nextCursor?: string;
  totalApprox?: number;
}

export interface ListAtomsRequest extends PageRequest {
  filter?: NotepadFilter;
  sort?: NotepadSort[];
}

export interface CreateAtomRequest {
  rawText: string;
  captureSource: CaptureSource;
  initialFacets?: FacetKind[];
  facetData?: Partial<AtomFacets>;
  relations?: Partial<AtomRelations>;
  governance?: GovernanceMeta;
  idempotencyKey?: string;
  body?: string;
}

export interface BodyPatch {
  mode: "replace" | "append" | "prepend";
  value: string;
}

export interface UpdateAtomRequest {
  expectedRevision: number;
  idempotencyKey?: string;
  rawText?: string;
  facetDataPatch?: Partial<AtomFacets>;
  relationsPatch?: Partial<AtomRelations>;
  clearParentId?: boolean;
  bodyPatch?: BodyPatch;
}

export interface SetTaskStatusRequest {
  expectedRevision: number;
  idempotencyKey?: string;
  status: TaskStatus;
  reason?: string;
}

export interface TaskReopenRequest {
  expectedRevision: number;
  idempotencyKey?: string;
  status?: "todo" | "doing" | "blocked";
}

export interface ArchiveAtomRequest {
  expectedRevision: number;
  idempotencyKey?: string;
  reason?: string;
}

export interface SaveNotepadViewRequest {
  expectedRevision?: number;
  idempotencyKey?: string;
  definition: Omit<NotepadViewDefinition, "createdAt" | "updatedAt" | "revision">;
}

export interface BlockRecord {
  id: EntityId;
  schemaVersion: number;
  atomId?: EntityId;
  text: string;
  kind: "unknown" | "task" | "note" | "heading" | "meta" | "quote" | string;
  lifecycle: "active" | "completed" | "archived";
  parentBlockId?: EntityId;
  threadIds: EntityId[];
  labels: string[];
  categories: string[];
  taskStatus?: TaskStatus;
  priority?: number;
  attentionLayer?: AttentionLayer;
  commitmentLevel?: CommitmentLevel;
  completedAt?: IsoDateTime;
  archivedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export interface PlacementRecord {
  id: EntityId;
  schemaVersion: number;
  viewId: EntityId;
  blockId: EntityId;
  parentPlacementId?: EntityId;
  orderKey: string;
  pinned: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export interface ListBlocksRequest extends PageRequest {
  notepadId?: EntityId;
  atomId?: EntityId;
  lifecycle?: BlockRecord["lifecycle"];
  textQuery?: string;
}

export interface ListPlacementsRequest extends PageRequest {
  viewId?: EntityId;
  blockId?: EntityId;
}

export interface CreateBlockInNotepadRequest {
  notepadId: EntityId;
  rawText: string;
  body?: string;
  captureSource?: CaptureSource;
  idempotencyKey?: string;
}

export interface PlacementReorderRequest {
  expectedRevisions?: number[];
  orderedPlacementIds: EntityId[];
  idempotencyKey?: string;
}

export interface WorkspaceMutationPayload {
  expectedRevision?: number;
  idempotencyKey?: string;
  [key: string]: unknown;
}

export interface ListEventsRequest extends PageRequest {
  type?: WorkspaceEventType;
  atomId?: EntityId;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface WorkspaceCapabilities {
  obsidianCliAvailable: boolean;
  baseQueryAvailable: boolean;
  selectedVault?: string;
  supportedCommands: string[];
}

export interface WorkspaceHealth {
  adapterHealthy: boolean;
  vaultAccessible: boolean;
  lastSuccessfulCommandAt?: IsoDateTime;
  message?: string;
}

export interface ObsidianTaskSyncResult {
  vaultPath: string;
  scannedFiles: number;
  discoveredTasks: number;
  createdAtoms: number;
  updatedAtoms: number;
  unchangedAtoms: number;
  archivedAtoms: number;
}

export type RuleScope = "atom" | "task" | "thread" | "notepad" | "system";
export type RuleTriggerKind = "event" | "schedule" | "manual";

export interface RuleTrigger {
  kind: RuleTriggerKind;
  eventTypes?: WorkspaceEventType[];
  scheduleId?: EntityId;
}

export interface RuleCondition {
  field: string;
  op: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "exists" | "contains" | "matches";
  value?: unknown;
}

export type RuleActionKind =
  | "enqueue_decision_prompt"
  | "enqueue_job"
  | "emit_notification"
  | "set_field"
  | "add_relation"
  | "add_tag"
  | "record_event";

export interface RuleAction {
  kind: RuleActionKind;
  params: Record<string, unknown>;
}

export interface RuleDefinition {
  id: EntityId;
  schemaVersion: number;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  scope: RuleScope;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
  cooldownMs?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export type JobType =
  | "sweep.classification"
  | "sweep.decay"
  | "sweep.boundary"
  | "triage.enqueue"
  | "recurrence.spawn"
  | "followup.enqueue"
  | "projection.refresh"
  | "semantic.reindex";

export type JobSchedule =
  | { kind: "interval"; everyMinutes: number }
  | { kind: "weekly"; byDay: string[]; hour: number; minute: number; tz: string }
  | { kind: "manual" };

export interface JobDefinition {
  id: EntityId;
  schemaVersion: number;
  type: JobType;
  enabled: boolean;
  schedule: JobSchedule;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  dedupeWindowMs?: number;
  payloadTemplate?: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export type JobRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled" | "skipped";

export interface JobRunRecord {
  id: EntityId;
  jobId: EntityId;
  status: JobRunStatus;
  trigger: "schedule" | "manual" | "rule";
  attempt: number;
  startedAt?: IsoDateTime;
  finishedAt?: IsoDateTime;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export type DecisionPromptType =
  | "force_decision"
  | "boundary_crossing"
  | "stale_hard_commitment"
  | "blocked_followup"
  | "thread_staleness"
  | "confession";

export type DecisionPromptStatus = "pending" | "snoozed" | "resolved" | "expired" | "dismissed";

export interface DecisionOption {
  id: string;
  label: string;
  actionKind:
    | "task.do_now"
    | "task.snooze"
    | "task.drop"
    | "task.recommit"
    | "task.reschedule"
    | "task.cancel_commitment"
    | "task.unblock"
    | "task.archive"
    | "confession.create_blocker";
  payload?: Record<string, unknown>;
}

export interface DecisionPrompt {
  id: EntityId;
  schemaVersion: number;
  type: DecisionPromptType;
  status: DecisionPromptStatus;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  atomIds: EntityId[];
  options: DecisionOption[];
  dueAt?: IsoDateTime;
  snoozedUntil?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
  resolvedOptionId?: string;
  resolutionNotes?: string;
  revision: number;
}

export type WorkSessionStatus = "running" | "ended" | "canceled";
export type ConditionStatus = "active" | "satisfied" | "cancelled" | string;
export type ConditionMode = "date" | "person" | "task" | string;

export interface ConditionRecord {
  id: EntityId;
  schemaVersion: number;
  atomId: EntityId;
  status: ConditionStatus;
  mode: ConditionMode;
  blockedUntil?: IsoDateTime;
  waitingOnPerson?: string;
  waitingCadenceDays?: number;
  blockerAtomId?: EntityId;
  lastFollowupAt?: IsoDateTime;
  nextFollowupAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  resolvedAt?: IsoDateTime;
  canceledAt?: IsoDateTime;
  revision: number;
}

export interface WorkSessionRecord {
  id: EntityId;
  status: WorkSessionStatus;
  focusBlockIds: EntityId[];
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
  canceledAt?: IsoDateTime;
  notes: string[];
  summaryNote?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export interface WorkSessionStartRequest {
  focusBlockIds?: EntityId[];
  note?: string;
  idempotencyKey?: string;
}

export interface WorkSessionNoteRequest {
  expectedRevision: number;
  note: string;
  idempotencyKey?: string;
}

export interface WorkSessionEndRequest {
  expectedRevision: number;
  summaryNote?: string;
  idempotencyKey?: string;
}

export interface WorkSessionCancelRequest {
  expectedRevision: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface ConditionSetDateRequest {
  atomId: EntityId;
  untilAt: IsoDateTime;
  idempotencyKey?: string;
}

export interface ConditionSetPersonRequest {
  atomId: EntityId;
  waitingOnPerson: string;
  cadenceDays: number;
  idempotencyKey?: string;
}

export interface ConditionSetTaskRequest {
  atomId: EntityId;
  blockerAtomId: EntityId;
  idempotencyKey?: string;
}

export interface ConditionFollowupRequest {
  expectedRevision: number;
  followedUpAt?: IsoDateTime;
  idempotencyKey?: string;
}

export interface ConditionResolveRequest {
  expectedRevision: number;
  idempotencyKey?: string;
}

export interface ConditionCancelRequest {
  expectedRevision: number;
  reason?: string;
  idempotencyKey?: string;
}

export interface RecurrenceTemplate {
  id: EntityId;
  schemaVersion: number;
  status: "active" | "paused" | "retired" | string;
  titleTemplate: string;
  rawTextTemplate: string;
  defaultNotepadId?: EntityId;
  threadIds: EntityId[];
  frequency: "daily" | "weekly" | "monthly" | "custom" | string;
  interval: number;
  byDay: string[];
  nextRunAt?: IsoDateTime;
  lastSpawnedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export interface RecurrenceInstance {
  id: EntityId;
  templateId: EntityId;
  status: "scheduled" | "spawned" | "missed" | "completed" | "archived" | string;
  scheduledFor: IsoDateTime;
  spawnedAt?: IsoDateTime;
  dueAt?: IsoDateTime;
  atomId?: EntityId;
  blockId?: EntityId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  revision: number;
}

export interface RecurrenceSpawnRequest {
  templateIds?: EntityId[];
  now?: IsoDateTime;
  idempotencyKey?: string;
}

export interface RecurrenceSpawnResponse {
  accepted: boolean;
  spawnedInstanceIds: EntityId[];
  touchedTemplateIds: EntityId[];
}

export interface AttentionUpdateRequest {
  now?: IsoDateTime;
  idempotencyKey?: string;
}

export interface AttentionUpdateResponse {
  accepted: boolean;
  updatedAtomIds: EntityId[];
  decisionIds: EntityId[];
}

export interface DecisionGenerateRequest {
  now?: IsoDateTime;
  idempotencyKey?: string;
}

export interface DecisionGenerateResponse {
  accepted: boolean;
  createdOrUpdatedIds: EntityId[];
}

export type NotificationChannel = "in_app" | "push" | "email" | "sms" | "webhook";
export type NotificationStatus = "queued" | "sent" | "delivered" | "failed" | "suppressed";

export interface NotificationMessage {
  id: EntityId;
  channel: NotificationChannel;
  recipient: string;
  title: string;
  body: string;
  ctaUrl?: string;
  priority: 1 | 2 | 3 | 4 | 5;
  dedupeKey?: string;
  scheduledFor?: IsoDateTime;
  relatedAtomIds?: EntityId[];
  relatedPromptId?: EntityId;
}

export interface NotificationDeliveryRecord {
  id: EntityId;
  messageId: EntityId;
  status: NotificationStatus;
  attemptedAt: IsoDateTime;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export type ProjectionType =
  | "tasks.list"
  | "tasks.waiting"
  | "focus.queue"
  | "today.a_list"
  | "thread.health"
  | "history.daily";

export interface ProjectionDefinition {
  id: EntityId;
  schemaVersion: number;
  type: ProjectionType;
  source: "atoms+events";
  enabled: boolean;
  refreshMode: "event_driven" | "scheduled" | "manual";
  scheduleId?: EntityId;
  outputPath?: string;
  versionTag: string;
  revision: number;
}

export interface ProjectionCheckpoint {
  projectionId: EntityId;
  lastEventCursor?: string;
  lastRebuiltAt?: IsoDateTime;
  status: "healthy" | "lagging" | "failed";
  errorMessage?: string;
}

export type RegistryEntryKind = "thread" | "category" | "north_star";
export type RegistryEntryStatus = "active" | "stale" | "retired";

export interface RegistryEntry {
  id: EntityId;
  schemaVersion: number;
  kind: RegistryEntryKind;
  name: string;
  aliases: string[];
  status: RegistryEntryStatus;
  parentIds: EntityId[];
  attentionFloor?: AttentionLayer;
  attentionCeiling?: AttentionLayer;
  metadata?: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastActivityAt?: IsoDateTime;
  revision: number;
}

export interface SemanticChunk {
  id: EntityId;
  atomId: EntityId;
  chunkIndex: number;
  text: string;
  hash: string;
  updatedAt: IsoDateTime;
}

export interface SemanticSearchRequest {
  query: string;
  topK: number;
  filters?: NotepadFilter;
}

export interface SemanticSearchHit {
  atomId: EntityId;
  chunkId: EntityId;
  score: number;
  snippet: string;
}

export type FeatureFlagKey =
  | "workspace.blocks_v2"
  | "workspace.placements_v2"
  | "workspace.capture_policy_v2"
  | "workspace.rules_engine"
  | "workspace.scheduler"
  | "workspace.decision_queue"
  | "workspace.notifications"
  | "workspace.projections"
  | "workspace.registry"
  | "workspace.semantic_index"
  | "workspace.decay_engine"
  | "workspace.focus_sessions_v2"
  | "workspace.recurrence"
  | "workspace.recurrence_v2"
  | "workspace.agent_handoff";

export interface FeatureFlag {
  key: FeatureFlagKey;
  enabled: boolean;
  rolloutPercent?: number;
  updatedAt: IsoDateTime;
}

export interface WorkspaceCapabilitySnapshot {
  capturedAt: IsoDateTime;
  obsidianCliAvailable: boolean;
  baseQueryAvailable: boolean;
  semanticAvailable: boolean;
  notificationChannels: NotificationChannel[];
  featureFlags: FeatureFlag[];
}

export type MigrationDomain = "schema" | "projection" | "rule";
export type MigrationStatus = "pending" | "running" | "succeeded" | "failed" | "rolled_back";

export interface MigrationPlan {
  id: EntityId;
  domain: MigrationDomain;
  fromVersion: number;
  toVersion: number;
  dryRun: boolean;
  steps: string[];
  createdAt: IsoDateTime;
}

export interface MigrationRun {
  id: EntityId;
  planId: EntityId;
  status: MigrationStatus;
  startedAt: IsoDateTime;
  finishedAt?: IsoDateTime;
  logs: string[];
  errorMessage?: string;
}

export interface RuleEvaluationResult {
  ruleId: EntityId;
  matched: boolean;
  evaluatedAt: IsoDateTime;
  trace: { condition: RuleCondition; passed: boolean }[];
}

export interface RulesListRequest extends PageRequest {
  enabled?: boolean;
}

export interface JobsListRequest extends PageRequest {
  enabled?: boolean;
}

export interface JobRunsListRequest extends PageRequest {
  jobId?: EntityId;
  status?: JobRunStatus;
}

export interface DecisionsListRequest extends PageRequest {
  status?: DecisionPromptStatus;
}

export interface WorkSessionsListRequest extends PageRequest {
  status?: WorkSessionStatus;
}

export interface ListConditionsRequest extends PageRequest {
  atomId?: EntityId;
  status?: ConditionStatus;
  mode?: ConditionMode;
}

export interface RecurrenceTemplatesListRequest extends PageRequest {
  status?: RecurrenceTemplate["status"];
}

export interface RecurrenceInstancesListRequest extends PageRequest {
  templateId?: EntityId;
  status?: RecurrenceInstance["status"];
}

export interface NotificationDeliveriesListRequest extends PageRequest {
  status?: NotificationStatus;
  channel?: NotificationChannel;
}

export interface RegistryEntriesListRequest extends PageRequest {
  kind?: RegistryEntryKind;
  status?: RegistryEntryStatus;
  search?: string;
}

export interface AtomGovernanceUpdateRequest {
  expectedRevision: number;
  governance: GovernanceMeta;
  idempotencyKey?: string;
}

export interface FeatureFlagUpdateRequest {
  enabled: boolean;
  rolloutPercent?: number;
  idempotencyKey?: string;
}

export interface MigrationPlanCreateRequest {
  domain: MigrationDomain;
  fromVersion: number;
  toVersion: number;
  dryRun: boolean;
  idempotencyKey?: string;
}
