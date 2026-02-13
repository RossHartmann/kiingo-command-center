import { FormEvent, useMemo, useState } from "react";
import type { Provider } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

export function ProfilesScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();

  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>("codex");
  const [configText, setConfigText] = useState("{}");
  const [error, setError] = useState<string>();

  const grouped = useMemo(() => {
    return {
      codex: state.profiles.filter((profile) => profile.provider === "codex"),
      claude: state.profiles.filter((profile) => profile.provider === "claude")
    };
  }, [state.profiles]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(undefined);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configText) as Record<string, unknown>;
    } catch {
      setError("Profile config must be valid JSON.");
      return;
    }

    if (!name.trim()) {
      setError("Profile name is required.");
      return;
    }

    await actions.saveProfile({
      name: name.trim(),
      provider,
      config
    });
    setName("");
    setConfigText("{}");
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Profiles</h2>
        <p>Create reusable command templates with provider-safe config JSON.</p>
      </div>

      <div className="split-grid">
        <form className="card" onSubmit={(event) => void submit(event)}>
          <label>
            Profile name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Daily review" />
          </label>
          <label>
            Provider
            <select value={provider} onChange={(event) => setProvider(event.target.value as Provider)}>
              <option value="codex">codex</option>
              <option value="claude">claude</option>
            </select>
          </label>
          <label>
            Config JSON
            <textarea value={configText} onChange={(event) => setConfigText(event.target.value)} rows={8} />
          </label>
          {error && <div className="banner error">{error}</div>}
          <div className="actions">
            <button type="submit" className="primary">
              Save profile
            </button>
          </div>
        </form>

        <div className="card">
          <h3>Codex profiles</h3>
          {grouped.codex.map((profile) => (
            <article key={profile.id} className="profile-item">
              <strong>{profile.name}</strong>
              <code>{JSON.stringify(profile.config)}</code>
              <small>updated {new Date(profile.updatedAt).toLocaleString()}</small>
            </article>
          ))}

          <h3>Claude profiles</h3>
          {grouped.claude.map((profile) => (
            <article key={profile.id} className="profile-item">
              <strong>{profile.name}</strong>
              <code>{JSON.stringify(profile.config)}</code>
              <small>updated {new Date(profile.updatedAt).toLocaleString()}</small>
            </article>
          ))}

          {!state.profiles.length && <div className="banner info">No saved profiles yet.</div>}
        </div>
      </div>
    </section>
  );
}
