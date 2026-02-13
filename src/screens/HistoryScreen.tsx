import { useEffect, useMemo, useState } from "react";
import { listRuns } from "../lib/tauriClient";
import type { Provider, RunRecord, RunStatus } from "../lib/types";
import { useAppActions, useAppState } from "../state/appState";

export function HistoryScreen(): JSX.Element {
  const state = useAppState();
  const actions = useAppActions();
  const [provider, setProvider] = useState<Provider | "all">("all");
  const [status, setStatus] = useState<RunStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [serverFilteredRuns, setServerFilteredRuns] = useState<RunRecord[] | null>(null);
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string>();

  const localFilteredRuns = useMemo(() => {
    return state.runs.filter((run) => {
      if (provider !== "all" && run.provider !== provider) {
        return false;
      }
      if (status !== "all" && run.status !== status) {
        return false;
      }
      if (search && !run.prompt.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (dateFrom && run.startedAt < new Date(dateFrom).toISOString()) {
        return false;
      }
      if (dateTo) {
        const dateToInclusive = new Date(`${dateTo}T23:59:59.999Z`).toISOString();
        if (run.startedAt > dateToInclusive) {
          return false;
        }
      }
      return true;
    });
  }, [dateFrom, dateTo, provider, search, state.runs, status]);

  const visibleRuns = serverFilteredRuns ?? localFilteredRuns;

  useEffect(() => {
    setServerFilteredRuns(null);
    setQueryError(undefined);
  }, [provider, status, search, dateFrom, dateTo]);

  async function refreshServerFiltered(): Promise<void> {
    setQuerying(true);
    try {
      const runs = await listRuns({
        provider: provider === "all" ? undefined : provider,
        status: status === "all" ? undefined : status,
        search: search.trim() || undefined,
        dateFrom: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
        limit: 200,
        offset: 0
      });
      setServerFilteredRuns(runs);
      setQueryError(undefined);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuerying(false);
    }
  }

  function clearFilters(): void {
    setProvider("all");
    setStatus("all");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setServerFilteredRuns(null);
    setQueryError(undefined);
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <h2>Run History</h2>
        <p>Filter by provider/status/date context and inspect detailed run metadata.</p>
      </div>

      <div className="card">
        <div className="toolbar-grid">
          <label>
            Provider
            <select value={provider} onChange={(event) => setProvider(event.target.value as Provider | "all")}>
              <option value="all">all</option>
              <option value="codex">codex</option>
              <option value="claude">claude</option>
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value as RunStatus | "all")}>
              <option value="all">all</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
              <option value="canceled">canceled</option>
              <option value="interrupted">interrupted</option>
            </select>
          </label>
          <label>
            Prompt search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="search prompt text" />
          </label>
          <label>
            Date from
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            Date to
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <button type="button" onClick={() => void refreshServerFiltered()} disabled={querying}>
            Apply filters
          </button>
          <button type="button" onClick={clearFilters}>
            Reset filters
          </button>
        </div>

        {queryError && <div className="banner error">{queryError}</div>}
        <div className="history-list">
          {visibleRuns.map((run) => (
            <button
              type="button"
              key={run.id}
              className="history-row"
              onClick={() => void actions.selectRun(run.id)}
            >
              <div>
                <strong>{run.provider}</strong>
                <span>{run.status}</span>
              </div>
              <p>{run.prompt}</p>
              <small>
                {new Date(run.startedAt).toLocaleString()} | model: {run.model ?? "default"} | cwd: {run.cwd}
              </small>
            </button>
          ))}
          {!visibleRuns.length && <div className="banner info">No runs match the current filters.</div>}
        </div>
      </div>
    </section>
  );
}
