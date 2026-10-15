// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.003 — CalendarSettingsScreen.
//
// ★★★ TWO CONNECT LINKS ARE PLAIN NAVIGATIONS, NEVER `fetch`. `GET .../connect/google|microsoft`
//     is a 302 redirect straight to the provider's consent screen, so these render as ordinary
//     `<a href>` elements.
//
// ★★★ THREE DOCUMENTED GAPS/DECISIONS:
//   (1) F664 — SUBSCRIBE LINK: `calendar_subscribe_token_resolve`'s SQL shape is unspecified,
//       so subscribeLink renders disabled/inert.
//   (2) THE CALENDAR-ENUMERATION GAP: renders only what the server knows (watchedCalendars),
//       not fabricated example rows.
//   (3) EVENT-TITLE MODE: rendered as data-driven static text reflecting real `eventTitleMode`
//       value, not as an invented dropdown.
//
// ★★★ TASK 3a.6 (F686) — REMOTE-CHANGES CONFLICT QUEUE: self-fetched via onMount, renders
//     nothing when there are no pending conflicts.
//
// ★ 13.43 — CALENDAR PREFERENCES: the six values arrive as `calendarPreferences` PROP.
//   THERE IS NO GET ROUTE — a `null` prop falls back to migration 0403's defaults.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { api, ApiError, request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { FieldLabel, FieldDescription, FieldContent } from "@/lib/components/ui/field.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import CalendarSettingsScreenCalendarDisconnectConfirm from "./CalendarSettingsScreenCalendarDisconnectConfirm.jsx";

const DEFAULT_CALENDAR_PREFS = {
  weekStarts: "monday",
  dayFromMinute: 420,
  dayToMinute: 1200,
  slotMinutes: 30,
  showCancelledDays: 7,
  colourBy: "service",
};

const WEEK_STARTS_OPTIONS = [
  { value: "monday", label: "Monday" },
  { value: "sunday", label: "Sunday" },
];

const SLOT_OPTIONS = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "60 minutes" },
];

const SHOW_CANCELLED_OPTIONS = [
  { value: "0", label: "Don't show" },
  { value: "7", label: "Greyed out, for a week" },
];

const COLOUR_BY_OPTIONS = [
  { value: "service", label: "Service" },
  { value: "staff", label: "Person" },
  { value: "state", label: "Location" },
  { value: "program", label: "Program" },
];

const MINUTE_STEP = 15;
const MINUTE_OPTIONS = Array.from({ length: (24 * 60) / MINUTE_STEP }, (_, i) => String(i * MINUTE_STEP));

const PROVIDER_LABEL = { google: "Google", microsoft: "Microsoft" };
const PROVIDER_INITIAL = { google: "G", microsoft: "M" };
const CONNECT_LABEL = { google: "Connect Google", microsoft: "Connect Outlook" };
const CONNECT_OTHER_LABEL = { google: "Connect Google instead", microsoft: "Connect Outlook instead" };

const STATUS_CHIP = {
  active: { text: "Connected", class: "ok" },
  renewal_failed: { text: "Needs reconnecting", class: "warn" },
  needs_full_resync: { text: "Reconnecting", class: "warn" },
};

const ERROR_TEXT = {
  google_calendar_disabled: "Google Calendar sync is not turned on for this practice.",
  outlook_calendar_disabled: "Outlook calendar sync is not turned on for this practice.",
  google_declined: "The connection was cancelled before Google finished.",
  microsoft_declined: "The connection was cancelled before Microsoft finished.",
  invalid_state: "That connection link had expired or was not started from this screen. Try again below.",
  google_unreachable: "Google could not be reached to finish connecting. Try again.",
  microsoft_unreachable: "Microsoft could not be reached to finish connecting. Try again.",
  google_not_configured: "Google Calendar isn't set up yet.",
  outlook_not_configured: "Outlook Calendar isn't set up yet.",
  redirect_uri_mismatch: "Google refused the sign-in because the return address Workbench sent does not match the one saved with Google (redirect_uri_mismatch). Nothing was connected; the address has to be corrected in the Google console.",
  something_went_wrong: "Something went wrong, try again.",
};

function clockLabel(total) {
  const totalNum = Number(total);
  const h24 = Math.floor(totalNum / 60);
  const mm = String(totalNum % 60).padStart(2, "0");
  const period = h24 < 12 ? "AM" : "PM";
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return `${h12}:${mm} ${period}`;
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function CalendarSettingsScreen({ view = null, onNavigate = null, onDone = null, calendarPreferences = null }) {
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_CALENDAR_PREFS, ...(calendarPreferences ?? {}) }));
  const [prefsSavingField, setPrefsSavingField] = useState(null);
  const [prefsError, setPrefsError] = useState(null);
  const [prefsDenied, setPrefsDenied] = useState(false);
  const [prefsDeniedReason, setPrefsDeniedReason] = useState(null);

  const [remoteChanges, setRemoteChanges] = useState([]);
  const [remoteChangesProblem, setRemoteChangesProblem] = useState(null);
  const [actionKeyBusy, setActionKeyBusy] = useState(null);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectTarget, setDisconnectTarget] = useState(null);

  const connections = view?.connections ?? [];
  const subscribeLink = view?.subscribeLink ?? null;
  const connectedProviders = new Set(connections.map((c) => c.provider));
  // ★ A provider the server has no OAuth client for is never offered as a working Connect button (7 Oct 2026: it sent people to a raw error page).
  const configured = view?.providersConfigured ?? { google: true, microsoft: true };
  const otherProviders = ["google", "microsoft"].filter((p) => !connectedProviders.has(p) && configured[p] !== false);
  const unavailableProviders = ["google", "microsoft"].filter((p) => !connectedProviders.has(p) && configured[p] === false);

  // Update prefs when calendarPreferences prop changes
  useEffect(() => {
    setPrefs({ ...DEFAULT_CALENDAR_PREFS, ...(calendarPreferences ?? {}) });
  }, [calendarPreferences]);

  // Load remote changes on mount
  useEffect(() => {
    loadRemoteChanges();
  }, []);

  const changeKey = (row) => `${row.bookingId}:${row.externalEventId}`;

  async function loadRemoteChanges() {
    try {
      const changes = await api.calendarRemoteChanges();
      setRemoteChanges(changes || []);
    } catch (err) {
      const errMsg = err instanceof ApiError ? err.message : String(err?.message ?? err);
      setRemoteChangesProblem(errMsg);
    }
  }

  async function saveCalendarPref(field, value) {
    if (prefsSavingField) return;
    setPrefsSavingField(field);
    setPrefsError(null);
    try {
      const updated = await request("/api/me/calendar-preferences", {
        method: "POST",
        body: { [field]: value },
      });
      setPrefs((prev) => ({ ...prev, ...updated }));
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPrefsDenied(true);
        setPrefsDeniedReason(err.message);
      } else {
        setPrefsError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    } finally {
      setPrefsSavingField(null);
    }
  }

  async function toggleWatched(connectionId, watched, externalCalendarId, nextCountsAsBusy) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.setCalendarWatchedCalendars({
        connectionId,
        watched: watched.map((w) => ({
          externalCalendarId: w.externalCalendarId,
          countsAsBusy: w.externalCalendarId === externalCalendarId ? nextCountsAsBusy : w.countsAsBusy,
        })),
      });
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function setPushTarget(connectionId, pushCalendarId) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.setCalendarPushTarget({ connectionId, pushCalendarId: pushCalendarId || null });
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisconnect() {
    if (!disconnectTarget || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.disconnectCalendarConnection({ connectionId: disconnectTarget.id });
      setDisconnectOpen(false);
      setDisconnectTarget(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function acceptChange(row) {
    if (actionKeyBusy) return;
    const key = changeKey(row);
    setActionKeyBusy(key);
    setRemoteChangesProblem(null);
    try {
      await api.acceptCalendarRemoteChange({ bookingId: row.bookingId, externalEventId: row.externalEventId });
      setRemoteChanges((prev) => prev.filter((r) => changeKey(r) !== key));
      onDone?.();
    } catch (err) {
      setRemoteChangesProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setActionKeyBusy(null);
    }
  }

  async function rejectChange(row) {
    if (actionKeyBusy) return;
    const key = changeKey(row);
    setActionKeyBusy(key);
    setRemoteChangesProblem(null);
    try {
      await api.rejectCalendarRemoteChange({ bookingId: row.bookingId, externalEventId: row.externalEventId });
      setRemoteChanges((prev) => prev.filter((r) => changeKey(r) !== key));
      onDone?.();
    } catch (err) {
      setRemoteChangesProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setActionKeyBusy(null);
    }
  }

  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const justConnected = params?.get("connected") ?? null;
  const calendarError = params?.get("calendar_error") ?? null;

  function goto(e, href) {
    e.preventDefault();
    onNavigate?.(href);
  }

  return (
    <div className="flex flex-col max-w-[920px]" data-testid="settings-calendar">
      <p className="m-0 text-xs text-[var(--ink-muted)]">
        <a href="/settings" onClick={(e) => goto(e, "/settings")} className="text-[var(--primary)] no-underline">My settings</a> › Calendar
      </p>
      <h1 className="m-0 mt-1 text-2xl font-medium tracking-tighter text-[length:var(--fs-title)]">Calendar sync</h1>
      <p className="mt-1.5 mb-4 text-[var(--ink-muted)]">Keep Workbench and your own calendar in step. Workbench stays in charge of sessions.</p>

      {justConnected && (
        <p className="mb-4 rounded-lg p-[10px_14px] text-sm bg-[var(--chip-ok-bg)] text-[var(--chip-ok-ink)]" data-testid="calendar-connected-notice">
          {PROVIDER_LABEL[justConnected] ?? justConnected} is connected.
        </p>
      )}

      {calendarError && (
        <p className="mb-4 rounded-lg p-[10px_14px] text-sm bg-[var(--chip-bad-bg)] text-[var(--chip-bad-ink)]" data-testid="calendar-error-notice" role="alert">
          {ERROR_TEXT[calendarError] ?? "That connection attempt did not finish."}
        </p>
      )}

      {problem && (
        <p className="mb-4 rounded-lg p-[10px_14px] text-sm bg-[var(--chip-bad-bg)] text-[var(--chip-bad-ink)]" data-testid="calendar-problem" role="alert">
          {problem}
        </p>
      )}

      {/* Remote-changes conflict queue */}
      {remoteChangesProblem && (
        <p className="mb-4 rounded-lg p-[10px_14px] text-sm bg-[var(--chip-bad-bg)] text-[var(--chip-bad-ink)]" data-testid="calendar-remote-changes-problem" role="alert">
          {remoteChangesProblem}
        </p>
      )}

      {remoteChanges.length > 0 && (
        <section className="flex gap-8 mb-6 py-6 border-t border-line" data-testid="calendar-section-remote-changes">
          <div className="flex-none w-60">
            <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Needs your review</h2>
            <p className="m-0 mt-1 text-sm text-[var(--ink-muted)]">This session moved on your outside calendar. Choose which time is right.</p>
          </div>
          <div className="flex-1">
            {remoteChanges.map((row) => (
              <div key={changeKey(row)} className="flex items-center gap-3 p-3.5 mb-3 border border-line rounded-lg" data-testid={`calendar-remote-change-${row.bookingId}`}>
                <span className="flex items-center justify-center w-9 h-9 rounded text-sm font-semibold flex-none bg-[var(--surface-sunken)] text-[var(--ink)]">
                  {PROVIDER_INITIAL[row.provider] ?? "?"}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-[var(--ink)]">Moved to {fmtWhen(row.proposedStartsAt)}</span>
                  <span className="block text-xs text-[var(--ink-muted)]">{PROVIDER_LABEL[row.provider] ?? row.provider} · flagged {fmtWhen(row.flaggedAt)}</span>
                </span>
                <Button size="sm" variant="outline" data-testid={`calendar-remote-change-accept-${row.bookingId}`} disabled={actionKeyBusy === changeKey(row)} onClick={() => acceptChange(row)}>
                  Accept {fmtWhen(row.proposedStartsAt)}
                </Button>
                <Button size="sm" variant="outline" data-testid={`calendar-remote-change-reject-${row.bookingId}`} disabled={actionKeyBusy === changeKey(row)} onClick={() => rejectChange(row)}>
                  Keep Workbench's time
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* How your week is shaped */}
      <section className="flex gap-8 mb-6 py-6 border-t border-line" data-testid="calendar-section-prefs">
        <div className="flex-none w-60">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">How your week is shaped</h2>
          <p className="m-0 mt-1 text-sm text-[var(--ink-muted)]">Just how you see the calendar. Nobody else's view changes.</p>
        </div>
        <div className="flex-1 max-w-[480px]">
          {prefsError && (
            <p className="mb-4 rounded-lg p-[10px_14px] text-sm bg-[var(--chip-bad-bg)] text-[var(--chip-bad-ink)]" data-testid="calendar-prefs-error" role="alert">
              {prefsError}
            </p>
          )}

          {prefsDenied ? (
            <ScreenState
              phase="denied"
              reason={prefsDeniedReason}
              testIds={{ denied: "calendar-prefs-denied" }}
            />
          ) : (
            <>
              {/* Week starts on */}
              <div className="flex gap-5 items-start py-4 border-b border-line-soft" data-testid="calendar-prefs-row-week-starts">
                <div className="w-60 flex-shrink-0">
                  <FieldLabel htmlFor="calendar-prefs-week-starts" className="text-sm font-medium block text-[var(--ink)] p-0">
                    Week starts on<span className="ml-1.25 text-xs text-[var(--ink-muted)]">optional</span>
                  </FieldLabel>
                </div>
                <FieldContent className="flex-1 max-w-[460px] flex items-center gap-2">
                  <NativeSelect
                    id="calendar-prefs-week-starts"
                    value={prefs.weekStarts}
                    disabled={prefsSavingField === "calendarWeekStarts"}
                    data-testid="calendar-prefs-week-starts"
                    onChange={(e) => saveCalendarPref("calendarWeekStarts", e.currentTarget.value)}
                  >
                    {WEEK_STARTS_OPTIONS.map((opt) => (
                      <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {prefsSavingField === "calendarWeekStarts" && (
                    <span className="text-xs text-[var(--ink-muted)]" data-testid="calendar-prefs-saving">Saving…</span>
                  )}
                </FieldContent>
              </div>

              {/* Day shown from */}
              <div className="flex gap-5 items-start py-4 border-b border-line-soft" data-testid="calendar-prefs-row-day-shown">
                <div className="w-60 flex-shrink-0">
                  <FieldLabel htmlFor="calendar-prefs-day-from" className="text-sm font-medium block text-[var(--ink)] p-0">
                    Day shown from<span className="ml-1.25 text-xs text-[var(--ink-muted)]">optional</span>
                  </FieldLabel>
                  <FieldDescription className="text-xs mt-1 text-[var(--ink-muted)]">Just what you see. Bookable hours are set separately.</FieldDescription>
                </div>
                <FieldContent className="flex-1 max-w-[460px] flex items-center gap-2.5 flex-wrap">
                  <span className="flex gap-2.5">
                    <NativeSelect
                      id="calendar-prefs-day-from"
                      value={String(prefs.dayFromMinute)}
                      disabled={prefsSavingField === "calendarDayFromMinute"}
                      data-testid="calendar-prefs-day-from"
                      onChange={(e) => saveCalendarPref("calendarDayFromMinute", Number(e.currentTarget.value))}
                    >
                      {MINUTE_OPTIONS.map((m) => (
                        <NativeSelectOption key={m} value={m}>{clockLabel(m)}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <NativeSelect
                      id="calendar-prefs-day-to"
                      value={String(prefs.dayToMinute)}
                      disabled={prefsSavingField === "calendarDayToMinute"}
                      data-testid="calendar-prefs-day-to"
                      onChange={(e) => saveCalendarPref("calendarDayToMinute", Number(e.currentTarget.value))}
                    >
                      {MINUTE_OPTIONS.map((m) => (
                        <NativeSelectOption key={m} value={m}>{clockLabel(m)}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </span>
                  {(prefsSavingField === "calendarDayFromMinute" || prefsSavingField === "calendarDayToMinute") && (
                    <span className="text-xs text-[var(--ink-muted)]" data-testid="calendar-prefs-saving">Saving…</span>
                  )}
                </FieldContent>
              </div>

              {/* Slot size */}
              <div className="flex gap-5 items-start py-4 border-b border-line-soft" data-testid="calendar-prefs-row-slot-size">
                <div className="w-60 flex-shrink-0">
                  <FieldLabel htmlFor="calendar-prefs-slot-size" className="text-sm font-medium block text-[var(--ink)] p-0">
                    Slot size<span className="ml-1.25 text-xs text-[var(--ink-muted)]">optional</span>
                  </FieldLabel>
                  <FieldDescription className="text-xs mt-1 text-[var(--ink-muted)]">How finely the grid is divided. Doesn't change what's bookable.</FieldDescription>
                </div>
                <FieldContent className="flex-1 max-w-[460px] flex items-center gap-2">
                  <NativeSelect
                    id="calendar-prefs-slot-size"
                    value={String(prefs.slotMinutes)}
                    disabled={prefsSavingField === "calendarSlotMinutes"}
                    data-testid="calendar-prefs-slot-size"
                    onChange={(e) => saveCalendarPref("calendarSlotMinutes", Number(e.currentTarget.value))}
                  >
                    {SLOT_OPTIONS.map((opt) => (
                      <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {prefsSavingField === "calendarSlotMinutes" && (
                    <span className="text-xs text-[var(--ink-muted)]" data-testid="calendar-prefs-saving">Saving…</span>
                  )}
                </FieldContent>
              </div>

              {/* Show cancelled sessions */}
              <div className="flex gap-5 items-start py-4 border-b border-line-soft" data-testid="calendar-prefs-row-show-cancelled">
                <div className="w-60 flex-shrink-0">
                  <FieldLabel htmlFor="calendar-prefs-show-cancelled" className="text-sm font-medium block text-[var(--ink)] p-0">
                    Show cancelled sessions<span className="ml-1.25 text-xs text-[var(--ink-muted)]">optional</span>
                  </FieldLabel>
                </div>
                <FieldContent className="flex-1 max-w-[460px] flex items-center gap-2">
                  <NativeSelect
                    id="calendar-prefs-show-cancelled"
                    value={String(prefs.showCancelledDays)}
                    disabled={prefsSavingField === "calendarShowCancelledDays"}
                    data-testid="calendar-prefs-show-cancelled"
                    onChange={(e) => saveCalendarPref("calendarShowCancelledDays", Number(e.currentTarget.value))}
                  >
                    {SHOW_CANCELLED_OPTIONS.map((opt) => (
                      <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {prefsSavingField === "calendarShowCancelledDays" && (
                    <span className="text-xs text-[var(--ink-muted)]" data-testid="calendar-prefs-saving">Saving…</span>
                  )}
                </FieldContent>
              </div>

              {/* Colour by */}
              <div className="flex gap-5 items-start py-4" data-testid="calendar-prefs-row-colour-by">
                <div className="w-60 flex-shrink-0">
                  <FieldLabel htmlFor="calendar-prefs-colour-by" className="text-sm font-medium block text-[var(--ink)] p-0">
                    Colour by<span className="ml-1.25 text-xs text-[var(--ink-muted)]">optional</span>
                  </FieldLabel>
                  <FieldDescription className="text-xs mt-1 text-[var(--ink-muted)]">Or by person, location or program.</FieldDescription>
                </div>
                <FieldContent className="flex-1 max-w-[460px] flex items-center gap-2">
                  <NativeSelect
                    id="calendar-prefs-colour-by"
                    value={prefs.colourBy}
                    disabled={prefsSavingField === "calendarColourBy"}
                    data-testid="calendar-prefs-colour-by"
                    onChange={(e) => saveCalendarPref("calendarColourBy", e.currentTarget.value)}
                  >
                    {COLOUR_BY_OPTIONS.map((opt) => (
                      <NativeSelectOption key={opt.value} value={opt.value}>{opt.label}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {prefsSavingField === "calendarColourBy" && (
                    <span className="text-xs text-[var(--ink-muted)]" data-testid="calendar-prefs-saving">Saving…</span>
                  )}
                </FieldContent>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Connected calendar */}
      <section className="flex gap-8 mb-6 py-6 border-t border-line" data-testid="calendar-section-connected">
        <div className="flex-none w-60">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Connected calendar</h2>
          <p className="m-0 mt-1 text-sm text-[var(--ink-muted)]">Busy times come in, sessions go out.</p>
        </div>
        <div className="flex-1 max-w-[480px]">
          {connections.length === 0 ? (
            <>
              <p className="m-0 mb-4 rounded-lg p-[12px_14px] text-sm text-center bg-[var(--surface-sunken)] text-[var(--ink-muted)]" data-testid="calendar-connected-empty">
                No calendar connected yet<br />
                <span className="text-xs">Connect Google or Outlook to read your busy times and put new sessions on your calendar.</span>
              </p>
              <div className="flex gap-3 flex-wrap mt-1" data-testid="calendar-connect-row">
                {configured.google !== false && (
                  <a href="/api/engagements/calendar/connect/google" data-testid="calendar-connect-google" className="px-4 py-2 bg-white border border-line rounded-lg text-sm font-medium text-[var(--ink)]">
                    {CONNECT_LABEL.google}
                  </a>
                )}
                {configured.microsoft !== false && (
                  <a href="/api/engagements/calendar/connect/microsoft" data-testid="calendar-connect-microsoft" className="px-4 py-2 bg-white border border-line rounded-lg text-sm font-medium text-[var(--ink)]">
                    {CONNECT_LABEL.microsoft}
                  </a>
                )}
                {unavailableProviders.map((p) => (
                  <span key={p} data-testid={`calendar-unavailable-${p}`} className="px-4 py-2 text-sm text-[var(--ink-muted)]">
                    {p === "google" ? "Google Calendar isn't set up yet." : "Outlook Calendar isn't set up yet."}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <>
              {connections.map((conn) => (
                <div key={conn.id} className="flex items-center gap-3 p-3.5 mb-3 border border-line rounded-lg" data-testid={`calendar-account-${conn.id}`}>
                  <span className="flex items-center justify-center w-9 h-9 rounded text-sm font-semibold flex-none bg-[var(--surface-sunken)] text-[var(--ink)]">
                    {PROVIDER_INITIAL[conn.provider] ?? "?"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium overflow-hidden text-ellipsis whitespace-nowrap text-[var(--ink)]" title={conn.externalAccount}>{conn.externalAccount}</span>
                    <span className="block text-xs text-[var(--ink-muted)]">
                      {PROVIDER_LABEL[conn.provider] ?? conn.provider}
                      {conn.status === "active" && conn.lastRenewedAt && " · synced"}
                      {conn.status !== "active" && conn.lastError && ` · ${conn.lastError}`}
                    </span>
                  </span>
                  <Badge className={`h-5 text-xs font-medium px-2.5 py-0.5 flex-none ${STATUS_CHIP[conn.status]?.class === "ok" ? "bg-[var(--chip-ok-bg)] text-[var(--chip-ok-ink)]" : "bg-[var(--chip-warn-bg)] text-[var(--chip-warn-ink)]"}`}>
                    {(STATUS_CHIP[conn.status] ?? { text: conn.status }).text}
                  </Badge>
                  <Button size="sm" variant="outline" data-testid={`calendar-disconnect-${conn.id}`} onClick={() => {
                    setProblem(null);
                    setDisconnectTarget({ id: conn.id, externalAccount: conn.externalAccount });
                    setDisconnectOpen(true);
                  }}>
                    Disconnect
                  </Button>
                </div>
              ))}
              {otherProviders.length > 0 && (
                <div className="flex gap-3 flex-wrap mt-4" data-testid="calendar-connect-other-row">
                  {otherProviders.map((p) => (
                    <a key={p} href={`/api/engagements/calendar/connect/${p}`} data-testid={`calendar-connect-${p}`} className="px-4 py-2 bg-white border border-line rounded-lg text-sm font-medium text-[var(--ink)]">
                      {CONNECT_OTHER_LABEL[p]}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Count as busy */}
      <section className="flex gap-8 mb-6 py-6 border-t border-line" data-testid="calendar-section-watched">
        <div className="flex-none w-60">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Count as busy</h2>
          <p className="m-0 mt-1 text-sm text-[var(--ink-muted)]">Only the time is read. Titles are never shown in Workbench.</p>
        </div>
        <div className="flex-1 max-w-[480px]">
          {connections.length === 0 ? (
            <p className="m-0 text-xs text-[var(--ink-muted)]" data-testid="calendar-watched-no-connection">
              Connect a calendar above to choose which of its calendars block bookings.
            </p>
          ) : (
            <>
              {connections.map((conn) => (
                <div key={conn.id}>
                  {conn.watchedCalendars.length === 0 ? (
                    <p className="m-0 text-xs text-[var(--ink-muted)]" data-testid={`calendar-watched-empty-${conn.id}`}>
                      Workbench has not been told which of {conn.externalAccount}'s calendars to watch yet. This list fills in as calendars are added on the provider's side and synced back.
                    </p>
                  ) : (
                    <>
                      {conn.watchedCalendars.map((w) => (
                        <div key={w.externalCalendarId} className="flex items-center justify-between py-3.5 border-b border-line-soft" data-testid={`calendar-watched-${w.externalCalendarId}`}>
                          <span className="flex-1 min-w-0">
                            <span className="block font-medium text-sm overflow-hidden text-ellipsis whitespace-nowrap text-[var(--ink)]" title={w.displayName ?? w.externalCalendarId}>
                              {w.displayName ?? w.externalCalendarId}
                            </span>
                            <span className="block text-xs text-[var(--ink-muted)]">
                              {w.countsAsBusy ? "Blocks bookings as Busy" : "Doesn't block"}
                            </span>
                          </span>
                          <Switch
                            checked={w.countsAsBusy}
                            disabled={busy}
                            aria-label={`Count ${w.displayName ?? w.externalCalendarId} as busy`}
                            data-testid={`calendar-watched-toggle-${w.externalCalendarId}`}
                            onCheckedChange={(v) => toggleWatched(conn.id, conn.watchedCalendars, w.externalCalendarId, v)}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Put sessions on */}
      <section className="flex gap-8 mb-6 py-6 border-t border-line" data-testid="calendar-section-push">
        <div className="flex-none w-60">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Put sessions on</h2>
          <p className="m-0 mt-1 text-sm text-[var(--ink-muted)]">Where new sessions appear.</p>
        </div>
        <div className="flex-1 max-w-[480px]">
          {connections.length === 0 ? (
            <p className="m-0 text-xs text-[var(--ink-muted)]" data-testid="calendar-push-no-connection">
              Connect a calendar above to choose where new sessions are put.
            </p>
          ) : (
            <>
              {connections.map((conn) => (
                <div key={conn.id} className="mb-4">
                  <label className="flex flex-col gap-1.5 mb-3" data-testid={`calendar-push-field-${conn.id}`}>
                    <span className="text-sm font-medium text-[var(--ink)]">Calendar ({conn.externalAccount})</span>
                    <select
                      value={conn.pushCalendarId ?? ""}
                      disabled={busy}
                      data-testid={`calendar-push-select-${conn.id}`}
                      onChange={(e) => setPushTarget(conn.id, e.currentTarget.value)}
                      className="px-3 py-2 border border-line rounded-lg text-sm text-[var(--ink)]"
                    >
                      <option value="">Primary calendar</option>
                      {conn.watchedCalendars.map((w) => (
                        <option key={w.externalCalendarId} value={w.externalCalendarId}>
                          {w.displayName ?? w.externalCalendarId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="m-0 text-xs text-[var(--ink-muted)]" data-testid={`calendar-title-mode-${conn.id}`}>
                    {conn.eventTitleMode === "client_first_name"
                      ? "Session titles show the client's first name only."
                      : "Session titles show only that it is a session — no client name."}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </section>

      {/* Subscribe link */}
      <section className="flex gap-8 py-6 border-t border-line" data-testid="calendar-section-subscribe">
        <div className="flex-none w-60">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">Subscribe link</h2>
          <p className="m-0 mt-1 text-sm text-[var(--ink-muted)]">For Apple Calendar or anything else. Read-only.</p>
        </div>
        <div className="flex-1 max-w-[480px]">
          <div className="flex gap-3 mb-3">
            <input
              type="text"
              readOnly
              disabled
              value={subscribeLink ?? "Not available yet"}
              data-testid="calendar-subscribe-input"
              className="flex-1 px-3 py-2 border border-line rounded-lg text-sm text-[var(--ink-muted)]"
            />
            <button type="button" disabled className="px-4 py-2 bg-white border border-line rounded-lg text-sm font-medium text-[var(--ink-muted)]" data-testid="calendar-subscribe-copy">
              Copy
            </button>
          </div>
          <p className="m-0 text-xs text-[var(--ink-muted)]" data-testid="calendar-subscribe-note">
            This link is not available yet. Reset and copy will turn on once it is built.
          </p>
        </div>
      </section>

      <CalendarSettingsScreenCalendarDisconnectConfirm
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        busy={busy}
        problem={problem}
        disconnectTarget={disconnectTarget}
        confirmDisconnect={confirmDisconnect}
      />
    </div>
  );
}
