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
  ScreenMetricBinding,
  ScreenMetricView,
  SendConversationMessagePayload,
  RunDetail,
  RunRecord,
  SchedulerJob,
  StartRunPayload,
  StreamEnvelope,
  WorkspaceGrant
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
    screenMetrics: []
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
      screenMetrics: parsed.screenMetrics ?? []
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
  const existing = mockStore.screenMetrics.find(
    (b) => b.screenId === payload.screenId && b.metricId === payload.metricId
  );
  if (existing) {
    existing.position = payload.position ?? existing.position;
    existing.layoutHint = payload.layoutHint ?? existing.layoutHint;
    persistMockStore();
    return existing;
  }
  const binding: ScreenMetricBinding = {
    id: uid("sm"),
    screenId: payload.screenId,
    metricId: payload.metricId,
    position: payload.position ?? 0,
    layoutHint: payload.layoutHint ?? "card"
  };
  mockStore.screenMetrics.push(binding);
  persistMockStore();
  return binding;
}

export async function unbindMetricFromScreen(screenId: string, metricId: string): Promise<{ success: boolean }> {
  if (IS_TAURI) {
    return tauriInvoke("unbind_metric_from_screen", { screenId, metricId });
  }
  const idx = mockStore.screenMetrics.findIndex(
    (b) => b.screenId === screenId && b.metricId === metricId
  );
  if (idx === -1) return { success: false };
  mockStore.screenMetrics.splice(idx, 1);
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
