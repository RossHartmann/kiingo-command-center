import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  CapabilitySnapshot,
  ListRunsFilters,
  Profile,
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
  profiles: Profile[];
  grants: WorkspaceGrant[];
  jobs: SchedulerJob[];
  capabilities: CapabilitySnapshot[];
  settings: AppSettings;
}

const defaultSettings: AppSettings = {
  codexPath: "codex",
  claudePath: "claude",
  retentionDays: 90,
  maxStorageMb: 1024,
  allowAdvancedPolicy: false,
  remoteTelemetryOptIn: false,
  redactAggressive: true,
  storeEncryptedRawArtifacts: false
};

const mockStore = loadMockStore();

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function loadMockStore(): MockStore {
  const storage = getStorage();
  if (!storage) {
    return {
      runs: [],
      profiles: [],
      grants: [],
      jobs: [],
      capabilities: [],
      settings: defaultSettings
    };
  }
  const raw = storage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) {
    return {
      runs: [],
      profiles: [],
      grants: [],
      jobs: [],
      capabilities: [],
      settings: defaultSettings
    };
  }
  try {
    return JSON.parse(raw) as MockStore;
  } catch {
    return {
      runs: [],
      profiles: [],
      grants: [],
      jobs: [],
      capabilities: [],
      settings: defaultSettings
    };
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
    compatibilityWarnings: []
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
