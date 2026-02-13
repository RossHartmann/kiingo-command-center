import { useAppState } from "../state/appState";

export function CompatibilityScreen(): JSX.Element {
  const state = useAppState();

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Compatibility Dashboard</h2>
        <p>Detected CLI versions with capability gates and degraded/blocked remediation clues.</p>
      </div>

      <div className="card compatibility-grid">
        {state.capabilities.map((snapshot) => (
          <article key={snapshot.id} className="compat-card">
            <header>
              <strong>{snapshot.provider}</strong>
              <span>{snapshot.cliVersion}</span>
            </header>
            <p>
              {snapshot.profile.blocked
                ? "Blocked"
                : snapshot.profile.degraded
                  ? "Degraded"
                  : snapshot.profile.supported
                    ? "Supported"
                    : "Unknown"}
            </p>
            <div>
              <small>Modes: {snapshot.profile.supportedModes.join(", ") || "none"}</small>
            </div>
            <div>
              <small>Flags: {snapshot.profile.supportedFlags.join(", ") || "none"}</small>
            </div>
            {!!snapshot.profile.disabledReasons.length && (
              <ul>
                {snapshot.profile.disabledReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <small>Detected {new Date(snapshot.detectedAt).toLocaleString()}</small>
          </article>
        ))}
        {!state.capabilities.length && <div className="banner info">No capability snapshots available yet.</div>}
      </div>
    </section>
  );
}
