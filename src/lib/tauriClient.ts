import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  BindMetricToScreenPayload,
  CapabilitySnapshot,
  ConversationDetail,
  ConversationRecord,
  ConversationSummary,
  CreateConversationPayload,
  ListConversationsFilters,
  ListRunsFilters,
  MetricDefinition,
  MetricRefreshResponse,
  MetricSnapshot,
  Profile,
  SaveMetricDefinitionPayload,
  SaveNotepadViewRequest,
  ScreenMetricBinding,
  ScreenMetricView,
  SendConversationMessagePayload,
  SetTaskStatusRequest,
  TaskReopenRequest,
  RunDetail,
  RunRecord,
  SchedulerJob,
  StartRunPayload,
  StreamEnvelope,
  UpdateAtomRequest,
  UpdateScreenMetricLayoutPayload,
  WorkspaceCapabilities,
  WorkspaceEventRecord,
  WorkspaceGrant,
  WorkspaceHealth,
  AtomRecord,
  ListAtomsRequest,
  CreateAtomRequest,
  ArchiveAtomRequest,
  NotepadViewDefinition,
  PageRequest,
  PageResponse,
  ListEventsRequest,
  ClassificationResult,
  ClassificationSource,
  RuleDefinition,
  RuleEvaluationResult,
  JobDefinition,
  JobRunRecord,
  DecisionPrompt,
  NotificationChannel,
  NotificationMessage,
  NotificationDeliveryRecord,
  ProjectionDefinition,
  ProjectionCheckpoint,
  RegistryEntry,
  RegistryEntryKind,
  SemanticChunk,
  SemanticSearchRequest,
  SemanticSearchHit,
  GovernanceMeta,
  AtomGovernanceUpdateRequest,
  FeatureFlag,
  WorkspaceCapabilitySnapshot,
  MigrationPlan,
  MigrationRun,
  RulesListRequest,
  JobsListRequest,
  JobRunsListRequest,
  DecisionsListRequest,
  NotificationDeliveriesListRequest,
  RegistryEntriesListRequest,
  FeatureFlagUpdateRequest,
  MigrationPlanCreateRequest,
  EntityId
} from "./types";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const LOCAL_STORAGE_KEY = "local-cli-control-center-mock";

interface MockStore {
  runs: RunRecord[];
  conversations: ConversationRecord[];
  profiles: Profile[];
  grants: WorkspaceGrant[];
  jobs: SchedulerJob[];
  capabilities: CapabilitySnapshot[];
  settings: AppSettings;
  metricDefinitions: MetricDefinition[];
  metricSnapshots: MetricSnapshot[];
  screenMetrics: ScreenMetricBinding[];
  atoms: AtomRecord[];
  notepads: NotepadViewDefinition[];
  workspaceEvents: WorkspaceEventRecord[];
  rules: RuleDefinition[];
  workspaceJobs: JobDefinition[];
  jobRuns: JobRunRecord[];
  decisions: DecisionPrompt[];
  notifications: NotificationMessage[];
  notificationDeliveries: NotificationDeliveryRecord[];
  projections: ProjectionDefinition[];
  projectionCheckpoints: ProjectionCheckpoint[];
  registryEntries: RegistryEntry[];
  semanticChunks: SemanticChunk[];
  featureFlags: FeatureFlag[];
  migrationPlans: MigrationPlan[];
  migrationRuns: MigrationRun[];
}

const defaultSettings: AppSettings = {
  codexPath: "codex",
  claudePath: "claude",
  conversationThreadsV1: true,
  retentionDays: 90,
  maxStorageMb: 1024,
  allowAdvancedPolicy: false,
  remoteTelemetryOptIn: false,
  redactAggressive: true,
  storeEncryptedRawArtifacts: false,
  navOrder: undefined
};

const mockStore = loadMockStore();

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function ensureIdempotencyKey(idempotencyKey?: string): string {
  const key = idempotencyKey?.trim();
  if (key && key.length > 0) {
    return key;
  }
  return uid("idem");
}

function atomId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const time = now.toISOString().slice(11, 19).replaceAll(":", "");
  return `atom_${date}_${time}_${crypto.randomUUID().slice(0, 4)}`;
}

function defaultWorkspaceGovernance(): AtomRecord["governance"] {
  return {
    sensitivity: "internal",
    retentionPolicyId: undefined,
    origin: "user_input",
    sourceRef: undefined,
    encryptionScope: "none",
    allowedAgentScopes: undefined
  };
}

function classifyRawText(rawText: string): ClassificationResult {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]")) {
    return { primaryFacet: "task", confidence: 0.88, source: "heuristic", reasoning: "task marker prefix detected" };
  }
  if (trimmed.startsWith("#") || trimmed.startsWith(">")) {
    return { primaryFacet: "note", confidence: 0.72, source: "heuristic", reasoning: "note-like structure detected" };
  }
  return { primaryFacet: "meta", confidence: 0.55, source: "heuristic", reasoning: "default freeform classification" };
}

function deriveTaskTitle(rawText: string): string {
  const first = rawText.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "Untitled task";
  return first.replace(/^- \[[ xX]\]\s*/, "").replace(/^[-*]\s*/, "").slice(0, 120);
}

function ensureNowNotepad(): void {
  const existing = mockStore.notepads.find((notepad) => notepad.id === "now");
  if (existing) {
    return;
  }
  const now = nowIso();
  mockStore.notepads.unshift({
    id: "now",
    schemaVersion: 1,
    name: "Now",
    description: "System default view for active work",
    isSystem: true,
    filters: { facet: "task", statuses: ["todo", "doing", "blocked"], includeArchived: false },
    sorts: [{ field: "priority", direction: "asc" }],
    layoutMode: "list",
    createdAt: now,
    updatedAt: now,
    revision: 1
  });
}

function recordWorkspaceEvent(
  type: WorkspaceEventRecord["type"],
  payload: Record<string, unknown>,
  atomIdValue?: string
): void {
  mockStore.workspaceEvents.unshift({
    id: uid("evt"),
    type,
    occurredAt: nowIso(),
    actor: "user",
    atomId: atomIdValue,
    payload
  });
}

function emptyMockStore(): MockStore {
  return {
    runs: [],
    conversations: [],
    profiles: [],
    grants: [],
    jobs: [],
    capabilities: [],
    settings: defaultSettings,
    metricDefinitions: [],
    metricSnapshots: [],
    screenMetrics: [],
    atoms: [],
    notepads: [],
    workspaceEvents: [],
    rules: [],
    workspaceJobs: [],
    jobRuns: [],
    decisions: [],
    notifications: [],
    notificationDeliveries: [],
    projections: [],
    projectionCheckpoints: [],
    registryEntries: [],
    semanticChunks: [],
    featureFlags: [],
    migrationPlans: [],
    migrationRuns: []
  };
}

function loadMockStore(): MockStore {
  const storage = getStorage();
  if (!storage) {
    return emptyMockStore();
  }
  const raw = storage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) {
    return emptyMockStore();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MockStore>;
    return {
      runs: parsed.runs ?? [],
      conversations: parsed.conversations ?? [],
      profiles: parsed.profiles ?? [],
      grants: parsed.grants ?? [],
      jobs: parsed.jobs ?? [],
      capabilities: parsed.capabilities ?? [],
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      metricDefinitions: parsed.metricDefinitions ?? [],
      metricSnapshots: parsed.metricSnapshots ?? [],
      screenMetrics: parsed.screenMetrics ?? [],
      atoms: parsed.atoms ?? [],
      notepads: parsed.notepads ?? [],
      workspaceEvents: parsed.workspaceEvents ?? [],
      rules: parsed.rules ?? [],
      workspaceJobs: parsed.workspaceJobs ?? [],
      jobRuns: parsed.jobRuns ?? [],
      decisions: parsed.decisions ?? [],
      notifications: parsed.notifications ?? [],
      notificationDeliveries: parsed.notificationDeliveries ?? [],
      projections: parsed.projections ?? [],
      projectionCheckpoints: parsed.projectionCheckpoints ?? [],
      registryEntries: parsed.registryEntries ?? [],
      semanticChunks: parsed.semanticChunks ?? [],
      featureFlags: parsed.featureFlags ?? [],
      migrationPlans: parsed.migrationPlans ?? [],
      migrationRuns: parsed.migrationRuns ?? []
    };
  } catch {
    return emptyMockStore();
  }
}

function persistMockStore(): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(mockStore));
}

function getStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage as unknown;
  if (!storage || typeof storage !== "object") {
    return null;
  }
  const maybe = storage as { getItem?: unknown; setItem?: unknown };
  if (typeof maybe.getItem !== "function" || typeof maybe.setItem !== "function") {
    return null;
  }
  return maybe as Pick<Storage, "getItem" | "setItem">;
}

async function tauriInvoke<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, payload);
}

function normalizeConversationTitle(raw?: string): string {
  const firstLine = (raw ?? "").split("\n")[0]?.trim() ?? "";
  if (!firstLine) {
    return "New chat";
  }
  const max = 80;
  return firstLine.length <= max ? firstLine : `${firstLine.slice(0, max - 3)}...`;
}

function toConversationSummary(conversation: ConversationRecord): ConversationSummary {
  const runs = mockStore.runs
    .filter((run) => run.conversationId === conversation.id)
    .sort((a, b) => new Date(a.startedAt).valueOf() - new Date(b.startedAt).valueOf());
  const last = runs[runs.length - 1];
  return {
    id: conversation.id,
    provider: conversation.provider,
    title: conversation.title,
    providerSessionId: conversation.providerSessionId,
    updatedAt: conversation.updatedAt,
    archivedAt: conversation.archivedAt,
    lastRunId: last?.id,
    lastMessagePreview: last?.prompt
  };
}

export async function startRun(payload: StartRunPayload): Promise<{ runId: string }> {
  if (IS_TAURI) {
    return tauriInvoke("start_run", { payload });
  }

  const startedAt = nowIso();
  const run: RunRecord = {
    id: uid("run"),
    provider: payload.provider,
    status: "queued",
    prompt: payload.prompt,
    model: payload.model,
    mode: payload.mode,
    outputFormat: payload.outputFormat,
    cwd: payload.cwd,
    startedAt,
    queuePriority: payload.queuePriority ?? 0,
    profileId: payload.profileId,
    compatibilityWarnings: [],
    conversationId: undefined
  };
  mockStore.runs.unshift(run);
  mockStore.jobs.unshift({
    id: uid("job"),
    runId: run.id,
    priority: run.queuePriority,
    state: "queued",
    queuedAt: startedAt,
    nextRunAt: payload.scheduledAt,
    attempts: 0,
    maxRetries: payload.maxRetries ?? 0,
    retryBackoffMs: payload.retryBackoffMs ?? 1000
  });
  persistMockStore();
  return { runId: run.id };
}

export async function cancelRun(runId: string): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("cancel_run", { runId });
  }
  const run = mockStore.runs.find((entry) => entry.id === runId);
  if (!run) {
    return { success: false };
  }
  run.status = "canceled";
  run.endedAt = nowIso();
  persistMockStore();
  return { success: true };
}

export async function rerun(runId: string, overrides: Partial<StartRunPayload>): Promise<{ newRunId: string }> {
  if (IS_TAURI) {
    return tauriInvoke("rerun", { runId, overrides });
  }
  const run = mockStore.runs.find((entry) => entry.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }
  const next = await startRun({
    provider: overrides.provider ?? run.provider,
    prompt: overrides.prompt ?? run.prompt,
    model: overrides.model ?? run.model,
    mode: overrides.mode ?? run.mode,
    outputFormat: overrides.outputFormat ?? (run.outputFormat as StartRunPayload["outputFormat"]),
    cwd: overrides.cwd ?? run.cwd,
    optionalFlags: overrides.optionalFlags ?? {},
    profileId: overrides.profileId,
    queuePriority: overrides.queuePriority ?? run.queuePriority,
    timeoutSeconds: overrides.timeoutSeconds,
    scheduledAt: overrides.scheduledAt,
    maxRetries: overrides.maxRetries,
    retryBackoffMs: overrides.retryBackoffMs
  });
  return { newRunId: next.runId };
}

export async function listRuns(filters: ListRunsFilters = {}): Promise<RunRecord[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_runs", { filters });
  }

  let runs = [...mockStore.runs];
  if (filters.provider) {
    runs = runs.filter((run) => run.provider === filters.provider);
  }
  if (filters.status) {
    runs = runs.filter((run) => run.status === filters.status);
  }
  if (filters.conversationId) {
    runs = runs.filter((run) => run.conversationId === filters.conversationId);
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    runs = runs.filter((run) => run.prompt.toLowerCase().includes(needle));
  }
  if (filters.dateFrom) {
    runs = runs.filter((run) => run.startedAt >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    runs = runs.filter((run) => run.startedAt <= filters.dateTo!);
  }

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 100;
  return runs.slice(offset, offset + limit);
}

export async function createConversation(payload: CreateConversationPayload): Promise<ConversationRecord> {
  if (IS_TAURI) {
    return tauriInvoke("create_conversation", { payload });
  }
  const now = nowIso();
  const conversation: ConversationRecord = {
    id: uid("conv"),
    provider: payload.provider,
    title: normalizeConversationTitle(payload.title),
    providerSessionId: undefined,
    metadata: payload.metadata ?? {},
    createdAt: now,
    updatedAt: now,
    archivedAt: undefined
  };
  mockStore.conversations.unshift(conversation);
  persistMockStore();
  return conversation;
}

export async function listConversations(
  filters: ListConversationsFilters = {}
): Promise<ConversationSummary[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_conversations", { filters });
  }
  let items = [...mockStore.conversations];
  if (filters.provider) {
    items = items.filter((conversation) => conversation.provider === filters.provider);
  }
  if (!filters.includeArchived) {
    items = items.filter((conversation) => !conversation.archivedAt);
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    items = items.filter((conversation) => conversation.title.toLowerCase().includes(needle));
  }
  items.sort((a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf());
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 100;
  return items.slice(offset, offset + limit).map((conversation) => toConversationSummary(conversation));
}

export async function getConversation(conversationId: string): Promise<ConversationDetail | null> {
  if (IS_TAURI) {
    return tauriInvoke("get_conversation", { conversationId });
  }
  const conversation = mockStore.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return null;
  }
  const runs = mockStore.runs
    .filter((run) => run.conversationId === conversationId)
    .slice()
    .sort((a, b) => new Date(a.startedAt).valueOf() - new Date(b.startedAt).valueOf());
  return {
    conversation,
    runs
  };
}

export async function sendConversationMessage(payload: SendConversationMessagePayload): Promise<{ runId: string }> {
  if (IS_TAURI) {
    return tauriInvoke("send_conversation_message", { payload });
  }
  const conversation = mockStore.conversations.find((item) => item.id === payload.conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${payload.conversationId}`);
  }
  if (conversation.archivedAt) {
    throw new Error("Cannot send message to archived conversation");
  }
  const activeWorkspace = mockStore.grants.find((grant) => !grant.revokedAt)?.path;
  const run = await startRun({
    provider: conversation.provider,
    prompt: payload.prompt,
    model: payload.model,
    mode: "non-interactive",
    outputFormat: payload.outputFormat ?? "text",
    cwd: payload.cwd ?? activeWorkspace ?? "",
    optionalFlags: payload.optionalFlags ?? {},
    profileId: payload.profileId,
    queuePriority: payload.queuePriority ?? 0,
    timeoutSeconds: payload.timeoutSeconds,
    scheduledAt: payload.scheduledAt,
    maxRetries: payload.maxRetries,
    retryBackoffMs: payload.retryBackoffMs,
    harness: {
      ...(payload.harness ?? {}),
      resumeSessionId: conversation.providerSessionId
    }
  });
  const created = mockStore.runs.find((entry) => entry.id === run.runId);
  if (created) {
    created.conversationId = conversation.id;
  }
  if (conversation.title === "New chat") {
    conversation.title = normalizeConversationTitle(payload.prompt);
  }
  conversation.updatedAt = nowIso();
  persistMockStore();
  return run;
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<ConversationRecord | null> {
  if (IS_TAURI) {
    return tauriInvoke("rename_conversation", {
      payload: { conversationId, title }
    });
  }
  const conversation = mockStore.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return null;
  }
  conversation.title = normalizeConversationTitle(title);
  conversation.updatedAt = nowIso();
  persistMockStore();
  return conversation;
}

export async function archiveConversation(
  conversationId: string,
  archived = true
): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("archive_conversation", {
      payload: { conversationId, archived }
    });
  }
  const conversation = mockStore.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return { success: false };
  }
  conversation.archivedAt = archived ? nowIso() : undefined;
  conversation.updatedAt = nowIso();
  persistMockStore();
  return { success: true };
}

export async function getRun(runId: string): Promise<RunDetail | null> {
  if (IS_TAURI) {
    return tauriInvoke("get_run", { runId });
  }
  const run = mockStore.runs.find((entry) => entry.id === runId);
  if (!run) {
    return null;
  }
  return {
    run,
    events: [],
    artifacts: []
  };
}

export async function listProfiles(): Promise<Profile[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_profiles");
  }
  return [...mockStore.profiles];
}

export async function saveProfile(payload: {
  id?: string;
  name: string;
  provider: Profile["provider"];
  config: Record<string, unknown>;
}): Promise<Profile> {
  if (IS_TAURI) {
    return tauriInvoke("save_profile", { payload });
  }

  const now = nowIso();
  if (payload.id) {
    const existing = mockStore.profiles.find((profile) => profile.id === payload.id);
    if (existing) {
      existing.name = payload.name;
      existing.provider = payload.provider;
      existing.config = payload.config;
      existing.updatedAt = now;
      persistMockStore();
      return existing;
    }
  }

  const profile: Profile = {
    id: uid("profile"),
    name: payload.name,
    provider: payload.provider,
    config: payload.config,
    createdAt: now,
    updatedAt: now
  };
  mockStore.profiles.unshift(profile);
  persistMockStore();
  return profile;
}

export async function listCapabilities(): Promise<CapabilitySnapshot[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_capabilities");
  }
  return [...mockStore.capabilities];
}

export async function listQueueJobs(): Promise<SchedulerJob[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_queue_jobs");
  }
  return [...mockStore.jobs];
}

export async function getSettings(): Promise<AppSettings> {
  if (IS_TAURI) {
    return tauriInvoke("get_settings");
  }
  return { ...mockStore.settings };
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  if (IS_TAURI) {
    return tauriInvoke("update_settings", { settings });
  }
  mockStore.settings = { ...mockStore.settings, ...settings };
  persistMockStore();
  return mockStore.settings;
}

export async function listWorkspaceGrants(): Promise<WorkspaceGrant[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_workspace_grants");
  }
  return [...mockStore.grants];
}

export async function grantWorkspace(path: string): Promise<WorkspaceGrant> {
  if (IS_TAURI) {
    return tauriInvoke("grant_workspace", { path });
  }
  const existing = mockStore.grants.find((grant) => grant.path === path && !grant.revokedAt);
  if (existing) {
    return existing;
  }
  const grant: WorkspaceGrant = {
    id: uid("grant"),
    path,
    grantedBy: "local-user",
    grantedAt: nowIso()
  };
  mockStore.grants.unshift(grant);
  persistMockStore();
  return grant;
}

export async function exportRun(runId: string, format: "md" | "json" | "txt"): Promise<{ path: string }> {
  if (IS_TAURI) {
    return tauriInvoke("export_run", { runId, format });
  }
  return { path: `${runId}.${format}` };
}

export async function startInteractiveSession(payload: StartRunPayload): Promise<{ runId: string; sessionId: string }> {
  if (IS_TAURI) {
    return tauriInvoke("start_interactive_session", { payload });
  }
  const result = await startRun({ ...payload, mode: "interactive" });
  return { runId: result.runId, sessionId: uid("session") };
}

export async function sendSessionInput(runId: string, data: string): Promise<{ accepted: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("send_session_input", { runId, data });
  }
  return { accepted: data.trim().length > 0 };
}

export async function endSession(runId: string): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("end_session", { runId });
  }
  return cancelRun(runId);
}

export async function resumeSession(runId: string): Promise<{ runId: string; sessionId: string }> {
  if (IS_TAURI) {
    return tauriInvoke("resume_session", { runId });
  }
  return { runId, sessionId: `session-${runId}` };
}

export async function onRunEvent(handler: (event: StreamEnvelope) => void): Promise<UnlistenFn> {
  if (!IS_TAURI) {
    return () => {};
  }
  return listen<StreamEnvelope>("run_event", ({ payload }) => {
    handler(payload);
  });
}

export async function saveProviderToken(provider: "codex" | "claude", token: string): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("save_provider_token", { provider, token });
  }
  return { success: token.trim().length > 0 };
}

export async function clearProviderToken(provider: "codex" | "claude"): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("clear_provider_token", { provider });
  }
  return { success: true };
}

export async function hasProviderToken(provider: "codex" | "claude"): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("has_provider_token", { provider });
  }
  return { success: false };
}

// ─── Metric Library ─────────────────────────────────────────────────────────

export async function saveMetricDefinition(payload: SaveMetricDefinitionPayload): Promise<MetricDefinition> {
  if (IS_TAURI) {
    return tauriInvoke("save_metric_definition", { payload });
  }
  const now = nowIso();
  const existing = payload.id ? mockStore.metricDefinitions.find((d) => d.id === payload.id) : undefined;
  if (existing) {
    Object.assign(existing, {
      name: payload.name,
      slug: payload.slug,
      instructions: payload.instructions,
      templateHtml: payload.templateHtml ?? existing.templateHtml,
      ttlSeconds: payload.ttlSeconds ?? existing.ttlSeconds,
      provider: payload.provider ?? existing.provider,
      model: payload.model,
      profileId: payload.profileId,
      cwd: payload.cwd,
      enabled: payload.enabled ?? existing.enabled,
      proactive: payload.proactive ?? existing.proactive,
      metadataJson: payload.metadataJson ?? existing.metadataJson,
      updatedAt: now
    });
    persistMockStore();
    return existing;
  }
  const definition: MetricDefinition = {
    id: uid("metric"),
    name: payload.name,
    slug: payload.slug,
    instructions: payload.instructions,
    templateHtml: payload.templateHtml ?? "",
    ttlSeconds: payload.ttlSeconds ?? 3600,
    provider: payload.provider ?? "claude",
    model: payload.model,
    profileId: payload.profileId,
    cwd: payload.cwd,
    enabled: payload.enabled ?? true,
    proactive: payload.proactive ?? false,
    metadataJson: payload.metadataJson ?? {},
    createdAt: now,
    updatedAt: now
  };
  mockStore.metricDefinitions.unshift(definition);
  persistMockStore();
  return definition;
}

export async function getMetricDefinition(id: string): Promise<MetricDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("get_metric_definition", { id });
  }
  return mockStore.metricDefinitions.find((d) => d.id === id) ?? null;
}

export async function listMetricDefinitions(includeArchived = false): Promise<MetricDefinition[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_metric_definitions", { includeArchived });
  }
  let defs = [...mockStore.metricDefinitions];
  if (!includeArchived) {
    defs = defs.filter((d) => !d.archivedAt);
  }
  return defs;
}

export async function archiveMetricDefinition(id: string): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("archive_metric_definition", { id });
  }
  const def = mockStore.metricDefinitions.find((d) => d.id === id);
  if (!def) return { success: false };
  def.archivedAt = nowIso();
  def.updatedAt = nowIso();
  persistMockStore();
  return { success: true };
}

export async function deleteMetricDefinition(id: string): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("delete_metric_definition", { id });
  }
  const idx = mockStore.metricDefinitions.findIndex((d) => d.id === id);
  if (idx === -1) return { success: false };
  mockStore.metricDefinitions.splice(idx, 1);
  mockStore.metricSnapshots = mockStore.metricSnapshots.filter((s) => s.metricId !== id);
  mockStore.screenMetrics = mockStore.screenMetrics.filter((b) => b.metricId !== id);
  persistMockStore();
  return { success: true };
}

export async function getLatestMetricSnapshot(metricId: string): Promise<MetricSnapshot | null> {
  if (IS_TAURI) {
    return tauriInvoke("get_latest_metric_snapshot", { metricId });
  }
  const snaps = mockStore.metricSnapshots
    .filter((s) => s.metricId === metricId)
    .sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf());
  return snaps[0] ?? null;
}

export async function listMetricSnapshots(metricId: string, limit = 50): Promise<MetricSnapshot[]> {
  if (IS_TAURI) {
    return tauriInvoke("list_metric_snapshots", { metricId, limit });
  }
  return mockStore.metricSnapshots
    .filter((s) => s.metricId === metricId)
    .sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())
    .slice(0, limit);
}

export async function bindMetricToScreen(payload: BindMetricToScreenPayload): Promise<ScreenMetricBinding> {
  if (IS_TAURI) {
    return tauriInvoke("bind_metric_to_screen", { payload });
  }
  const binding: ScreenMetricBinding = {
    id: uid("sm"),
    screenId: payload.screenId,
    metricId: payload.metricId,
    position: payload.position ?? 0,
    layoutHint: payload.layoutHint ?? "card",
    gridX: payload.gridX ?? -1,
    gridY: payload.gridY ?? -1,
    gridW: payload.gridW ?? 4,
    gridH: payload.gridH ?? 6
  };
  mockStore.screenMetrics.push(binding);
  persistMockStore();
  return binding;
}

export async function unbindMetricFromScreen(bindingId: string): Promise<{ success: boolean; screenId?: string }> {
  if (IS_TAURI) {
    return tauriInvoke("unbind_metric_from_screen", { bindingId });
  }
  const idx = mockStore.screenMetrics.findIndex((b) => b.id === bindingId);
  if (idx === -1) return { success: false };
  const screenId = mockStore.screenMetrics[idx].screenId;
  mockStore.screenMetrics.splice(idx, 1);
  persistMockStore();
  return { success: true, screenId };
}

export async function reorderScreenMetrics(screenId: string, bindingIds: string[]): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("reorder_screen_metrics", { screenId, metricIds: bindingIds });
  }
  bindingIds.forEach((id, i) => {
    const binding = mockStore.screenMetrics.find(
      (b) => b.screenId === screenId && b.id === id
    );
    if (binding) binding.position = i;
  });
  persistMockStore();
  return { success: true };
}

export async function updateScreenMetricLayout(payload: UpdateScreenMetricLayoutPayload): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("update_screen_metric_layout", { payload });
  }
  for (const item of payload.layouts) {
    const binding = mockStore.screenMetrics.find(
      (b) => b.screenId === payload.screenId && b.id === item.bindingId
    );
    if (binding) {
      binding.gridX = item.gridX;
      binding.gridY = item.gridY;
      binding.gridW = item.gridW;
      binding.gridH = item.gridH;
    }
  }
  persistMockStore();
  return { success: true };
}

export async function getScreenMetrics(screenId: string): Promise<ScreenMetricView[]> {
  if (IS_TAURI) {
    return tauriInvoke("get_screen_metrics", { screenId });
  }
  const bindings = mockStore.screenMetrics
    .filter((b) => b.screenId === screenId)
    .sort((a, b) => a.position - b.position);
  return bindings.map((binding) => {
    const definition = mockStore.metricDefinitions.find((d) => d.id === binding.metricId);
    if (!definition) return null;
    const latestSnapshot = mockStore.metricSnapshots
      .filter((s) => s.metricId === binding.metricId)
      .sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())[0] ?? undefined;
    const isStale = !latestSnapshot || latestSnapshot.status === "failed" || !latestSnapshot.completedAt ||
      (new Date().valueOf() - new Date(latestSnapshot.completedAt).valueOf()) / 1000 >= definition.ttlSeconds;
    const refreshInProgress = latestSnapshot?.status === "pending" || latestSnapshot?.status === "running";
    return { binding, definition, latestSnapshot, isStale, refreshInProgress } as ScreenMetricView;
  }).filter(Boolean) as ScreenMetricView[];
}

export async function refreshMetric(metricId: string): Promise<MetricRefreshResponse> {
  if (IS_TAURI) {
    return tauriInvoke("refresh_metric", { metricId });
  }
  const snap: MetricSnapshot = {
    id: uid("snap"),
    metricId,
    valuesJson: {},
    renderedHtml: "<div>Mock metric data</div>",
    status: "completed",
    createdAt: nowIso(),
    completedAt: nowIso()
  };
  mockStore.metricSnapshots.unshift(snap);
  persistMockStore();
  return { metricId, snapshotId: snap.id };
}

export async function refreshScreenMetrics(screenId: string): Promise<MetricRefreshResponse[]> {
  if (IS_TAURI) {
    return tauriInvoke("refresh_screen_metrics", { screenId });
  }
  const views = await getScreenMetrics(screenId);
  const results: MetricRefreshResponse[] = [];
  for (const view of views) {
    if (view.isStale && !view.refreshInProgress) {
      const result = await refreshMetric(view.definition.id);
      results.push(result);
    }
  }
  return results;
}

// ─── Workspace (Tasks + Notepad Platform) ───────────────────────────────────

export async function workspaceCapabilitiesGet(): Promise<WorkspaceCapabilities> {
  if (IS_TAURI) {
    return tauriInvoke("workspace_capabilities_get");
  }
  return {
    obsidianCliAvailable: false,
    baseQueryAvailable: false,
    selectedVault: mockStore.grants.find((grant) => !grant.revokedAt)?.path,
    supportedCommands: [
      "workspace_capabilities_get",
      "workspace_health_get",
      "atoms_list",
      "atom_get",
      "atom_create",
      "atom_update",
      "task_status_set",
      "atom_archive",
      "atom_unarchive",
      "task_complete",
      "task_reopen",
      "notepads_list",
      "notepad_get",
      "notepad_save",
      "notepad_delete",
      "notepad_atoms_list",
      "events_list",
      "atom_events_list",
      "classification_preview",
      "atom_classify",
      "rules_list",
      "rule_get",
      "rule_save",
      "rule_update",
      "rule_evaluate",
      "jobs_list",
      "job_get",
      "job_save",
      "job_update",
      "job_run",
      "job_runs_list",
      "job_run_get",
      "decisions_list",
      "decision_create",
      "decision_get",
      "decision_resolve",
      "decision_snooze",
      "decision_dismiss",
      "notification_channels_list",
      "notification_send",
      "notification_deliveries_list",
      "projections_list",
      "projection_get",
      "projection_save",
      "projection_checkpoint_get",
      "projection_refresh",
      "projection_rebuild",
      "registry_entries_list",
      "registry_entry_get",
      "registry_entry_save",
      "registry_entry_update",
      "registry_entry_delete",
      "registry_suggestions_list",
      "semantic_search",
      "semantic_reindex",
      "semantic_chunk_get",
      "governance_policies_get",
      "atom_governance_update",
      "feature_flags_list",
      "feature_flag_update",
      "capability_snapshot_get",
      "migration_plan_create",
      "migration_run_start",
      "migration_run_get",
      "migration_run_rollback"
    ]
  };
}

export async function workspaceHealthGet(): Promise<WorkspaceHealth> {
  if (IS_TAURI) {
    return tauriInvoke("workspace_health_get");
  }
  return {
    adapterHealthy: true,
    vaultAccessible: true,
    lastSuccessfulCommandAt: mockStore.workspaceEvents[0]?.occurredAt,
    message: undefined
  };
}

function applyAtomFilter(atoms: AtomRecord[], request?: ListAtomsRequest): AtomRecord[] {
  const filter = request?.filter;
  let result = [...atoms];
  const includeArchived = filter?.includeArchived ?? false;
  if (!includeArchived) {
    result = result.filter((atom) => !atom.archivedAt);
  }
  if (filter?.facet) {
    result = result.filter((atom) => atom.facets.includes(filter.facet!));
  }
  if (filter?.statuses?.length) {
    result = result.filter((atom) => atom.facetData.task && filter.statuses!.includes(atom.facetData.task.status));
  }
  if (filter?.parentId) {
    result = result.filter((atom) => atom.relations.parentId === filter.parentId);
  }
  if (filter?.threadIds?.length) {
    const expected = new Set(filter.threadIds);
    result = result.filter((atom) => atom.relations.threadIds.some((threadId) => expected.has(threadId)));
  }
  if (filter?.textQuery?.trim()) {
    const q = filter.textQuery.toLowerCase();
    result = result.filter((atom) => {
      const body = atom.body ?? "";
      const title = atom.facetData.task?.title ?? "";
      return `${atom.rawText}\n${body}\n${title}`.toLowerCase().includes(q);
    });
  }
  return result;
}

function sortAtoms(atoms: AtomRecord[], request?: ListAtomsRequest): AtomRecord[] {
  const result = [...atoms];
  const sorts = request?.sort?.length ? request.sort : [{ field: "updatedAt", direction: "desc" as const }];
  result.sort((a, b) => {
    for (const sort of sorts) {
      let compare = 0;
      switch (sort.field) {
        case "createdAt":
          compare = a.createdAt.localeCompare(b.createdAt);
          break;
        case "updatedAt":
          compare = a.updatedAt.localeCompare(b.updatedAt);
          break;
        case "priority":
          compare = (a.facetData.task?.priority ?? 99) - (b.facetData.task?.priority ?? 99);
          break;
        case "title":
          compare = (a.facetData.task?.title ?? "").localeCompare(b.facetData.task?.title ?? "");
          break;
        default:
          compare = 0;
      }
      if (compare !== 0) {
        return sort.direction === "desc" ? -compare : compare;
      }
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return result;
}

function paginateItems<T>(items: T[], limit?: number, cursor?: string): PageResponse<T> {
  const offset = cursor ? Number(cursor) || 0 : 0;
  const size = Math.max(1, Math.min(500, limit ?? 100));
  const slice = items.slice(offset, offset + size);
  const nextOffset = offset + slice.length;
  return {
    items: slice,
    nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
    totalApprox: items.length
  };
}

export async function atomsList(request: ListAtomsRequest = {}): Promise<PageResponse<AtomRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("atoms_list", { request });
  }
  const filtered = applyAtomFilter(mockStore.atoms, request);
  const sorted = sortAtoms(filtered, request);
  return paginateItems(sorted, request.limit, request.cursor);
}

export async function atomGet(atomId: string): Promise<AtomRecord | null> {
  if (IS_TAURI) {
    return tauriInvoke("atom_get", { atomId });
  }
  return mockStore.atoms.find((atom) => atom.id === atomId) ?? null;
}

export async function atomCreate(payload: CreateAtomRequest): Promise<AtomRecord> {
  const request: CreateAtomRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("atom_create", { payload: request });
  }
  const now = nowIso();
  const result = classifyRawText(request.rawText);
  const fallbackFacet: "task" | "note" | "meta" =
    result.primaryFacet === "task" || result.primaryFacet === "note" || result.primaryFacet === "meta"
      ? result.primaryFacet
      : "task";
  const facets: AtomRecord["facets"] = request.initialFacets?.length ? [...request.initialFacets] : [fallbackFacet];
  const atom: AtomRecord = {
    id: atomId(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    rawText: request.rawText,
    captureSource: request.captureSource,
    facets,
    facetData: {
      ...(request.facetData ?? {}),
      task:
        facets.includes("task")
          ? {
              title: request.facetData?.task?.title ?? deriveTaskTitle(request.rawText),
              status: request.facetData?.task?.status ?? "todo",
              priority: request.facetData?.task?.priority ?? 3,
              ...request.facetData?.task
            }
          : request.facetData?.task
    },
    relations: {
      parentId: request.relations?.parentId,
      blockedByAtomId: request.relations?.blockedByAtomId,
      threadIds: request.relations?.threadIds ?? [],
      derivedFromAtomId: request.relations?.derivedFromAtomId
    },
    governance: request.governance ?? defaultWorkspaceGovernance(),
    body: request.body,
    revision: 1,
    archivedAt: undefined
  };
  mockStore.atoms.unshift(atom);
  recordWorkspaceEvent("atom.created", { atom }, atom.id);
  persistMockStore();
  return atom;
}

export async function atomUpdate(atomIdValue: string, payload: UpdateAtomRequest): Promise<AtomRecord> {
  const request: UpdateAtomRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("atom_update", { atomId: atomIdValue, payload: request });
  }
  const atom = mockStore.atoms.find((entry) => entry.id === atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  if (atom.revision !== request.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${request.expectedRevision} but found ${atom.revision}`);
  }
  if (request.rawText !== undefined) {
    atom.rawText = request.rawText;
  }
  if (request.facetDataPatch) {
    atom.facetData = { ...atom.facetData, ...request.facetDataPatch };
  }
  if (request.relationsPatch) {
    atom.relations = {
      ...atom.relations,
      ...request.relationsPatch,
      threadIds: request.relationsPatch.threadIds ?? atom.relations.threadIds
    };
  }
  if (request.bodyPatch) {
    if (request.bodyPatch.mode === "replace") {
      atom.body = request.bodyPatch.value;
    } else if (request.bodyPatch.mode === "append") {
      atom.body = [atom.body, request.bodyPatch.value].filter(Boolean).join("\n");
    } else if (request.bodyPatch.mode === "prepend") {
      atom.body = [request.bodyPatch.value, atom.body].filter(Boolean).join("\n");
    }
  }
  atom.revision += 1;
  atom.updatedAt = nowIso();
  recordWorkspaceEvent("atom.updated", { beforeRevision: request.expectedRevision, atom }, atom.id);
  persistMockStore();
  return atom;
}

export async function taskStatusSet(atomIdValue: string, payload: SetTaskStatusRequest): Promise<AtomRecord> {
  const request: SetTaskStatusRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("task_status_set", { atomId: atomIdValue, payload: request });
  }
  const atom = await atomGet(atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  if (atom.revision !== request.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${request.expectedRevision} but found ${atom.revision}`);
  }
  const from = atom.facetData.task?.status ?? "todo";
  atom.facetData.task = {
    title: atom.facetData.task?.title ?? deriveTaskTitle(atom.rawText),
    status: request.status,
    priority: atom.facetData.task?.priority ?? 3,
    ...atom.facetData.task
  };
  atom.facetData.task.status = request.status;
  atom.updatedAt = nowIso();
  atom.revision += 1;
  if (request.status === "done") {
    atom.facetData.task.completedAt = nowIso();
  }
  if (request.status === "archived") {
    atom.archivedAt = nowIso();
  } else {
    atom.archivedAt = undefined;
  }
  recordWorkspaceEvent("task.status_changed", { from, to: request.status, reason: request.reason }, atom.id);
  if (request.status === "done") {
    recordWorkspaceEvent("task.completed", { completedAt: atom.facetData.task.completedAt }, atom.id);
  }
  persistMockStore();
  return atom;
}

export async function taskComplete(atomIdValue: string, expectedRevision: number): Promise<AtomRecord> {
  const idempotencyKey = ensureIdempotencyKey();
  if (IS_TAURI) {
    return tauriInvoke("task_complete", { atomId: atomIdValue, expectedRevision, idempotencyKey });
  }
  return taskStatusSet(atomIdValue, { expectedRevision, status: "done", idempotencyKey });
}

export async function taskReopen(atomIdValue: string, payload: TaskReopenRequest): Promise<AtomRecord> {
  const request: TaskReopenRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("task_reopen", { atomId: atomIdValue, payload: request });
  }
  return taskStatusSet(atomIdValue, {
    expectedRevision: request.expectedRevision,
    status: request.status ?? "todo",
    idempotencyKey: request.idempotencyKey
  });
}

export async function atomArchive(atomIdValue: string, payload: ArchiveAtomRequest): Promise<AtomRecord> {
  const request: ArchiveAtomRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("atom_archive", { atomId: atomIdValue, payload: request });
  }
  const atom = await taskStatusSet(atomIdValue, {
    expectedRevision: request.expectedRevision,
    status: "archived",
    idempotencyKey: request.idempotencyKey
  });
  recordWorkspaceEvent("atom.archived", { archivedAt: atom.archivedAt, reason: request.reason }, atom.id);
  persistMockStore();
  return atom;
}

export async function atomUnarchive(atomIdValue: string, expectedRevision: number): Promise<AtomRecord> {
  const idempotencyKey = ensureIdempotencyKey();
  if (IS_TAURI) {
    return tauriInvoke("atom_unarchive", { atomId: atomIdValue, expectedRevision, idempotencyKey });
  }
  return taskStatusSet(atomIdValue, { expectedRevision, status: "todo", idempotencyKey });
}

export async function notepadsList(): Promise<NotepadViewDefinition[]> {
  if (IS_TAURI) {
    return tauriInvoke("notepads_list");
  }
  ensureNowNotepad();
  return [...mockStore.notepads].sort((a, b) => a.name.localeCompare(b.name));
}

export async function notepadGet(notepadId: string): Promise<NotepadViewDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("notepad_get", { notepadId });
  }
  ensureNowNotepad();
  return mockStore.notepads.find((notepad) => notepad.id === notepadId) ?? null;
}

export async function notepadSave(payload: SaveNotepadViewRequest): Promise<NotepadViewDefinition> {
  const request: SaveNotepadViewRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("notepad_save", { payload: request });
  }
  ensureNowNotepad();
  const now = nowIso();
  const existing = mockStore.notepads.find((notepad) => notepad.id === request.definition.id);
  if (request.expectedRevision !== undefined) {
    const actual = existing?.revision ?? 0;
    if (actual !== request.expectedRevision) {
      throw new Error(`CONFLICT: expected revision ${request.expectedRevision} but found ${actual}`);
    }
  }
  const next: NotepadViewDefinition = {
    ...request.definition,
    isSystem: request.definition.isSystem || request.definition.id === "now",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    mockStore.notepads.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function notepadDelete(notepadId: string): Promise<{ success: boolean }> {
  const idempotencyKey = ensureIdempotencyKey();
  if (IS_TAURI) {
    return tauriInvoke("notepad_delete", { notepadId, idempotencyKey });
  }
  if (notepadId === "now") {
    throw new Error("Cannot delete system notepad 'now'");
  }
  const idx = mockStore.notepads.findIndex((notepad) => notepad.id === notepadId);
  if (idx === -1) {
    return { success: false };
  }
  mockStore.notepads.splice(idx, 1);
  persistMockStore();
  return { success: true };
}

export async function notepadAtomsList(
  notepadId: string,
  limit?: number,
  cursor?: string
): Promise<PageResponse<AtomRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("notepad_atoms_list", { notepadId, limit, cursor });
  }
  const notepad = await notepadGet(notepadId);
  if (!notepad) {
    throw new Error(`Notepad not found: ${notepadId}`);
  }
  return atomsList({ limit, cursor, filter: notepad.filters, sort: notepad.sorts });
}

export async function eventsList(request: ListEventsRequest = {}): Promise<PageResponse<WorkspaceEventRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("events_list", { request });
  }
  let events = [...mockStore.workspaceEvents];
  if (request.type) {
    events = events.filter((event) => event.type === request.type);
  }
  if (request.atomId) {
    events = events.filter((event) => event.atomId === request.atomId);
  }
  if (request.from) {
    events = events.filter((event) => event.occurredAt >= request.from!);
  }
  if (request.to) {
    events = events.filter((event) => event.occurredAt <= request.to!);
  }
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return paginateItems(events, request.limit, request.cursor);
}

export async function atomEventsList(
  atomIdValue: string,
  limit?: number,
  cursor?: string
): Promise<PageResponse<WorkspaceEventRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("atom_events_list", { atomId: atomIdValue, limit, cursor });
  }
  return eventsList({ atomId: atomIdValue, limit, cursor });
}

export async function classificationPreview(rawText: string): Promise<ClassificationResult> {
  if (IS_TAURI) {
    return tauriInvoke("classification_preview", { rawText });
  }
  return classifyRawText(rawText);
}

export async function atomClassify(
  atomIdValue: string,
  source: ClassificationSource,
  forceFacet?: "task" | "note" | "meta",
  idempotencyKey?: string
): Promise<AtomRecord> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("atom_classify", { atomId: atomIdValue, source, forceFacet, idempotencyKey: mutationKey });
  }
  const atom = await atomGet(atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  const result = forceFacet
    ? { primaryFacet: forceFacet, confidence: 1, source, reasoning: "manual override" }
    : { ...classifyRawText(atom.rawText), source };
  if (!atom.facets.includes(result.primaryFacet)) {
    atom.facets.push(result.primaryFacet);
  }
  if (result.primaryFacet === "task" && !atom.facetData.task) {
    atom.facetData.task = {
      title: deriveTaskTitle(atom.rawText),
      status: "todo",
      priority: 3
    };
  }
  atom.revision += 1;
  atom.updatedAt = nowIso();
  recordWorkspaceEvent("atom.classified", { result }, atom.id);
  persistMockStore();
  return atom;
}

function ensureFeatureFlags(): void {
  if (mockStore.featureFlags.length > 0) {
    return;
  }
  const now = nowIso();
  const keys: FeatureFlag["key"][] = [
    "workspace.rules_engine",
    "workspace.scheduler",
    "workspace.decision_queue",
    "workspace.notifications",
    "workspace.projections",
    "workspace.registry",
    "workspace.semantic_index",
    "workspace.decay_engine",
    "workspace.recurrence",
    "workspace.agent_handoff"
  ];
  mockStore.featureFlags = keys.map((key) => ({
    key,
    enabled: false,
    updatedAt: now
  }));
}

function paginateWithRequest<T>(items: T[], request: { limit?: number; cursor?: string }): PageResponse<T> {
  return paginateItems(items, request.limit, request.cursor);
}

function evaluateRuleCondition(
  context: Record<string, unknown>,
  condition: { field: string; op: string; value?: unknown }
): boolean {
  const actual = condition.field.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, context);
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case "nin":
      return Array.isArray(condition.value) && !condition.value.includes(actual);
    case "exists":
      return actual !== undefined && actual !== null;
    case "contains":
      return typeof actual === "string" && typeof condition.value === "string" && actual.includes(condition.value);
    default:
      return false;
  }
}

export async function rulesList(request: RulesListRequest = {}): Promise<PageResponse<RuleDefinition>> {
  if (IS_TAURI) {
    return tauriInvoke("rules_list", { ...request });
  }
  let items = [...mockStore.rules];
  if (request.enabled !== undefined) {
    items = items.filter((rule) => rule.enabled === request.enabled);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function ruleGet(ruleId: string): Promise<RuleDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("rule_get", { ruleId });
  }
  return mockStore.rules.find((rule) => rule.id === ruleId) ?? null;
}

export async function ruleSave(
  rule: Partial<RuleDefinition> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<RuleDefinition> {
  const request = { ...rule, idempotencyKey: ensureIdempotencyKey(rule.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("rule_save", { rule: request });
  }
  const now = nowIso();
  const id = rule.id ?? uid("rule");
  const idx = mockStore.rules.findIndex((item) => item.id === id);
  const existing = idx >= 0 ? mockStore.rules[idx] : undefined;
  const actual = existing?.revision ?? 0;
  if (rule.expectedRevision !== undefined && rule.expectedRevision !== actual) {
    throw new Error(`CONFLICT: expected revision ${rule.expectedRevision} but found ${actual}`);
  }
  const next: RuleDefinition = {
    id,
    schemaVersion: rule.schemaVersion ?? 1,
    name: rule.name ?? "Untitled rule",
    description: rule.description,
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 100,
    scope: rule.scope ?? "system",
    trigger: rule.trigger ?? { kind: "manual" },
    conditions: rule.conditions ?? [],
    actions: rule.actions ?? [],
    cooldownMs: rule.cooldownMs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: actual + 1
  };
  if (existing) {
    mockStore.rules[idx] = next;
  } else {
    mockStore.rules.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function ruleUpdate(
  ruleId: string,
  patch: Partial<RuleDefinition> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<RuleDefinition> {
  const request = { ...patch, idempotencyKey: ensureIdempotencyKey(patch.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("rule_update", { ruleId, patch: request });
  }
  const existing = await ruleGet(ruleId);
  if (!existing) {
    throw new Error(`Rule not found: ${ruleId}`);
  }
  return ruleSave({ ...existing, ...request, id: ruleId });
}

export async function ruleEvaluate(
  ruleId: string,
  input: { context?: Record<string, unknown>; idempotencyKey?: string }
): Promise<RuleEvaluationResult> {
  const request = { ...input, idempotencyKey: ensureIdempotencyKey(input.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("rule_evaluate", { ruleId, input: request });
  }
  const rule = await ruleGet(ruleId);
  if (!rule) {
    throw new Error(`Rule not found: ${ruleId}`);
  }
  const context = request.context ?? {};
  const trace = rule.conditions.map((condition) => ({
    condition,
    passed: evaluateRuleCondition(context, condition)
  }));
  const result: RuleEvaluationResult = {
    ruleId,
    matched: trace.every((entry) => entry.passed),
    evaluatedAt: nowIso(),
    trace
  };
  recordWorkspaceEvent("rule.evaluated", { ruleId, matched: result.matched });
  persistMockStore();
  return result;
}

export async function jobsList(request: JobsListRequest = {}): Promise<PageResponse<JobDefinition>> {
  if (IS_TAURI) {
    return tauriInvoke("jobs_list", { ...request });
  }
  let items = [...mockStore.workspaceJobs];
  if (request.enabled !== undefined) {
    items = items.filter((job) => job.enabled === request.enabled);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function jobGet(jobId: string): Promise<JobDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("job_get", { jobId });
  }
  return mockStore.workspaceJobs.find((job) => job.id === jobId) ?? null;
}

export async function jobSave(
  job: Partial<JobDefinition> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<JobDefinition> {
  const request = { ...job, idempotencyKey: ensureIdempotencyKey(job.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("job_save", { job: request });
  }
  const now = nowIso();
  const id = job.id ?? uid("job");
  const idx = mockStore.workspaceJobs.findIndex((item) => item.id === id);
  const existing = idx >= 0 ? mockStore.workspaceJobs[idx] : undefined;
  const actual = existing?.revision ?? 0;
  if (job.expectedRevision !== undefined && job.expectedRevision !== actual) {
    throw new Error(`CONFLICT: expected revision ${job.expectedRevision} but found ${actual}`);
  }
  const next: JobDefinition = {
    id,
    schemaVersion: job.schemaVersion ?? 1,
    type: job.type ?? "triage.enqueue",
    enabled: job.enabled ?? true,
    schedule: job.schedule ?? { kind: "manual" },
    timeoutMs: job.timeoutMs ?? 60_000,
    maxRetries: job.maxRetries ?? 0,
    retryBackoffMs: job.retryBackoffMs ?? 1_000,
    dedupeWindowMs: job.dedupeWindowMs,
    payloadTemplate: job.payloadTemplate,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: actual + 1
  };
  if (existing) {
    mockStore.workspaceJobs[idx] = next;
  } else {
    mockStore.workspaceJobs.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function jobUpdate(
  jobId: string,
  patch: Partial<JobDefinition> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<JobDefinition> {
  const request = { ...patch, idempotencyKey: ensureIdempotencyKey(patch.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("job_update", { jobId, patch: request });
  }
  const existing = await jobGet(jobId);
  if (!existing) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return jobSave({ ...existing, ...request, id: jobId });
}

export async function jobRun(
  jobId: string,
  payload?: Record<string, unknown>,
  idempotencyKey?: string
): Promise<JobRunRecord> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("job_run", { jobId, payload, idempotencyKey: mutationKey });
  }
  const job = await jobGet(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  if (mutationKey) {
    const existing = mockStore.jobRuns.find((run) => run.idempotencyKey === mutationKey && run.jobId === jobId);
    if (existing) {
      return existing;
    }
  }
  const now = nowIso();
  const run: JobRunRecord = {
    id: uid("jobrun"),
    jobId,
    status: "succeeded",
    trigger: "manual",
    attempt: 1,
    startedAt: now,
    finishedAt: now,
    idempotencyKey: mutationKey,
    payload
  };
  mockStore.jobRuns.unshift(run);
  recordWorkspaceEvent("job.run.started", { jobRunId: run.id, jobId });
  recordWorkspaceEvent("job.run.completed", { jobRunId: run.id, jobId });
  persistMockStore();
  return run;
}

export async function jobRunsList(request: JobRunsListRequest = {}): Promise<PageResponse<JobRunRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("job_runs_list", { ...request });
  }
  let items = [...mockStore.jobRuns];
  if (request.jobId) {
    items = items.filter((run) => run.jobId === request.jobId);
  }
  if (request.status) {
    items = items.filter((run) => run.status === request.status);
  }
  items.sort((a, b) => (b.finishedAt ?? b.startedAt ?? "").localeCompare(a.finishedAt ?? a.startedAt ?? ""));
  return paginateWithRequest(items, request);
}

export async function jobRunGet(runId: string): Promise<JobRunRecord | null> {
  if (IS_TAURI) {
    return tauriInvoke("job_run_get", { runId });
  }
  return mockStore.jobRuns.find((run) => run.id === runId) ?? null;
}

export async function decisionsList(request: DecisionsListRequest = {}): Promise<PageResponse<DecisionPrompt>> {
  if (IS_TAURI) {
    return tauriInvoke("decisions_list", { ...request });
  }
  let items = [...mockStore.decisions];
  if (request.status) {
    items = items.filter((decision) => decision.status === request.status);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function decisionCreate(
  prompt: Partial<DecisionPrompt> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<DecisionPrompt> {
  const request = { ...prompt, idempotencyKey: ensureIdempotencyKey(prompt.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("decision_create", { prompt: request });
  }
  const now = nowIso();
  const id = prompt.id ?? uid("decision");
  const idx = mockStore.decisions.findIndex((item) => item.id === id);
  const existing = idx >= 0 ? mockStore.decisions[idx] : undefined;
  const actual = existing?.revision ?? 0;
  if (prompt.expectedRevision !== undefined && prompt.expectedRevision !== actual) {
    throw new Error(`CONFLICT: expected revision ${prompt.expectedRevision} but found ${actual}`);
  }
  const next: DecisionPrompt = {
    id,
    schemaVersion: prompt.schemaVersion ?? 1,
    type: prompt.type ?? "force_decision",
    status: prompt.status ?? "pending",
    priority: prompt.priority ?? 3,
    title: prompt.title ?? "Decision required",
    body: prompt.body ?? "",
    atomIds: prompt.atomIds ?? [],
    options: prompt.options ?? [],
    dueAt: prompt.dueAt,
    snoozedUntil: prompt.snoozedUntil,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: prompt.resolvedAt,
    resolvedOptionId: prompt.resolvedOptionId,
    resolutionNotes: prompt.resolutionNotes,
    revision: actual + 1
  };
  if (existing) {
    mockStore.decisions[idx] = next;
  } else {
    mockStore.decisions.unshift(next);
    recordWorkspaceEvent("decision.created", { decisionId: next.id });
  }
  persistMockStore();
  return next;
}

export async function decisionGet(decisionId: string): Promise<DecisionPrompt | null> {
  if (IS_TAURI) {
    return tauriInvoke("decision_get", { decisionId });
  }
  return mockStore.decisions.find((decision) => decision.id === decisionId) ?? null;
}

export async function decisionResolve(
  decisionId: string,
  optionId: string,
  notes?: string,
  idempotencyKey?: string
): Promise<DecisionPrompt> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("decision_resolve", { decisionId, optionId, notes, idempotencyKey: mutationKey });
  }
  const existing = await decisionGet(decisionId);
  if (!existing) {
    throw new Error(`Decision not found: ${decisionId}`);
  }
  const next = await decisionCreate({
    ...existing,
    status: "resolved",
    resolvedAt: nowIso(),
    resolvedOptionId: optionId,
    resolutionNotes: notes
  });
  recordWorkspaceEvent("decision.resolved", { decisionId, optionId });
  persistMockStore();
  return next;
}

export async function decisionSnooze(
  decisionId: string,
  snoozedUntil?: string,
  idempotencyKey?: string
): Promise<DecisionPrompt> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("decision_snooze", { decisionId, snoozedUntil, idempotencyKey: mutationKey });
  }
  const existing = await decisionGet(decisionId);
  if (!existing) {
    throw new Error(`Decision not found: ${decisionId}`);
  }
  return decisionCreate({ ...existing, status: "snoozed", snoozedUntil });
}

export async function decisionDismiss(
  decisionId: string,
  reason?: string,
  idempotencyKey?: string
): Promise<DecisionPrompt> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("decision_dismiss", { decisionId, reason, idempotencyKey: mutationKey });
  }
  const existing = await decisionGet(decisionId);
  if (!existing) {
    throw new Error(`Decision not found: ${decisionId}`);
  }
  return decisionCreate({
    ...existing,
    status: "dismissed",
    resolvedAt: nowIso(),
    resolutionNotes: reason
  });
}

export async function notificationChannelsList(): Promise<NotificationChannel[]> {
  if (IS_TAURI) {
    return tauriInvoke("notification_channels_list");
  }
  return ["in_app"];
}

export async function notificationSend(
  message: Partial<NotificationMessage> & { idempotencyKey?: string }
): Promise<NotificationMessage> {
  const request = { ...message, idempotencyKey: ensureIdempotencyKey(message.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("notification_send", { message: request });
  }
  const now = nowIso();
  const next: NotificationMessage = {
    id: message.id ?? uid("msg"),
    channel: message.channel ?? "in_app",
    recipient: message.recipient ?? "in-app",
    title: message.title ?? "Notification",
    body: message.body ?? "",
    ctaUrl: message.ctaUrl,
    priority: message.priority ?? 3,
    dedupeKey: message.dedupeKey,
    scheduledFor: message.scheduledFor,
    relatedAtomIds: message.relatedAtomIds,
    relatedPromptId: message.relatedPromptId
  };
  mockStore.notifications.unshift(next);
  const delivery: NotificationDeliveryRecord = {
    id: uid("delivery"),
    messageId: next.id,
    status: "delivered",
    attemptedAt: now,
    providerMessageId: uid("inapp")
  };
  mockStore.notificationDeliveries.unshift(delivery);
  recordWorkspaceEvent("notification.sent", { messageId: next.id, channel: next.channel });
  persistMockStore();
  return next;
}

export async function notificationDeliveriesList(
  request: NotificationDeliveriesListRequest = {}
): Promise<PageResponse<NotificationDeliveryRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("notification_deliveries_list", { ...request });
  }
  let items = [...mockStore.notificationDeliveries];
  if (request.status) {
    items = items.filter((delivery) => delivery.status === request.status);
  }
  if (request.channel) {
    const byMessageId = new Map(mockStore.notifications.map((message) => [message.id, message.channel]));
    items = items.filter((delivery) => byMessageId.get(delivery.messageId) === request.channel);
  }
  items.sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  return paginateWithRequest(items, request);
}

export async function projectionsList(
  request: PageRequest = {}
): Promise<PageResponse<ProjectionDefinition>> {
  if (IS_TAURI) {
    return tauriInvoke("projections_list", { ...request });
  }
  const items = [...mockStore.projections].sort((a, b) => b.revision - a.revision);
  return paginateWithRequest(items, request);
}

export async function projectionGet(projectionId: string): Promise<ProjectionDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("projection_get", { projectionId });
  }
  return mockStore.projections.find((projection) => projection.id === projectionId) ?? null;
}

export async function projectionSave(
  projection: Partial<ProjectionDefinition> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<ProjectionDefinition> {
  const request = { ...projection, idempotencyKey: ensureIdempotencyKey(projection.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("projection_save", { projection: request });
  }
  const now = nowIso();
  const id = projection.id ?? uid("projection");
  const idx = mockStore.projections.findIndex((item) => item.id === id);
  const existing = idx >= 0 ? mockStore.projections[idx] : undefined;
  const actual = existing?.revision ?? 0;
  if (projection.expectedRevision !== undefined && projection.expectedRevision !== actual) {
    throw new Error(`CONFLICT: expected revision ${projection.expectedRevision} but found ${actual}`);
  }
  const next: ProjectionDefinition = {
    id,
    schemaVersion: projection.schemaVersion ?? 1,
    type: projection.type ?? "tasks.list",
    source: "atoms+events",
    enabled: projection.enabled ?? true,
    refreshMode: projection.refreshMode ?? "manual",
    scheduleId: projection.scheduleId,
    outputPath: projection.outputPath,
    versionTag: projection.versionTag ?? "v1",
    revision: actual + 1
  };
  if (existing) {
    mockStore.projections[idx] = next;
  } else {
    mockStore.projections.unshift(next);
  }
  const cpIdx = mockStore.projectionCheckpoints.findIndex((cp) => cp.projectionId === id);
  if (cpIdx === -1) {
    mockStore.projectionCheckpoints.unshift({ projectionId: id, status: "healthy", lastRebuiltAt: now });
  }
  persistMockStore();
  return next;
}

export async function projectionCheckpointGet(projectionId: string): Promise<ProjectionCheckpoint> {
  if (IS_TAURI) {
    return tauriInvoke("projection_checkpoint_get", { projectionId });
  }
  const existing = mockStore.projectionCheckpoints.find((cp) => cp.projectionId === projectionId);
  if (existing) return existing;
  return { projectionId, status: "healthy" };
}

export async function projectionRefresh(
  projectionId: string,
  mode: "incremental" | "full" = "incremental",
  idempotencyKey?: string
): Promise<ProjectionCheckpoint> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("projection_refresh", { projectionId, mode, idempotencyKey: mutationKey });
  }
  const now = nowIso();
  const cp = await projectionCheckpointGet(projectionId);
  const next: ProjectionCheckpoint = {
    ...cp,
    lastEventCursor: mockStore.workspaceEvents[0]?.id,
    lastRebuiltAt: now,
    status: "healthy",
    errorMessage: undefined
  };
  const idx = mockStore.projectionCheckpoints.findIndex((item) => item.projectionId === projectionId);
  if (idx >= 0) {
    mockStore.projectionCheckpoints[idx] = next;
  } else {
    mockStore.projectionCheckpoints.unshift(next);
  }
  recordWorkspaceEvent("projection.refreshed", { projectionId, mode });
  persistMockStore();
  return next;
}

export async function projectionRebuild(
  projectionIds?: string[],
  idempotencyKey?: string
): Promise<{ accepted: true; jobRunIds: EntityId[] }> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("projection_rebuild", { projectionIds, idempotencyKey: mutationKey });
  }
  const ids = projectionIds?.length ? projectionIds : mockStore.projections.map((projection) => projection.id);
  const jobRunIds: string[] = [];
  for (const projectionId of ids) {
    const run = await jobRun(`projection.rebuild.${projectionId}`, { projectionId }, `projection-rebuild-${projectionId}`);
    jobRunIds.push(run.id);
    await projectionRefresh(projectionId, "full");
  }
  persistMockStore();
  return { accepted: true, jobRunIds };
}

export async function registryEntriesList(
  request: RegistryEntriesListRequest = {}
): Promise<PageResponse<RegistryEntry>> {
  if (IS_TAURI) {
    return tauriInvoke("registry_entries_list", { ...request });
  }
  let items = [...mockStore.registryEntries];
  if (request.kind) {
    items = items.filter((entry) => entry.kind === request.kind);
  }
  if (request.status) {
    items = items.filter((entry) => entry.status === request.status);
  }
  if (request.search) {
    const q = request.search.toLowerCase();
    items = items.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(q))
    );
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function registryEntryGet(entryId: string): Promise<RegistryEntry | null> {
  if (IS_TAURI) {
    return tauriInvoke("registry_entry_get", { entryId });
  }
  return mockStore.registryEntries.find((entry) => entry.id === entryId) ?? null;
}

export async function registryEntrySave(
  entry: Partial<RegistryEntry> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<RegistryEntry> {
  const request = { ...entry, idempotencyKey: ensureIdempotencyKey(entry.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("registry_entry_save", { entry: request });
  }
  const now = nowIso();
  const id = entry.id ?? uid("registry");
  const idx = mockStore.registryEntries.findIndex((item) => item.id === id);
  const existing = idx >= 0 ? mockStore.registryEntries[idx] : undefined;
  const actual = existing?.revision ?? 0;
  if (entry.expectedRevision !== undefined && entry.expectedRevision !== actual) {
    throw new Error(`CONFLICT: expected revision ${entry.expectedRevision} but found ${actual}`);
  }
  const next: RegistryEntry = {
    id,
    schemaVersion: entry.schemaVersion ?? 1,
    kind: entry.kind ?? "thread",
    name: entry.name ?? "Untitled",
    aliases: entry.aliases ?? [],
    status: entry.status ?? "active",
    parentIds: entry.parentIds ?? [],
    attentionFloor: entry.attentionFloor,
    attentionCeiling: entry.attentionCeiling,
    metadata: entry.metadata,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastActivityAt: entry.lastActivityAt,
    revision: actual + 1
  };
  if (existing) {
    mockStore.registryEntries[idx] = next;
  } else {
    mockStore.registryEntries.unshift(next);
  }
  recordWorkspaceEvent("registry.updated", { entryId: next.id, kind: next.kind });
  persistMockStore();
  return next;
}

export async function registryEntryUpdate(
  entryId: string,
  patch: Partial<RegistryEntry> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<RegistryEntry> {
  const request = { ...patch, idempotencyKey: ensureIdempotencyKey(patch.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("registry_entry_update", { entryId, patch: request });
  }
  const existing = await registryEntryGet(entryId);
  if (!existing) {
    throw new Error(`Registry entry not found: ${entryId}`);
  }
  return registryEntrySave({ ...existing, ...request, id: entryId });
}

export async function registryEntryDelete(entryId: string): Promise<{ success: boolean }> {
  const idempotencyKey = ensureIdempotencyKey();
  if (IS_TAURI) {
    return tauriInvoke("registry_entry_delete", { entryId, idempotencyKey });
  }
  const idx = mockStore.registryEntries.findIndex((entry) => entry.id === entryId);
  if (idx === -1) {
    return { success: false };
  }
  mockStore.registryEntries.splice(idx, 1);
  persistMockStore();
  return { success: true };
}

export async function registrySuggestionsList(
  text: string,
  kind?: RegistryEntryKind
): Promise<{ suggestions: string[] }> {
  if (IS_TAURI) {
    return tauriInvoke("registry_suggestions_list", { text, kind });
  }
  const entries = await registryEntriesList({ kind, status: "active", limit: 200 });
  const needle = text.toLowerCase();
  const set = new Set<string>();
  for (const entry of entries.items) {
    if (entry.name.toLowerCase().includes(needle)) set.add(entry.name);
    for (const alias of entry.aliases) {
      if (alias.toLowerCase().includes(needle)) set.add(alias);
    }
  }
  return { suggestions: [...set].sort((a, b) => a.localeCompare(b)) };
}

export async function semanticSearch(
  request: SemanticSearchRequest
): Promise<{ hits: SemanticSearchHit[] }> {
  if (IS_TAURI) {
    return tauriInvoke("semantic_search", { request });
  }
  const q = request.query.toLowerCase();
  const hits = mockStore.semanticChunks
    .filter((chunk) => chunk.text.toLowerCase().includes(q))
    .map((chunk) => ({
      atomId: chunk.atomId,
      chunkId: chunk.id,
      score: chunk.text.toLowerCase().split(q).length - 1,
      snippet: chunk.text.slice(0, 200)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(request.topK, 100)));
  return { hits };
}

export async function semanticReindex(atomIds?: EntityId[]): Promise<{ accepted: true; jobRunId: EntityId }> {
  const idempotencyKey = ensureIdempotencyKey();
  if (IS_TAURI) {
    return tauriInvoke("semantic_reindex", { atomIds, idempotencyKey });
  }
  const selected = atomIds?.length
    ? mockStore.atoms.filter((atom) => atomIds.includes(atom.id))
    : mockStore.atoms;
  mockStore.semanticChunks = [];
  for (const atom of selected) {
    const text = `${atom.rawText}\n${atom.body ?? ""}`.trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const chunkText = parts.join(" ");
    mockStore.semanticChunks.push({
      id: uid("chunk"),
      atomId: atom.id,
      chunkIndex: 0,
      text: chunkText,
      hash: `${chunkText.length}:${atom.id}`,
      updatedAt: nowIso()
    });
  }
  persistMockStore();
  return { accepted: true, jobRunId: uid("jobrun") };
}

export async function semanticChunkGet(chunkId: string): Promise<SemanticChunk | null> {
  if (IS_TAURI) {
    return tauriInvoke("semantic_chunk_get", { chunkId });
  }
  return mockStore.semanticChunks.find((chunk) => chunk.id === chunkId) ?? null;
}

export async function governancePoliciesGet(): Promise<{
  retentionPolicies: Record<string, unknown>[];
  defaultSensitivity: GovernanceMeta["sensitivity"];
}> {
  if (IS_TAURI) {
    return tauriInvoke("governance_policies_get");
  }
  return {
    retentionPolicies: [{ id: "default-internal", name: "default-internal" }],
    defaultSensitivity: "internal"
  };
}

export async function atomGovernanceUpdate(
  atomIdValue: string,
  payload: AtomGovernanceUpdateRequest
): Promise<AtomRecord> {
  const idempotencyKey = ensureIdempotencyKey(payload.idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("atom_governance_update", {
      atomId: atomIdValue,
      expectedRevision: payload.expectedRevision,
      governance: payload.governance,
      idempotencyKey
    });
  }
  const atom = await atomGet(atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  if (atom.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${atom.revision}`);
  }
  atom.governance = payload.governance;
  atom.revision += 1;
  atom.updatedAt = nowIso();
  recordWorkspaceEvent("governance.retention_applied", {
    atomId: atom.id,
    policyId: atom.governance.retentionPolicyId
  });
  persistMockStore();
  return atom;
}

export async function featureFlagsList(): Promise<FeatureFlag[]> {
  if (IS_TAURI) {
    return tauriInvoke("feature_flags_list");
  }
  ensureFeatureFlags();
  return [...mockStore.featureFlags];
}

export async function featureFlagUpdate(
  key: FeatureFlag["key"],
  payload: FeatureFlagUpdateRequest
): Promise<FeatureFlag> {
  const idempotencyKey = ensureIdempotencyKey(payload.idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("feature_flag_update", {
      key,
      enabled: payload.enabled,
      rolloutPercent: payload.rolloutPercent,
      idempotencyKey
    });
  }
  ensureFeatureFlags();
  const now = nowIso();
  const idx = mockStore.featureFlags.findIndex((flag) => flag.key === key);
  const next: FeatureFlag = {
    key,
    enabled: payload.enabled,
    rolloutPercent: payload.rolloutPercent,
    updatedAt: now
  };
  if (idx >= 0) {
    mockStore.featureFlags[idx] = next;
  } else {
    mockStore.featureFlags.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function capabilitySnapshotGet(): Promise<WorkspaceCapabilitySnapshot> {
  if (IS_TAURI) {
    return tauriInvoke("capability_snapshot_get");
  }
  ensureFeatureFlags();
  return {
    capturedAt: nowIso(),
    obsidianCliAvailable: false,
    baseQueryAvailable: false,
    semanticAvailable: mockStore.semanticChunks.length > 0,
    notificationChannels: ["in_app"],
    featureFlags: [...mockStore.featureFlags]
  };
}

export async function migrationPlanCreate(payload: MigrationPlanCreateRequest): Promise<MigrationPlan> {
  const idempotencyKey = ensureIdempotencyKey(payload.idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("migration_plan_create", {
      domain: payload.domain,
      fromVersion: payload.fromVersion,
      toVersion: payload.toVersion,
      dryRun: payload.dryRun,
      idempotencyKey
    });
  }
  const plan: MigrationPlan = {
    id: uid("migration-plan"),
    domain: payload.domain,
    fromVersion: payload.fromVersion,
    toVersion: payload.toVersion,
    dryRun: payload.dryRun,
    steps: ["validate current version", "prepare migration assets", "apply migration", "verify post-migration invariants"],
    createdAt: nowIso()
  };
  mockStore.migrationPlans.unshift(plan);
  persistMockStore();
  return plan;
}

export async function migrationRunStart(planId: EntityId, idempotencyKey?: string): Promise<MigrationRun> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("migration_run_start", { planId, idempotencyKey: mutationKey });
  }
  const plan = mockStore.migrationPlans.find((item) => item.id === planId);
  if (!plan) {
    throw new Error(`Migration plan not found: ${planId}`);
  }
  const now = nowIso();
  const run: MigrationRun = {
    id: uid("migration-run"),
    planId,
    status: "succeeded",
    startedAt: now,
    finishedAt: now,
    logs: ["migration applied successfully"]
  };
  mockStore.migrationRuns.unshift(run);
  recordWorkspaceEvent("migration.run.started", { runId: run.id, domain: plan.domain });
  recordWorkspaceEvent("migration.run.completed", { runId: run.id, domain: plan.domain });
  persistMockStore();
  return run;
}

export async function migrationRunGet(runId: EntityId): Promise<MigrationRun | null> {
  if (IS_TAURI) {
    return tauriInvoke("migration_run_get", { runId });
  }
  return mockStore.migrationRuns.find((run) => run.id === runId) ?? null;
}

export async function migrationRunRollback(runId: EntityId, reason?: string, idempotencyKey?: string): Promise<MigrationRun> {
  const mutationKey = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("migration_run_rollback", { runId, reason, idempotencyKey: mutationKey });
  }
  const run = await migrationRunGet(runId);
  if (!run) {
    throw new Error(`Migration run not found: ${runId}`);
  }
  run.status = "rolled_back";
  run.finishedAt = nowIso();
  run.errorMessage = reason;
  run.logs = [...run.logs, reason ? `rollback: ${reason}` : "rollback requested"];
  persistMockStore();
  return run;
}
