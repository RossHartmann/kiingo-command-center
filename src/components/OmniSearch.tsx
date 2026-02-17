import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { NAVIGATION, SCREEN_META } from "./Sidebar/navigationConfig";
import { getScreenMetrics, listMetricDefinitions, notepadsList } from "../lib/tauriClient";
import type { NotepadViewDefinition } from "../lib/types";
import type { Screen } from "../state/appState";

interface PageResult {
  kind: "page";
  screen: Screen;
  label: string;
  group: string;
  icon: string;
  description: string;
}

interface MetricResult {
  kind: "metric";
  metricId: string;
  label: string;
  screen: Screen | null;
  screenLabel: string;
  bindingId: string | null;
}

interface ProjectResult {
  kind: "project";
  projectId: string;
  label: string;
  categories: string[];
  description: string;
}

type SearchResult = PageResult | MetricResult | ProjectResult;

const ALL_PAGES: PageResult[] = NAVIGATION.flatMap((group) =>
  group.items.map((item) => ({
    kind: "page" as const,
    screen: item.id,
    label: item.label,
    group: group.label,
    icon: item.icon,
    description: SCREEN_META[item.id]?.description ?? ""
  }))
);

const DASHBOARD_SCREEN_IDS: Screen[] = NAVIGATION.flatMap((group) => group.items.map((item) => item.id));

interface MetricBinding {
  metricId: string;
  screenId: Screen;
  bindingId: string;
}

let metricBindingsCache: MetricBinding[] | null = null;
let metricBindingsPromise: Promise<MetricBinding[]> | null = null;

async function loadAllMetricBindings(): Promise<MetricBinding[]> {
  if (metricBindingsCache) return metricBindingsCache;
  if (metricBindingsPromise) return metricBindingsPromise;
  metricBindingsPromise = (async () => {
    const bindings: MetricBinding[] = [];
    const results = await Promise.allSettled(
      DASHBOARD_SCREEN_IDS.map(async (screenId) => {
        const views = await getScreenMetrics(screenId);
        return { screenId, views };
      })
    );
    for (const result of results) {
      if (result.status !== "fulfilled") {
        continue;
      }
      for (const view of result.value.views) {
        bindings.push({
          metricId: view.definition.id,
          screenId: result.value.screenId as Screen,
          bindingId: view.binding.id
        });
      }
    }
    metricBindingsCache = bindings;
    metricBindingsPromise = null;
    return bindings;
  })();
  return metricBindingsPromise;
}

export const OMNI_SCROLL_TO_METRIC = "omni:scroll-to-metric";
export const OMNI_OPEN_PROJECT = "omni:open-project";

export function OmniSearch() {
  const state = useAppState();
  const actions = useAppActions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [metricBindings, setMetricBindings] = useState<MetricBinding[]>([]);
  const [projects, setProjects] = useState<NotepadViewDefinition[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navModeRef = useRef<"keyboard" | "mouse">("keyboard");
  const bindingsLoadedRef = useRef(false);

  const [localMetrics, setLocalMetrics] = useState<import("../lib/types").MetricDefinition[]>([]);
  const stateMetrics = state.metricDefinitions;
  const metrics = stateMetrics.length > 0 ? stateMetrics : localMetrics;

  useEffect(() => {
    if (!open) {
      return;
    }
    if (stateMetrics.length === 0) {
      void actions.loadMetricDefinitions();
      // Fallback: load directly in case state dispatch isn't propagating
      void listMetricDefinitions().then(setLocalMetrics).catch(() => undefined);
    }
    if (!bindingsLoadedRef.current) {
      bindingsLoadedRef.current = true;
      void loadAllMetricBindings().then(setMetricBindings);
    }
    void notepadsList().then(setProjects).catch(() => undefined);
  }, [actions, stateMetrics.length, open]);

  const filtered = useMemo(() => {
    const projectResults: ProjectResult[] = projects
      .map((project) => ({
        kind: "project" as const,
        projectId: project.id,
        label: project.name,
        categories: project.filters.categories ?? [],
        description: project.description ?? ""
      }))
      .sort((a, b) => {
        if (a.projectId === "now") return -1;
        if (b.projectId === "now") return 1;
        return a.label.localeCompare(b.label);
      });

    if (!query.trim()) {
      return [...ALL_PAGES, ...projectResults] as SearchResult[];
    }

    const q = query.toLowerCase();
    const scored: { result: SearchResult; score: number }[] = [];

    for (const result of ALL_PAGES) {
      const label = result.label.toLowerCase();
      const group = result.group.toLowerCase();
      const description = result.description.toLowerCase();
      const screen = result.screen.toLowerCase();
      let score = 0;
      if (label === q) score = 100;
      else if (label.startsWith(q)) score = 80;
      else if (label.split(/\s+/).some((word) => word.startsWith(q))) score = 60;
      else if (label.includes(q)) score = 50;
      else if (screen.includes(q)) score = 40;
      else if (group === q) score = 35;
      else if (group.includes(q)) score = 25;
      else if (description.includes(q)) score = 15;
      if (score > 0) {
        scored.push({ result, score });
      }
    }

    for (const metric of metrics) {
      if (metric.archivedAt) continue;
      const name = metric.name.toLowerCase();
      const slug = metric.slug.toLowerCase();
      let score = 0;
      if (name === q) score = 95;
      else if (name.startsWith(q)) score = 75;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 55;
      else if (name.includes(q)) score = 35;
      else if (slug.includes(q)) score = 20;
      if (score > 0) {
        const binding = metricBindings.find((value) => value.metricId === metric.id);
        const screenId = binding?.screenId ?? null;
        const screenLabel = screenId ? (SCREEN_META[screenId]?.title ?? screenId) : "Unbound";
        scored.push({
          result: {
            kind: "metric",
            metricId: metric.id,
            label: metric.name,
            screen: screenId,
            screenLabel,
            bindingId: binding?.bindingId ?? null
          },
          score
        });
      }
    }

    for (const project of projectResults) {
      const name = project.label.toLowerCase();
      const categories = project.categories.map((value) => value.toLowerCase()).join(" ");
      const description = project.description.toLowerCase();
      let score = 0;
      if (name === q) score = 92;
      else if (name.startsWith(q)) score = 72;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 56;
      else if (name.includes(q)) score = 44;
      else if (categories.includes(q)) score = 30;
      else if (description.includes(q)) score = 18;
      if (score > 0) {
        scored.push({ result: project, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((value) => value.result);
  }, [metricBindings, metrics, projects, query]);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const navigateTo = useCallback(
    (result: SearchResult) => {
      if (result.kind === "page") {
        actions.selectScreen(result.screen);
      } else if (result.kind === "metric" && result.screen) {
        actions.selectScreen(result.screen);
        if (result.bindingId) {
          const bindingId = result.bindingId;
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent(OMNI_SCROLL_TO_METRIC, { detail: { bindingId } }));
          }, 200);
        }
      } else if (result.kind === "project") {
        actions.selectScreen("notepad");
        const projectId = result.projectId;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(OMNI_OPEN_PROJECT, { detail: { projectId } }));
        }, 120);
      }
      close();
    },
    [actions, close]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "o") {
        event.preventDefault();
        setOpen((current) => {
          if (current) {
            close();
            return false;
          }
          return true;
        });
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    if (navModeRef.current !== "keyboard" || !listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const navigateToRef = useRef(navigateTo);
  navigateToRef.current = navigateTo;

  const onKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navModeRef.current = "keyboard";
      setSelectedIndex((current) => Math.min(current + 1, filteredRef.current.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      navModeRef.current = "keyboard";
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = filteredRef.current[selectedIndexRef.current];
      if (result) {
        navigateToRef.current(result);
      }
    }
  }, []);

  const onMouseMove = useCallback(() => {
    navModeRef.current = "mouse";
  }, []);

  if (!open) return null;

  return (
    <div className="omni-backdrop" onClick={close}>
      <div className="omni-modal" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="omni-input"
          type="text"
          placeholder="Go to page, project, or metric..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="omni-results" ref={listRef} onMouseMove={onMouseMove}>
          {filtered.length === 0 && <div className="omni-empty">No matching pages, projects, or metrics</div>}
          {filtered.map((result, index) => {
            const key =
              result.kind === "page"
                ? `p:${result.screen}`
                : result.kind === "metric"
                  ? `m:${result.metricId}`
                  : `pr:${result.projectId}`;
            const isActive = index === selectedIndex;
            const isCurrent = result.kind === "page" && result.screen === state.selectedScreen;
            return (
              <button
                key={key}
                className={`omni-result${isActive ? " omni-result-active" : ""}${isCurrent ? " omni-result-current" : ""}`}
                onClick={() => navigateTo(result)}
                onMouseEnter={() => {
                  if (navModeRef.current === "mouse") {
                    setSelectedIndex(index);
                  }
                }}
                type="button"
              >
                {result.kind === "page" ? (
                  <>
                    <span className="omni-result-icon">{result.icon}</span>
                    <span className="omni-result-text">
                      <span className="omni-result-label">{result.label}</span>
                      <span className="omni-result-description">{result.description}</span>
                    </span>
                    <span className="omni-result-group">{result.group}</span>
                  </>
                ) : result.kind === "metric" ? (
                  <>
                    <span className="omni-result-icon omni-metric-icon">{"\u25C8"}</span>
                    <span className="omni-result-text">
                      <span className="omni-result-label">{result.label}</span>
                      <span className="omni-result-description">
                        {result.screen ? `on ${result.screenLabel}` : "Unbound metric"}
                      </span>
                    </span>
                    <span className="omni-result-badge">metric</span>
                  </>
                ) : (
                  <>
                    <span className="omni-result-icon omni-project-icon">{"\u270E"}</span>
                    <span className="omni-result-text">
                      <span className="omni-result-label">{result.label}</span>
                      <span className="omni-result-description">
                        {result.categories.length > 0 ? `Categories: ${result.categories.join(", ")}` : "Project"}
                      </span>
                    </span>
                    <span className="omni-result-badge">project</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <div className="omni-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span style={{ marginLeft: "auto", opacity: 0.5, fontSize: "0.7rem" }}>
            {metrics.length} metrics · {metricBindings.length} bindings · {projects.length} projects
          </span>
        </div>
      </div>
    </div>
  );
}
