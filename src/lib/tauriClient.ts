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
  MetricDiagnostics,
  MetricRefreshResponse,
  MetricSnapshot,
  Profile,
  SaveMetricDefinitionPayload,
  SaveNotepadViewRequest,
  SaveProjectDefinitionRequest,
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
  ObsidianTaskSyncResult,
  AtomRecord,
  ListAtomsRequest,
  CreateAtomRequest,
  ArchiveAtomRequest,
  DeleteAtomRequest,
  AttentionLayer,
  NotepadViewDefinition,
  ProjectDefinition,
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
  DecisionOption,
  NotificationChannel,
  NotificationMessage,
  NotificationDeliveryRecord,
  ProjectionDefinition,
  ProjectionCheckpoint,
  PlacementRecord,
  PlacementReorderRequest,
  RegistryEntry,
  RegistryEntryKind,
  RecurrenceInstance,
  RecurrenceInstancesListRequest,
  RecurrenceSpawnRequest,
  RecurrenceSpawnResponse,
  RecurrenceTemplate,
  RecurrenceTemplatesListRequest,
  SemanticChunk,
  SemanticSearchRequest,
  SemanticSearchHit,
  WorkSessionCancelRequest,
  WorkSessionEndRequest,
  WorkSessionNoteRequest,
  WorkSessionRecord,
  WorkSessionStartRequest,
  WorkSessionsListRequest,
  ConditionCancelRequest,
  ConditionFollowupRequest,
  ConditionRecord,
  ConditionResolveRequest,
  ConditionSetDateRequest,
  ConditionSetPersonRequest,
  ConditionSetTaskRequest,
  ListConditionsRequest,
  WorkspaceMutationPayload,
  AttentionUpdateRequest,
  AttentionUpdateResponse,
  DecisionGenerateRequest,
  DecisionGenerateResponse,
  BlockRecord,
  ListBlocksRequest,
  ListPlacementsRequest,
  CreateBlockInNotepadRequest,
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
import { deriveTaskTitle, taskDisplayTitle } from "./taskTitle";

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
  blocks: BlockRecord[];
  placements: PlacementRecord[];
  conditions: ConditionRecord[];
  notepads: NotepadViewDefinition[];
  projects: ProjectDefinition[];
  workSessions: WorkSessionRecord[];
  recurrenceTemplates: RecurrenceTemplate[];
  recurrenceInstances: RecurrenceInstance[];
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

function atomHasNoMeaningfulContent(atom: AtomRecord): boolean {
  const text = atom.rawText.trim();
  const body = (atom.body ?? "").trim();
  return text.length === 0 && body.length === 0;
}

function blockIdForAtom(atomIdValue: string): string {
  return `blk_${atomIdValue.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function atomLifecycle(atom: AtomRecord): BlockRecord["lifecycle"] {
  const status = atom.facetData.task?.status;
  if (atom.archivedAt || status === "archived") return "archived";
  if (status === "done") return "completed";
  return "active";
}

function atomToBlockRecord(atom: AtomRecord): BlockRecord {
  const kind: BlockRecord["kind"] = atom.facets.includes("task")
    ? "task"
    : atom.facets.includes("note")
      ? "note"
      : atom.facets.includes("meta")
        ? "meta"
        : "unknown";
  return {
    id: blockIdForAtom(atom.id),
    schemaVersion: 1,
    atomId: atom.id,
    text: atom.rawText,
    kind,
    lifecycle: atomLifecycle(atom),
    parentBlockId: atom.relations.parentId ? blockIdForAtom(atom.relations.parentId) : undefined,
    threadIds: atom.relations.threadIds ?? [],
    labels: atom.facetData.meta?.labels ?? [],
    categories: atom.facetData.meta?.categories ?? [],
    taskStatus: atom.facetData.task?.status,
    priority: atom.facetData.task?.priority,
    attentionLayer: atom.facetData.task?.attentionLayer,
    commitmentLevel: atom.facetData.task?.commitmentLevel,
    completedAt: atom.facetData.task?.completedAt,
    archivedAt: atom.archivedAt,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
    revision: atom.revision
  };
}

function mockBlocksSnapshot(): BlockRecord[] {
  return mockStore.atoms.map((atom) => atomToBlockRecord(atom));
}

function nextPlacementOrderKey(existing: PlacementRecord[]): string {
  const index = existing.length;
  return `${String(index).padStart(8, "0")}-${crypto.randomUUID().slice(0, 8)}`;
}

function conditionIdForAtomMode(atomIdValue: string, mode: string): string {
  return `condition_${atomIdValue.replace(/[^a-zA-Z0-9_-]/g, "_")}_${mode.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function getMockAtomOrThrow(atomIdValue: string): AtomRecord {
  const atom = mockStore.atoms.find((entry) => entry.id === atomIdValue);
  if (!atom) {
    throw new Error(`Atom not found: ${atomIdValue}`);
  }
  return atom;
}

function ensureTaskFacet(atom: AtomRecord): NonNullable<AtomRecord["facetData"]["task"]> {
  if (!atom.facetData.task) {
    atom.facetData.task = {
      status: "todo",
      priority: 3
    };
  }
  return atom.facetData.task;
}

function applyConditionToAtom(condition: ConditionRecord): void {
  const atom = getMockAtomOrThrow(condition.atomId);
  const task = ensureTaskFacet(atom);
  task.status = "blocked";
  atom.facetData.blocking = {
    mode: condition.mode as "date" | "person" | "task",
    blockedUntil: condition.blockedUntil,
    waitingOnPerson: condition.waitingOnPerson,
    waitingCadenceDays: condition.waitingCadenceDays,
    blockedByAtomId: condition.blockerAtomId,
    lastFollowupAt: condition.lastFollowupAt
  };
  atom.updatedAt = nowIso();
  atom.revision += 1;
}

function clearBlockingIfNoActiveCondition(atomIdValue: string): void {
  const stillBlocked = mockStore.conditions.some(
    (condition) => condition.atomId === atomIdValue && condition.status === "active"
  );
  if (stillBlocked) {
    return;
  }
  const atom = mockStore.atoms.find((entry) => entry.id === atomIdValue);
  if (!atom || !atom.facetData.blocking) {
    return;
  }
  atom.facetData.blocking = undefined;
  if (atom.facetData.task?.status === "blocked") {
    atom.facetData.task.status = "todo";
  }
  atom.updatedAt = nowIso();
  atom.revision += 1;
}

function nextRecurrenceRun(template: RecurrenceTemplate, fromIso: string): string {
  const from = new Date(fromIso);
  const interval = Math.max(1, Number(template.interval) || 1);
  switch ((template.frequency ?? "daily").toLowerCase()) {
    case "weekly":
      return new Date(from.getTime() + interval * 7 * 24 * 60 * 60 * 1000).toISOString();
    case "monthly":
      return new Date(from.getTime() + interval * 30 * 24 * 60 * 60 * 1000).toISOString();
    case "daily":
    default:
      return new Date(from.getTime() + interval * 24 * 60 * 60 * 1000).toISOString();
  }
}

const ATTENTION_LAYER_RANK: Record<AttentionLayer, number> = {
  l3: 0,
  ram: 1,
  short: 2,
  long: 3,
  archive: 4
};

const ATTENTION_CAPS: Record<"l3" | "ram", number> = {
  l3: 3,
  ram: 20
};

interface AttentionComputation {
  atom: AtomRecord;
  score: number;
  proposedLayer: AttentionLayer;
  boundedLayer: AttentionLayer;
  blocked: boolean;
  reason: string;
  duePressure: number;
  signalDelta: number;
  commitmentPressure: number;
}

function parseIsoDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed;
}

function hoursBetween(fromIso: string | undefined, toDate: Date): number {
  const from = parseIsoDate(fromIso);
  if (!from) return Number.POSITIVE_INFINITY;
  return Math.max(0, (toDate.valueOf() - from.valueOf()) / (1000 * 60 * 60));
}

function daysUntil(targetIso: string | undefined, now: Date): number | undefined {
  const target = parseIsoDate(targetIso);
  if (!target) return undefined;
  return (target.valueOf() - now.valueOf()) / (1000 * 60 * 60 * 24);
}

function confidenceFromPriority(priority: number | undefined): number {
  switch (priority ?? 3) {
    case 1:
      return 4.2;
    case 2:
      return 3.2;
    case 3:
      return 2.2;
    case 4:
      return 1.6;
    default:
      return 1.2;
  }
}

function scoreToLayer(score: number): AttentionLayer {
  if (score >= 9.6) return "l3";
  if (score >= 6.4) return "ram";
  if (score >= 3.8) return "short";
  if (score >= 1.8) return "long";
  return "archive";
}

function hasActiveCondition(atomIdValue: string): boolean {
  return mockStore.conditions.some((condition) => condition.atomId === atomIdValue && condition.status === "active");
}

function latestWorkSignalHours(atomIdValue: string, now: Date): number | undefined {
  const blockId = blockIdForAtom(atomIdValue);
  let latestIso: string | undefined;
  for (const session of mockStore.workSessions) {
    if (!session.focusBlockIds.includes(blockId)) {
      continue;
    }
    const signalIso = session.updatedAt ?? session.endedAt ?? session.startedAt ?? session.createdAt;
    if (!latestIso || signalIso > latestIso) {
      latestIso = signalIso;
    }
  }
  if (!latestIso) return undefined;
  return hoursBetween(latestIso, now);
}

function buildDecisionDedupeKey(type: string, atomIds: string[], scope?: string): string {
  const sorted = [...atomIds].sort();
  return [type, scope ?? "global", ...sorted].join(":");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function decisionOptionAtomIds(option: DecisionOption, fallbackAtomIds: string[]): string[] {
  const payloadAtomIds = asStringArray(option.payload?.atomIds);
  if (payloadAtomIds.length > 0) {
    return payloadAtomIds;
  }
  if (typeof option.payload?.atomId === "string") {
    return [option.payload.atomId];
  }
  return fallbackAtomIds;
}

function atomAttentionScore(atom: AtomRecord): number {
  return atom.facetData.attention?.heatScore ?? confidenceFromPriority(atom.facetData.task?.priority);
}

function rankAtomsByAttentionPressure(atoms: AtomRecord[]): AtomRecord[] {
  return [...atoms].sort((a, b) => {
    const layerRank = ATTENTION_LAYER_RANK[a.facetData.task?.attentionLayer ?? a.facetData.attention?.layer ?? "long"]
      - ATTENTION_LAYER_RANK[b.facetData.task?.attentionLayer ?? b.facetData.attention?.layer ?? "long"];
    if (layerRank !== 0) return layerRank;
    const scoreDelta = atomAttentionScore(b) - atomAttentionScore(a);
    if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
    const priorityDelta = (a.facetData.task?.priority ?? 3) - (b.facetData.task?.priority ?? 3);
    if (priorityDelta !== 0) return priorityDelta;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function isFeatureFlagEnabled(key: FeatureFlag["key"], fallback = true): boolean {
  ensureFeatureFlags();
  const flag = mockStore.featureFlags.find((entry) => entry.key === key);
  if (!flag) return fallback;
  return flag.enabled;
}

async function upsertDecisionPrompt(
  prompt: Partial<DecisionPrompt> & {
    type: DecisionPrompt["type"];
    title: string;
    body: string;
    atomIds: string[];
    options: DecisionPrompt["options"];
    dedupeKey: string;
    triggerCode?: string;
    triggerReason?: string;
    triggerMeta?: Record<string, unknown>;
    priority?: 1 | 2 | 3 | 4 | 5;
    dueAt?: string;
  }
): Promise<DecisionPrompt> {
  const now = nowIso();
  const cooldownCutoff = new Date(Date.parse(now) - 6 * 60 * 60 * 1000).toISOString();
  const cooled = mockStore.decisions.find(
    (decision) =>
      decision.dedupeKey === prompt.dedupeKey &&
      (decision.status === "dismissed" || decision.status === "resolved") &&
      decision.updatedAt >= cooldownCutoff
  );
  if (cooled) {
    return cooled;
  }
  const snoozed = mockStore.decisions.find(
    (decision) =>
      decision.dedupeKey === prompt.dedupeKey &&
      decision.status === "snoozed" &&
      !!decision.snoozedUntil &&
      decision.snoozedUntil > now
  );
  if (snoozed) {
    return snoozed;
  }
  const existing = mockStore.decisions.find(
    (decision) =>
      decision.dedupeKey === prompt.dedupeKey &&
      (decision.status === "pending" ||
        (decision.status === "snoozed" && (!decision.snoozedUntil || decision.snoozedUntil <= now)))
  );
  if (existing) {
    return decisionCreate({
      ...existing,
      title: prompt.title,
      body: prompt.body,
      atomIds: prompt.atomIds,
      options: prompt.options,
      priority: prompt.priority ?? existing.priority,
      dueAt: prompt.dueAt ?? existing.dueAt,
      dedupeKey: prompt.dedupeKey,
      triggerCode: prompt.triggerCode ?? existing.triggerCode,
      triggerReason: prompt.triggerReason ?? existing.triggerReason,
      triggerMeta: prompt.triggerMeta ?? existing.triggerMeta,
      status: existing.status === "snoozed" && existing.snoozedUntil && existing.snoozedUntil > now ? "snoozed" : "pending",
      expectedRevision: existing.revision
    });
  }
  return decisionCreate({
    type: prompt.type,
    title: prompt.title,
    body: prompt.body,
    atomIds: prompt.atomIds,
    options: prompt.options,
    priority: prompt.priority ?? 3,
    dueAt: prompt.dueAt,
    dedupeKey: prompt.dedupeKey,
    triggerCode: prompt.triggerCode,
    triggerReason: prompt.triggerReason,
    triggerMeta: prompt.triggerMeta
  });
}

function ensureNowNotepad(): void {
  const existing = mockStore.notepads.find((notepad) => notepad.id === "now");
  if (existing) {
    if (!existing.viewKind) {
      existing.viewKind = "inbox";
    }
    return;
  }
  const now = nowIso();
  mockStore.notepads.unshift({
    id: "now",
    schemaVersion: 1,
    name: "Now",
    description: "System default view for active work",
    isSystem: true,
    viewKind: "inbox",
    filters: { facet: "task", statuses: ["todo", "doing", "blocked"], includeArchived: false },
    sorts: [{ field: "priority", direction: "asc" }],
    captureDefaults: {
      initialFacets: ["task"],
      taskStatus: "todo",
      taskPriority: 3
    },
    layoutMode: "list",
    createdAt: now,
    updatedAt: now,
    revision: 1
  });
}

function inferNotepadViewKind(notepad: Pick<NotepadViewDefinition, "id" | "filters">): NotepadViewDefinition["viewKind"] {
  if (notepad.id === "now") {
    return "inbox";
  }
  const filters = notepad.filters;
  const hasComputedSelectors =
    Boolean(filters.categories?.length) ||
    Boolean(filters.categoryIds?.length) ||
    Boolean(filters.labels?.length) ||
    Boolean(filters.labelIds?.length) ||
    Boolean(filters.threadIds?.length) ||
    Boolean(filters.textQuery?.trim()) ||
    Boolean(filters.facet) ||
    Boolean(filters.parentId);
  return hasComputedSelectors ? "computed" : "manual";
}

function sanitizeProjectId(seed: string): string {
  const normalized = seed.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/(^-|-$)/g, "");
  return normalized.length > 0 ? normalized : `project-${crypto.randomUUID().slice(0, 8)}`;
}

function ensureProjectsBackfilled(): void {
  ensureNowNotepad();
  if (mockStore.projects.length > 0) {
    return;
  }
  const now = nowIso();
  const derived = mockStore.notepads
    .filter((notepad) => !notepad.isSystem)
    .map<ProjectDefinition>((notepad) => {
      const labelIds = [
        ...(notepad.filters.categoryIds ?? []),
        ...(notepad.filters.labelIds ?? []),
        ...(notepad.filters.threadIds ?? [])
      ].filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index);
      const kind: ProjectDefinition["kind"] = labelIds.length > 0 ? "label_project" : "workspace_project";
      return {
        id: sanitizeProjectId(`project-${notepad.id}`),
        schemaVersion: 1,
        name: notepad.name,
        description: notepad.description,
        status: "active",
        kind,
        labelIds,
        defaultViewId: notepad.id,
        viewIds: [notepad.id],
        captureDefaults: {
          threadIds: notepad.captureDefaults?.threadIds,
          labelIds: notepad.captureDefaults?.labelIds,
          categoryIds: notepad.captureDefaults?.categoryIds,
          categories: notepad.captureDefaults?.categories,
          labels: notepad.captureDefaults?.labels,
          taskStatus: notepad.captureDefaults?.taskStatus,
          taskPriority: notepad.captureDefaults?.taskPriority
        },
        source: "migrated_derived",
        createdAt: now,
        updatedAt: now,
        revision: 1
      };
    });
  mockStore.projects = derived;
  persistMockStore();
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
    blocks: [],
    placements: [],
    conditions: [],
    notepads: [],
    projects: [],
    workSessions: [],
    recurrenceTemplates: [],
    recurrenceInstances: [],
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
      blocks: parsed.blocks ?? [],
      placements: parsed.placements ?? [],
      conditions: parsed.conditions ?? [],
      notepads: parsed.notepads ?? [],
      projects: parsed.projects ?? [],
      workSessions: parsed.workSessions ?? [],
      recurrenceTemplates: parsed.recurrenceTemplates ?? [],
      recurrenceInstances: parsed.recurrenceInstances ?? [],
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
    ttlSeconds: payload.ttlSeconds ?? 259200,
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

export async function getMetricDiagnostics(metricId: string): Promise<MetricDiagnostics> {
  if (IS_TAURI) {
    return tauriInvoke("get_metric_diagnostics", { metricId });
  }
  return {
    metricId,
    totalRuns: 0,
    completedRuns: 0,
    failedRuns: 0,
    successRate: 0,
    lastRunDurationSecs: null,
    avgRunDurationSecs: null,
    minRunDurationSecs: null,
    maxRunDurationSecs: null,
    ttlSeconds: 300,
    provider: "claude",
    model: null,
    currentStatus: null,
    lastError: null,
    lastCompletedAt: null,
    nextRefreshAt: null,
  };
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
      .filter((s) => s.metricId === binding.metricId && (s.status === "completed" || s.status === "failed"))
      .sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())[0] ?? undefined;
    const inflightSnapshot = mockStore.metricSnapshots
      .filter((s) => s.metricId === binding.metricId && (s.status === "pending" || s.status === "running"))
      .sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())[0] ?? undefined;
    const isStale = !latestSnapshot || latestSnapshot.status === "failed" || !latestSnapshot.completedAt ||
      (new Date().valueOf() - new Date(latestSnapshot.completedAt).valueOf()) / 1000 >= definition.ttlSeconds;
    const refreshInProgress = Boolean(inflightSnapshot);
    return { binding, definition, latestSnapshot, inflightSnapshot, isStale, refreshInProgress } as ScreenMetricView;
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
      "obsidian_tasks_sync",
      "atoms_list",
      "atom_get",
      "atom_create",
      "atom_update",
      "task_status_set",
      "atom_archive",
      "atom_delete",
      "atom_unarchive",
      "task_complete",
      "task_reopen",
      "notepads_list",
      "notepad_get",
      "notepad_save",
      "notepad_delete",
      "projects_list",
      "project_get",
      "project_save",
      "project_delete",
      "project_open",
      "project_views_list",
      "notepad_atoms_list",
      "notepad_block_create",
      "blocks_list",
      "block_get",
      "placements_list",
      "placement_save",
      "placement_delete",
      "placements_reorder",
      "conditions_list",
      "condition_get",
      "condition_set_date",
      "condition_set_person",
      "condition_set_task",
      "condition_followup_log",
      "condition_resolve",
      "condition_cancel",
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
      "work_sessions_list",
      "work_session_get",
      "work_session_start",
      "work_session_note",
      "work_session_end",
      "work_session_cancel",
      "recurrence_templates_list",
      "recurrence_template_get",
      "recurrence_template_save",
      "recurrence_template_update",
      "recurrence_instances_list",
      "recurrence_spawn",
      "system_apply_attention_update",
      "system_generate_decision_cards",
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

export async function obsidianTasksSync(): Promise<ObsidianTaskSyncResult> {
  if (IS_TAURI) {
    return tauriInvoke("obsidian_tasks_sync");
  }
  return {
    vaultPath: "",
    scannedFiles: 0,
    discoveredTasks: 0,
    createdAtoms: 0,
    updatedAtoms: 0,
    unchangedAtoms: 0,
    archivedAtoms: 0
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
    const mode = filter.threadFilterMode ?? "or";
    result = result.filter((atom) => {
      const actual = atom.relations.threadIds ?? [];
      if (mode === "and") {
        return [...expected].every((threadId) => actual.includes(threadId));
      }
      return actual.some((threadId) => expected.has(threadId));
    });
  }
  if (filter?.labels?.length) {
    const expected = new Set(filter.labels.map((value) => value.toLowerCase()));
    const mode = filter.labelFilterMode ?? "or";
    result = result.filter((atom) => {
      const labels = atom.facetData.meta?.labels ?? [];
      const normalized = labels.map((label) => label.toLowerCase());
      if (mode === "and") {
        return [...expected].every((label) => normalized.includes(label));
      }
      return normalized.some((label) => expected.has(label));
    });
  }
  if (filter?.categories?.length) {
    const expected = new Set(filter.categories.map((value) => value.toLowerCase()));
    const mode = filter.categoryFilterMode ?? "or";
    result = result.filter((atom) => {
      const categories = atom.facetData.meta?.categories ?? [];
      const normalized = categories.map((category) => category.toLowerCase());
      if (mode === "and") {
        return [...expected].every((category) => normalized.includes(category));
      }
      return normalized.some((category) => expected.has(category));
    });
  }
  if (filter?.attentionLayers?.length) {
    const expected = new Set(filter.attentionLayers);
    result = result.filter((atom) => {
      const layer = atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer;
      return layer ? expected.has(layer) : false;
    });
  }
  if (filter?.commitmentLevels?.length) {
    const expected = new Set(filter.commitmentLevels);
    result = result.filter((atom) => {
      const level = atom.facetData.task?.commitmentLevel ?? atom.facetData.commitment?.level;
      return level ? expected.has(level) : false;
    });
  }
  if (filter?.dueFrom || filter?.dueTo) {
    const from = filter.dueFrom ? new Date(filter.dueFrom) : undefined;
    const to = filter.dueTo ? new Date(filter.dueTo) : undefined;
    result = result.filter((atom) => {
      const due = atom.facetData.task?.hardDueAt ?? atom.facetData.task?.softDueAt;
      if (!due) return false;
      const dt = new Date(due);
      if (Number.isNaN(dt.valueOf())) return false;
      if (from && dt < from) return false;
      if (to && dt > to) return false;
      return true;
    });
  }
  if (filter?.textQuery?.trim()) {
    const q = filter.textQuery.toLowerCase();
    result = result.filter((atom) => {
      const body = atom.body ?? "";
      return `${atom.rawText}\n${body}`.toLowerCase().includes(q);
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
        case "softDueAt":
          compare =
            (a.facetData.task?.softDueAt ? new Date(a.facetData.task.softDueAt).valueOf() : Number.MAX_SAFE_INTEGER) -
            (b.facetData.task?.softDueAt ? new Date(b.facetData.task.softDueAt).valueOf() : Number.MAX_SAFE_INTEGER);
          break;
        case "hardDueAt":
          compare =
            (a.facetData.task?.hardDueAt ? new Date(a.facetData.task.hardDueAt).valueOf() : Number.MAX_SAFE_INTEGER) -
            (b.facetData.task?.hardDueAt ? new Date(b.facetData.task.hardDueAt).valueOf() : Number.MAX_SAFE_INTEGER);
          break;
        case "attentionLayer": {
          const rank: Record<AttentionLayer, number> = {
            l3: 0,
            ram: 1,
            short: 2,
            long: 3,
            archive: 4
          };
          const ar = rank[(a.facetData.task?.attentionLayer ?? "archive") as AttentionLayer] ?? 99;
          const br = rank[(b.facetData.task?.attentionLayer ?? "archive") as AttentionLayer] ?? 99;
          compare = ar - br;
          break;
        }
        case "title":
          compare = deriveTaskTitle(a.rawText).localeCompare(deriveTaskTitle(b.rawText));
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
  if (request.clearParentId) {
    atom.relations.parentId = undefined;
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

export async function atomDelete(atomIdValue: string, payload: DeleteAtomRequest): Promise<{ success: boolean }> {
  const request: DeleteAtomRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("atom_delete", { atomId: atomIdValue, payload: request });
  }
  const atomIndex = mockStore.atoms.findIndex((entry) => entry.id === atomIdValue);
  if (atomIndex === -1) {
    return { success: false };
  }
  const atom = mockStore.atoms[atomIndex];
  if (atom.revision !== request.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${request.expectedRevision} but found ${atom.revision}`);
  }
  if (!atom.archivedAt) {
    throw new Error("POLICY_DENIED: atom_delete requires atom to be archived");
  }
  if (!atomHasNoMeaningfulContent(atom)) {
    throw new Error("POLICY_DENIED: atom_delete only permits archived atoms with no text/body content");
  }
  const blockId = blockIdForAtom(atom.id);
  mockStore.placements = mockStore.placements.filter((placement) => placement.blockId !== blockId);
  mockStore.atoms.splice(atomIndex, 1);
  recordWorkspaceEvent("atom.deleted", { reason: request.reason }, atomIdValue);
  persistMockStore();
  return { success: true };
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
  for (const notepad of mockStore.notepads) {
    if (!notepad.viewKind) {
      notepad.viewKind = inferNotepadViewKind(notepad);
    }
  }
  return [...mockStore.notepads].sort((a, b) => a.name.localeCompare(b.name));
}

export async function notepadGet(notepadId: string): Promise<NotepadViewDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("notepad_get", { notepadId });
  }
  ensureNowNotepad();
  const notepad = mockStore.notepads.find((item) => item.id === notepadId) ?? null;
  if (notepad && !notepad.viewKind) {
    notepad.viewKind = inferNotepadViewKind(notepad);
  }
  return notepad;
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
    viewKind: request.definition.viewKind ?? inferNotepadViewKind(request.definition),
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

export async function projectsList(): Promise<ProjectDefinition[]> {
  if (IS_TAURI) {
    return tauriInvoke("projects_list");
  }
  ensureProjectsBackfilled();
  return [...mockStore.projects].sort((a, b) => a.name.localeCompare(b.name));
}

export async function projectGet(projectId: string): Promise<ProjectDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("project_get", { projectId });
  }
  ensureProjectsBackfilled();
  return mockStore.projects.find((project) => project.id === projectId) ?? null;
}

export async function projectSave(payload: SaveProjectDefinitionRequest): Promise<ProjectDefinition> {
  const request: SaveProjectDefinitionRequest = {
    ...payload,
    idempotencyKey: ensureIdempotencyKey(payload.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("project_save", { payload: request });
  }
  ensureProjectsBackfilled();
  const now = nowIso();
  const existing = mockStore.projects.find((project) => project.id === request.definition.id);
  if (request.expectedRevision !== undefined) {
    const actual = existing?.revision ?? 0;
    if (actual !== request.expectedRevision) {
      throw new Error(`CONFLICT: expected revision ${request.expectedRevision} but found ${actual}`);
    }
  }
  const normalizedViewIds = request.definition.viewIds.filter(
    (value, index, values) => value.trim().length > 0 && values.indexOf(value) === index
  );
  const next: ProjectDefinition = {
    ...request.definition,
    viewIds: normalizedViewIds,
    defaultViewId: request.definition.defaultViewId ?? normalizedViewIds[0] ?? "now",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    mockStore.projects.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function projectDelete(projectId: string): Promise<{ success: boolean }> {
  const idempotencyKey = ensureIdempotencyKey();
  if (IS_TAURI) {
    return tauriInvoke("project_delete", { projectId, idempotencyKey });
  }
  ensureProjectsBackfilled();
  const idx = mockStore.projects.findIndex((project) => project.id === projectId);
  if (idx === -1) {
    return { success: false };
  }
  mockStore.projects.splice(idx, 1);
  persistMockStore();
  return { success: true };
}

export async function projectOpen(projectId: string): Promise<{ projectId: string; defaultViewId: string }> {
  if (IS_TAURI) {
    return tauriInvoke("project_open", { projectId });
  }
  const project = await projectGet(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const defaultViewId = project.defaultViewId ?? project.viewIds[0] ?? "now";
  return { projectId, defaultViewId };
}

export async function projectViewsList(projectId: string): Promise<NotepadViewDefinition[]> {
  if (IS_TAURI) {
    return tauriInvoke("project_views_list", { projectId });
  }
  const project = await projectGet(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const available = await notepadsList();
  if (project.viewIds.length === 0) {
    return available.filter((notepad) => notepad.id === project.defaultViewId);
  }
  const allowed = new Set(project.viewIds);
  return available.filter((notepad) => allowed.has(notepad.id));
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

export async function notepadBlockCreate(request: CreateBlockInNotepadRequest): Promise<BlockRecord> {
  const payload: CreateBlockInNotepadRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("notepad_block_create", { request: payload });
  }
  const notepad = await notepadGet(payload.notepadId);
  if (!notepad) {
    throw new Error(`Notepad not found: ${payload.notepadId}`);
  }
  const capture = notepad.captureDefaults;
  const atom = await atomCreate({
    rawText: payload.rawText,
    body: payload.body,
    captureSource: payload.captureSource ?? "ui",
    initialFacets: capture?.initialFacets ?? ["task"],
    relations: { threadIds: capture?.threadIds ?? [] },
    facetData: {
      task: {
        status: capture?.taskStatus ?? "todo",
        priority: capture?.taskPriority ?? 3,
        commitmentLevel: capture?.commitmentLevel,
        attentionLayer: capture?.attentionLayer
      },
      meta: {
        labels: capture?.labels,
        categories: capture?.categories
      }
    }
  });
  const block = atomToBlockRecord(atom);
  const exists = mockStore.placements.some(
    (placement) => placement.viewId === payload.notepadId && placement.blockId === block.id
  );
  if (!exists) {
    const now = nowIso();
    const placementsForView = mockStore.placements.filter((placement) => placement.viewId === payload.notepadId);
    mockStore.placements.push({
      id: uid("placement"),
      schemaVersion: 1,
      viewId: payload.notepadId,
      blockId: block.id,
      parentPlacementId: undefined,
      orderKey: nextPlacementOrderKey(placementsForView),
      pinned: false,
      createdAt: now,
      updatedAt: now,
      revision: 1
    });
  }
  persistMockStore();
  return block;
}

export async function blocksList(request: ListBlocksRequest = {}): Promise<PageResponse<BlockRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("blocks_list", { request });
  }
  let items = mockBlocksSnapshot();
  if (request.atomId) {
    items = items.filter((block) => block.atomId === request.atomId);
  }
  if (request.lifecycle) {
    items = items.filter((block) => block.lifecycle === request.lifecycle);
  }
  if (request.textQuery) {
    const needle = request.textQuery.toLowerCase();
    items = items.filter((block) => block.text.toLowerCase().includes(needle));
  }
  if (request.notepadId) {
    const ids = new Set(
      mockStore.placements.filter((placement) => placement.viewId === request.notepadId).map((placement) => placement.blockId)
    );
    items = items.filter((block) => ids.has(block.id));
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const offset = Number.parseInt(request.cursor ?? "0", 10) || 0;
  const pageSize = Math.max(1, Math.min(500, request.limit ?? 100));
  const page = items.slice(offset, offset + pageSize);
  return {
    items: page,
    nextCursor: offset + page.length < items.length ? String(offset + page.length) : undefined,
    totalApprox: items.length
  };
}

export async function blockGet(blockId: string): Promise<BlockRecord | null> {
  if (IS_TAURI) {
    return tauriInvoke("block_get", { blockId });
  }
  return mockBlocksSnapshot().find((block) => block.id === blockId) ?? null;
}

export async function placementsList(
  request: ListPlacementsRequest = {}
): Promise<PageResponse<PlacementRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("placements_list", { request });
  }
  let items = [...mockStore.placements];
  if (request.viewId) {
    items = items.filter((placement) => placement.viewId === request.viewId);
  }
  if (request.blockId) {
    items = items.filter((placement) => placement.blockId === request.blockId);
  }
  items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.orderKey.localeCompare(b.orderKey));
  const offset = Number.parseInt(request.cursor ?? "0", 10) || 0;
  const pageSize = Math.max(1, Math.min(500, request.limit ?? 100));
  const page = items.slice(offset, offset + pageSize);
  return {
    items: page,
    nextCursor: offset + page.length < items.length ? String(offset + page.length) : undefined,
    totalApprox: items.length
  };
}

export async function placementSave(placement: WorkspaceMutationPayload): Promise<PlacementRecord> {
  if (IS_TAURI) {
    return tauriInvoke("placement_save", { placement });
  }
  const viewId = String(placement.viewId ?? "");
  const blockId = String(placement.blockId ?? "");
  if (!viewId || !blockId) {
    throw new Error("VALIDATION_ERROR: placement viewId and blockId are required");
  }
  if (!(await notepadGet(viewId))) {
    throw new Error(`Notepad not found: ${viewId}`);
  }
  if (!(await blockGet(blockId))) {
    throw new Error(`Block not found: ${blockId}`);
  }

  const now = nowIso();
  const explicitId = placement.id ? String(placement.id) : undefined;
  const idx = explicitId ? mockStore.placements.findIndex((item) => item.id === explicitId) : -1;
  const existing = idx >= 0 ? mockStore.placements[idx] : undefined;
  const expectedRevision =
    typeof placement.expectedRevision === "number" ? placement.expectedRevision : undefined;
  if (expectedRevision !== undefined) {
    const actual = existing?.revision ?? 0;
    if (actual !== expectedRevision) {
      throw new Error(`CONFLICT: expected revision ${expectedRevision} but found ${actual}`);
    }
  }

  const next: PlacementRecord = {
    id: explicitId ?? uid("placement"),
    schemaVersion: typeof placement.schemaVersion === "number" ? placement.schemaVersion : 1,
    viewId,
    blockId,
    parentPlacementId: placement.parentPlacementId ? String(placement.parentPlacementId) : undefined,
    orderKey:
      typeof placement.orderKey === "string"
        ? placement.orderKey
        : nextPlacementOrderKey(mockStore.placements.filter((item) => item.viewId === viewId)),
    pinned: typeof placement.pinned === "boolean" ? placement.pinned : false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1
  };
  if (existing && idx >= 0) {
    mockStore.placements[idx] = next;
  } else {
    mockStore.placements.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function placementDelete(
  placementId: string,
  idempotencyKey?: string
): Promise<{ success: boolean }> {
  const key = ensureIdempotencyKey(idempotencyKey);
  if (IS_TAURI) {
    return tauriInvoke("placement_delete", { placementId, idempotencyKey: key });
  }
  const idx = mockStore.placements.findIndex((placement) => placement.id === placementId);
  if (idx === -1) {
    return { success: false };
  }
  mockStore.placements.splice(idx, 1);
  persistMockStore();
  return { success: true };
}

export async function placementsReorder(
  viewId: string,
  request: PlacementReorderRequest
): Promise<PlacementRecord[]> {
  const payload: PlacementReorderRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("placements_reorder", { viewId, request: payload });
  }
  const placements = mockStore.placements.filter((placement) => placement.viewId === viewId);
  if (placements.length !== payload.orderedPlacementIds.length) {
    throw new Error("VALIDATION_ERROR: placement reorder requires full placement id list");
  }
  const now = nowIso();
  const byId = new Map(placements.map((placement) => [placement.id, placement]));
  const result: PlacementRecord[] = [];
  payload.orderedPlacementIds.forEach((placementId, index) => {
    const existing = byId.get(placementId);
    if (!existing) {
      throw new Error(`VALIDATION_ERROR: placement ${placementId} does not belong to ${viewId}`);
    }
    const next: PlacementRecord = {
      ...existing,
      orderKey: `${String(index).padStart(8, "0")}-${existing.id.slice(-6)}`,
      updatedAt: now,
      revision: existing.revision + 1
    };
    result.push(next);
  });
  const nextSet = new Set(result.map((placement) => placement.id));
  mockStore.placements = [...mockStore.placements.filter((placement) => !nextSet.has(placement.id)), ...result];
  persistMockStore();
  return result.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

export async function conditionsList(
  request: ListConditionsRequest = {}
): Promise<PageResponse<ConditionRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("conditions_list", { request });
  }
  let items = [...mockStore.conditions];
  if (request.atomId) {
    items = items.filter((condition) => condition.atomId === request.atomId);
  }
  if (request.status) {
    items = items.filter((condition) => condition.status === request.status);
  }
  if (request.mode) {
    items = items.filter((condition) => condition.mode === request.mode);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateItems(items, request.limit, request.cursor);
}

export async function conditionGet(conditionId: string): Promise<ConditionRecord | null> {
  if (IS_TAURI) {
    return tauriInvoke("condition_get", { conditionId });
  }
  return mockStore.conditions.find((condition) => condition.id === conditionId) ?? null;
}

export async function conditionSetDate(request: ConditionSetDateRequest): Promise<ConditionRecord> {
  const payload: ConditionSetDateRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("condition_set_date", { request: payload });
  }

  getMockAtomOrThrow(payload.atomId);
  const now = nowIso();
  const id = conditionIdForAtomMode(payload.atomId, "date");
  const idx = mockStore.conditions.findIndex((condition) => condition.id === id);
  const existing = idx >= 0 ? mockStore.conditions[idx] : undefined;
  const next: ConditionRecord = {
    id,
    schemaVersion: 1,
    atomId: payload.atomId,
    status: "active",
    mode: "date",
    blockedUntil: payload.untilAt,
    waitingOnPerson: undefined,
    waitingCadenceDays: undefined,
    blockerAtomId: undefined,
    lastFollowupAt: undefined,
    nextFollowupAt: undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: undefined,
    canceledAt: undefined,
    revision: (existing?.revision ?? 0) + 1
  };
  if (idx >= 0) {
    mockStore.conditions[idx] = next;
  } else {
    mockStore.conditions.unshift(next);
  }
  applyConditionToAtom(next);
  recordWorkspaceEvent("condition.set", { ...next }, next.atomId);
  persistMockStore();
  return next;
}

export async function conditionSetPerson(request: ConditionSetPersonRequest): Promise<ConditionRecord> {
  const payload: ConditionSetPersonRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("condition_set_person", { request: payload });
  }

  getMockAtomOrThrow(payload.atomId);
  const now = nowIso();
  const cadenceDays = Math.max(1, payload.cadenceDays);
  const nextFollowupAt = new Date(Date.parse(now) + cadenceDays * 24 * 60 * 60 * 1000).toISOString();
  const id = conditionIdForAtomMode(payload.atomId, "person");
  const idx = mockStore.conditions.findIndex((condition) => condition.id === id);
  const existing = idx >= 0 ? mockStore.conditions[idx] : undefined;
  const next: ConditionRecord = {
    id,
    schemaVersion: 1,
    atomId: payload.atomId,
    status: "active",
    mode: "person",
    blockedUntil: undefined,
    waitingOnPerson: payload.waitingOnPerson,
    waitingCadenceDays: cadenceDays,
    blockerAtomId: undefined,
    lastFollowupAt: now,
    nextFollowupAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: undefined,
    canceledAt: undefined,
    revision: (existing?.revision ?? 0) + 1
  };
  if (idx >= 0) {
    mockStore.conditions[idx] = next;
  } else {
    mockStore.conditions.unshift(next);
  }
  applyConditionToAtom(next);
  recordWorkspaceEvent("condition.set", { ...next }, next.atomId);
  persistMockStore();
  return next;
}

export async function conditionSetTask(request: ConditionSetTaskRequest): Promise<ConditionRecord> {
  const payload: ConditionSetTaskRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("condition_set_task", { request: payload });
  }

  getMockAtomOrThrow(payload.atomId);
  getMockAtomOrThrow(payload.blockerAtomId);
  const now = nowIso();
  const id = conditionIdForAtomMode(payload.atomId, "task");
  const idx = mockStore.conditions.findIndex((condition) => condition.id === id);
  const existing = idx >= 0 ? mockStore.conditions[idx] : undefined;
  const next: ConditionRecord = {
    id,
    schemaVersion: 1,
    atomId: payload.atomId,
    status: "active",
    mode: "task",
    blockedUntil: undefined,
    waitingOnPerson: undefined,
    waitingCadenceDays: undefined,
    blockerAtomId: payload.blockerAtomId,
    lastFollowupAt: undefined,
    nextFollowupAt: undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    resolvedAt: undefined,
    canceledAt: undefined,
    revision: (existing?.revision ?? 0) + 1
  };
  if (idx >= 0) {
    mockStore.conditions[idx] = next;
  } else {
    mockStore.conditions.unshift(next);
  }
  applyConditionToAtom(next);
  recordWorkspaceEvent("condition.set", { ...next }, next.atomId);
  persistMockStore();
  return next;
}

export async function conditionFollowupLog(
  conditionId: string,
  request: ConditionFollowupRequest
): Promise<ConditionRecord> {
  const payload: ConditionFollowupRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("condition_followup_log", { conditionId, request: payload });
  }
  const idx = mockStore.conditions.findIndex(
    (condition) => condition.id === conditionId && condition.status === "active"
  );
  if (idx === -1) {
    throw new Error(`Condition not found: ${conditionId}`);
  }
  const existing = mockStore.conditions[idx];
  if (existing.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${existing.revision}`);
  }
  if (existing.mode !== "person") {
    throw new Error("VALIDATION_ERROR: followup can only be logged on person conditions");
  }
  const followedUpAt = payload.followedUpAt ?? nowIso();
  const cadenceDays = Math.max(1, existing.waitingCadenceDays ?? 7);
  const nextFollowupAt = new Date(Date.parse(followedUpAt) + cadenceDays * 24 * 60 * 60 * 1000).toISOString();
  const next: ConditionRecord = {
    ...existing,
    lastFollowupAt: followedUpAt,
    nextFollowupAt,
    updatedAt: nowIso(),
    revision: existing.revision + 1
  };
  mockStore.conditions[idx] = next;
  applyConditionToAtom(next);
  recordWorkspaceEvent(
    "condition.followup_logged",
    { conditionId: next.id, followedUpAt },
    next.atomId
  );
  persistMockStore();
  return next;
}

export async function conditionResolve(
  conditionId: string,
  request: ConditionResolveRequest
): Promise<ConditionRecord> {
  const payload: ConditionResolveRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("condition_resolve", { conditionId, request: payload });
  }
  const idx = mockStore.conditions.findIndex(
    (condition) => condition.id === conditionId && condition.status === "active"
  );
  if (idx === -1) {
    throw new Error(`Condition not found: ${conditionId}`);
  }
  const existing = mockStore.conditions[idx];
  if (existing.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${existing.revision}`);
  }
  const transitioned: ConditionRecord = {
    ...existing,
    status: "satisfied",
    resolvedAt: nowIso(),
    updatedAt: nowIso(),
    revision: existing.revision + 1
  };
  mockStore.conditions[idx] = transitioned;
  clearBlockingIfNoActiveCondition(transitioned.atomId);
  recordWorkspaceEvent(
    "condition.transitioned",
    { conditionId: transitioned.id, status: transitioned.status },
    transitioned.atomId
  );
  persistMockStore();
  return transitioned;
}

export async function conditionCancel(
  conditionId: string,
  request: ConditionCancelRequest
): Promise<ConditionRecord> {
  const payload: ConditionCancelRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("condition_cancel", { conditionId, request: payload });
  }
  const idx = mockStore.conditions.findIndex(
    (condition) => condition.id === conditionId && condition.status === "active"
  );
  if (idx === -1) {
    throw new Error(`Condition not found: ${conditionId}`);
  }
  const existing = mockStore.conditions[idx];
  if (existing.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${existing.revision}`);
  }
  const transitioned: ConditionRecord = {
    ...existing,
    status: "cancelled",
    canceledAt: nowIso(),
    updatedAt: nowIso(),
    revision: existing.revision + 1
  };
  mockStore.conditions[idx] = transitioned;
  clearBlockingIfNoActiveCondition(transitioned.atomId);
  recordWorkspaceEvent(
    "condition.transitioned",
    { conditionId: transitioned.id, status: transitioned.status, reason: payload.reason },
    transitioned.atomId
  );
  persistMockStore();
  return transitioned;
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
  const defaultEnabled = new Set<FeatureFlag["key"]>([
    "workspace.notepad_ui_v2",
    "workspace.notepad_open_notepad_v2",
    "workspace.inline_tags",
    "workspace.notepad_context_menu",
    "workspace.projects_v1",
    "workspace.notepad_project_split_ui",
    "workspace.project_default_views",
    "workspace.scheduler",
    "workspace.decay_engine",
    "workspace.decision_queue",
    "workspace.focus_sessions_v2",
    "workspace.projections",
    "workspace.recurrence"
  ]);
  const keys: FeatureFlag["key"][] = [
    "workspace.blocks_v2",
    "workspace.placements_v2",
    "workspace.capture_policy_v2",
    "workspace.rules_engine",
    "workspace.scheduler",
    "workspace.decision_queue",
    "workspace.notifications",
    "workspace.projections",
    "workspace.registry",
    "workspace.semantic_index",
    "workspace.decay_engine",
    "workspace.focus_sessions_v2",
    "workspace.recurrence",
    "workspace.recurrence_v2",
    "workspace.agent_handoff",
    "workspace.notepad_ui_v2",
    "workspace.notepad_open_notepad_v2",
    "workspace.inline_tags",
    "workspace.notepad_context_menu",
    "workspace.projects_v1",
    "workspace.notepad_project_split_ui",
    "workspace.project_default_views"
  ];
  mockStore.featureFlags = keys.map((key) => ({
    key,
    enabled: defaultEnabled.has(key),
    updatedAt: now
  }));
}

function ensureDefaultWorkspaceJobs(): void {
  const now = nowIso();
  const defaults: Array<Pick<JobDefinition, "id" | "type" | "enabled" | "schedule" | "timeoutMs" | "maxRetries" | "retryBackoffMs">> = [
    { id: "job.workspace.sweep.decay", type: "sweep.decay", enabled: true, schedule: { kind: "interval", everyMinutes: 60 }, timeoutMs: 30_000, maxRetries: 0, retryBackoffMs: 1_000 },
    { id: "job.workspace.sweep.boundary", type: "sweep.boundary", enabled: true, schedule: { kind: "interval", everyMinutes: 60 }, timeoutMs: 30_000, maxRetries: 0, retryBackoffMs: 1_000 },
    { id: "job.workspace.triage.enqueue", type: "triage.enqueue", enabled: true, schedule: { kind: "interval", everyMinutes: 45 }, timeoutMs: 30_000, maxRetries: 0, retryBackoffMs: 1_000 },
    { id: "job.workspace.followup.enqueue", type: "followup.enqueue", enabled: true, schedule: { kind: "interval", everyMinutes: 180 }, timeoutMs: 30_000, maxRetries: 0, retryBackoffMs: 1_000 },
    { id: "job.workspace.projection.refresh", type: "projection.refresh", enabled: true, schedule: { kind: "interval", everyMinutes: 30 }, timeoutMs: 30_000, maxRetries: 0, retryBackoffMs: 1_000 }
  ];

  for (const next of defaults) {
    const existing = mockStore.workspaceJobs.find((job) => job.id === next.id || job.type === next.type);
    if (existing) {
      continue;
    }
    mockStore.workspaceJobs.unshift({
      id: next.id,
      schemaVersion: 1,
      type: next.type,
      enabled: next.enabled,
      schedule: next.schedule,
      timeoutMs: next.timeoutMs,
      maxRetries: next.maxRetries,
      retryBackoffMs: next.retryBackoffMs,
      createdAt: now,
      updatedAt: now,
      revision: 1
    });
  }
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
  ensureDefaultWorkspaceJobs();
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
  ensureDefaultWorkspaceJobs();
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

async function runProjectionRefreshJobs(payload?: Record<string, unknown>): Promise<"executed" | "skipped"> {
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return "skipped";
  }
  ensureDefaultProjections();
  const projectionIds = asStringArray(payload?.projectionIds);
  if (projectionIds.length > 0) {
    for (const projectionId of projectionIds) {
      await projectionRefresh(projectionId, "incremental");
    }
    return "executed";
  }
  if (typeof payload?.projectionId === "string") {
    await projectionRefresh(payload.projectionId, "incremental");
    return "executed";
  }
  const defaults = [...mockStore.projections]
    .filter((projection) => projection.enabled)
    .map((projection) => projection.id);
  for (const projectionId of defaults) {
    await projectionRefresh(projectionId, "incremental");
  }
  return defaults.length > 0 ? "executed" : "skipped";
}

async function executeJob(job: JobDefinition, payload?: Record<string, unknown>): Promise<"executed" | "skipped"> {
  if (!isFeatureFlagEnabled("workspace.scheduler", true)) {
    return "skipped";
  }
  switch (job.type) {
    case "sweep.decay":
    case "sweep.boundary":
      if (!isFeatureFlagEnabled("workspace.decay_engine", true)) {
        return "skipped";
      }
      await systemApplyAttentionUpdate({ now: typeof payload?.now === "string" ? payload.now : undefined });
      if (isFeatureFlagEnabled("workspace.decision_queue", true)) {
        await systemGenerateDecisionCards({ now: typeof payload?.now === "string" ? payload.now : undefined });
      }
      return "executed";
    case "triage.enqueue":
    case "followup.enqueue":
      if (!isFeatureFlagEnabled("workspace.decision_queue", true)) {
        return "skipped";
      }
      await systemGenerateDecisionCards({ now: typeof payload?.now === "string" ? payload.now : undefined });
      return "executed";
    case "recurrence.spawn":
      if (!isFeatureFlagEnabled("workspace.recurrence", true) && !isFeatureFlagEnabled("workspace.recurrence_v2", true)) {
        return "skipped";
      }
      await recurrenceSpawn({
        now: typeof payload?.now === "string" ? payload.now : undefined,
        templateIds: asStringArray(payload?.templateIds)
      });
      return "executed";
    case "projection.refresh":
      return runProjectionRefreshJobs(payload);
    case "semantic.reindex":
      if (!isFeatureFlagEnabled("workspace.semantic_index", true)) {
        return "skipped";
      }
      await semanticReindex(asStringArray(payload?.atomIds));
      return "executed";
    case "sweep.classification":
      return "skipped";
    default:
      return "skipped";
  }
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
    status: "running",
    trigger: "manual",
    attempt: 1,
    startedAt: now,
    idempotencyKey: mutationKey,
    payload
  };
  mockStore.jobRuns.unshift(run);
  recordWorkspaceEvent("job.run.started", { jobRunId: run.id, jobId });
  try {
    const outcome = await executeJob(job, payload);
    run.status = outcome === "skipped" ? "skipped" : "succeeded";
    run.finishedAt = nowIso();
    recordWorkspaceEvent("job.run.completed", { jobRunId: run.id, jobId, status: run.status });
  } catch (error) {
    run.status = "failed";
    run.finishedAt = nowIso();
    run.errorCode = "JOB_EXECUTION_FAILED";
    run.errorMessage = error instanceof Error ? error.message : String(error);
    recordWorkspaceEvent("job.run.failed", {
      jobRunId: run.id,
      jobId,
      errorMessage: run.errorMessage
    });
  } finally {
    persistMockStore();
  }
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
    dedupeKey: prompt.dedupeKey,
    triggerCode: prompt.triggerCode,
    triggerReason: prompt.triggerReason,
    triggerMeta: prompt.triggerMeta,
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

function atomsByIds(atomIds: string[]): AtomRecord[] {
  if (atomIds.length === 0) {
    return [];
  }
  const ids = new Set(atomIds);
  return mockStore.atoms.filter((atom) => ids.has(atom.id));
}

function markAttentionSignal(atom: AtomRecord, now: string, kind: NonNullable<AtomRecord["facetData"]["attention"]>["lastSignalKind"]): void {
  atom.facetData.attention = {
    layer: atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer ?? "long",
    ...atom.facetData.attention,
    lastSignalAt: now,
    lastSignalKind: kind
  };
}

function atomsForFocusBlocks(focusBlockIds: string[]): AtomRecord[] {
  const atoms: AtomRecord[] = [];
  const seen = new Set<string>();
  for (const blockId of focusBlockIds) {
    const directAtom = mockStore.atoms.find((atom) => atom.id === blockId);
    if (directAtom && !seen.has(directAtom.id)) {
      seen.add(directAtom.id);
      atoms.push(directAtom);
      continue;
    }
    const block = mockBlocksSnapshot().find((entry) => entry.id === blockId);
    if (!block?.atomId || seen.has(block.atomId)) {
      continue;
    }
    const atom = mockStore.atoms.find((entry) => entry.id === block.atomId);
    if (!atom) {
      continue;
    }
    seen.add(atom.id);
    atoms.push(atom);
  }
  return atoms;
}

function restoreFocusedTaskStatuses(session: WorkSessionRecord, now: string): void {
  for (const atom of atomsForFocusBlocks(session.focusBlockIds)) {
    const task = ensureTaskFacet(atom);
    const originalStatus = session.initialTaskStatusByAtomId?.[atom.id];
    // Restore only if the task is still in the transient focus state.
    if (originalStatus && task.status === "doing") {
      task.status = originalStatus;
    }
    markAttentionSignal(atom, now, "focus_end");
    atom.updatedAt = now;
    atom.revision += 1;
  }
}

async function applyDecisionOptionToAtom(atom: AtomRecord, option: DecisionOption): Promise<void> {
  const now = nowIso();
  const task = ensureTaskFacet(atom);
  switch (option.actionKind) {
    case "task.do_now":
      task.status = "doing";
      task.attentionLayer = "l3";
      markAttentionSignal(atom, now, "decision");
      break;
    case "task.snooze": {
      const untilAt = typeof option.payload?.untilAt === "string"
        ? option.payload.untilAt
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      task.snoozedUntil = untilAt;
      if (!task.softDueAt || task.softDueAt < untilAt) {
        task.softDueAt = untilAt;
      }
      task.status = task.status === "blocked" ? "blocked" : "todo";
      markAttentionSignal(atom, now, "decision");
      break;
    }
    case "task.reschedule": {
      const dueAt = typeof option.payload?.dueAt === "string"
        ? option.payload.dueAt
        : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      if (task.commitmentLevel === "hard") {
        task.hardDueAt = dueAt;
      } else {
        task.softDueAt = dueAt;
      }
      task.status = "todo";
      markAttentionSignal(atom, now, "decision");
      break;
    }
    case "task.recommit":
      task.commitmentLevel = "hard";
      task.attentionLayer = task.attentionLayer === "archive" ? "ram" : task.attentionLayer ?? "ram";
      markAttentionSignal(atom, now, "decision");
      break;
    case "task.cancel_commitment":
      task.commitmentLevel = "soft";
      markAttentionSignal(atom, now, "decision");
      break;
    case "task.unblock": {
      const activeConditions = mockStore.conditions.filter(
        (condition) => condition.atomId === atom.id && condition.status === "active"
      );
      for (const condition of activeConditions) {
        await conditionResolve(condition.id, { expectedRevision: condition.revision });
      }
      task.status = task.status === "blocked" ? "todo" : task.status;
      markAttentionSignal(atom, now, "decision");
      break;
    }
    case "task.archive":
    case "task.drop":
      await atomArchive(atom.id, {
        expectedRevision: atom.revision,
        reason: "decision_resolution"
      });
      return;
    case "confession.create_blocker":
      markAttentionSignal(atom, now, "decision");
      break;
    default:
      break;
  }
  atom.updatedAt = now;
  atom.revision += 1;
}

async function applyDecisionResolution(decision: DecisionPrompt, optionId: string): Promise<void> {
  const option = decision.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    return;
  }
  const targetIds = decisionOptionAtomIds(option, decision.atomIds);
  const targets = atomsByIds(targetIds);
  for (const atom of targets) {
    await applyDecisionOptionToAtom(atom, option);
  }
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
  await applyDecisionResolution(existing, optionId);
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

export async function workSessionsList(
  request: WorkSessionsListRequest = {}
): Promise<PageResponse<WorkSessionRecord>> {
  if (IS_TAURI) {
    return tauriInvoke("work_sessions_list", { ...request });
  }
  let items = [...mockStore.workSessions];
  if (request.status) {
    items = items.filter((session) => session.status === request.status);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function workSessionGet(sessionId: string): Promise<WorkSessionRecord | null> {
  if (IS_TAURI) {
    return tauriInvoke("work_session_get", { sessionId });
  }
  return mockStore.workSessions.find((session) => session.id === sessionId) ?? null;
}

export async function workSessionStart(request: WorkSessionStartRequest): Promise<WorkSessionRecord> {
  const payload: WorkSessionStartRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("work_session_start", { request: payload });
  }
  const now = nowIso();
  const next: WorkSessionRecord = {
    id: uid("ws"),
    status: "running",
    focusBlockIds: payload.focusBlockIds ?? [],
    initialTaskStatusByAtomId: {},
    startedAt: now,
    notes: payload.note ? [payload.note] : [],
    createdAt: now,
    updatedAt: now,
    revision: 1
  };
  mockStore.workSessions.unshift(next);
  const focusedAtoms = atomsForFocusBlocks(next.focusBlockIds);
  for (const atom of focusedAtoms) {
    const task = ensureTaskFacet(atom);
    next.initialTaskStatusByAtomId![atom.id] = task.status;
    if (task.status === "todo") {
      task.status = "doing";
    }
    if (!task.attentionLayer || ATTENTION_LAYER_RANK[task.attentionLayer] > ATTENTION_LAYER_RANK.l3) {
      task.attentionLayer = "l3";
    }
    markAttentionSignal(atom, now, "focus_start");
    atom.updatedAt = now;
    atom.revision += 1;
  }
  recordWorkspaceEvent("work.session.started", { sessionId: next.id, focusBlockIds: next.focusBlockIds });
  persistMockStore();
  return next;
}

export async function workSessionNote(
  sessionId: string,
  request: WorkSessionNoteRequest
): Promise<WorkSessionRecord> {
  const payload: WorkSessionNoteRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("work_session_note", { sessionId, request: payload });
  }
  const session = await workSessionGet(sessionId);
  if (!session) {
    throw new Error(`Work session not found: ${sessionId}`);
  }
  if (session.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${session.revision}`);
  }
  session.notes = [...session.notes, payload.note];
  const now = nowIso();
  session.updatedAt = now;
  session.revision += 1;
  for (const atom of atomsForFocusBlocks(session.focusBlockIds)) {
    markAttentionSignal(atom, now, "focus_note");
    atom.updatedAt = now;
    atom.revision += 1;
  }
  recordWorkspaceEvent("work.session.noted", { sessionId, noteLength: payload.note.length });
  persistMockStore();
  return session;
}

export async function workSessionEnd(
  sessionId: string,
  request: WorkSessionEndRequest
): Promise<WorkSessionRecord> {
  const payload: WorkSessionEndRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("work_session_end", { sessionId, request: payload });
  }
  const session = await workSessionGet(sessionId);
  if (!session) {
    throw new Error(`Work session not found: ${sessionId}`);
  }
  if (session.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${session.revision}`);
  }
  const now = nowIso();
  session.status = "ended";
  session.endedAt = now;
  session.summaryNote = payload.summaryNote;
  session.updatedAt = now;
  session.revision += 1;
  restoreFocusedTaskStatuses(session, now);
  recordWorkspaceEvent("work.session.ended", { sessionId, summary: payload.summaryNote });
  persistMockStore();
  return session;
}

export async function workSessionCancel(
  sessionId: string,
  request: WorkSessionCancelRequest
): Promise<WorkSessionRecord> {
  const payload: WorkSessionCancelRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("work_session_cancel", { sessionId, request: payload });
  }
  const session = await workSessionGet(sessionId);
  if (!session) {
    throw new Error(`Work session not found: ${sessionId}`);
  }
  if (session.revision !== payload.expectedRevision) {
    throw new Error(`CONFLICT: expected revision ${payload.expectedRevision} but found ${session.revision}`);
  }
  const now = nowIso();
  session.status = "canceled";
  session.canceledAt = now;
  session.summaryNote = payload.reason;
  session.updatedAt = now;
  session.revision += 1;
  restoreFocusedTaskStatuses(session, now);
  recordWorkspaceEvent("work.session.canceled", { sessionId, reason: payload.reason });
  persistMockStore();
  return session;
}

export async function recurrenceTemplatesList(
  request: RecurrenceTemplatesListRequest = {}
): Promise<PageResponse<RecurrenceTemplate>> {
  if (IS_TAURI) {
    return tauriInvoke("recurrence_templates_list", { ...request });
  }
  let items = [...mockStore.recurrenceTemplates];
  if (request.status) {
    items = items.filter((template) => template.status === request.status);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function recurrenceTemplateGet(templateId: string): Promise<RecurrenceTemplate | null> {
  if (IS_TAURI) {
    return tauriInvoke("recurrence_template_get", { templateId });
  }
  return mockStore.recurrenceTemplates.find((template) => template.id === templateId) ?? null;
}

export async function recurrenceTemplateSave(payload: WorkspaceMutationPayload): Promise<RecurrenceTemplate> {
  const request: Record<string, unknown> = {
    ...payload,
    idempotencyKey:
      typeof payload.idempotencyKey === "string"
        ? ensureIdempotencyKey(payload.idempotencyKey)
        : ensureIdempotencyKey()
  };
  if (IS_TAURI) {
    return tauriInvoke("recurrence_template_save", { payload: request });
  }
  const now = nowIso();
  const id = request.id ? String(request.id) : uid("recurrence-template");
  const idx = mockStore.recurrenceTemplates.findIndex((template) => template.id === id);
  const existing = idx >= 0 ? mockStore.recurrenceTemplates[idx] : undefined;
  const expectedRevision = typeof request.expectedRevision === "number" ? request.expectedRevision : undefined;
  if (expectedRevision !== undefined) {
    const actual = existing?.revision ?? 0;
    if (actual !== expectedRevision) {
      throw new Error(`CONFLICT: expected revision ${expectedRevision} but found ${actual}`);
    }
  }
  const next: RecurrenceTemplate = {
    id,
    schemaVersion: typeof request.schemaVersion === "number" ? request.schemaVersion : 1,
    status: typeof request.status === "string" ? request.status : "active",
    titleTemplate: typeof request.titleTemplate === "string" ? request.titleTemplate : "Recurring item",
    rawTextTemplate: typeof request.rawTextTemplate === "string" ? request.rawTextTemplate : "- [ ] Recurring item",
    defaultNotepadId: typeof request.defaultNotepadId === "string" ? request.defaultNotepadId : "now",
    threadIds: Array.isArray(request.threadIds) ? (request.threadIds as string[]) : [],
    frequency: typeof request.frequency === "string" ? request.frequency : "daily",
    interval: typeof request.interval === "number" ? request.interval : 1,
    byDay: Array.isArray(request.byDay) ? (request.byDay as string[]) : [],
    nextRunAt: typeof request.nextRunAt === "string" ? request.nextRunAt : existing?.nextRunAt ?? now,
    lastSpawnedAt: typeof request.lastSpawnedAt === "string" ? request.lastSpawnedAt : existing?.lastSpawnedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1
  };
  if (existing && idx >= 0) {
    mockStore.recurrenceTemplates[idx] = next;
  } else {
    mockStore.recurrenceTemplates.unshift(next);
  }
  persistMockStore();
  return next;
}

export async function recurrenceTemplateUpdate(
  templateId: string,
  patch: WorkspaceMutationPayload
): Promise<RecurrenceTemplate> {
  const request: Record<string, unknown> = {
    ...patch,
    idempotencyKey:
      typeof patch.idempotencyKey === "string"
        ? ensureIdempotencyKey(patch.idempotencyKey)
        : ensureIdempotencyKey()
  };
  if (IS_TAURI) {
    return tauriInvoke("recurrence_template_update", { templateId, payload: request });
  }
  const existing = await recurrenceTemplateGet(templateId);
  if (!existing) {
    throw new Error(`Recurrence template not found: ${templateId}`);
  }
  return recurrenceTemplateSave({ ...existing, ...request, id: templateId });
}

export async function recurrenceInstancesList(
  request: RecurrenceInstancesListRequest = {}
): Promise<PageResponse<RecurrenceInstance>> {
  if (IS_TAURI) {
    return tauriInvoke("recurrence_instances_list", { ...request });
  }
  let items = [...mockStore.recurrenceInstances];
  if (request.templateId) {
    items = items.filter((instance) => instance.templateId === request.templateId);
  }
  if (request.status) {
    items = items.filter((instance) => instance.status === request.status);
  }
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return paginateWithRequest(items, request);
}

export async function recurrenceSpawn(request: RecurrenceSpawnRequest = {}): Promise<RecurrenceSpawnResponse> {
  const payload: RecurrenceSpawnRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("recurrence_spawn", { request: payload });
  }
  const now = payload.now ?? nowIso();
  const templateIds = payload.templateIds ? new Set(payload.templateIds) : null;
  const spawnedInstanceIds: string[] = [];
  const touchedTemplateIds: string[] = [];

  for (const template of mockStore.recurrenceTemplates) {
    if (template.status !== "active") continue;
    if (templateIds && !templateIds.has(template.id)) continue;
    const dueAt = template.nextRunAt ?? template.createdAt;
    if (dueAt > now) continue;

    const block = await notepadBlockCreate({
      notepadId: template.defaultNotepadId ?? "now",
      rawText: template.rawTextTemplate || template.titleTemplate,
      captureSource: "agent"
    });
    const instance: RecurrenceInstance = {
      id: uid("recurrence-instance"),
      templateId: template.id,
      status: "spawned",
      scheduledFor: dueAt,
      spawnedAt: now,
      atomId: block.atomId,
      blockId: block.id,
      createdAt: now,
      updatedAt: now,
      revision: 1
    };
    mockStore.recurrenceInstances.unshift(instance);
    spawnedInstanceIds.push(instance.id);
    touchedTemplateIds.push(template.id);
    template.lastSpawnedAt = now;
    template.nextRunAt = nextRecurrenceRun(template, dueAt);
    template.updatedAt = now;
    template.revision += 1;
  }
  persistMockStore();
  return { accepted: true, spawnedInstanceIds, touchedTemplateIds };
}

export async function systemApplyAttentionUpdate(
  request: AttentionUpdateRequest = {}
): Promise<AttentionUpdateResponse> {
  const payload: AttentionUpdateRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("system_apply_attention_update", { request: payload });
  }
  if (!isFeatureFlagEnabled("workspace.decay_engine", true)) {
    return { accepted: false, updatedAtomIds: [], decisionIds: [] };
  }
  const now = payload.now ? new Date(payload.now) : new Date();
  const nowValue = now.toISOString();
  const updatedAtomIds: string[] = [];
  const decisionIds: string[] = [];

  const categoryCounts = new Map<string, number>();
  for (const atom of mockStore.atoms) {
    const categories = atom.facetData.meta?.categories ?? [];
    for (const category of categories) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const computations: AttentionComputation[] = [];
  for (const atom of mockStore.atoms) {
    const task = atom.facetData.task;
    if (!task || atom.archivedAt) continue;
    if (task.status === "done" || task.status === "archived") continue;

    const blocked = task.status === "blocked" || hasActiveCondition(atom.id);
    const previousLayer = task.attentionLayer ?? atom.facetData.attention?.layer ?? "long";
    const previousHeat = atom.facetData.attention?.heatScore ?? confidenceFromPriority(task.priority);
    const staleHours = hoursBetween(atom.facetData.attention?.lastSignalAt ?? atom.updatedAt, now);
    const baseHeat = previousHeat * Math.exp(-Math.min(staleHours, 24 * 30) / 72) + confidenceFromPriority(task.priority) * 0.35;

    let signalDelta = 0;
    if (task.status === "doing") signalDelta += 2;
    if (staleHours <= 0.5) signalDelta += 1.8;
    else if (staleHours <= 6) signalDelta += 1.1;
    else if (staleHours <= 24) signalDelta += 0.4;

    const recentWorkHours = latestWorkSignalHours(atom.id, now);
    if (recentWorkHours !== undefined) {
      if (recentWorkHours <= 2) signalDelta += 2.8;
      else if (recentWorkHours <= 12) signalDelta += 1.8;
      else if (recentWorkHours <= 48) signalDelta += 0.8;
    }

    let duePressure = 0;
    const hardDays = daysUntil(task.hardDueAt, now);
    const softDays = daysUntil(task.softDueAt, now);
    if (hardDays !== undefined) {
      if (hardDays <= 0) duePressure += 4;
      else if (hardDays <= 1) duePressure += 3;
      else if (hardDays <= 3) duePressure += 2;
      else if (hardDays <= 7) duePressure += 1;
    }
    if (softDays !== undefined) {
      if (softDays <= 0) duePressure += 2;
      else if (softDays <= 1) duePressure += 1.4;
      else if (softDays <= 3) duePressure += 0.9;
      else if (softDays <= 7) duePressure += 0.4;
    }

    let commitmentPressure = 0;
    const commitmentLevel = task.commitmentLevel ?? atom.facetData.commitment?.level;
    if (commitmentLevel === "hard") {
      commitmentPressure += 0.8;
      const mustReviewDays = daysUntil(atom.facetData.commitment?.mustReviewBy, now);
      if (mustReviewDays !== undefined) {
        if (mustReviewDays <= 0) commitmentPressure += 2;
        else if (mustReviewDays <= 2) commitmentPressure += 1.4;
      }
      if (hardDays !== undefined && hardDays <= 2) {
        commitmentPressure += 1.2;
      }
    }

    const categories = atom.facetData.meta?.categories ?? [];
    const clusterInfluence = Math.min(
      1,
      categories.reduce((acc, category) => acc + Math.max(0, (categoryCounts.get(category) ?? 0) - 1) * 0.08, 0)
    );

    let score = Math.max(0, Math.min(20, baseHeat + signalDelta + duePressure + commitmentPressure + clusterInfluence));
    let proposedLayer = scoreToLayer(score);
    if (hardDays !== undefined && hardDays <= 0) {
      proposedLayer = "l3";
      score = Math.max(score, 10);
    }
    if (task.status === "doing") {
      proposedLayer = "l3";
      score = Math.max(score, 10.6);
    }
    if (blocked) {
      proposedLayer = "archive";
      score = Math.min(score, 1);
    }

    const dwellStartedAt = atom.facetData.attention?.dwellStartedAt ?? atom.updatedAt;
    const dwellHours = hoursBetween(dwellStartedAt, now);
    const minDwellHours: Record<AttentionLayer, number> = {
      l3: 4,
      ram: 12,
      short: 24,
      long: 48,
      archive: 0
    };
    const previousRank = ATTENTION_LAYER_RANK[previousLayer];
    const proposedRank = ATTENTION_LAYER_RANK[proposedLayer];
    let boundedLayer = proposedLayer;
    if (!blocked && proposedRank > previousRank && dwellHours < minDwellHours[previousLayer]) {
      boundedLayer = previousLayer;
    }

    const reasonSegments: string[] = [];
    if (blocked) reasonSegments.push("blocked");
    if (duePressure > 0) reasonSegments.push(`due+${duePressure.toFixed(1)}`);
    if (signalDelta > 0) reasonSegments.push(`work+${signalDelta.toFixed(1)}`);
    if (commitmentPressure > 0) reasonSegments.push(`commitment+${commitmentPressure.toFixed(1)}`);
    if (reasonSegments.length === 0) reasonSegments.push("decay");

    computations.push({
      atom,
      score,
      proposedLayer,
      boundedLayer,
      blocked,
      duePressure,
      signalDelta,
      commitmentPressure,
      reason: reasonSegments.join(" · ")
    });
  }

  const capEligible = computations
    .filter((entry) => !entry.blocked && entry.boundedLayer !== "archive")
    .sort((a, b) => b.score - a.score);

  const l3 = capEligible.filter((entry) => entry.boundedLayer === "l3");
  if (l3.length > ATTENTION_CAPS.l3) {
    const rankedL3 = [...l3].sort((a, b) => b.score - a.score);
    const keepIds = rankedL3.slice(0, ATTENTION_CAPS.l3).map((entry) => entry.atom.id);
    const overflowIds = rankedL3.slice(ATTENTION_CAPS.l3).map((entry) => entry.atom.id);
    for (const overflow of rankedL3.slice(ATTENTION_CAPS.l3)) {
      overflow.boundedLayer = overflow.score >= 6.4 ? "ram" : "short";
    }
    const decision = await upsertDecisionPrompt({
      type: "l3_overflow",
      dedupeKey: buildDecisionDedupeKey("l3_overflow", l3.map((entry) => entry.atom.id), nowValue.slice(0, 10)),
      title: "L3 is over capacity",
      body: `L3 can hold ${ATTENTION_CAPS.l3} hot tasks. Choose what stays hot.`,
      atomIds: l3.map((entry) => entry.atom.id),
      priority: 1,
      triggerCode: "l3_overflow",
      triggerReason: `L3 has ${l3.length} tasks for a cap of ${ATTENTION_CAPS.l3}.`,
      options: [
        {
          id: "keep_hottest",
          label: `Keep hottest ${ATTENTION_CAPS.l3}`,
          actionKind: "task.do_now",
          payload: { atomIds: keepIds }
        },
        {
          id: "drift_excess",
          label: "Let excess drift",
          actionKind: "task.snooze",
          payload: {
            atomIds: overflowIds,
            untilAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }
        },
        {
          id: "reschedule_excess",
          label: "Reschedule excess",
          actionKind: "task.reschedule",
          payload: {
            atomIds: overflowIds,
            dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]
    });
    decisionIds.push(decision.id);
  }

  const ram = capEligible.filter((entry) => entry.boundedLayer === "ram");
  if (ram.length > ATTENTION_CAPS.ram) {
    const rankedRam = [...ram].sort((a, b) => b.score - a.score);
    const keepIds = rankedRam.slice(0, ATTENTION_CAPS.ram).map((entry) => entry.atom.id);
    const overflowIds = rankedRam.slice(ATTENTION_CAPS.ram).map((entry) => entry.atom.id);
    for (const overflow of rankedRam.slice(ATTENTION_CAPS.ram)) {
      overflow.boundedLayer = "short";
    }
    const decision = await upsertDecisionPrompt({
      type: "ram_overflow",
      dedupeKey: buildDecisionDedupeKey("ram_overflow", ram.map((entry) => entry.atom.id), nowValue.slice(0, 10)),
      title: "RAM list is crowded",
      body: `RAM can hold ${ATTENTION_CAPS.ram} warm tasks. Select what to keep warm.`,
      atomIds: ram.map((entry) => entry.atom.id),
      priority: 3,
      triggerCode: "ram_overflow",
      triggerReason: `RAM has ${ram.length} tasks for a cap of ${ATTENTION_CAPS.ram}.`,
      options: [
        {
          id: "keep_warm",
          label: `Keep warm ${ATTENTION_CAPS.ram}`,
          actionKind: "task.do_now",
          payload: { atomIds: keepIds }
        },
        {
          id: "snooze_excess",
          label: "Snooze excess",
          actionKind: "task.snooze",
          payload: {
            atomIds: overflowIds,
            untilAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          }
        },
        {
          id: "reschedule_excess",
          label: "Reschedule excess",
          actionKind: "task.reschedule",
          payload: {
            atomIds: overflowIds,
            dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]
    });
    decisionIds.push(decision.id);
  }

  for (const entry of computations) {
    const atom = entry.atom;
    const task = atom.facetData.task;
    if (!task) {
      continue;
    }
    const previousLayer = task.attentionLayer ?? atom.facetData.attention?.layer ?? "long";
    const changedLayer = previousLayer !== entry.boundedLayer;
    const previousHeat = atom.facetData.attention?.heatScore ?? 0;
    const changedHeat = Math.abs(previousHeat - entry.score) > 0.12;
    const previousHiddenReason = atom.facetData.attention?.hiddenReason;
    const nextDecayEligibleAt =
      entry.boundedLayer === "archive"
        ? undefined
        : new Date(
            now.valueOf() +
              (entry.boundedLayer === "l3"
                ? 1
                : entry.boundedLayer === "ram"
                  ? 3
                  : entry.boundedLayer === "short"
                    ? 7
                    : 21) *
                24 *
                60 *
                60 *
                1000
          ).toISOString();
    const attention: AtomRecord["facetData"]["attention"] = {
      layer: entry.boundedLayer,
      heatScore: Number(entry.score.toFixed(2)),
      dwellStartedAt: changedLayer ? nowValue : atom.facetData.attention?.dwellStartedAt ?? nowValue,
      decayEligibleAt: nextDecayEligibleAt,
      lastPromotedAt:
        ATTENTION_LAYER_RANK[entry.boundedLayer] < ATTENTION_LAYER_RANK[previousLayer]
          ? nowValue
          : atom.facetData.attention?.lastPromotedAt,
      hiddenReason: entry.blocked ? "blocked" : undefined,
      lastSignalAt: atom.facetData.attention?.lastSignalAt ?? atom.updatedAt,
      lastSignalKind: atom.facetData.attention?.lastSignalKind,
      explanation: entry.reason
    };
    task.attentionLayer = entry.boundedLayer;
    atom.facetData.attention = attention;
    if (changedLayer || changedHeat || previousHiddenReason !== attention.hiddenReason) {
      atom.updatedAt = nowValue;
      atom.revision += 1;
      updatedAtomIds.push(atom.id);
    }
  }

  if (updatedAtomIds.length > 0) {
    recordWorkspaceEvent("rule.evaluated", { engine: "attention", updatedAtomIds, decisionIds });
  }
  persistMockStore();
  return { accepted: true, updatedAtomIds, decisionIds: [...new Set(decisionIds)] };
}

export async function systemGenerateDecisionCards(
  request: DecisionGenerateRequest = {}
): Promise<DecisionGenerateResponse> {
  const payload: DecisionGenerateRequest = {
    ...request,
    idempotencyKey: ensureIdempotencyKey(request.idempotencyKey)
  };
  if (IS_TAURI) {
    return tauriInvoke("system_generate_decision_cards", { request: payload });
  }
  if (!isFeatureFlagEnabled("workspace.decision_queue", true)) {
    return { accepted: false, createdOrUpdatedIds: [] };
  }
  const now = payload.now ? new Date(payload.now) : new Date();
  const nowIsoValue = now.toISOString();
  const createdOrUpdatedIds: string[] = [];
  const liveTasks = mockStore.atoms.filter((atom) => {
    const task = atom.facetData.task;
    return !!task && !atom.archivedAt && task.status !== "done" && task.status !== "archived";
  });

  const l3 = liveTasks.filter((atom) => atom.facetData.task?.attentionLayer === "l3");
  if (l3.length > ATTENTION_CAPS.l3) {
    const ranked = rankAtomsByAttentionPressure(l3);
    const keepIds = ranked.slice(0, ATTENTION_CAPS.l3).map((atom) => atom.id);
    const overflowIds = ranked.slice(ATTENTION_CAPS.l3).map((atom) => atom.id);
    const decision = await upsertDecisionPrompt({
      type: "l3_overflow",
      dedupeKey: buildDecisionDedupeKey("l3_overflow", l3.map((atom) => atom.id), nowIsoValue.slice(0, 10)),
      title: "Choose L3 hot threads",
      body: `L3 has ${l3.length} tasks; choose ${ATTENTION_CAPS.l3} to keep hot.`,
      atomIds: l3.map((atom) => atom.id),
      priority: 1,
      triggerCode: "l3_overflow",
      triggerReason: `Overflow: ${l3.length}/${ATTENTION_CAPS.l3}`,
      options: [
        {
          id: "keep_hottest",
          label: `Keep hottest ${ATTENTION_CAPS.l3}`,
          actionKind: "task.do_now",
          payload: { atomIds: keepIds }
        },
        {
          id: "snooze_extras",
          label: "Snooze extras",
          actionKind: "task.snooze",
          payload: { atomIds: overflowIds, untilAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
        },
        {
          id: "reschedule_extras",
          label: "Reschedule extras",
          actionKind: "task.reschedule",
          payload: { atomIds: overflowIds, dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() }
        }
      ]
    });
    createdOrUpdatedIds.push(decision.id);
  }

  const ram = liveTasks.filter((atom) => atom.facetData.task?.attentionLayer === "ram");
  if (ram.length > ATTENTION_CAPS.ram) {
    const ranked = rankAtomsByAttentionPressure(ram);
    const keepIds = ranked.slice(0, ATTENTION_CAPS.ram).map((atom) => atom.id);
    const overflowIds = ranked.slice(ATTENTION_CAPS.ram).map((atom) => atom.id);
    const decision = await upsertDecisionPrompt({
      type: "ram_overflow",
      dedupeKey: buildDecisionDedupeKey("ram_overflow", ram.map((atom) => atom.id), nowIsoValue.slice(0, 10)),
      title: "Trim RAM list",
      body: `RAM has ${ram.length} tasks; keep your warm set intentional.`,
      atomIds: ram.map((atom) => atom.id),
      priority: 3,
      triggerCode: "ram_overflow",
      triggerReason: `Overflow: ${ram.length}/${ATTENTION_CAPS.ram}`,
      options: [
        {
          id: "keep_warm",
          label: `Keep warm ${ATTENTION_CAPS.ram}`,
          actionKind: "task.do_now",
          payload: { atomIds: keepIds }
        },
        {
          id: "snooze_extras",
          label: "Snooze extras",
          actionKind: "task.snooze",
          payload: { atomIds: overflowIds, untilAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
        },
        {
          id: "reschedule_extras",
          label: "Reschedule extras",
          actionKind: "task.reschedule",
          payload: { atomIds: overflowIds, dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() }
        }
      ]
    });
    createdOrUpdatedIds.push(decision.id);
  }

  for (const atom of liveTasks) {
    const task = atom.facetData.task!;
    const hardDays = daysUntil(task.hardDueAt, now);
    if (hardDays !== undefined && hardDays <= 0) {
      const decision = await upsertDecisionPrompt({
        type: "overdue_hard_due",
        dedupeKey: buildDecisionDedupeKey("overdue_hard_due", [atom.id]),
        title: `Overdue hard due: ${taskDisplayTitle(atom)}`,
        body: "Hard due date has passed. Choose the next move.",
        atomIds: [atom.id],
        priority: 1,
        dueAt: nowIsoValue,
        triggerCode: "overdue_hard_due",
        triggerReason: "Hard due date is overdue.",
        options: [
          { id: "do_now", label: "Do now", actionKind: "task.do_now" },
          { id: "reschedule", label: "Reschedule", actionKind: "task.reschedule" },
          { id: "drop", label: "Drop", actionKind: "task.drop" }
        ]
      });
      createdOrUpdatedIds.push(decision.id);
    }

    const commitment = task.commitmentLevel ?? atom.facetData.commitment?.level;
    const mustReviewDays = daysUntil(atom.facetData.commitment?.mustReviewBy, now);
    if (
      commitment === "hard" &&
      ((hardDays !== undefined && hardDays <= 2) || (mustReviewDays !== undefined && mustReviewDays <= 1))
    ) {
      const decision = await upsertDecisionPrompt({
        type: "hard_commitment_review",
        dedupeKey: buildDecisionDedupeKey("hard_commitment_review", [atom.id]),
        title: `Hard commitment check: ${taskDisplayTitle(atom)}`,
        body: "This hard commitment is near boundary. Recommit, reschedule, or release it.",
        atomIds: [atom.id],
        priority: 2,
        triggerCode: "hard_commitment_review",
        triggerReason: "Hard commitment is near due/review boundary.",
        options: [
          { id: "recommit", label: "Recommit", actionKind: "task.recommit" },
          { id: "reschedule", label: "Reschedule", actionKind: "task.reschedule" },
          { id: "cancel", label: "Cancel commitment", actionKind: "task.cancel_commitment" }
        ]
      });
      createdOrUpdatedIds.push(decision.id);
    }

    const decayEligibleAt = parseIsoDate(atom.facetData.attention?.decayEligibleAt);
    if (decayEligibleAt) {
      const hoursToDecay = (decayEligibleAt.valueOf() - now.valueOf()) / (1000 * 60 * 60);
      if (hoursToDecay <= 6) {
        const decision = await upsertDecisionPrompt({
          type: "boundary_drift_review",
          dedupeKey: buildDecisionDedupeKey("boundary_drift_review", [atom.id]),
          title: `Drifting soon: ${taskDisplayTitle(atom)}`,
          body: "This task is near attention decay. Keep it hot or let it drift.",
          atomIds: [atom.id],
          priority: 3,
          triggerCode: "boundary_drift_review",
          triggerReason: `Decay boundary in ${Math.max(0, Math.round(hoursToDecay))}h.`,
          options: [
            { id: "do_now", label: "Do now", actionKind: "task.do_now" },
            { id: "snooze", label: "Snooze", actionKind: "task.snooze" },
            { id: "drift", label: "Let drift", actionKind: "task.reschedule" }
          ]
        });
        createdOrUpdatedIds.push(decision.id);
      }
    }
  }

  const waitingConditions = mockStore.conditions.filter(
    (condition) => condition.status === "active" && condition.mode === "person"
  );
  for (const condition of waitingConditions) {
    const cadence = Math.max(1, condition.waitingCadenceDays ?? 7);
    const nextFollowup = parseIsoDate(condition.nextFollowupAt);
    const lastFollowup = parseIsoDate(condition.lastFollowupAt);
    const due =
      (nextFollowup && nextFollowup <= now) ||
      (!nextFollowup && lastFollowup && (now.valueOf() - lastFollowup.valueOf()) / (1000 * 60 * 60 * 24) >= cadence);
    if (!due) {
      continue;
    }
    const atom = mockStore.atoms.find((entry) => entry.id === condition.atomId);
    const title = atom ? taskDisplayTitle(atom, condition.atomId) : condition.atomId;
    const decision = await upsertDecisionPrompt({
      type: "blocked_followup",
      dedupeKey: buildDecisionDedupeKey("blocked_followup", [condition.atomId], condition.id),
      title: `Follow up: ${title}`,
      body: `Waiting on ${condition.waitingOnPerson ?? "someone"}. Log a follow-up or unblock.`,
      atomIds: [condition.atomId],
      priority: 2,
      triggerCode: "waiting_followup",
      triggerReason: "Follow-up cadence is due.",
      triggerMeta: { conditionId: condition.id },
      options: [
        { id: "unblock", label: "Mark unblocked", actionKind: "task.unblock" },
        { id: "snooze", label: "Snooze", actionKind: "task.snooze" },
        { id: "reschedule", label: "Reschedule", actionKind: "task.reschedule" }
      ]
    });
    createdOrUpdatedIds.push(decision.id);
  }

  const hardCommitments = liveTasks.filter((atom) => {
    const task = atom.facetData.task;
    if (!task) return false;
    const commitment = task.commitmentLevel ?? atom.facetData.commitment?.level;
    return commitment === "hard";
  });
  const hardCommitmentCap = Math.max(2, ATTENTION_CAPS.l3);
  if (hardCommitments.length > hardCommitmentCap) {
    const ranked = rankAtomsByAttentionPressure(hardCommitments);
    const keepIds = ranked.slice(0, hardCommitmentCap).map((atom) => atom.id);
    const overflowIds = ranked.slice(hardCommitmentCap).map((atom) => atom.id);
    const decision = await upsertDecisionPrompt({
      type: "hard_commitment_overflow",
      dedupeKey: buildDecisionDedupeKey("hard_commitment_overflow", hardCommitments.map((atom) => atom.id), nowIsoValue.slice(0, 10)),
      title: "Too many hard commitments",
      body: `You have ${hardCommitments.length} hard commitments. Keep only the commitments you can truly honor now.`,
      atomIds: hardCommitments.map((atom) => atom.id),
      priority: 1,
      triggerCode: "hard_commitment_overflow",
      triggerReason: `Hard commitments exceed cap (${hardCommitments.length}/${hardCommitmentCap}).`,
      options: [
        { id: "recommit_kept", label: `Keep ${hardCommitmentCap} commitments`, actionKind: "task.recommit", payload: { atomIds: keepIds } },
        { id: "reschedule_excess", label: "Reschedule excess", actionKind: "task.reschedule", payload: { atomIds: overflowIds } },
        { id: "cancel_excess", label: "Cancel excess commitments", actionKind: "task.cancel_commitment", payload: { atomIds: overflowIds } }
      ]
    });
    createdOrUpdatedIds.push(decision.id);
  }

  for (const atom of liveTasks) {
    const recurrence = atom.facetData.recurrence;
    const task = atom.facetData.task;
    if (!recurrence || !task) {
      continue;
    }
    const hardDays = daysUntil(task.hardDueAt, now);
    const softDays = daysUntil(task.softDueAt, now);
    if ((hardDays !== undefined && hardDays <= -1) || (softDays !== undefined && softDays <= -1.5)) {
      const decision = await upsertDecisionPrompt({
        type: "recurrence_missed",
        dedupeKey: buildDecisionDedupeKey("recurrence_missed", [atom.id]),
        title: `Recurring task missed: ${taskDisplayTitle(atom)}`,
        body: "A recurring task instance appears missed. Decide whether to do now or re-time the cadence.",
        atomIds: [atom.id],
        priority: 2,
        triggerCode: "recurrence_missed",
        triggerReason: "Recurring task is overdue relative to due boundary.",
        options: [
          { id: "do_now", label: "Do now", actionKind: "task.do_now" },
          { id: "reschedule", label: "Reschedule", actionKind: "task.reschedule" },
          { id: "snooze", label: "Snooze", actionKind: "task.snooze" }
        ]
      });
      createdOrUpdatedIds.push(decision.id);
    }
  }

  const activeNorthStars = mockStore.registryEntries.filter((entry) => entry.kind === "north_star" && entry.status === "active");
  for (const northStar of activeNorthStars) {
    const lastActivity = parseIsoDate(northStar.lastActivityAt);
    const staleDays = lastActivity ? (now.valueOf() - lastActivity.valueOf()) / (1000 * 60 * 60 * 24) : Number.POSITIVE_INFINITY;
    if (staleDays < 14) {
      continue;
    }
    const relatedTaskIds = liveTasks
      .filter((atom) => {
        const categories = atom.facetData.meta?.categories ?? [];
        if (categories.some((category) => category.toLowerCase() === northStar.name.toLowerCase())) {
          return true;
        }
        return northStar.aliases.some((alias) => categories.some((category) => category.toLowerCase() === alias.toLowerCase()));
      })
      .map((atom) => atom.id);
    const decision = await upsertDecisionPrompt({
      type: "north_star_stale",
      dedupeKey: buildDecisionDedupeKey("north_star_stale", relatedTaskIds, northStar.id),
      title: `North star stale: ${northStar.name}`,
      body: "This north star has been quiet. Confirm it is still active or reconnect active work to it.",
      atomIds: relatedTaskIds,
      priority: 3,
      triggerCode: "north_star_stale",
      triggerReason: Number.isFinite(staleDays) ? `No activity for ${Math.round(staleDays)} days.` : "No recorded activity.",
      triggerMeta: { registryEntryId: northStar.id, northStarName: northStar.name },
      options: [
        { id: "recommit", label: "Recommit", actionKind: "task.recommit", payload: { atomIds: relatedTaskIds } },
        { id: "reschedule", label: "Reschedule related tasks", actionKind: "task.reschedule", payload: { atomIds: relatedTaskIds } },
        { id: "snooze", label: "Snooze review", actionKind: "task.snooze", payload: { atomIds: relatedTaskIds } }
      ]
    });
    createdOrUpdatedIds.push(decision.id);
  }

  const confessionCandidates = liveTasks
    .filter((atom) => {
      const task = atom.facetData.task;
      if (!task) return false;
      const dread = task.dreadLevel ?? atom.facetData.energy?.dreadLevel ?? 0;
      if (dread < 3) return false;
      const ageHours = hoursBetween(atom.facetData.attention?.lastSignalAt ?? atom.updatedAt, now);
      return ageHours >= 48 && task.status === "todo";
    })
    .sort((a, b) => atomAttentionScore(b) - atomAttentionScore(a))
    .slice(0, 5);

  for (const atom of confessionCandidates) {
    const task = atom.facetData.task!;
    const decision = await upsertDecisionPrompt({
      type: "confession_suggestion",
      dedupeKey: buildDecisionDedupeKey("confession_suggestion", [atom.id]),
      title: `Stuck? ${taskDisplayTitle(atom)}`,
      body: "This task looks avoided. Name the blocker, do a first step, or safely defer.",
      atomIds: [atom.id],
      priority: 3,
      triggerCode: "confession_suggestion",
      triggerReason: "High dread + stale signal suggests hidden blocker.",
      options: [
        { id: "first_step_now", label: "Do first step now", actionKind: "task.do_now" },
        { id: "name_blocker", label: "Name blocker", actionKind: "confession.create_blocker" },
        { id: "snooze", label: "Snooze", actionKind: "task.snooze" }
      ]
    });
    createdOrUpdatedIds.push(decision.id);
  }

  if (createdOrUpdatedIds.length > 0) {
    recordWorkspaceEvent("triage.prompted", { decisionIds: [...new Set(createdOrUpdatedIds)] });
  }
  return { accepted: true, createdOrUpdatedIds: [...new Set(createdOrUpdatedIds)] };
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

const DEFAULT_WORKSPACE_PROJECTION_IDS: Record<"tasks.waiting" | "focus.queue" | "today.a_list" | "history.daily", string> = {
  "tasks.waiting": "projection.tasks.waiting",
  "focus.queue": "projection.focus.queue",
  "today.a_list": "projection.today.a_list",
  "history.daily": "projection.history.daily"
};

function projectionTitleForAtom(atom: AtomRecord): string {
  return taskDisplayTitle(atom, atom.id);
}

function projectionTaskLayer(atom: AtomRecord): AttentionLayer {
  return atom.facetData.task?.attentionLayer ?? atom.facetData.attention?.layer ?? "long";
}

function activeProjectionTasks(): AtomRecord[] {
  return mockStore.atoms.filter((atom) => {
    const task = atom.facetData.task;
    return !!task && !atom.archivedAt && task.status !== "done" && task.status !== "archived";
  });
}

function buildProjectionPreview(type: ProjectionDefinition["type"], now: Date): Record<string, unknown> {
  const nowIsoValue = now.toISOString();
  const activeTasks = activeProjectionTasks();

  if (type === "tasks.waiting") {
    const waitingConditions = mockStore.conditions
      .filter((condition) => condition.status === "active")
      .map((condition) => {
        const atom = mockStore.atoms.find((candidate) => candidate.id === condition.atomId);
        return {
          conditionId: condition.id,
          atomId: condition.atomId,
          title: atom ? projectionTitleForAtom(atom) : condition.atomId,
          mode: condition.mode,
          waitingOnPerson: condition.waitingOnPerson,
          blockedUntil: condition.blockedUntil,
          blockerAtomId: condition.blockerAtomId,
          nextFollowupAt: condition.nextFollowupAt,
          lastFollowupAt: condition.lastFollowupAt
        };
      })
      .sort((a, b) => (a.nextFollowupAt ?? "").localeCompare(b.nextFollowupAt ?? ""));
    return {
      generatedAt: nowIsoValue,
      total: waitingConditions.length,
      items: waitingConditions
    };
  }

  if (type === "focus.queue") {
    const candidates = activeTasks
      .filter((atom) => {
        const status = atom.facetData.task?.status;
        return status === "todo" || status === "doing";
      })
      .sort((a, b) => {
        const layerDelta = ATTENTION_LAYER_RANK[projectionTaskLayer(a)] - ATTENTION_LAYER_RANK[projectionTaskLayer(b)];
        if (layerDelta !== 0) return layerDelta;
        const heatDelta = atomAttentionScore(b) - atomAttentionScore(a);
        if (Math.abs(heatDelta) > 0.001) return heatDelta;
        const priorityDelta = (a.facetData.task?.priority ?? 3) - (b.facetData.task?.priority ?? 3);
        if (priorityDelta !== 0) return priorityDelta;
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, 12)
      .map((atom) => ({
        atomId: atom.id,
        title: projectionTitleForAtom(atom),
        status: atom.facetData.task?.status ?? "todo",
        layer: projectionTaskLayer(atom),
        heatScore: atom.facetData.attention?.heatScore ?? 0,
        priority: atom.facetData.task?.priority ?? 3
      }));
    return {
      generatedAt: nowIsoValue,
      total: candidates.length,
      items: candidates
    };
  }

  if (type === "today.a_list") {
    const ranked = rankAtomsByAttentionPressure(activeTasks).slice(0, 3).map((atom) => ({
      atomId: atom.id,
      title: projectionTitleForAtom(atom),
      layer: projectionTaskLayer(atom),
      heatScore: atom.facetData.attention?.heatScore ?? 0,
      dueAt: atom.facetData.task?.hardDueAt ?? atom.facetData.task?.softDueAt
    }));
    const dueToday = activeTasks.filter((atom) => {
      const due = atom.facetData.task?.hardDueAt ?? atom.facetData.task?.softDueAt;
      if (!due) return false;
      const dueDate = new Date(due);
      if (Number.isNaN(dueDate.valueOf())) return false;
      return dueDate.toDateString() === now.toDateString();
    }).length;
    return {
      generatedAt: nowIsoValue,
      total: ranked.length,
      dueToday,
      items: ranked
    };
  }

  if (type === "history.daily") {
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(now.valueOf() - (6 - offset) * 24 * 60 * 60 * 1000);
      const dayKey = date.toISOString().slice(0, 10);
      return {
        day: dayKey,
        captured: 0,
        completed: 0,
        decisionsResolved: 0,
        focusSessionsEnded: 0
      };
    });
    const byDay = new Map(days.map((day) => [day.day, day]));
    for (const event of mockStore.workspaceEvents) {
      const day = event.occurredAt.slice(0, 10);
      const target = byDay.get(day);
      if (!target) continue;
      if (event.type === "atom.created") target.captured += 1;
      if (event.type === "task.completed") target.completed += 1;
      if (event.type === "decision.resolved") target.decisionsResolved += 1;
      if (event.type === "work.session.ended") target.focusSessionsEnded += 1;
    }
    return {
      generatedAt: nowIsoValue,
      totalDays: days.length,
      days
    };
  }

  return {
    generatedAt: nowIsoValue,
    total: activeTasks.length
  };
}

function ensureDefaultProjections(): void {
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return;
  }
  const now = nowIso();
  const defaults: Array<{ type: keyof typeof DEFAULT_WORKSPACE_PROJECTION_IDS }> = [
    { type: "tasks.waiting" },
    { type: "focus.queue" },
    { type: "today.a_list" },
    { type: "history.daily" }
  ];
  for (const entry of defaults) {
    const existing = mockStore.projections.find((projection) => projection.type === entry.type);
    if (existing) {
      continue;
    }
    const projection: ProjectionDefinition = {
      id: DEFAULT_WORKSPACE_PROJECTION_IDS[entry.type],
      schemaVersion: 1,
      type: entry.type,
      source: "atoms+events",
      enabled: true,
      refreshMode: "manual",
      versionTag: "v1",
      revision: 1
    };
    mockStore.projections.unshift(projection);
    mockStore.projectionCheckpoints.unshift({
      projectionId: projection.id,
      status: "healthy",
      lastRebuiltAt: now,
      preview: buildProjectionPreview(entry.type, new Date())
    });
  }
}

export async function projectionsList(
  request: PageRequest = {}
): Promise<PageResponse<ProjectionDefinition>> {
  if (IS_TAURI) {
    return tauriInvoke("projections_list", { ...request });
  }
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return paginateWithRequest([], request);
  }
  ensureDefaultProjections();
  const items = [...mockStore.projections].sort((a, b) => b.revision - a.revision);
  return paginateWithRequest(items, request);
}

export async function projectionGet(projectionId: string): Promise<ProjectionDefinition | null> {
  if (IS_TAURI) {
    return tauriInvoke("projection_get", { projectionId });
  }
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return null;
  }
  ensureDefaultProjections();
  return mockStore.projections.find((projection) => projection.id === projectionId) ?? null;
}

export async function projectionSave(
  projection: Partial<ProjectionDefinition> & { expectedRevision?: number; idempotencyKey?: string }
): Promise<ProjectionDefinition> {
  const request = { ...projection, idempotencyKey: ensureIdempotencyKey(projection.idempotencyKey) };
  if (IS_TAURI) {
    return tauriInvoke("projection_save", { projection: request });
  }
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    throw new Error("FEATURE_DISABLED: workspace.projections");
  }
  ensureDefaultProjections();
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
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return { projectionId, status: "lagging", errorMessage: "workspace.projections is disabled" };
  }
  ensureDefaultProjections();
  const existing = mockStore.projectionCheckpoints.find((cp) => cp.projectionId === projectionId);
  if (existing) return existing;
  return { projectionId, status: "healthy", preview: {} };
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
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return {
      projectionId,
      status: "lagging",
      errorMessage: "workspace.projections is disabled"
    };
  }
  ensureDefaultProjections();
  const projection = await projectionGet(projectionId);
  if (!projection) {
    throw new Error(`Projection not found: ${projectionId}`);
  }
  const now = nowIso();
  const preview = buildProjectionPreview(projection.type, new Date());
  const cp = await projectionCheckpointGet(projectionId);
  const next: ProjectionCheckpoint = {
    ...cp,
    lastEventCursor: mockStore.workspaceEvents[0]?.id,
    lastRebuiltAt: now,
    status: "healthy",
    errorMessage: undefined,
    preview
  };
  const idx = mockStore.projectionCheckpoints.findIndex((item) => item.projectionId === projectionId);
  if (idx >= 0) {
    mockStore.projectionCheckpoints[idx] = next;
  } else {
    mockStore.projectionCheckpoints.unshift(next);
  }
  recordWorkspaceEvent("projection.refreshed", { projectionId, mode, projectionType: projection.type });
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
  if (!isFeatureFlagEnabled("workspace.projections", true)) {
    return { accepted: true, jobRunIds: [] };
  }
  ensureDefaultProjections();
  const ids = projectionIds?.length ? projectionIds : mockStore.projections.map((projection) => projection.id);
  let projectionJob = mockStore.workspaceJobs.find((job) => job.type === "projection.refresh");
  if (!projectionJob) {
    projectionJob = await jobSave({
      id: "job.projection.refresh",
      type: "projection.refresh",
      enabled: true,
      schedule: { kind: "manual" }
    });
  }
  const jobRunIds: string[] = [];
  for (const projectionId of ids) {
    const run = await jobRun(projectionJob.id, { projectionId }, `projection-rebuild-${projectionId}`);
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
