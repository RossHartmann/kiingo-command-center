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

  if (!state.settings) {
    return (
      <section className="screen">
        <div className="banner info">Settings are loading...</div>
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

  useEffect(() => {
    void (async () => {
      const [codex, claude] = await Promise.all([hasProviderToken("codex"), hasProviderToken("claude")]);
      setTokenStatus({ codex: codex.success, claude: claude.success });
    })();
  }, []);

  async function persistToken(provider: "codex" | "claude"): Promise<void> {
    const token = provider === "codex" ? codexToken : claudeToken;
    const result = await saveProviderToken(provider, token);
    if (result.success) {
      setTokenMessage(`${provider} token saved to keyring.`);
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
      setTokenMessage(`${provider} token removed from keyring.`);
      setTokenStatus((prev) => ({ ...prev, [provider]: false }));
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Settings</h2>
        <p>Provider binaries (scoped alias by default, verified absolute path in advanced mode), retention, telemetry, and workspace grants.</p>
      </div>

      <div className="split-grid">
        <div className="card">
          <label>
            Codex binary path
            <input
              value={state.settings.codexPath}
              onChange={(event) => void actions.updateSettings({ codexPath: event.target.value })}
            />
            <small>Use `codex` by default. Absolute paths require advanced policy mode.</small>
          </label>
          <label>
            Claude binary path
            <input
              value={state.settings.claudePath}
              onChange={(event) => void actions.updateSettings({ claudePath: event.target.value })}
            />
            <small>Use `claude` by default. Absolute paths require advanced policy mode.</small>
          </label>
          <label>
            Retention days
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

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={state.settings.allowAdvancedPolicy}
              onChange={(event) => void actions.updateSettings({ allowAdvancedPolicy: event.target.checked })}
            />
            Enable advanced policy mode (admin guarded)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={state.settings.remoteTelemetryOptIn}
              onChange={(event) => void actions.updateSettings({ remoteTelemetryOptIn: event.target.checked })}
            />
            Remote telemetry opt-in
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
            Store encrypted raw artifacts
          </label>
          <div className="card">
            <h3>Provider Tokens (Keyring)</h3>
            <label>
              Codex token
              <input
                type="password"
                value={codexToken}
                onChange={(event) => setCodexToken(event.target.value)}
                placeholder="Optional token saved to OS keyring"
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void persistToken("codex")}>Save Codex token</button>
              <button type="button" onClick={() => void removeToken("codex")}>Clear</button>
              <small>{tokenStatus.codex ? "Stored" : "Not stored"}</small>
            </div>
            <label>
              Claude token
              <input
                type="password"
                value={claudeToken}
                onChange={(event) => setClaudeToken(event.target.value)}
                placeholder="Optional token saved to OS keyring"
              />
            </label>
            <div className="actions">
              <button type="button" onClick={() => void persistToken("claude")}>Save Claude token</button>
              <button type="button" onClick={() => void removeToken("claude")}>Clear</button>
              <small>{tokenStatus.claude ? "Stored" : "Not stored"}</small>
            </div>
            {tokenMessage && <div className="banner info">{tokenMessage}</div>}
          </div>
        </div>

        <div className="card">
          <h3>Workspace grants</h3>
          <form className="grant-form" onSubmit={(event) => void submit(event)}>
            <input
              placeholder="/absolute/path"
              value={workspacePath}
              onChange={(event) => setWorkspacePath(event.target.value)}
            />
            <button type="submit">Grant workspace</button>
          </form>

          <div className="grant-list">
            {state.workspaceGrants.map((grant) => (
              <article key={grant.id} className="grant-item">
                <strong>{grant.path}</strong>
                <small>
                  granted by {grant.grantedBy} on {new Date(grant.grantedAt).toLocaleString()}
                </small>
                {grant.revokedAt && <small>revoked {new Date(grant.revokedAt).toLocaleString()}</small>}
              </article>
            ))}
            {!state.workspaceGrants.length && <div className="banner info">No workspace grants configured.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
