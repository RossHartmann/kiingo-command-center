import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef
} from "react";
import {
  atomArchive,
  atomCreate,
  atomUpdate,
  atomsList,
  archiveConversation,
  archiveMetricDefinition,
  bindMetricToScreen,
  cancelRun,
  createConversation,
  deleteMetricDefinition,
  getConversation,
  notepadsList,
  getScreenMetrics,
  endSession,
  getRun,
  getSettings,
  grantWorkspace,
  listConversations,
  listCapabilities,
  listMetricDefinitions,
  listProfiles,
  listQueueJobs,
  listRuns,
  listWorkspaceGrants,
  onRunEvent,
  refreshMetric,
  refreshScreenMetrics,
  reorderScreenMetrics,
  rerun,
  renameConversation,
  resumeSession,
  saveMetricDefinition,
  saveProfile,
  sendConversationMessage,
  sendSessionInput,
  startInteractiveSession,
  startRun,
  taskStatusSet,
  unbindMetricFromScreen,
  updateScreenMetricLayout,
  updateSettings
} from "../lib/tauriClient";
import type {
  ArchiveAtomRequest,
  AppSettings,
  AtomRecord,
  BindMetricToScreenPayload,
  CapabilitySnapshot,
  CreateAtomRequest,
  ConversationDetail,
  ConversationSummary,
  ListAtomsRequest,
  MetricDefinition,
  NotepadViewDefinition,
  Profile,
  Provider,
  RunDetail,
  RunEvent,
  RunRecord,
  SaveMetricDefinitionPayload,
  SchedulerJob,
  ScreenMetricLayoutItem,
  ScreenMetricView,
  SetTaskStatusRequest,
  StartRunPayload,
  StreamEnvelope,
  UpdateAtomRequest,
  WorkspaceGrant
} from "../lib/types";

export type Screen =
  | "dashboard"
  | "client-roi"
  | "client-journey"
  | "client-health"
  | "path1-bootcamps"
  | "path1-champions"
  | "path1-accelerator"
  | "path2-pipeline"
  | "path2-deployed"
  | "path2-fde"
  | "revenue"
  | "growth"
  | "efficiency"
  | "pipeline"
  | "leads-gtm"
  | "dept-sales"
  | "dept-marketing"
  | "dept-engineering"
  | "dept-operations"
  | "team-scorecard"
  | "team-rocks"
  | "tasks"
  | "notepad"
  | "chat"
  | "composer"
  | "live"
  | "history"
  | "profiles"
  | "settings"
  | "compatibility"
  | "queue"
  | "metric-admin"
  | "ceo-training"
  | "ceo-principles"
  | "coo-principles"
  | "cmo-principles"
  | "cro-principles"
  | "cto-principles"
  | "cfo-principles"
  | "cpo-principles"
  | "cco-principles"
  | "chro-principles";
const MAX_DETAIL_EVENTS = 2000;
const CONVERSATION_SELECTION_KEY = "conversation-selection-by-provider";

interface State {
  selectedScreen: Screen;
  runs: RunRecord[];
  runDetails: Record<string, RunDetail>;
  conversations: ConversationSummary[];
  conversationDetails: Record<string, ConversationDetail>;
  selectedConversationByProvider: Record<Provider, string | undefined>;
  selectedRunId?: string;
  profiles: Profile[];
  capabilities: CapabilitySnapshot[];
  queueJobs: SchedulerJob[];
  workspaceGrants: WorkspaceGrant[];
  settings?: AppSettings;
  metricDefinitions: MetricDefinition[];
  screenMetricViews: Record<string, ScreenMetricView[]>;
  metricRefreshes: Record<string, string>;
  workspaceAtoms: AtomRecord[];
  workspaceNotepads: NotepadViewDefinition[];
  pendingChatContext: { systemPrompt: string; initialMessage: string } | null;
  loading: boolean;
  error?: string;
}

type Action =
  | { type: "select_screen"; screen: Screen }
  | { type: "loading"; value: boolean }
  | { type: "error"; error?: string }
  | { type: "set_runs"; runs: RunRecord[] }
  | { type: "upsert_run"; run: RunRecord }
  | { type: "set_detail"; detail: RunDetail }
  | { type: "set_conversations"; conversations: ConversationSummary[] }
  | { type: "set_conversation_detail"; detail: ConversationDetail }
  | { type: "set_selected_conversation"; provider: Provider; conversationId?: string }
  | { type: "select_run"; runId?: string }
  | { type: "set_profiles"; profiles: Profile[] }
  | { type: "set_capabilities"; capabilities: CapabilitySnapshot[] }
  | { type: "set_jobs"; jobs: SchedulerJob[] }
  | { type: "set_grants"; grants: WorkspaceGrant[] }
  | { type: "set_settings"; settings: AppSettings }
  | { type: "append_event"; runId: string; run: RunRecord; event: RunEvent }
  | { type: "set_metric_definitions"; definitions: MetricDefinition[] }
  | { type: "set_screen_metric_views"; screenId: string; views: ScreenMetricView[] }
  | { type: "set_metric_refresh"; metricId: string; snapshotId: string }
  | { type: "clear_metric_refresh"; metricId: string }
  | { type: "patch_screen_metric_layouts"; screenId: string; layouts: ScreenMetricLayoutItem[] }
  | { type: "set_workspace_atoms"; atoms: AtomRecord[] }
  | { type: "set_workspace_notepads"; notepads: NotepadViewDefinition[] }
  | { type: "set_pending_chat_context"; context: { systemPrompt: string; initialMessage: string } | null };

const initialState: State = {
  selectedScreen: "chat",
  runs: [],
  runDetails: {},
  conversations: [],
  conversationDetails: {},
  selectedConversationByProvider: loadConversationSelection(),
  profiles: [],
  capabilities: [],
  queueJobs: [],
  workspaceGrants: [],
  metricDefinitions: [],
  screenMetricViews: {},
  metricRefreshes: {},
  workspaceAtoms: [],
  workspaceNotepads: [],
  pendingChatContext: null,
  loading: true
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "select_screen":
      return { ...state, selectedScreen: action.screen };
    case "loading":
      return { ...state, loading: action.value };
    case "error":
      return { ...state, error: action.error };
    case "set_runs":
      return { ...state, runs: action.runs };
    case "upsert_run": {
      const exists = state.runs.some((run) => run.id === action.run.id);
      const runs = exists
        ? state.runs.map((run) => (run.id === action.run.id ? action.run : run))
        : [action.run, ...state.runs];
      return { ...state, runs };
    }
    case "set_detail":
      return {
        ...state,
        runDetails: {
          ...state.runDetails,
          [action.detail.run.id]: action.detail
        }
      };
    case "set_conversations":
      return { ...state, conversations: action.conversations };
    case "set_conversation_detail":
      return {
        ...state,
        conversationDetails: {
          ...state.conversationDetails,
          [action.detail.conversation.id]: action.detail
        }
      };
    case "set_selected_conversation": {
      const next = {
        ...state.selectedConversationByProvider,
        [action.provider]: action.conversationId
      };
      persistConversationSelection(next);
      return { ...state, selectedConversationByProvider: next };
    }
    case "select_run":
      return { ...state, selectedRunId: action.runId };
    case "set_profiles":
      return { ...state, profiles: action.profiles };
    case "set_capabilities":
      return { ...state, capabilities: action.capabilities };
    case "set_jobs":
      return { ...state, queueJobs: action.jobs };
    case "set_grants":
      return { ...state, workspaceGrants: action.grants };
    case "set_settings":
      return { ...state, settings: action.settings };
    case "append_event": {
      const existing = state.runDetails[action.runId] ?? {
        run: action.run,
        events: [],
        artifacts: []
      };
      const events = [...existing.events, action.event];
      const boundedEvents =
        events.length > MAX_DETAIL_EVENTS ? events.slice(events.length - MAX_DETAIL_EVENTS) : events;
      return {
        ...state,
        runDetails: {
          ...state.runDetails,
          [action.runId]: {
            ...existing,
            run: action.run,
            events: boundedEvents
          }
        }
      };
    }
    case "set_metric_definitions":
      return { ...state, metricDefinitions: action.definitions };
    case "set_screen_metric_views":
      return {
        ...state,
        screenMetricViews: {
          ...state.screenMetricViews,
          [action.screenId]: action.views
        }
      };
    case "set_metric_refresh":
      return {
        ...state,
        metricRefreshes: {
          ...state.metricRefreshes,
          [action.metricId]: action.snapshotId
        }
      };
    case "clear_metric_refresh": {
      const { [action.metricId]: _, ...rest } = state.metricRefreshes;
      return { ...state, metricRefreshes: rest };
    }
    case "patch_screen_metric_layouts": {
      const existing = state.screenMetricViews[action.screenId];
      if (!existing) return state;
      const updated = existing.map((v) => {
        const layout = action.layouts.find((l) => l.bindingId === v.binding.id);
        if (!layout) return v;
        if (
          v.binding.gridX === layout.gridX &&
          v.binding.gridY === layout.gridY &&
          v.binding.gridW === layout.gridW &&
          v.binding.gridH === layout.gridH
        ) return v; // no change — keep same reference
        return {
          ...v,
          binding: { ...v.binding, gridX: layout.gridX, gridY: layout.gridY, gridW: layout.gridW, gridH: layout.gridH }
        };
      });
      // If no view actually changed, keep the same array reference
      if (updated.every((v, i) => v === existing[i])) return state;
      return {
        ...state,
        screenMetricViews: { ...state.screenMetricViews, [action.screenId]: updated }
      };
    }
    case "set_workspace_atoms":
      return { ...state, workspaceAtoms: action.atoms };
    case "set_workspace_notepads":
      return { ...state, workspaceNotepads: action.notepads };
    case "set_pending_chat_context":
      return { ...state, pendingChatContext: action.context };
    default:
      return state;
  }
}

interface Actions {
  refreshAll: () => Promise<void>;
  refreshConversations: (provider?: Provider, includeArchived?: boolean) => Promise<void>;
  createConversation: (provider: Provider, title?: string) => Promise<ConversationSummary | undefined>;
  selectConversation: (provider: Provider, conversationId?: string) => Promise<void>;
  sendConversationMessage: (payload: {
    provider: Provider;
    conversationId: string;
    prompt: string;
    model?: string;
    outputFormat?: StartRunPayload["outputFormat"];
    cwd?: string;
    optionalFlags?: Record<string, unknown>;
    profileId?: string;
    queuePriority?: number;
    timeoutSeconds?: number;
    scheduledAt?: string;
    maxRetries?: number;
    retryBackoffMs?: number;
    harness?: StartRunPayload["harness"];
  }) => Promise<{ runId: string }>;
  renameConversation: (conversationId: string, title: string, provider: Provider) => Promise<void>;
  archiveConversation: (conversationId: string, provider: Provider, archived?: boolean) => Promise<void>;
  startRun: (payload: StartRunPayload) => Promise<void>;
  startInteractiveSession: (payload: StartRunPayload) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  rerun: (runId: string, overrides: Partial<StartRunPayload>) => Promise<void>;
  selectRun: (runId?: string) => Promise<void>;
  saveProfile: (payload: { id?: string; name: string; provider: Profile["provider"]; config: Record<string, unknown> }) => Promise<void>;
  updateSettings: (payload: Partial<AppSettings>) => Promise<void>;
  grantWorkspace: (path: string) => Promise<void>;
  sendSessionInput: (runId: string, data: string) => Promise<void>;
  endSession: (runId: string) => Promise<void>;
  resumeSession: (runId: string) => Promise<void>;
  selectScreen: (screen: Screen) => void;
  loadMetricDefinitions: () => Promise<void>;
  saveMetricDefinition: (payload: SaveMetricDefinitionPayload) => Promise<MetricDefinition>;
  archiveMetricDefinition: (id: string) => Promise<void>;
  deleteMetricDefinition: (id: string) => Promise<void>;
  loadScreenMetrics: (screenId: string) => Promise<void>;
  refreshScreenMetrics: (screenId: string) => Promise<void>;
  refreshMetric: (metricId: string) => Promise<void>;
  bindMetricToScreen: (payload: BindMetricToScreenPayload) => Promise<void>;
  unbindMetricFromScreen: (screenId: string, bindingId: string) => Promise<void>;
  reorderScreenMetrics: (screenId: string, metricIds: string[]) => Promise<void>;
  updateScreenMetricLayout: (screenId: string, layouts: ScreenMetricLayoutItem[]) => Promise<void>;
  loadWorkspaceAtoms: (request?: ListAtomsRequest) => Promise<void>;
  createWorkspaceAtom: (payload: CreateAtomRequest) => Promise<AtomRecord>;
  updateWorkspaceAtom: (atomId: string, payload: UpdateAtomRequest) => Promise<AtomRecord>;
  setWorkspaceTaskStatus: (atomId: string, payload: SetTaskStatusRequest) => Promise<AtomRecord>;
  archiveWorkspaceAtom: (atomId: string, payload: ArchiveAtomRequest) => Promise<AtomRecord>;
  loadWorkspaceNotepads: () => Promise<void>;
  setPendingChatContext: (context: { systemPrompt: string; initialMessage: string } | null) => void;
}

const StateContext = createContext<State>(initialState);
const ActionContext = createContext<Actions | null>(null);

export function AppStateProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const runsRef = useRef<RunRecord[]>([]);
  const runDetailsRef = useRef<Record<string, RunDetail>>({});
  const selectedConversationRef = useRef<Record<Provider, string | undefined>>(initialState.selectedConversationByProvider);
  const screenMetricViewsRef = useRef<Record<string, ScreenMetricView[]>>({});

  const safeDispatch = useCallback((action: Action) => {
    dispatch(action);
  }, []);

  useEffect(() => {
    runsRef.current = state.runs;
    runDetailsRef.current = state.runDetails;
    selectedConversationRef.current = state.selectedConversationByProvider;
    screenMetricViewsRef.current = state.screenMetricViews;
  }, [state.runs, state.runDetails, state.selectedConversationByProvider, state.screenMetricViews]);

  const refreshAll = useCallback(async () => {
    safeDispatch({ type: "loading", value: true });
    try {
      const [runsResult, conversationsResult, profilesResult, capabilitiesResult, jobsResult, grantsResult, settingsResult] =
        await Promise.allSettled([
        listRuns({ limit: 200, offset: 0 }),
        listConversations({ limit: 200, offset: 0, includeArchived: true }),
        listProfiles(),
        listCapabilities(),
        listQueueJobs(),
        listWorkspaceGrants(),
        getSettings()
      ]);
      const [notepadsResult] = await Promise.allSettled([notepadsList()]);

      const errors: string[] = [];
      const collectError = (value: PromiseRejectedResult): void => {
        errors.push(asError(value.reason));
      };

      if (runsResult.status === "fulfilled") {
        safeDispatch({ type: "set_runs", runs: runsResult.value });
      } else {
        collectError(runsResult);
      }
      if (conversationsResult.status === "fulfilled") {
        safeDispatch({ type: "set_conversations", conversations: conversationsResult.value });
      } else {
        collectError(conversationsResult);
      }
      if (profilesResult.status === "fulfilled") {
        safeDispatch({ type: "set_profiles", profiles: profilesResult.value });
      } else {
        collectError(profilesResult);
      }
      if (capabilitiesResult.status === "fulfilled") {
        safeDispatch({ type: "set_capabilities", capabilities: capabilitiesResult.value });
      } else {
        collectError(capabilitiesResult);
      }
      if (jobsResult.status === "fulfilled") {
        safeDispatch({ type: "set_jobs", jobs: jobsResult.value });
      } else {
        collectError(jobsResult);
      }
      if (grantsResult.status === "fulfilled") {
        safeDispatch({ type: "set_grants", grants: grantsResult.value });
      } else {
        collectError(grantsResult);
      }
      if (settingsResult.status === "fulfilled") {
        safeDispatch({ type: "set_settings", settings: settingsResult.value });
      } else {
        collectError(settingsResult);
      }
      if (notepadsResult.status === "fulfilled") {
        safeDispatch({ type: "set_workspace_notepads", notepads: notepadsResult.value });
      } else {
        safeDispatch({ type: "set_workspace_notepads", notepads: [] });
        console.warn("workspace notepads preload failed", notepadsResult.reason);
      }

      safeDispatch({ type: "error", error: errors[0] });
    } catch (error) {
      safeDispatch({ type: "error", error: asError(error) });
    } finally {
      safeDispatch({ type: "loading", value: false });
    }
  }, [safeDispatch]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    let unlisten: Unlisten = null;
    let disposed = false;
    void onRunEvent((event) => {
      if (event.type.startsWith("conversation.")) {
        void onConversationEventUpdate(safeDispatch, event, selectedConversationRef.current).catch((error) => {
          safeDispatch({ type: "error", error: asError(error) });
        });
        return;
      }
      if (event.type === "metric.snapshot_completed" || event.type === "metric.snapshot_failed") {
        const metricId = event.payload.metricId as string | undefined;
        if (metricId) {
          safeDispatch({ type: "clear_metric_refresh", metricId });
          // Reload all cached screen views that might contain this metric
          void reloadAllScreenMetrics(safeDispatch, screenMetricViewsRef.current);
        }
        return;
      }
      onRunEventUpdate(safeDispatch, runsRef.current, runDetailsRef.current, event);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [safeDispatch]);

  const actions = useMemo<Actions>(() => {
    return {
      refreshAll,
      refreshConversations: async (provider, includeArchived = true) => {
        const conversations = await listConversations({
          provider,
          includeArchived,
          limit: 200,
          offset: 0
        });
        safeDispatch({ type: "set_conversations", conversations });
      },
      createConversation: async (provider, title) => {
        const created = await createConversation({ provider, title });
        const conversations = await listConversations({
          provider,
          includeArchived: true,
          limit: 200,
          offset: 0
        });
        safeDispatch({ type: "set_conversations", conversations });
        safeDispatch({ type: "set_selected_conversation", provider, conversationId: created.id });
        const detail = await getConversation(created.id);
        if (detail) {
          safeDispatch({ type: "set_conversation_detail", detail });
        }
        return conversations.find((conversation) => conversation.id === created.id);
      },
      selectConversation: async (provider, conversationId) => {
        safeDispatch({ type: "set_selected_conversation", provider, conversationId });
        if (!conversationId) {
          return;
        }
        const detail = await getConversation(conversationId);
        if (detail) {
          safeDispatch({ type: "set_conversation_detail", detail });
        }
      },
      sendConversationMessage: async (payload) => {
        const result = await sendConversationMessage({
          conversationId: payload.conversationId,
          prompt: payload.prompt,
          model: payload.model,
          outputFormat: payload.outputFormat,
          cwd: payload.cwd,
          optionalFlags: payload.optionalFlags,
          profileId: payload.profileId,
          queuePriority: payload.queuePriority,
          timeoutSeconds: payload.timeoutSeconds,
          scheduledAt: payload.scheduledAt,
          maxRetries: payload.maxRetries,
          retryBackoffMs: payload.retryBackoffMs,
          harness: payload.harness
        });
        await refreshAll();
        await Promise.all([
          getConversation(payload.conversationId).then((detail) => {
            if (detail) {
              safeDispatch({ type: "set_conversation_detail", detail });
            }
          }),
          getRun(result.runId).then((detail) => {
            if (detail) {
              safeDispatch({ type: "set_detail", detail });
            }
          })
        ]);
        return result;
      },
      renameConversation: async (conversationId, title, provider) => {
        await renameConversation(conversationId, title);
        const conversations = await listConversations({
          provider,
          includeArchived: true,
          limit: 200,
          offset: 0
        });
        safeDispatch({ type: "set_conversations", conversations });
        const detail = await getConversation(conversationId);
        if (detail) {
          safeDispatch({ type: "set_conversation_detail", detail });
        }
      },
      archiveConversation: async (conversationId, provider, archived = true) => {
        await archiveConversation(conversationId, archived);
        const conversations = await listConversations({
          provider,
          includeArchived: true,
          limit: 200,
          offset: 0
        });
        safeDispatch({ type: "set_conversations", conversations });
        const current = state.selectedConversationByProvider[provider];
        if (current === conversationId && archived) {
          const fallback = conversations
            .filter((conversation) => conversation.provider === provider && !conversation.archivedAt)
            .sort((a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf())[0]
            ?.id;
          safeDispatch({
            type: "set_selected_conversation",
            provider,
            conversationId: fallback
          });
        }
      },
      startRun: async (payload) => {
        await startRun(payload);
        await refreshAll();
      },
      startInteractiveSession: async (payload) => {
        await startInteractiveSession(payload);
        await refreshAll();
      },
      cancelRun: async (runId) => {
        await cancelRun(runId);
        await refreshAll();
      },
      rerun: async (runId, overrides) => {
        await rerun(runId, overrides);
        await refreshAll();
      },
      selectRun: async (runId) => {
        safeDispatch({ type: "select_run", runId });
        if (!runId) {
          return;
        }
        const detail = await getRun(runId);
        if (detail) {
          safeDispatch({ type: "set_detail", detail });
        }
      },
      saveProfile: async (payload) => {
        await saveProfile(payload);
        const profiles = await listProfiles();
        safeDispatch({ type: "set_profiles", profiles });
      },
      updateSettings: async (payload) => {
        const settings = await updateSettings(payload);
        safeDispatch({ type: "set_settings", settings });
      },
      grantWorkspace: async (path) => {
        await grantWorkspace(path);
        const grants = await listWorkspaceGrants();
        safeDispatch({ type: "set_grants", grants });
      },
      sendSessionInput: async (runId, data) => {
        await sendSessionInput(runId, data);
      },
      endSession: async (runId) => {
        await endSession(runId);
        await refreshAll();
      },
      resumeSession: async (runId) => {
        await resumeSession(runId);
      },
      selectScreen: (screen) => {
        safeDispatch({ type: "select_screen", screen });
      },
      loadMetricDefinitions: async () => {
        const definitions = await listMetricDefinitions();
        safeDispatch({ type: "set_metric_definitions", definitions });
      },
      saveMetricDefinition: async (payload) => {
        const saved = await saveMetricDefinition(payload);
        const definitions = await listMetricDefinitions();
        safeDispatch({ type: "set_metric_definitions", definitions });
        return saved;
      },
      archiveMetricDefinition: async (id) => {
        await archiveMetricDefinition(id);
        const definitions = await listMetricDefinitions();
        safeDispatch({ type: "set_metric_definitions", definitions });
      },
      deleteMetricDefinition: async (id) => {
        await deleteMetricDefinition(id);
        const definitions = await listMetricDefinitions();
        safeDispatch({ type: "set_metric_definitions", definitions });
      },
      loadScreenMetrics: async (screenId) => {
        const views = await getScreenMetrics(screenId);
        safeDispatch({ type: "set_screen_metric_views", screenId, views });
      },
      refreshScreenMetrics: async (screenId) => {
        const results = await refreshScreenMetrics(screenId);
        for (const result of results) {
          safeDispatch({ type: "set_metric_refresh", metricId: result.metricId, snapshotId: result.snapshotId });
        }
        const views = await getScreenMetrics(screenId);
        safeDispatch({ type: "set_screen_metric_views", screenId, views });
      },
      refreshMetric: async (metricId) => {
        const result = await refreshMetric(metricId);
        safeDispatch({ type: "set_metric_refresh", metricId: result.metricId, snapshotId: result.snapshotId });
        // Reload views so the card shows the "refreshing..." shimmer immediately
        void reloadAllScreenMetrics(safeDispatch, screenMetricViewsRef.current);
      },
      bindMetricToScreen: async (payload) => {
        await bindMetricToScreen(payload);
        const views = await getScreenMetrics(payload.screenId);
        safeDispatch({ type: "set_screen_metric_views", screenId: payload.screenId, views });
      },
      unbindMetricFromScreen: async (screenId, bindingId) => {
        await unbindMetricFromScreen(bindingId);
        const views = await getScreenMetrics(screenId);
        safeDispatch({ type: "set_screen_metric_views", screenId, views });
      },
      reorderScreenMetrics: async (screenId, metricIds) => {
        await reorderScreenMetrics(screenId, metricIds);
        const views = await getScreenMetrics(screenId);
        safeDispatch({ type: "set_screen_metric_views", screenId, views });
      },
      updateScreenMetricLayout: async (screenId, layouts) => {
        await updateScreenMetricLayout({ screenId, layouts });
        // Patch layout positions locally — do NOT reload views from backend.
        // Reloading would pick up side-effect snapshot changes and trigger
        // cascading stale-refresh → auto-size → layout-save loops.
        safeDispatch({ type: "patch_screen_metric_layouts", screenId, layouts });
      },
      loadWorkspaceAtoms: async (request) => {
        const atoms = await fetchAllTaskAtoms(request);
        safeDispatch({ type: "set_workspace_atoms", atoms });
      },
      createWorkspaceAtom: async (payload) => {
        const atom = await atomCreate(payload);
        const atoms = await fetchAllTaskAtoms();
        safeDispatch({ type: "set_workspace_atoms", atoms });
        return atom;
      },
      updateWorkspaceAtom: async (atomId, payload) => {
        const atom = await atomUpdate(atomId, payload);
        const atoms = await fetchAllTaskAtoms();
        safeDispatch({ type: "set_workspace_atoms", atoms });
        return atom;
      },
      setWorkspaceTaskStatus: async (atomId, payload) => {
        const atom = await taskStatusSet(atomId, payload);
        const atoms = await fetchAllTaskAtoms();
        safeDispatch({ type: "set_workspace_atoms", atoms });
        return atom;
      },
      archiveWorkspaceAtom: async (atomId, payload) => {
        const atom = await atomArchive(atomId, payload);
        const atoms = await fetchAllTaskAtoms();
        safeDispatch({ type: "set_workspace_atoms", atoms });
        return atom;
      },
      loadWorkspaceNotepads: async () => {
        const notepads = await notepadsList();
        safeDispatch({ type: "set_workspace_notepads", notepads });
      },
      setPendingChatContext: (context) => {
        safeDispatch({ type: "set_pending_chat_context", context });
      }
    };
  }, [refreshAll, safeDispatch, state.selectedConversationByProvider]);

  return (
    <StateContext.Provider value={state}>
      <ActionContext.Provider value={actions}>{children}</ActionContext.Provider>
    </StateContext.Provider>
  );
}

async function fetchAllTaskAtoms(request?: ListAtomsRequest): Promise<AtomRecord[]> {
  const defaults: ListAtomsRequest = {
    filter: { facet: "task", includeArchived: false },
    sort: [{ field: "updatedAt", direction: "desc" }]
  };
  const merged: ListAtomsRequest = {
    ...defaults,
    ...request,
    filter: { ...defaults.filter, ...(request?.filter ?? {}) },
    sort: request?.sort ?? defaults.sort
  };

  const all: AtomRecord[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = merged.cursor;

  for (;;) {
    const page = await atomsList({
      ...merged,
      limit: 500,
      cursor
    });
    for (const atom of page.items) {
      if (seen.has(atom.id)) continue;
      seen.add(atom.id);
      all.push(atom);
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    if (all.length >= 10_000) break;
  }

  return all;
}

async function reloadAllScreenMetrics(
  dispatch: Dispatch<Action>,
  cachedViews: Record<string, ScreenMetricView[]>
): Promise<void> {
  const screenIds = Object.keys(cachedViews);
  for (const screenId of screenIds) {
    try {
      const views = await getScreenMetrics(screenId);
      dispatch({ type: "set_screen_metric_views", screenId, views });
    } catch {
      // ignore — screen may no longer be relevant
    }
  }
}

function onRunEventUpdate(
  dispatch: Dispatch<Action>,
  runs: RunRecord[],
  runDetails: Record<string, RunDetail>,
  event: StreamEnvelope
): void {
  const found = runs.find((run) => run.id === event.runId);
  if (!found) {
    return;
  }

  const next: RunRecord = { ...found };

  if (event.type === "run.started") {
    next.status = "running";
  }
  if (event.type === "run.completed") {
    next.status = "completed";
    next.endedAt = event.timestamp;
  }
  if (event.type === "run.failed") {
    next.status = "failed";
    next.endedAt = event.timestamp;
    next.errorSummary = (event.payload.message as string | undefined) ?? "Run failed";
  }
  if (event.type === "run.canceled") {
    next.status = "canceled";
    next.endedAt = event.timestamp;
  }
  if (event.type === "run.compatibility_warning") {
    const warning = (event.payload.message as string | undefined) ?? "Compatibility warning";
    next.compatibilityWarnings = [...new Set([...next.compatibilityWarnings, warning])];
  }

  dispatch({ type: "upsert_run", run: next });

  const detail = runDetails[event.runId];
  const lastSeq = detail?.events[detail.events.length - 1]?.seq ?? 0;
  dispatch({
    type: "append_event",
    runId: event.runId,
    event: {
      id: event.eventId ?? `${event.runId}-${event.seq ?? lastSeq + 1}-${event.timestamp}`,
      runId: event.runId,
      seq: event.seq ?? lastSeq + 1,
      eventType: event.type,
      payload: event.payload,
      createdAt: event.timestamp
    },
    run: next
  });
}

async function onConversationEventUpdate(
  dispatch: Dispatch<Action>,
  event: StreamEnvelope,
  selectedByProvider: Record<Provider, string | undefined>
): Promise<void> {
  const conversations = await listConversations({
    includeArchived: true,
    limit: 200,
    offset: 0
  });
  dispatch({ type: "set_conversations", conversations });

  const conversationId = conversationIdFromPayload(event.payload);
  if (!conversationId) {
    return;
  }

  const detail = await getConversation(conversationId);
  if (detail) {
    dispatch({ type: "set_conversation_detail", detail });
  }

  if (event.type !== "conversation.archived") {
    return;
  }
  const archived = event.payload.archived === true;
  if (!archived) {
    return;
  }

  const provider = providerFromPayload(event.payload) ?? detail?.conversation.provider;
  if (!provider || selectedByProvider[provider] !== conversationId) {
    return;
  }

  const fallback = conversations
    .filter((conversation) => conversation.provider === provider && !conversation.archivedAt)
    .sort((a, b) => new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf())[0]
    ?.id;
  dispatch({ type: "set_selected_conversation", provider, conversationId: fallback });
}

function conversationIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const value = payload.conversationId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function providerFromPayload(payload: Record<string, unknown>): Provider | undefined {
  const value = payload.provider;
  if (value === "codex" || value === "claude") {
    return value;
  }
  return undefined;
}

type Unlisten = (() => void) | null;

function asError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; error?: unknown };
    if (typeof maybe.message === "string" && maybe.message.length > 0) {
      return maybe.message;
    }
    if (typeof maybe.error === "string" && maybe.error.length > 0) {
      return maybe.error;
    }
  }
  return "Unexpected error";
}

function loadConversationSelection(): Record<Provider, string | undefined> {
  if (typeof window === "undefined") {
    return { codex: undefined, claude: undefined };
  }
  const storage = getStorage();
  if (!storage) {
    return { codex: undefined, claude: undefined };
  }
  const raw = storage.getItem(CONVERSATION_SELECTION_KEY);
  if (!raw) {
    return { codex: undefined, claude: undefined };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<Provider, string>>;
    return {
      codex: parsed.codex,
      claude: parsed.claude
    };
  } catch {
    return { codex: undefined, claude: undefined };
  }
}

function persistConversationSelection(selection: Record<Provider, string | undefined>): void {
  if (typeof window === "undefined") {
    return;
  }
  const storage = getStorage();
  if (!storage) {
    return;
  }
  storage.setItem(CONVERSATION_SELECTION_KEY, JSON.stringify(selection));
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

export function useAppState(): State {
  return useContext(StateContext);
}

export function useAppActions(): Actions {
  const ctx = useContext(ActionContext);
  if (!ctx) {
    throw new Error("useAppActions must be used within AppStateProvider");
  }
  return ctx;
}
