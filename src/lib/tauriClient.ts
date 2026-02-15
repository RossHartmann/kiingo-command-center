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
  PageResponse,
  ListEventsRequest,
  ClassificationResult,
  ClassificationSource
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
    workspaceEvents: []
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
      workspaceEvents: parsed.workspaceEvents ?? []
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
      "atoms_list",
      "atom_get",
      "atom_create",
      "atom_update",
      "task_status_set",
      "atom_archive",
      "atom_unarchive",
      "notepads_list",
      "notepad_save",
      "events_list"
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
  if (IS_TAURI) {
    return tauriInvoke("atom_create", { payload });
  }
  const now = nowIso();
  const result = classifyRawText(payload.rawText);
  const facets = payload.initialFacets?.length
    ? [...payload.initialFacets]
    : [result.primaryFacet === "task" ? "task" : result.primaryFacet];
  const atom: AtomRecord = {
    id: atomId(),
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    rawText: payload.rawText,
    captureSource: payload.captureSource,
    facets,
    facetData: {
      ...(payload.facetData ?? {}),
      task:
        facets.includes("task")
          ? {
              title: payload.facetData?.task?.title ?? deriveTaskTitle(payload.rawText),
              status: payload.facetData?.task?.status ?? "todo",
              priority: payload.facetData?.task?.priority ?? 3,
              ...payload.facetData?.task
            }
          : payload.facetData?.task
    },
    relations: {
      parentId: payload.relations?.parentId,
      blockedByAtomId: payload.relations?.blockedByAtomId,
      threadIds: payload.relations?.threadIds ?? [],
      derivedFromAtomId: payload.relations?.derivedFromAtomId
    },
    governance: payload.governance ?? defaultWorkspaceGovernance(),
    body: payload.body,
    revision: 1,
    archivedAt: undefined
  };
  mockStore.atoms.unshift(atom);
  recordWorkspaceEvent("atom.created", { atom }, atom.id);
  persistMockStore();
  return atom;
}

export async function atomUpdate(atomIdValue: string, payload: UpdateAtomRequest): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("atom_update", { atomId: atomIdValue, payload });
  }
  const atom = mockStore.atoms.find((entry) => entry.id === atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  if (atom.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${atom.revision}`);
  }
  if (payload.rawText !== undefined) {
    atom.rawText = payload.rawText;
  }
  if (payload.facetDataPatch) {
    atom.facetData = { ...atom.facetData, ...payload.facetDataPatch };
  }
  if (payload.relationsPatch) {
    atom.relations = {
      ...atom.relations,
      ...payload.relationsPatch,
      threadIds: payload.relationsPatch.threadIds ?? atom.relations.threadIds
    };
  }
  if (payload.bodyPatch) {
    if (payload.bodyPatch.mode === "replace") {
      atom.body = payload.bodyPatch.value;
    } else if (payload.bodyPatch.mode === "append") {
      atom.body = [atom.body, payload.bodyPatch.value].filter(Boolean).join("\n");
    } else if (payload.bodyPatch.mode === "prepend") {
      atom.body = [payload.bodyPatch.value, atom.body].filter(Boolean).join("\n");
    }
  }
  atom.revision += 1;
  atom.updatedAt = nowIso();
  recordWorkspaceEvent("atom.updated", { beforeRevision: payload.expectedRevision, atom }, atom.id);
  persistMockStore();
  return atom;
}

export async function taskStatusSet(atomIdValue: string, payload: SetTaskStatusRequest): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("task_status_set", { atomId: atomIdValue, payload });
  }
  const atom = await atomGet(atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  if (atom.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${atom.revision}`);
  }
  const from = atom.facetData.task?.status ?? "todo";
  atom.facetData.task = {
    title: atom.facetData.task?.title ?? deriveTaskTitle(atom.rawText),
    status: payload.status,
    priority: atom.facetData.task?.priority ?? 3,
    ...atom.facetData.task
  };
  atom.facetData.task.status = payload.status;
  atom.updatedAt = nowIso();
  atom.revision += 1;
  if (payload.status === "done") {
    atom.facetData.task.completedAt = nowIso();
  }
  if (payload.status === "archived") {
    atom.archivedAt = nowIso();
  } else {
    atom.archivedAt = undefined;
  }
  recordWorkspaceEvent("task.status_changed", { from, to: payload.status, reason: payload.reason }, atom.id);
  if (payload.status === "done") {
    recordWorkspaceEvent("task.completed", { completedAt: atom.facetData.task.completedAt }, atom.id);
  }
  persistMockStore();
  return atom;
}

export async function taskComplete(atomIdValue: string, expectedRevision: number): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("task_complete", { atomId: atomIdValue, expectedRevision });
  }
  return taskStatusSet(atomIdValue, { expectedRevision, status: "done" });
}

export async function taskReopen(atomIdValue: string, payload: TaskReopenRequest): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("task_reopen", { atomId: atomIdValue, payload });
  }
  return taskStatusSet(atomIdValue, {
    expectedRevision: payload.expectedRevision,
    status: payload.status ?? "todo"
  });
}

export async function atomArchive(atomIdValue: string, payload: ArchiveAtomRequest): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("atom_archive", { atomId: atomIdValue, payload });
  }
  const atom = await taskStatusSet(atomIdValue, { expectedRevision: payload.expectedRevision, status: "archived" });
  recordWorkspaceEvent("atom.archived", { archivedAt: atom.archivedAt, reason: payload.reason }, atom.id);
  persistMockStore();
  return atom;
}

export async function atomUnarchive(atomIdValue: string, expectedRevision: number): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("atom_unarchive", { atomId: atomIdValue, expectedRevision });
  }
  return taskStatusSet(atomIdValue, { expectedRevision, status: "todo" });
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
  if (IS_TAURI) {
    return tauriInvoke("notepad_save", { payload });
  }
  ensureNowNotepad();
  const now = nowIso();
  const existing = mockStore.notepads.find((notepad) => notepad.id === payload.definition.id);
  if (payload.expectedRevision !== undefined) {
    const actual = existing?.revision ?? 0;
    if (actual !== payload.expectedRevision) {
      throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${actual}`);
    }
  }
  const next: NotepadViewDefinition = {
    ...payload.definition,
    isSystem: payload.definition.isSystem || payload.definition.id === "now",
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
  if (IS_TAURI) {
    return tauriInvoke("notepad_delete", { notepadId });
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
  forceFacet?: "task" | "note" | "meta"
): Promise<AtomRecord> {
  if (IS_TAURI) {
    return tauriInvoke("atom_classify", { atomId: atomIdValue, source, forceFacet });
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
