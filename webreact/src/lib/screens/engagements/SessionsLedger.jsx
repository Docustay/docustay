// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SessionsLedger — build from specs/mockups/SessionsList.frame.html on LedgerPage.
// Props: { view, onNavigate, onDone } — view is ALREADY-FETCHED list response.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { useContext, useState, useEffect, lazy, Suspense } from "react";
import { AppStateContext } from "@/lib/app/useAppState.js";
import { request, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import ExportMenu from "@/lib/lists/ExportMenu.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import { wallClock } from "@/lib/engagements/weekGrid.mjs";
import useListBulk from "@/lib/lists/useListBulk.jsx";

// R5.021.T1 — lazy-loaded since it's built separately
const SessionsLedgerSessionsLedgerTable = lazy(() =>
  import("./SessionsLedgerSessionsLedgerTable.jsx").catch(() => ({
    default: () => <div data-testid="sessions-ledger-table-mock" className="text-mute">Table will render once the subtask is built</div>
  }))
);

// R5.021.M1 — lazy-loaded since it's built separately
const SessionsLedgerSessionsCancelModal = lazy(() =>
  import("./SessionsLedgerSessionsCancelModal.jsx").catch(() => ({
    default: () => null
  }))
);

// R5.021.M2 — lazy-loaded since it's built separately
const SessionsLedgerReassignModal = lazy(() => import("./SessionsLedgerReassignModal.jsx"));
const SessionsLedgerModal2Modal = lazy(() =>
  import("./SessionsLedgerModal2Modal.jsx").catch(() => ({
    default: () => null
  }))
);

// CalendarFlagModal import
const CalendarFlagModal = lazy(() =>
  import("./CalendarFlagModal.jsx").catch(() => ({
    default: ({ onFlagged }) => { onFlagged?.(); return null; }
  }))
);

export default function SessionsLedger({ view = null, onNavigate = null, onDone = null }) {
  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  // ★ FOUND LIVE, 28 Sep 2026 — same defect as WeekView.jsx's "Book someone": this navigated to
  //   "/engagements/sessions?book=1", a query param nothing in the app ever reads. The real trigger
  //   for the shared BookSessionDialog is app.bookOpen = true (Shell.jsx:95). useContext, not the
  //   throwing useAppState(), so a no-provider mount stays safe rather than crashing.
  const app = useContext(AppStateContext);
  const openBookSomeone = () => { if (app) app.bookOpen = true; };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE FETCH PHASE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const phase = (() => {
    if (view == null) return "loading";
    if (view.denied) return "denied";
    if (view.error) return "error";
    return "ready";
  })();

  const rows = view?.rows ?? [];
  const columns = view?.columns ?? [];
  const timezone = view?.timezone ?? "UTC";

  // ─── the "When" column and time-window filter, wall-clock, never a bare stored UTC ─────────────
  const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function whenLabel(instant) {
    const w = wallClock(instant, timezone);
    if (!w) return "—";
    const hour12 = ((w.hour + 11) % 12) + 1;
    const minute = String(w.minute).padStart(2, "0");
    const ampm = w.hour < 12 ? "am" : "pm";
    return `${WEEKDAY_ABBR[w.weekday]} ${w.d}, ${hour12}:${minute}${ampm}`;
  }

  // ─── the state-chip tone map — this task's own field 4 tuple, verbatim ─────────────────────────
  const STATE_TONE = {
    "Confirmed": "neutral",
    "Done": "ok",
    "Consent unsigned": "warn",
    "Didn't show": "bad",
    "Free": "ok",
    "Cancelled": "neutral",
  };
  function stateTone(label) {
    if (STATE_TONE[label] !== undefined) return STATE_TONE[label];
    if (/^Group reset/.test(String(label))) return "act";
    return "neutral";
  }

  // ─── the summary sentence ─────────────────────────────────────────────────────────────────────
  const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  function numberText(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return String(n ?? "0");
    if (Number.isInteger(n) && n >= 0 && n <= 10) return NUMBER_WORDS[n];
    return String(n);
  }
  const summaryText = (() => {
    const s = view?.summary ?? null;
    if (!s) return null;
    const clauses = [];
    if (s.noShows) clauses.push(`${numberText(s.noShows)} no-show${s.noShows === 1 ? "" : "s"}`);
    if (s.unsignedConsent) {
      clauses.push(`${numberText(s.unsignedConsent)} unsigned consent${s.unsignedConsent === 1 ? "" : "s"}`);
    }
    const first = `${numberText(s.thisWeek)} this week.`;
    if (!clauses.length) return first;
    return `${first} ${clauses.join(" and ")}.`;
  })();

  // ─── view tabs ─────────────────────────────────────────────────────────────────────────────────
  const VIEWS = [
    { key: "coming-up", label: "Coming up" },
    { key: "today", label: "Today" },
    { key: "past", label: "Past" },
    { key: "cancelled", label: "Cancelled" },
    { key: "no-shows", label: "No-shows" },
  ];
  const [activeView, setActiveView] = useState("coming-up");

  function inBucket(row, key, nowMs) {
    const startsMs = new Date(row.starts_at).getTime();
    if (key === "coming-up") return row.state !== "cancelled" && startsMs >= nowMs;
    if (key === "today") {
      const a = wallClock(row.starts_at, timezone);
      const b = wallClock(new Date(nowMs), timezone);
      return !!a && !!b && a.ymd === b.ymd;
    }
    if (key === "past") return row.state !== "cancelled" && startsMs < nowMs;
    if (key === "cancelled") return row.state === "cancelled";
    if (key === "no-shows") return row.state === "no_show";
    return true;
  }

  // ─── filter pills ──────────────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [whenFilter, setWhenFilter] = useState("all");
  const [whoFilter, setWhoFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [programFilter, setProgramFilter] = useState("all");

  function distinctValues(field) {
    const set = new Set();
    for (const r of rows) if (r[field]) set.add(r[field]);
    return Array.from(set).sort();
  }
  const whoValues = distinctValues("who");
  const serviceValues = distinctValues("service_name");
  const staffValues = distinctValues("host_name");
  const locationValues = distinctValues("where_label");
  const stateValues = distinctValues("state_label");

  const isFiltered = search.trim() !== "" || whenFilter !== "all" || whoFilter !== "all" ||
    serviceFilter !== "all" || staffFilter !== "all" || locationFilter !== "all" || stateFilter !== "all" || programFilter !== "all";

  function clearFilters() {
    setSearch("");
    setWhenFilter("all");
    setWhoFilter("all");
    setServiceFilter("all");
    setStaffFilter("all");
    setLocationFilter("all");
    setStateFilter("all");
    setProgramFilter("all");
  }

  const filtered = (() => {
    const nowMs = Date.now();
    let r = rows.filter((row) => inBucket(row, activeView, nowMs));
    const q = search.trim().toLowerCase();
    if (q) {
      r = r.filter((row) =>
        [row.who, row.service_name, row.host_name, row.where_label]
          .some((v) => String(v ?? "").toLowerCase().includes(q)));
    }
    if (whenFilter === "week") {
      r = r.filter((row) => {
        const t = new Date(row.starts_at).getTime();
        return t >= nowMs && t <= nowMs + 7 * 86_400_000;
      });
    }
    if (whoFilter !== "all") r = r.filter((row) => row.who === whoFilter);
    if (serviceFilter !== "all") r = r.filter((row) => row.service_name === serviceFilter);
    if (staffFilter !== "all") r = r.filter((row) => row.host_name === staffFilter);
    if (locationFilter !== "all") r = r.filter((row) => row.where_label === locationFilter);
    if (stateFilter !== "all") r = r.filter((row) => row.state_label === stateFilter);
    if (programFilter !== "all") r = r.filter((row) => matchesProgram(programFilter, row.program_id));
    return r;
  })();

  const bulk = useListBulk({ app, path: "/engagements/sessions", rank: app?.nav?.rank, rows: filtered, onChanged: onDone });

  const displayPhase = phase === "ready" && filtered.length === 0 ? "empty" : phase;

  function emptyPropFor() {
    if (isFiltered) {
      return {
        kind: "filtered",
        headline: "Nothing matches these filters",
        line: "Try different filters or clear them.",
        action: null,
      };
    }
    return view?.emptyState ?? { kind: "first-run", headline: "No sessions yet", line: "", action: null };
  }

  // ─── export (currently visible/filtered rows) ──────────────────────────────────────────────────
  const EXPORT_FORMATS = [
    { key: "csv", label: "CSV", includes: "When, who, what, with, where and state, for the rows currently shown." },
  ];
  function exportFiltered(key) {
    if (key !== "csv") return;
    const cols = ["starts_at", "who", "service_name", "host_name", "where_label", "state_label"];
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...filtered.map((r) => cols.map((c) => escape(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sessions-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Cancel — DecisionModal ────────────────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  useEffect(() => {
    if (!cancelOpen) setCancelTarget(null);
  }, [cancelOpen]);

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await request("/api/engagements/bookings/cancel", {
        method: "POST",
        body: { bookingId: cancelTarget.id },
      });
      setCancelOpen(false);
      onDone?.();
    } catch (err) {
      setCancelError(err instanceof ApiError
        ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
        : String(err?.message ?? err));
    } finally {
      setCancelBusy(false);
    }
  }

  // ─── Mark attendance ──────────────────────────────────────────────────────────────────────────
  const [attendanceTarget, setAttendanceTarget] = useState(null);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  function openAttendance(row) {
    setAttendanceTarget({ id: row.id, state: row.state });
    setAttendanceOpen(true);
  }
  function onAttendanceDone() {
    setAttendanceOpen(false);
    onDone?.();
  }

  // ─── Flag ──────────────────────────────────────────────────────────────────────────────────────
  const [flagTarget, setFlagTarget] = useState(null);
  const [flagOpen, setFlagOpen] = useState(false);
  function openFlag(row) {
    setFlagTarget({ id: row.id, personName: row.who, startsAt: row.starts_at });
    setFlagOpen(true);
  }
  function onFlagged() {
    setFlagOpen(false);
    onDone?.();
  }

  // ─── Move to another person / add a person ───────────────────────────────────────────────────────
  const [peopleTarget, setPeopleTarget] = useState(null);   // { mode, booking }
  const [peopleOpen, setPeopleOpen] = useState(false);
  function openPeople(mode, row) { setPeopleTarget({ mode, booking: row }); setPeopleOpen(true); }

  function rowActions(row) {
    return [
      { id: "open", label: "Open", onRun: () => go(`/record/booking/${row.id}`) },
      { id: "move", label: "Move", onRun: () => go("/engagements/calendar") },
      {
        id: "cancel", label: "Cancel", destructive: true,
        onRun: () => { setCancelTarget(row); setCancelError(null); setCancelOpen(true); },
      },
      { id: "attendance", label: "Mark attendance", onRun: () => openAttendance(row) },
      { id: "flag", label: "Flag", onRun: () => openFlag(row) },
      { id: "reassign", label: "Move to someone else", onRun: () => openPeople("reassign", row) },
      { id: "attendee", label: "Add someone", onRun: () => openPeople("attendee", row) },
    ];
  }

  // ─── Render controls ──────────────────────────────────────────────────────────────────────────
  const controls = displayPhase === "ready" ? (
    <>
      <Input
        className="min-w-52 max-w-72"
        placeholder="Search"
        data-testid="sessions-search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="sessions-filter-when"
        value={whenFilter}
        onChange={(e) => setWhenFilter(e.target.value)}
      >
        <option value="all">When: All</option>
        <option value="week">When: This week</option>
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="sessions-filter-who"
        value={whoFilter}
        onChange={(e) => setWhoFilter(e.target.value)}
      >
        <option value="all">Who: All</option>
        {whoValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="sessions-filter-service"
        value={serviceFilter}
        onChange={(e) => setServiceFilter(e.target.value)}
      >
        <option value="all">Service: All</option>
        {serviceValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="sessions-filter-staff"
        value={staffFilter}
        onChange={(e) => setStaffFilter(e.target.value)}
      >
        <option value="all">Staff: All</option>
        {staffValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="sessions-filter-location"
        value={locationFilter}
        onChange={(e) => setLocationFilter(e.target.value)}
      >
        <option value="all">Location: All</option>
        {locationValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <ProgramFilter value={programFilter} onChange={setProgramFilter} testId="sessions-filter-program" />
      <select
        className="h-8 rounded-lg border border-input bg-surface px-2.5 py-1 text-base text-ink outline-none"
        data-testid="sessions-filter-state"
        value={stateFilter}
        onChange={(e) => setStateFilter(e.target.value)}
      >
        <option value="all">State: All</option>
        {stateValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <div className="flex-1"></div>
      <ExportMenu formats={EXPORT_FORMATS} onExport={exportFiltered} testId="sessions-export" />
    </>
  ) : null;

  return (
    <LedgerPage
      title={view?.title ?? "Sessions"}
      summary={(displayPhase === "ready" || displayPhase === "empty") ? summaryText : null}
      primary={{ label: "Book someone", onClick: openBookSomeone }}
      views={VIEWS}
      activeView={activeView}
      onView={(k) => setActiveView(k)}
      controls={controls}
      testId="sessions-ledger"
    >
      <ScreenState
        phase={displayPhase}
        error={phase === "error" ? view?.error : null}
        reason={phase === "denied" ? (view?.error?.message ?? view?.reason ?? null) : null}
        empty={emptyPropFor()}
        onClearFilters={clearFilters}
        onNavigate={go}
      >
        {displayPhase === "ready" && (
          <Suspense fallback={<div data-testid="sessions-ledger-table-loading" className="text-mute">Loading table...</div>}>
            {bulk.bulkBar}
            <SessionsLedgerSessionsLedgerTable
              bulk={bulk}
              view={view}
              onNavigate={onNavigate}
              go={go}
              phase={phase}
              columns={columns}
              whenLabel={whenLabel}
              stateTone={stateTone}
              summaryText={summaryText}
              VIEWS={VIEWS}
              activeView={activeView}
              clearFilters={clearFilters}
              filtered={filtered}
              displayPhase={displayPhase}
              emptyPropFor={emptyPropFor}
              rowActions={rowActions}
            />
          </Suspense>
        )}
      </ScreenState>

      {cancelTarget && (
        <Suspense fallback={null}>
          <SessionsLedgerSessionsCancelModal
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            rows={[{ headline: "This frees the slot", detail: "Anyone waiting for this time is offered it automatically." }]}
            whenLabel={whenLabel}
            cancelTarget={cancelTarget}
            cancelBusy={cancelBusy}
            cancelError={cancelError}
            confirmCancel={confirmCancel}
          />
        </Suspense>
      )}

      {attendanceTarget && (
        <Suspense fallback={null}>
          <SessionsLedgerModal2Modal
            open={attendanceOpen}
            onOpenChange={setAttendanceOpen}
            onDone={onDone}
            attendanceTarget={attendanceTarget}
            onAttendanceDone={onAttendanceDone}
          />
        </Suspense>
      )}

      {peopleTarget && (
        <Suspense fallback={null}>
          <SessionsLedgerReassignModal open={peopleOpen} onOpenChange={setPeopleOpen} mode={peopleTarget.mode} booking={peopleTarget.booking} onDone={onDone} />
        </Suspense>
      )}

      {flagTarget && (
        <Suspense fallback={null}>
          <CalendarFlagModal
            open={flagOpen}
            onOpenChange={setFlagOpen}
            booking={flagTarget}
            timezone={timezone}
            onFlagged={onFlagged}
          />
        </Suspense>
      )}
    </LedgerPage>
  );
}
