import clsx from "clsx";
import { useMemo, useState } from "react";
import { useAppActions, useAppState, type Screen } from "./state/appState";
import { ChatScreen } from "./screens/ChatScreen";
import { CompatibilityScreen } from "./screens/CompatibilityScreen";
import { ComposerScreen } from "./screens/ComposerScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LiveRunScreen } from "./screens/LiveRunScreen";
import { ProfilesScreen } from "./screens/ProfilesScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

const PRIMARY_NAV_ITEMS: Array<{ key: Screen; label: string; hint: string }> = [
  { key: "chat", label: "Chat", hint: "Talk to model" },
  { key: "settings", label: "Settings", hint: "Policy and storage" }
];

const ADVANCED_NAV_ITEMS: Array<{ key: Screen; label: string; hint: string }> = [
  { key: "composer", label: "Run Composer", hint: "Create safe runs" },
  { key: "live", label: "Live Run", hint: "Streaming terminal" },
  { key: "history", label: "History", hint: "Search and replay" },
  { key: "profiles", label: "Profiles", hint: "Reusable presets" },
  { key: "compatibility", label: "Compatibility", hint: "CLI capability map" },
  { key: "queue", label: "Queue", hint: "Priorities and limits" }
];

export default function App(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const panel = useMemo(() => {
    switch (state.selectedScreen) {
      case "chat":
        return <ChatScreen />;
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
        return <ChatScreen />;
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
          <p>Chat-first local interface for Codex and Claude with safe defaults.</p>
        </div>
      </header>

      <div className="layout-grid">
        <aside className="nav-panel" aria-label="Primary navigation">
          {PRIMARY_NAV_ITEMS.map((item) => (
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
          <button type="button" className="nav-item" onClick={() => setShowAdvanced((value) => !value)}>
            <span>{showAdvanced ? "Hide advanced" : "Show advanced"}</span>
            <small>Composer, queue, diagnostics</small>
          </button>
          {showAdvanced &&
            ADVANCED_NAV_ITEMS.map((item) => (
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
