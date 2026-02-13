import clsx from "clsx";
import { useMemo, useState } from "react";
import { useAppActions, useAppState, type Screen } from "./state/appState";
import { ChatScreen } from "./screens/ChatScreen";
import { LegacyChatScreen } from "./screens/LegacyChatScreen";
import { CompatibilityScreen } from "./screens/CompatibilityScreen";
import { ComposerScreen } from "./screens/ComposerScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LiveRunScreen } from "./screens/LiveRunScreen";
import { ProfilesScreen } from "./screens/ProfilesScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { ThemeSwitcher } from "./ThemeSwitcher";

export default function App(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isAdvancedScreen =
    state.selectedScreen === "composer" ||
    state.selectedScreen === "live" ||
    state.selectedScreen === "history" ||
    state.selectedScreen === "profiles" ||
    state.selectedScreen === "compatibility" ||
    state.selectedScreen === "queue";

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
      case "compatibility":
        return <CompatibilityScreen />;
      case "queue":
        return <QueueScreen />;
      case "chat":
      default:
        return state.settings?.conversationThreadsV1 ? <ChatScreen /> : <LegacyChatScreen />;
    }
  }, [state.selectedScreen, state.settings?.conversationThreadsV1]);

  function goHome(): void {
    actions.selectScreen("chat");
    setSettingsOpen(false);
  }

  return (
    <div className="app-shell">
      <ThemeSwitcher />

      <header className="topbar">
        <div className="topbar-spacer" />

        {isAdvancedScreen && (
          <button
            type="button"
            className="topbar-back"
            onClick={goHome}
          >
            Back to chat
          </button>
        )}

        <button
          type="button"
          className={clsx("topbar-icon-btn", settingsOpen && "active")}
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Settings"
          title="Settings"
        >
          {"\u2699"}
        </button>
      </header>

      {settingsOpen && (
        <div className="settings-drawer">
          <SettingsScreen onNavigate={(screen: Screen) => { actions.selectScreen(screen); setSettingsOpen(false); }} />
        </div>
      )}

      <main className="content-panel">
        {state.loading && <div className="banner info">Loading...</div>}
        {state.error && <div className="banner error">{state.error}</div>}
        {panel}
      </main>
    </div>
  );
}
