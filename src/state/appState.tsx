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
  cancelRun,
  endSession,
  getRun,
  getSettings,
  grantWorkspace,
  listCapabilities,
  listProfiles,
  listQueueJobs,
  listRuns,
  listWorkspaceGrants,
  onRunEvent,
  rerun,
  resumeSession,
  saveProfile,
  sendSessionInput,
  startInteractiveSession,
  startRun,
  updateSettings
} from "../lib/tauriClient";
import type {
  AppSettings,
  CapabilitySnapshot,
  Profile,
  RunDetail,
  RunEvent,
  RunRecord,
  SchedulerJob,
  StartRunPayload,
  StreamEnvelope,
  WorkspaceGrant
} from "../lib/types";

export type Screen = "composer" | "live" | "history" | "profiles" | "settings" | "compatibility" | "queue";
const MAX_DETAIL_EVENTS = 2000;

interface State {
  selectedScreen: Screen;
  runs: RunRecord[];
  runDetails: Record<string, RunDetail>;
  selectedRunId?: string;
  profiles: Profile[];
  capabilities: CapabilitySnapshot[];
  queueJobs: SchedulerJob[];
  workspaceGrants: WorkspaceGrant[];
  settings?: AppSettings;
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
  | { type: "select_run"; runId?: string }
  | { type: "set_profiles"; profiles: Profile[] }
  | { type: "set_capabilities"; capabilities: CapabilitySnapshot[] }
  | { type: "set_jobs"; jobs: SchedulerJob[] }
  | { type: "set_grants"; grants: WorkspaceGrant[] }
  | { type: "set_settings"; settings: AppSettings }
  | { type: "append_event"; runId: string; run: RunRecord; event: RunEvent };

const initialState: State = {
  selectedScreen: "composer",
  runs: [],
  runDetails: {},
  profiles: [],
  capabilities: [],
  queueJobs: [],
  workspaceGrants: [],
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
    default:
      return state;
  }
}

interface Actions {
  refreshAll: () => Promise<void>;
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
}

const StateContext = createContext<State>(initialState);
const ActionContext = createContext<Actions | null>(null);

export function AppStateProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const runsRef = useRef<RunRecord[]>([]);
  const runDetailsRef = useRef<Record<string, RunDetail>>({});

  const safeDispatch = useCallback((action: Action) => {
    dispatch(action);
  }, []);

  useEffect(() => {
    runsRef.current = state.runs;
    runDetailsRef.current = state.runDetails;
  }, [state.runs, state.runDetails]);

  const refreshAll = useCallback(async () => {
    safeDispatch({ type: "loading", value: true });
    try {
      const [runs, profiles, capabilities, jobs, grants, settings] = await Promise.all([
        listRuns({ limit: 200, offset: 0 }),
        listProfiles(),
        listCapabilities(),
        listQueueJobs(),
        listWorkspaceGrants(),
        getSettings()
      ]);
      safeDispatch({ type: "set_runs", runs });
      safeDispatch({ type: "set_profiles", profiles });
      safeDispatch({ type: "set_capabilities", capabilities });
      safeDispatch({ type: "set_jobs", jobs });
      safeDispatch({ type: "set_grants", grants });
      safeDispatch({ type: "set_settings", settings });
      safeDispatch({ type: "error", error: undefined });
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
    void onRunEvent((event) => {
      onRunEventUpdate(safeDispatch, runsRef.current, runDetailsRef.current, event);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [safeDispatch]);

  const actions = useMemo<Actions>(() => {
    return {
      refreshAll,
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
      }
    };
  }, [refreshAll, safeDispatch]);

  return (
    <StateContext.Provider value={state}>
      <ActionContext.Provider value={actions}>{children}</ActionContext.Provider>
    </StateContext.Provider>
  );
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

type Unlisten = (() => void) | null;

function asError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
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
