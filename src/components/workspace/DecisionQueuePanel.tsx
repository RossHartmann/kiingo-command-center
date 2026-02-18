import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import type { AtomRecord, DecisionPrompt } from "../../lib/types";
import { taskDisplayTitle } from "../../lib/taskTitle";

interface DecisionQueuePanelProps {
  decisions: DecisionPrompt[];
  atomsById?: Record<string, AtomRecord>;
  loading?: boolean;
  error?: string;
  busyDecisionId?: string | null;
  compact?: boolean;
  onResolve: (decision: DecisionPrompt, optionId: string) => Promise<void>;
  onSnooze: (decision: DecisionPrompt) => Promise<void>;
  onDismiss: (decision: DecisionPrompt) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

function urgencyLabel(decision: DecisionPrompt): string {
  if (decision.priority <= 1) return "Critical";
  if (decision.priority === 2) return "High";
  if (decision.priority === 3) return "Medium";
  return "Low";
}

function dueLabel(decision: DecisionPrompt): string | undefined {
  if (!decision.dueAt) return undefined;
  const due = new Date(decision.dueAt);
  if (Number.isNaN(due.valueOf())) return undefined;
  return due.toLocaleString();
}

function reasonLabel(decision: DecisionPrompt): string {
  return decision.triggerReason ?? decision.body;
}

function relatedTitles(decision: DecisionPrompt, atomsById: Record<string, AtomRecord> | undefined): string[] {
  if (!atomsById) return [];
  return decision.atomIds
    .map((atomId) => atomsById[atomId])
    .filter((atom): atom is AtomRecord => !!atom)
    .map((atom) => taskDisplayTitle(atom, atom.id))
    .slice(0, 3);
}

export function DecisionQueuePanel({
  decisions,
  atomsById,
  loading,
  error,
  busyDecisionId,
  compact,
  onResolve,
  onSnooze,
  onDismiss,
  onRefresh
}: DecisionQueuePanelProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const pending = useMemo(
    () => decisions.filter((decision) => decision.status === "pending" || decision.status === "snoozed"),
    [decisions]
  );

  const ordered = useMemo(() => {
    return [...pending].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [pending]);

  useEffect(() => {
    if (ordered.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.max(0, Math.min(current, ordered.length - 1)));
  }, [ordered]);

  const activeDecision = ordered[activeIndex];

  const onQueueKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (ordered.length === 0) {
      return;
    }
    if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % ordered.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + ordered.length) % ordered.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(ordered.length - 1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && activeDecision?.options[0]) {
      event.preventDefault();
      void onResolve(activeDecision, activeDecision.options[0].id);
      return;
    }
    if (event.key.toLowerCase() === "s" && activeDecision) {
      event.preventDefault();
      void onSnooze(activeDecision);
      return;
    }
    if ((event.key.toLowerCase() === "d" || event.key === "Delete") && activeDecision) {
      event.preventDefault();
      void onDismiss(activeDecision);
      return;
    }
    if (event.key.toLowerCase() === "m" && activeDecision) {
      event.preventDefault();
      setExpandedId((current) => (current === activeDecision.id ? null : activeDecision.id));
    }
  };

  return (
    <section
      className={`decision-queue card${compact ? " compact" : ""}`}
      tabIndex={0}
      onKeyDown={onQueueKeyDown}
      aria-label="Decision queue"
    >
      <header className="decision-queue-header">
        <div>
          <h3>Decision Queue</h3>
          <small className="settings-hint">{ordered.length} pending tradeoff{ordered.length === 1 ? "" : "s"}</small>
          {ordered.length > 0 && (
            <small className="settings-hint">Keyboard: ↑/↓ move, Enter resolve, S snooze, D dismiss, M more.</small>
          )}
        </div>
        {onRefresh && (
          <button type="button" onClick={() => void onRefresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}
      {!error && ordered.length === 0 && <p className="settings-hint">No pending decisions. Attention caps are stable.</p>}

      <div className="decision-queue-list">
        {ordered.map((decision, index) => {
          const expanded = expandedId === decision.id;
          const titles = relatedTitles(decision, atomsById);
          const disabled = busyDecisionId === decision.id;
          const due = dueLabel(decision);

          return (
            <article
              className={`decision-card${index === activeIndex ? " active" : ""}`}
              key={decision.id}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <div className="decision-card-main">
                <div className="decision-card-title-row">
                  <strong>{decision.title}</strong>
                  <small className={`decision-priority p${decision.priority}`}>{urgencyLabel(decision)}</small>
                </div>
                <small>{reasonLabel(decision)}</small>
                {titles.length > 0 && <small className="decision-related">{titles.join(" · ")}</small>}
                {due && <small className="decision-due">Due {due}</small>}
              </div>

              <div className="decision-card-actions">
                {decision.options.slice(0, compact ? 1 : 2).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={option.id === "do_now" ? "primary" : ""}
                    onClick={() => void onResolve(decision, option.id)}
                    disabled={disabled}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => (current === decision.id ? null : decision.id))}
                  aria-expanded={expanded}
                >
                  {expanded ? "Less" : "More"}
                </button>
              </div>

              {expanded && (
                <div className="decision-card-disclosure">
                  <div className="decision-card-actions">
                    {decision.options.map((option) => (
                      <button
                        type="button"
                        key={`${decision.id}-${option.id}`}
                        onClick={() => void onResolve(decision, option.id)}
                        disabled={disabled}
                      >
                        {option.label}
                      </button>
                    ))}
                    <button type="button" onClick={() => void onSnooze(decision)} disabled={disabled}>
                      Snooze
                    </button>
                    <button type="button" onClick={() => void onDismiss(decision)} disabled={disabled}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
