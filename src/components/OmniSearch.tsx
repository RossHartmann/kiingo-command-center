import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useAppActions, useAppState } from "../state/appState";
import { NAVIGATION, SCREEN_META } from "./Sidebar/navigationConfig";
import { getScreenMetrics, listMetricDefinitions, notepadsList, projectOpen, projectsList, registryEntriesList } from "../lib/tauriClient";
import type { NotepadViewDefinition, ProjectDefinition, RegistryEntry } from "../lib/types";
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
  defaultViewId?: string;
  projectKind: ProjectDefinition["kind"];
  labels: string[];
  description: string;
}

interface NotepadResult {
  kind: "notepad";
  notepadId: string;
  label: string;
  categories: string[];
  description: string;
}

interface CommandResult {
  kind: "command";
  command: "open_notepad";
  label: string;
  description: string;
}

interface OpenNotepadResult {
  kind: "open_notepad";
  label: string;
  description: string;
  categories: string[];
  filterMode: "or" | "and";
}

type SearchResult = PageResult | MetricResult | ProjectResult | NotepadResult | CommandResult | OpenNotepadResult;

const ALL_PAGES: PageResult[] = NAVIGATION.flatMap((group) =>
  group.items.flatMap((item) => {
    if (item.children) {
      return item.children.map((child) => ({
        kind: "page" as const,
        screen: child.id as Screen,
        label: child.label,
        group: group.label,
        icon: child.icon,
        description: SCREEN_META[child.id as Screen]?.description ?? ""
      }));
    }
    return [{
      kind: "page" as const,
      screen: item.id as Screen,
      label: item.label,
      group: group.label,
      icon: item.icon,
      description: SCREEN_META[item.id as Screen]?.description ?? ""
    }];
  })
);

const DASHBOARD_SCREEN_IDS: Screen[] = NAVIGATION.flatMap((group) =>
  group.items.flatMap((item) =>
    item.children ? item.children.map((c) => c.id as Screen) : [item.id as Screen]
  )
);

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
export const OMNI_OPEN_NOTEPAD = "omni:open-notepad";
export const OMNI_OPEN_NOTEPAD_BY_CATEGORY = "omni:open-notepad-by-category";

function parseCategoryQuery(query: string): { categories: string[]; filterMode: "or" | "and" } {
  let trimmed = query.trim();
  let filterMode: "or" | "and" = "or";
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("and:")) {
    filterMode = "and";
    trimmed = trimmed.slice(4).trim();
  } else if (lower.startsWith("and ")) {
    filterMode = "and";
    trimmed = trimmed.slice(4).trim();
  }
  const categories = trimmed
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  return { categories, filterMode };
}

export function OmniSearch() {
  const state = useAppState();
  const actions = useAppActions();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"global" | "open_notepad">("global");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [metricBindings, setMetricBindings] = useState<MetricBinding[]>([]);
  const [notepads, setNotepads] = useState<NotepadViewDefinition[]>([]);
  const [projects, setProjects] = useState<ProjectDefinition[]>([]);
  const [categoryEntries, setCategoryEntries] = useState<RegistryEntry[]>([]);
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
    void notepadsList().then(setNotepads).catch(() => undefined);
    void projectsList().then(setProjects).catch(() => undefined);
    void registryEntriesList({ kind: "category", status: "active", limit: 500 })
      .then((page) => setCategoryEntries(page.items))
      .catch(() => undefined);
  }, [actions, stateMetrics.length, open]);

  const filtered = useMemo(() => {
    if (mode === "open_notepad") {
      const notepadCategoryNames = notepads
        .flatMap((notepad) => notepad.filters.categories ?? [])
        .filter((value, index, values) => value.trim().length > 0 && values.indexOf(value) === index);
      const base = [
        ...categoryEntries
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map<OpenNotepadResult>((entry) => ({
            kind: "open_notepad",
            label: entry.name,
            description: entry.aliases.length > 0 ? `Aliases: ${entry.aliases.join(", ")}` : "Category notepad",
            categories: [entry.name],
            filterMode: "or"
          })),
        ...notepadCategoryNames.map<OpenNotepadResult>((name) => ({
          kind: "open_notepad",
          label: name,
          description: "Category from existing notepads",
          categories: [name],
          filterMode: "or"
        }))
      ]
        .filter(
          (item, index, items) => items.findIndex((candidate) => candidate.label.toLowerCase() === item.label.toLowerCase()) === index
        )
        .sort((a, b) => a.label.localeCompare(b.label));
      const { categories, filterMode } = parseCategoryQuery(query);
      const q = query.trim().toLowerCase();
      const matches =
        q.length === 0
          ? base
          : base.filter((item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
      if (categories.length > 0) {
        const multiLabel =
          categories.length === 1
            ? `Open Notepad: ${categories[0]}`
            : `Open Notepad (${filterMode.toUpperCase()}): ${categories.join(" + ")}`;
        const exists = matches.some(
          (item) =>
            item.categories.length === categories.length &&
            item.filterMode === filterMode &&
            item.categories.every((value, index) => value.toLowerCase() === categories[index].toLowerCase())
        );
        if (!exists) {
          matches.unshift({
            kind: "open_notepad",
            label: multiLabel,
            description:
              categories.length === 1
                ? "Create/open category notepad"
                : `Create/open multi-category view (${filterMode.toUpperCase()})`,
            categories,
            filterMode
          });
        }
      }
      return matches;
    }

    const projectResults: ProjectResult[] = projects
      .map((project) => ({
        kind: "project" as const,
        projectId: project.id,
        label: project.name,
        defaultViewId: project.defaultViewId,
        projectKind: project.kind,
        labels: project.labelIds,
        description: project.description ?? ""
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const notepadResults: NotepadResult[] = notepads
      .map((notepad) => ({
        kind: "notepad" as const,
        notepadId: notepad.id,
        label: notepad.name,
        categories: notepad.filters.categories ?? [],
        description: notepad.description ?? ""
      }))
      .sort((a, b) => {
        if (a.notepadId === "now") return -1;
        if (b.notepadId === "now") return 1;
        return a.label.localeCompare(b.label);
      });

    if (!query.trim()) {
      return [
        {
          kind: "command",
          command: "open_notepad",
          label: "Open Notepad",
          description: "Open or create a category notepad"
        },
        ...ALL_PAGES,
        ...projectResults,
        ...notepadResults
      ] as SearchResult[];
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
      const aliases: string[] = Array.isArray(metric.metadataJson?.aliases)
        ? (metric.metadataJson.aliases as string[]).map((a) => a.toLowerCase())
        : [];

      // Score name
      let nameScore = 0;
      if (name === q) nameScore = 95;
      else if (name.startsWith(q)) nameScore = 75;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) nameScore = 55;
      else if (name.includes(q)) nameScore = 35;

      // Score aliases independently (best alias wins)
      let aliasScore = 0;
      for (const alias of aliases) {
        let s = 0;
        if (alias === q) s = 90;
        else if (alias.startsWith(q)) s = 70;
        else if (alias.split(/\s+/).some((word) => word.startsWith(q))) s = 50;
        else if (alias.includes(q)) s = 30;
        if (s > aliasScore) aliasScore = s;
      }

      // Score slug
      const slugScore = slug.includes(q) ? 20 : 0;

      const score = Math.max(nameScore, aliasScore, slugScore);
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
      const labels = project.labels.map((value) => value.toLowerCase()).join(" ");
      const description = project.description.toLowerCase();
      let score = 0;
      if (name === q) score = 92;
      else if (name.startsWith(q)) score = 72;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 56;
      else if (name.includes(q)) score = 44;
      else if (labels.includes(q)) score = 30;
      else if (description.includes(q)) score = 18;
      if (score > 0) {
        scored.push({ result: project, score });
      }
    }

    for (const notepad of notepadResults) {
      const name = notepad.label.toLowerCase();
      const categories = notepad.categories.map((value) => value.toLowerCase()).join(" ");
      const description = notepad.description.toLowerCase();
      let score = 0;
      if (name === q) score = 88;
      else if (name.startsWith(q)) score = 68;
      else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 52;
      else if (name.includes(q)) score = 40;
      else if (categories.includes(q)) score = 28;
      else if (description.includes(q)) score = 16;
      if (score > 0) {
        scored.push({ result: notepad, score });
      }
    }

    if ("open notepad".includes(q) || "category notepad".includes(q) || "category view".includes(q)) {
      scored.push({
        result: {
          kind: "command",
          command: "open_notepad",
          label: "Open Notepad",
          description: "Open or create a category notepad"
        },
        score: 96
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map((value) => value.result);
  }, [categoryEntries, metricBindings, metrics, mode, notepads, projects, query]);

  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const close = useCallback(() => {
    setOpen(false);
    setMode("global");
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
        void (async () => {
          try {
            const opened = await projectOpen(result.projectId);
            actions.selectScreen("notepad");
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent(OMNI_OPEN_NOTEPAD, { detail: { notepadId: opened.defaultViewId } }));
            }, 120);
          } catch {
            actions.selectScreen("projects");
          }
        })();
      } else if (result.kind === "notepad") {
        actions.selectScreen("notepad");
        const notepadId = result.notepadId;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(OMNI_OPEN_NOTEPAD, { detail: { notepadId } }));
        }, 120);
      } else if (result.kind === "command" && result.command === "open_notepad") {
        setMode("open_notepad");
        setQuery("");
        setSelectedIndex(0);
        return;
      } else if (result.kind === "open_notepad") {
        actions.selectScreen("notepad");
        const detail = { categories: result.categories, filterMode: result.filterMode };
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(OMNI_OPEN_NOTEPAD_BY_CATEGORY, { detail }));
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
        if (mode === "open_notepad") {
          setMode("global");
          setQuery("");
          setSelectedIndex(0);
        } else {
          close();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, mode, open]);

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
          placeholder={
            mode === "open_notepad"
              ? "Type category (or comma-separated list). Prefix with 'and:' for AND."
              : "Go to page, project, notepad, or metric..."
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="omni-results" ref={listRef} onMouseMove={onMouseMove}>
          {filtered.length === 0 && (
            <div className="omni-empty">
              {mode === "open_notepad" ? "No matching categories" : "No matching pages, projects, notepads, or metrics"}
            </div>
          )}
          {filtered.map((result, index) => {
            const key =
              result.kind === "page"
                ? `p:${result.screen}`
                : result.kind === "metric"
                  ? `m:${result.metricId}`
                  : result.kind === "project"
                    ? `pr:${result.projectId}`
                    : result.kind === "notepad"
                      ? `np:${result.notepadId}`
                      : result.kind === "command"
                      ? `cmd:${result.command}`
                      : `on:${result.filterMode}:${result.categories.join("|")}`;
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
                    {result.kind === "project" ? (
                      <>
                        <span className="omni-result-icon omni-project-icon">{"\u270E"}</span>
                        <span className="omni-result-text">
                          <span className="omni-result-label">{result.label}</span>
                          <span className="omni-result-description">
                            {result.labels.length > 0 ? `Labels: ${result.labels.join(", ")}` : "Project context"}
                          </span>
                        </span>
                        <span className="omni-result-badge">project</span>
                      </>
                    ) : result.kind === "notepad" ? (
                      <>
                        <span className="omni-result-icon omni-project-icon">{"\u25A3"}</span>
                        <span className="omni-result-text">
                          <span className="omni-result-label">{result.label}</span>
                          <span className="omni-result-description">
                            {result.categories.length > 0 ? `Categories: ${result.categories.join(", ")}` : "Notepad view"}
                          </span>
                        </span>
                        <span className="omni-result-badge">notepad</span>
                      </>
                    ) : result.kind === "command" ? (
                      <>
                        <span className="omni-result-icon omni-command-icon">{"\u25B7"}</span>
                        <span className="omni-result-text">
                          <span className="omni-result-label">{result.label}</span>
                          <span className="omni-result-description">{result.description}</span>
                        </span>
                        <span className="omni-result-badge">command</span>
                      </>
                    ) : (
                      <>
                        <span className="omni-result-icon omni-project-icon">{"\u25A3"}</span>
                        <span className="omni-result-text">
                          <span className="omni-result-label">{result.label}</span>
                          <span className="omni-result-description">{result.description}</span>
                        </span>
                        <span className="omni-result-badge">
                          {result.categories.length > 1 ? `categories ${result.filterMode.toUpperCase()}` : "category"}
                        </span>
                      </>
                    )}
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
            {mode === "open_notepad"
              ? `${categoryEntries.length} categories`
              : `${metrics.length} metrics · ${metricBindings.length} bindings · ${projects.length} projects · ${notepads.length} notepads`}
          </span>
        </div>
      </div>
    </div>
  );
}
