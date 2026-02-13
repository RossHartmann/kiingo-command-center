import clsx from "clsx";
import { useMemo } from "react";
import { useAppActions, useAppState, type Screen } from "./state/appState";
import { CompatibilityScreen } from "./screens/CompatibilityScreen";
import { ComposerScreen } from "./screens/ComposerScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LiveRunScreen } from "./screens/LiveRunScreen";
import { ProfilesScreen } from "./screens/ProfilesScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const NAV_ITEMS: Array<{ key: Screen; label: string; hint: string }> = [
  { key: "composer", label: "Run Composer", hint: "Create safe runs" },
  { key: "live", label: "Live Run", hint: "Streaming terminal" },
  { key: "history", label: "History", hint: "Search and replay" },
  { key: "profiles", label: "Profiles", hint: "Reusable presets" },
  { key: "compatibility", label: "Compatibility", hint: "CLI capability map" },
  { key: "queue", label: "Queue", hint: "Priorities and limits" },
  { key: "settings", label: "Settings", hint: "Policy and storage" }
];

export default function App(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const panel = useMemo(() => {
    switch (state.selectedScreen) {
      case "composer":
        return <ComposerScreen />;
      case "live":
        return <LiveRunScreen />;
      case "history":
        return <HistoryScreen />;
      case "profiles":
        return <ProfilesScreen />;
      case "settings":
        return <SettingsScreen />;
      case "compatibility":
        return <CompatibilityScreen />;
      case "queue":
        return <QueueScreen />;
      default:
        return <ComposerScreen />;
    }
  }, [state.selectedScreen]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div>
          <h1>Local CLI Command Center</h1>
          <p>Codex + Claude headless orchestration with local policy, queueing, and history.</p>
        </div>
      </header>

      <div className="layout-grid">
        <aside className="nav-panel" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx("nav-item", state.selectedScreen === item.key && "active")}
              onClick={() => actions.selectScreen(item.key)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </aside>

        <main className="content-panel">
          {state.loading && <div className="banner info">Loading local state...</div>}
          {state.error && <div className="banner error">{state.error}</div>}
          {panel}
        </main>
      </div>
    </div>
  );
}
