import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JournalType, JournalEntryMeta, MetricSnapshot } from "../lib/types";
import {
  journalListEntries,
  journalGetEntry,
  journalSaveEntry,
  getMetricDefinitionBySlug,
  getLatestMetricSnapshot,
  refreshMetric,
  onRunEvent,
} from "../lib/tauriClient";

interface JournalScreenProps {
  journalType: JournalType;
}

function todayDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateLabel(date: string): string {
  const today = todayDate();
  if (date === today) return "Today";
  const yesterday = shiftDate(today, -1);
  if (date === yesterday) return "Yesterday";
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

interface CalendarEvent {
  title: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
}

function formatEventTime(startTime: string | null, endTime: string | null, allDay: boolean): string {
  if (allDay) return "All day";
  if (!startTime) return "";
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  const start = fmt(startTime);
  if (!endTime) return start;
  return `${start} – ${fmt(endTime)}`;
}

type SaveStatus = "idle" | "saving" | "saved" | "unsaved";

export function JournalScreen({ journalType }: JournalScreenProps): JSX.Element {
  const [entries, setEntries] = useState<JournalEntryMeta[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayDate());
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string>();

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string>();
  const calendarMetricIdRef = useRef<string | null>(null);

  const saveTimerRef = useRef<number>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentContentRef = useRef("");
  const currentDateRef = useRef(selectedDate);

  currentContentRef.current = content;
  currentDateRef.current = selectedDate;

  const refreshEntries = useCallback(async () => {
    try {
      const list = await journalListEntries(journalType);
      setEntries(list);
    } catch (err) {
      console.error("Failed to list journal entries:", err);
    }
  }, [journalType]);

  const loadEntry = useCallback(
    async (date: string) => {
      setLoading(true);
      setError(undefined);
      try {
        const entry = await journalGetEntry(journalType, date);
        setContent(entry?.content ?? "");
        setSaveStatus("idle");
      } catch (err) {
        setError(String(err));
        setContent("");
      } finally {
        setLoading(false);
      }
    },
    [journalType]
  );

  const doSave = useCallback(
    async (date: string, text: string) => {
      setSaveStatus("saving");
      try {
        await journalSaveEntry(journalType, date, text);
        setSaveStatus("saved");
        await refreshEntries();
      } catch (err) {
        setError(String(err));
        setSaveStatus("unsaved");
      }
    },
    [journalType, refreshEntries]
  );

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
      await doSave(currentDateRef.current, currentContentRef.current);
    }
  }, [doSave]);

  const forceSave = useCallback(async () => {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = undefined;
    }
    await doSave(currentDateRef.current, currentContentRef.current);
  }, [doSave]);

  // Boot: load entries + today's entry
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(undefined);
      try {
        const list = await journalListEntries(journalType);
        if (cancelled) return;
        setEntries(list);
        const today = todayDate();
        setSelectedDate(today);
        const entry = await journalGetEntry(journalType, today);
        if (cancelled) return;
        setContent(entry?.content ?? "");
        setSaveStatus("idle");
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journalType]);

  // Auto-focus textarea after loading completes
  useEffect(() => {
    if (!loading) {
      textareaRef.current?.focus();
    }
  }, [loading, selectedDate]);

  // Cmd+S / Ctrl+S to force save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void forceSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [forceSave]);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Calendar events: resolve metric and load snapshot
  useEffect(() => {
    if (journalType !== "journal") return;
    let cancelled = false;

    (async () => {
      try {
        const def = await getMetricDefinitionBySlug("daily-calendar-events");
        if (cancelled || !def) return;
        calendarMetricIdRef.current = def.id;

        const snapshot = await getLatestMetricSnapshot(def.id);
        if (cancelled) return;

        const today = todayDate();
        if (
          snapshot &&
          snapshot.status === "completed" &&
          snapshot.valuesJson &&
          (snapshot.valuesJson as { date?: string }).date === today
        ) {
          setCalendarEvents(
            ((snapshot.valuesJson as { events?: CalendarEvent[] }).events ?? [])
          );
          return;
        }

        // Stale or missing — trigger refresh
        setCalendarLoading(true);
        await refreshMetric(def.id);
      } catch (err) {
        if (!cancelled) setCalendarError(String(err));
      }
    })();

    return () => { cancelled = true; };
  }, [journalType]);

  // Calendar events: listen for metric completion
  useEffect(() => {
    if (journalType !== "journal") return;

    let unlisten: (() => void) | null = null;
    let disposed = false;

    void onRunEvent((event) => {
      const metricId = calendarMetricIdRef.current;
      if (!metricId) return;
      const payloadMetricId = (event.payload as { metricId?: string })?.metricId;
      if (payloadMetricId !== metricId) return;

      if (event.type === "metric.snapshot_completed") {
        void getLatestMetricSnapshot(metricId).then((snap) => {
          if (snap?.valuesJson) {
            setCalendarEvents(
              ((snap.valuesJson as { events?: CalendarEvent[] }).events ?? [])
            );
          }
          setCalendarLoading(false);
          setCalendarError(undefined);
        });
      } else if (event.type === "metric.snapshot_failed") {
        setCalendarLoading(false);
        const message =
          (event.payload as { error?: string } | undefined)?.error?.trim() ||
          "Failed to load calendar events";
        setCalendarError(message);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [journalType]);

  const handleCalendarRefresh = useCallback(async () => {
    const metricId = calendarMetricIdRef.current;
    if (!metricId) return;
    setCalendarLoading(true);
    setCalendarError(undefined);
    try {
      await refreshMetric(metricId);
    } catch (err) {
      setCalendarLoading(false);
      setCalendarError(String(err));
    }
  }, []);

  const handleDateSelect = useCallback(
    async (date: string) => {
      if (date === selectedDate) return;
      await flushPendingSave();
      setSelectedDate(date);
      await loadEntry(date);
    },
    [selectedDate, flushPendingSave, loadEntry]
  );

  const handleContentChange = useCallback(
    (text: string) => {
      setContent(text);
      setSaveStatus("unsaved");
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = undefined;
        void doSave(currentDateRef.current, text);
      }, 1500);
    },
    [doSave]
  );

  const handlePrevDay = useCallback(async () => {
    const prev = shiftDate(selectedDate, -1);
    await flushPendingSave();
    setSelectedDate(prev);
    await loadEntry(prev);
  }, [selectedDate, flushPendingSave, loadEntry]);

  const handleNextDay = useCallback(async () => {
    const today = todayDate();
    if (selectedDate >= today) return;
    const next = shiftDate(selectedDate, 1);
    await flushPendingSave();
    setSelectedDate(next);
    await loadEntry(next);
  }, [selectedDate, flushPendingSave, loadEntry]);

  const handleGoToToday = useCallback(async () => {
    const today = todayDate();
    if (selectedDate === today) return;
    await flushPendingSave();
    setSelectedDate(today);
    await loadEntry(today);
  }, [selectedDate, flushPendingSave, loadEntry]);

  // Build sidebar list: today always first, then existing entries (deduped)
  const today = todayDate();
  const sidebarDates: string[] = [today];
  for (const entry of entries) {
    if (entry.date !== today) {
      sidebarDates.push(entry.date);
    }
  }

  const isAtToday = selectedDate >= today;
  const hasEntries = entries.length > 0;
  const wordCount = useMemo(() => countWords(content), [content]);

  const placeholder =
    journalType === "food-journal"
      ? "What did you eat today?"
      : "What's on your mind?";

  return (
    <section className="journal-screen screen">
      <div className="page-sidebar-layout">
        <div className="journal-sidebar">
          <div className="journal-sidebar-header">
            <span>Entries</span>
            {selectedDate !== today && (
              <button
                type="button"
                className="journal-today-btn"
                onClick={() => void handleGoToToday()}
              >
                Today
              </button>
            )}
          </div>
          <div className="journal-entry-list">
            {sidebarDates.map((date) => (
              <button
                key={date}
                type="button"
                className={`journal-entry-item${date === selectedDate ? " active" : ""}`}
                onClick={() => void handleDateSelect(date)}
              >
                {formatDateLabel(date)}
              </button>
            ))}
            {!hasEntries && (
              <div className="journal-empty-state">
                Your first entry starts here
              </div>
            )}
          </div>
        </div>

        <div className="page-sidebar-main">
          {error && <div className="banner error">{error}</div>}

          <div className="journal-editor-header">
            <div className="journal-date-nav">
              <button
                type="button"
                className="journal-nav-btn"
                onClick={() => void handlePrevDay()}
                aria-label="Previous day"
              >
                &#8249;
              </button>
              <span className="journal-editor-date">{formatDateLabel(selectedDate)}</span>
              <button
                type="button"
                className="journal-nav-btn"
                onClick={() => void handleNextDay()}
                disabled={isAtToday}
                aria-label="Next day"
              >
                &#8250;
              </button>
            </div>
            <span className="journal-save-indicator">
              {saveStatus === "saving" && "Saving..."}
              {saveStatus === "saved" && "Saved"}
              {saveStatus === "unsaved" && "Unsaved"}
            </span>
          </div>

          <textarea
            ref={textareaRef}
            className="journal-textarea"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder={loading ? "Loading..." : placeholder}
            disabled={loading}
          />

          {journalType === "journal" && (
            <div className="journal-calendar-section">
              <div className="journal-calendar-header">
                <span>Today's Calendar</span>
                <button
                  type="button"
                  className="journal-calendar-refresh-btn"
                  onClick={() => void handleCalendarRefresh()}
                  disabled={calendarLoading}
                  aria-label="Refresh calendar"
                >
                  &#x21bb;
                </button>
              </div>
              {calendarError && (
                <div className="journal-calendar-error">{calendarError}</div>
              )}
              {calendarLoading ? (
                <div className="journal-calendar-loading">Loading calendar...</div>
              ) : calendarEvents.length > 0 ? (
                <ul className="journal-calendar-list">
                  {calendarEvents.map((evt, i) => (
                    <li key={i} className="journal-calendar-event">
                      <span className="journal-calendar-time">
                        {formatEventTime(evt.startTime, evt.endTime, evt.allDay)}
                      </span>
                      <span className="journal-calendar-title">{evt.title}</span>
                      {evt.location && (
                        <span className="journal-calendar-location">{evt.location}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="journal-calendar-empty">No events today</div>
              )}
            </div>
          )}

          <div className="journal-footer">
            <span className="journal-word-count">
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
