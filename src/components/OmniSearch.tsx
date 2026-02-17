import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState, useAppActions } from "../state/appState";
import { NAVIGATION, SCREEN_META } from "./Sidebar/navigationConfig";
import type { Screen } from "../state/appState";

interface SearchResult {
  screen: Screen;
  label: string;
  group: string;
  icon: string;
  description: string;
}

const ALL_RESULTS: SearchResult[] = NAVIGATION.flatMap((group) =>
  group.items.map((item) => ({
    screen: item.id,
    label: item.label,
    group: group.label,
    icon: item.icon,
    description: SCREEN_META[item.id]?.description ?? "",
  }))
);

export function OmniSearch() {
  const state = useAppState();
  const actions = useAppActions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Track keyboard vs mouse to prevent scrollIntoView from triggering
  // onMouseEnter and fighting with arrow-key selection.
  const navModeRef = useRef<"keyboard" | "mouse">("keyboard");

  const filtered = useMemo(() => {
    if (!query.trim()) return ALL_RESULTS;
    const q = query.toLowerCase();
    const scored: { result: SearchResult; score: number }[] = [];
    for (const r of ALL_RESULTS) {
      const label = r.label.toLowerCase();
      const group = r.group.toLowerCase();
      const desc = r.description.toLowerCase();
      const screen = r.screen.toLowerCase();
      let score = 0;
      if (label === q) score = 100;                       // exact label match
      else if (label.startsWith(q)) score = 80;           // label starts with
      else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 60; // word starts with
      else if (label.includes(q)) score = 50;             // label contains
      else if (screen.includes(q)) score = 40;            // screen id contains
      else if (group.toLowerCase() === q) score = 35;     // exact group match
      else if (group.includes(q)) score = 25;             // group contains
      else if (desc.includes(q)) score = 15;              // description contains
      if (score > 0) scored.push({ result: r, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.result);
  }, [query]);

  // Keep refs in sync so the keydown handler always reads fresh values
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const navigate = useCallback(
    (screen: Screen) => {
      actions.selectScreen(screen);
      close();
    },
    [actions, close]
  );

  // Global keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        setOpen((v) => {
          if (v) {
            close();
            return false;
          }
          return true;
        });
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Scroll selected item into view (keyboard navigation only)
  useEffect(() => {
    if (navModeRef.current !== "keyboard" || !listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        navModeRef.current = "keyboard";
        setSelectedIndex((i) => Math.min(i + 1, filteredRef.current.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        navModeRef.current = "keyboard";
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const result = filteredRef.current[selectedIndexRef.current];
        if (result) navigateRef.current(result.screen);
      }
    },
    []
  );

  const onMouseMove = useCallback(() => {
    navModeRef.current = "mouse";
  }, []);

  if (!open) return null;

  return (
    <div className="omni-backdrop" onClick={close}>
      <div className="omni-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="omni-input"
          type="text"
          placeholder="Go to page..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="omni-results" ref={listRef} onMouseMove={onMouseMove}>
          {filtered.length === 0 && (
            <div className="omni-empty">No matching pages</div>
          )}
          {filtered.map((result, i) => (
            <button
              key={result.screen}
              className={`omni-result${i === selectedIndex ? " omni-result-active" : ""}${result.screen === state.selectedScreen ? " omni-result-current" : ""}`}
              onClick={() => navigate(result.screen)}
              onMouseEnter={() => {
                if (navModeRef.current === "mouse") setSelectedIndex(i);
              }}
              type="button"
            >
              <span className="omni-result-icon">{result.icon}</span>
              <span className="omni-result-text">
                <span className="omni-result-label">{result.label}</span>
                <span className="omni-result-description">{result.description}</span>
              </span>
              <span className="omni-result-group">{result.group}</span>
            </button>
          ))}
        </div>
        <div className="omni-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
