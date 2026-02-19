import { useMemo, useState } from "react";
import { useAppState } from "./state/appState";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { OmniSearch } from "./components/OmniSearch";
import { SCREEN_META } from "./components/Sidebar/navigationConfig";
import { ChatScreen } from "./screens/ChatScreen";
import { LegacyChatScreen } from "./screens/LegacyChatScreen";
import { CompatibilityScreen } from "./screens/CompatibilityScreen";
import { ComposerScreen } from "./screens/ComposerScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { LiveRunScreen } from "./screens/LiveRunScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { MetricAdminScreen } from "./screens/MetricAdminScreen";
import { ProfilesScreen } from "./screens/ProfilesScreen";
import { QueueScreen } from "./screens/QueueScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { CeoPrinciplesScreen } from "./screens/CeoPrinciplesScreen";
import { CooPrinciplesScreen } from "./screens/CooPrinciplesScreen";
import { CmoPrinciplesScreen } from "./screens/CmoPrinciplesScreen";
import { CroPrinciplesScreen } from "./screens/CroPrinciplesScreen";
import { CtoPrinciplesScreen } from "./screens/CtoPrinciplesScreen";
import { CfoPrinciplesScreen } from "./screens/CfoPrinciplesScreen";
import { CpoPrinciplesScreen } from "./screens/CpoPrinciplesScreen";
import { CcoPrinciplesScreen } from "./screens/CcoPrinciplesScreen";
import { ChroPrinciplesScreen } from "./screens/ChroPrinciplesScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { NotepadScreen } from "./screens/NotepadScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";

export default function App(): JSX.Element {
  const state = useAppState();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const meta = SCREEN_META[state.selectedScreen];

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
      case "tasks":
        return <TasksScreen />;
      case "projects":
        return <ProjectsScreen />;
      case "notepad":
        return <NotepadScreen />;
      case "settings":
        return <SettingsScreen />;
      case "chat":
        return state.settings?.conversationThreadsV1 ? <ChatScreen /> : <LegacyChatScreen />;
      case "metric-admin":
        return <MetricAdminScreen />;
      case "ceo-principles":
        return <CeoPrinciplesScreen />;
      case "coo-principles":
        return <CooPrinciplesScreen />;
      case "cmo-principles":
        return <CmoPrinciplesScreen />;
      case "cro-principles":
        return <CroPrinciplesScreen />;
      case "cto-principles":
        return <CtoPrinciplesScreen />;
      case "cfo-principles":
        return <CfoPrinciplesScreen />;
      case "cpo-principles":
        return <CpoPrinciplesScreen />;
      case "cco-principles":
        return <CcoPrinciplesScreen />;
      case "chro-principles":
        return <ChroPrinciplesScreen />;
      default: {
        return <DashboardScreen screenId={state.selectedScreen} />;
      }
    }
  }, [state.selectedScreen, state.settings?.conversationThreadsV1, meta.title, meta.description]);

  return (
    <div className="app-shell">
      <OmniSearch />
      <Sidebar mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />

      <div className="content-area">
        <header className="content-header">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {"\u2630"}
          </button>
          <div className="content-header-text">
            <h1>{meta.title}</h1>
            <p>{meta.description}</p>
          </div>
        </header>

        <main className="content-panel">
          {state.loading && <div className="banner info">Loading...</div>}
          {state.error && <div className="banner error">{state.error}</div>}
          {panel}
        </main>
      </div>
    </div>
  );
}
