import { FormEvent, useEffect, useState } from "react";
import { clearProviderToken, hasProviderToken, saveProviderToken } from "../lib/tauriClient";
import { useAppActions, useAppState } from "../state/appState";

export function SettingsScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [workspacePath, setWorkspacePath] = useState("");
  const [codexToken, setCodexToken] = useState("");
  const [claudeToken, setClaudeToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState<{ codex: boolean; claude: boolean }>({
    codex: false,
    claude: false
  });
  const [tokenMessage, setTokenMessage] = useState<string>();
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    void (async () => {
      const [codex, claude] = await Promise.all([hasProviderToken("codex"), hasProviderToken("claude")]);
      setTokenStatus({ codex: codex.success, claude: claude.success });
    })();
  }, []);

  if (!state.settings) {
    return (
      <section className="settings-content">
        <div className="banner info">Loading settings...</div>
      </section>
    );
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!workspacePath.trim()) {
      return;
    }
    await actions.grantWorkspace(workspacePath.trim());
    setWorkspacePath("");
  }

  async function persistToken(provider: "codex" | "claude"): Promise<void> {
    const token = provider === "codex" ? codexToken : claudeToken;
    const result = await saveProviderToken(provider, token);
    if (result.success) {
      setTokenMessage(`${provider} token saved.`);
      setTokenStatus((prev) => ({ ...prev, [provider]: true }));
      if (provider === "codex") {
        setCodexToken("");
      } else {
        setClaudeToken("");
      }
    }
  }

  async function removeToken(provider: "codex" | "claude"): Promise<void> {
    const result = await clearProviderToken(provider);
    if (result.success) {
      setTokenMessage(`${provider} token removed.`);
      setTokenStatus((prev) => ({ ...prev, [provider]: false }));
    }
  }

  return (
    <section className="settings-content">
      <h2 className="settings-title">Settings</h2>

      {/* Workspace */}
      <div className="settings-section">
        <h3>Workspace</h3>
        <form className="grant-form" onSubmit={(event) => void submit(event)}>
          <input
            placeholder="/path/to/project"
            value={workspacePath}
            onChange={(event) => setWorkspacePath(event.target.value)}
          />
          <button type="submit">Add</button>
        </form>
        {state.workspaceGrants.filter((g) => !g.revokedAt).map((grant) => (
          <div key={grant.id} className="settings-row">
            <span>{grant.path}</span>
          </div>
        ))}
        {!state.workspaceGrants.filter((g) => !g.revokedAt).length && (
          <p className="settings-hint">No workspace configured yet.</p>
        )}
      </div>

      {/* Tokens */}
      <div className="settings-section">
        <h3>API Tokens</h3>
        <div className="settings-token-row">
          <label>
            Codex
            <div className="settings-inline">
              <input
                type="password"
                value={codexToken}
                onChange={(event) => setCodexToken(event.target.value)}
                placeholder={tokenStatus.codex ? "Saved in keyring" : "Paste token"}
              />
              <button type="button" onClick={() => void persistToken("codex")}>Save</button>
              {tokenStatus.codex && <button type="button" onClick={() => void removeToken("codex")}>Clear</button>}
            </div>
          </label>
          <label>
            Claude
            <div className="settings-inline">
              <input
                type="password"
                value={claudeToken}
                onChange={(event) => setClaudeToken(event.target.value)}
                placeholder={tokenStatus.claude ? "Saved in keyring" : "Paste token"}
              />
              <button type="button" onClick={() => void persistToken("claude")}>Save</button>
              {tokenStatus.claude && <button type="button" onClick={() => void removeToken("claude")}>Clear</button>}
            </div>
          </label>
        </div>
        {tokenMessage && <div className="banner info">{tokenMessage}</div>}
      </div>

      {/* Advanced toggle */}
      <div className="settings-section">
        <button
          type="button"
          className="settings-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide advanced" : "Show advanced options"}
        </button>

        {showAdvanced && (
          <div className="settings-advanced">
            <div className="settings-grid">
              <label>
                Codex binary
                <input
                  value={state.settings.codexPath}
                  onChange={(event) => void actions.updateSettings({ codexPath: event.target.value })}
                />
              </label>
              <label>
                Claude binary
                <input
                  value={state.settings.claudePath}
                  onChange={(event) => void actions.updateSettings({ claudePath: event.target.value })}
                />
              </label>
              <label>
                Retention (days)
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={state.settings.retentionDays}
                  onChange={(event) => void actions.updateSettings({ retentionDays: Number(event.target.value) })}
                />
              </label>
              <label>
                Storage cap (MB)
                <input
                  type="number"
                  min={128}
                  max={10240}
                  value={state.settings.maxStorageMb}
                  onChange={(event) => void actions.updateSettings({ maxStorageMb: Number(event.target.value) })}
                />
              </label>
            </div>

            <div className="settings-checks">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.settings.conversationThreadsV1}
                  onChange={(event) => void actions.updateSettings({ conversationThreadsV1: event.target.checked })}
                />
                Conversation threads v1
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.settings.allowAdvancedPolicy}
                  onChange={(event) => void actions.updateSettings({ allowAdvancedPolicy: event.target.checked })}
                />
                Advanced policy mode
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.settings.remoteTelemetryOptIn}
                  onChange={(event) => void actions.updateSettings({ remoteTelemetryOptIn: event.target.checked })}
                />
                Telemetry opt-in
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.settings.redactAggressive}
                  onChange={(event) => void actions.updateSettings({ redactAggressive: event.target.checked })}
                />
                Aggressive redaction
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.settings.storeEncryptedRawArtifacts}
                  onChange={(event) => void actions.updateSettings({ storeEncryptedRawArtifacts: event.target.checked })}
                />
                Store encrypted artifacts
              </label>
            </div>

          </div>
        )}
      </div>
    </section>
  );
}
