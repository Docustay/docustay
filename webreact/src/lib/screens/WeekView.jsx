// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 13.31 — THE WEEK CALENDAR (CalendarWeek family). specs/features/plans/STAGE-13-PLAN.md §13.31.
// Ported from webui/src/lib/screens/WeekView.svelte to React.
//
// ★★★ KEEPS THE EXPORT NAME AND THE PROPS `view, rows, timezone, onOpen, onNavigate` —
//     `db/gates/p21d_screens_real_rows.mjs:773-775` mounts this through REACT SSR
//     (`renderToStaticMarkup`), which never runs a React useEffect. So the FIRST paint has to be
//     fully derivable from PROPS ALONE — `rows` is that initial paint; the live, rich data comes
//     from `GET /api/engagements/calendar-range` once mounted for real in a browser (the useEffect
//     below, which the gate's SSR pass never reaches). `initialData` below is that seam.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useState } from "react";
import { AppStateContext } from "@/lib/app/useAppState.js";
import { weekDays, dayLengthMinutes, placeBooking, wallClock } from "@/lib/engagements/weekGrid.mjs";
import { request, api, ApiError } from "@/lib/api.js";
import { blockedResolver } from "@/lib/empty/blocked.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import { ButtonGroup } from "@/lib/components/ui/button-group.jsx";
import { NativeSelect, NativeSelectOption } from "@/lib/components/ui/native-select.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ProgramFilter, { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import { NO_PROGRAM_COLOUR } from "@/lib/programs/programs.js";
import CalendarSyncBanner from "./engagements/CalendarSyncBanner.jsx";
import CalendarMonthView from "./engagements/CalendarMonthView.jsx";
import CalendarTeamView from "./engagements/CalendarTeamView.jsx";
import BlockTimePopover from "./engagements/BlockTimePopover.jsx";
import HoursDialog from "./engagements/HoursDialog.jsx";
import CalendarMoveModal from "./engagements/CalendarMoveModal.jsx";
import CalendarFlagModal from "./engagements/CalendarFlagModal.jsx";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const VIEW_OPTIONS = [
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
  { key: "month", label: "Month" },
];

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * total minutes-from-midnight → "8am" / "5pm" — `CalendarTeamView`'s own function,
 * restated (not imported — that file exports no shared symbol for it).
 */
function hourLabel(h) {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function hhmm(instant, zone) {
  const w = wallClock(instant, zone);
  if (!w) return "";
  const hour12 = ((w.hour + 11) % 12) + 1;
  const ampm = w.hour < 12 ? "am" : "pm";
  return `${hour12}:${String(w.minute).padStart(2, "0")}${ampm}`;
}

function formatDollars(minor) {
  const dollars = Number(minor) / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

function firstNameOf(who) {
  const first = String(who ?? "").split(",")[0].trim();
  return first ? first.split(" ")[0] : "—";
}

/**
 * ★ mirrors `BlockTimePopover`'s own `zonedLocalToUtc` exactly — see file header.
 */
function zonedLocalToUtc(year, month, day, minutesFromMidnight, tz) {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let ts = wantedAsUtc;
  for (let i = 0; i < 2; i++) {
    const shown = wallClock(new Date(ts), tz);
    if (!shown) break;
    const shownAsUtc = Date.UTC(shown.y, shown.m - 1, shown.d, shown.hour, shown.minute, 0, 0);
    const drift = wantedAsUtc - shownAsUtc;
    if (drift === 0) break;
    ts += drift;
  }
  return new Date(ts);
}

export default function WeekView({ view, rows = [], timezone = null, onOpen = null, onNavigate = null }) {
  // ★ FOUND LIVE, 28 Sep 2026 — "Book someone" set the URL to `?book=1` on this same path and
  //   nothing ever read it back: this screen has no useSearchParams/URLSearchParams handling of
  //   `book` at all, so the click looked like it did nothing while the address bar changed. The
  //   real trigger for the shared BookSessionDialog is `app.bookOpen = true` — the exact mechanism
  //   Shell.jsx's own "New booking" nav row already uses (Shell.jsx:95). `useContext` (not the
  //   throwing `useAppState()`) because db/gates/p21d_screens_real_rows.mjs mounts this screen via
  //   `renderToStaticMarkup` with no `<AppStateContext.Provider>` above it — `app` is `null` there
  //   and the click handlers are never invoked in that pass, so this stays gate-safe.
  const app = useContext(AppStateContext);
  const openBookSomeone = () => { if (app) app.bookOpen = true; };

  // Navigation / View State
  const [anchor, setAnchor] = useState(new Date());
  const [viewMode, setViewMode] = useState("week");  // "week" | "day" | "month"
  const [hostFilter, setHostFilter] = useState("all");  // "all" | a host's app_user id
  const [programFilter, setProgramFilter] = useState("all");  // "all" | "none" | a program id

  // Data state
  const [liveData, setLiveData] = useState(null);
  const [phase, setPhase] = useState("ready");     // "loading" | "error" | "denied" | "ready"
  const [errorInfo, setErrorInfo] = useState(null);
  const [caps, setCaps] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [reloadToken, setReloadToken] = useState(0);

  // Modal states
  const [blockOpen, setBlockOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState(null);  // {open, booking, toStartsAt, toEndsAt, clash}
  const [flagTarget, setFlagTarget] = useState(null);  // {open, booking}
  const [draggingId, setDraggingId] = useState(null);

  const reload = () => setReloadToken((t) => t + 1);

  // Derive zone from liveData or timezone prop
  const zone = liveData?.timezone ?? timezone ?? null;

  // Derive days array
  const days = zone ? weekDays(anchor, zone) : [];

  // Get today's ISO date
  const todayISO = zone ? (wallClock(new Date(), zone)?.ymd ?? null) : null;

  // Derive month year for month view
  const monthYM = (() => {
    const w = zone ? wallClock(anchor, zone) : null;
    return { year: w?.y ?? anchor.getFullYear(), month: w?.m ?? anchor.getMonth() + 1 };
  })();

  // Derive range label
  const rangeLabel = (() => {
    if (!zone) return "";
    if (viewMode === "month") {
      return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(Date.UTC(monthYM.year, monthYM.month - 1, 1)));
    }
    return days.length ? `${days[0].label} – ${days[6].label}` : "";
  })();

  // Initial data from rows prop (for SSR)
  const initialData = {
    timezone, settings: null, hosts: [], days: [],
    bookings: (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r.id, hostId: r.host_id ?? null, startsAt: r.starts_at, endsAt: r.ends_at ?? null,
      state: r.state, serviceName: r.service_name ?? null, who: r.attendees ?? null,
      capacity: r.capacity ?? 1, taken: r.taken ?? 0,
      placesLeft: Math.max((r.capacity ?? 1) - (r.taken ?? 0), 0),
      locationKind: null, locationDetail: null, flag: null, flagNote: null, careNote: null,
      source: null, createdAt: null, isFree: false, consentOnFile: false,
    })),
    blocks: [], sync: { status: "none", brokenSince: null, lastSyncedAt: null },
  };

  const data = liveData ?? initialData;

  // Filter data by hostFilter
  const filteredData = (hostFilter === "all" && programFilter === "all") ? data : {
    ...data,
    hosts: hostFilter === "all" ? data.hosts : (data.hosts ?? []).filter((h) => h.id === hostFilter),
    bookings: (data.bookings ?? []).filter((b) =>
      (hostFilter === "all" || b.hostId === hostFilter) && matchesProgram(programFilter, b.programId)),
    // Blocks are not tied to a program — a program filter leaves them as they are.
    blocks: hostFilter === "all" ? data.blocks : (data.blocks ?? []).filter((bl) => bl.hostId === hostFilter),
  };

  // "Colour by" preference (served with the range); programs ride with it for the colour lookup.
  const colourBy = data.settings?.colourBy ?? "service";
  const programColourById = new Map((data.programs ?? []).map((p) => [p.id, p.colour || NO_PROGRAM_COLOUR]));
  const programColourFor = (programId) => (programId && programColourById.get(programId)) || NO_PROGRAM_COLOUR;

  const hostsById = new Map((data.hosts ?? []).map((h) => [h.id, h]));
  const blockHostId = hostFilter !== "all" ? hostFilter : (data.hosts?.[0]?.id ?? null);

  // Helper to determine range for API call
  function rangeFor(vm, anchorInstant, tz) {
    if (vm === "month") {
      const w = wallClock(anchorInstant, tz) ?? { y: anchorInstant.getUTCFullYear?.() ?? 1970, m: 1 };
      const daysInMonth = new Date(Date.UTC(w.y, w.m, 0)).getUTCDate();
      return { from: `${w.y}-${pad2(w.m)}-01`, to: `${w.y}-${pad2(w.m)}-${pad2(daysInMonth)}` };
    }
    const wd = weekDays(anchorInstant, tz);
    return { from: wd[0]?.ymd, to: wd[6]?.ymd };
  }

  // Fetch live data
  useEffect(() => {
    if (!timezone) return;
    let live = true;
    setPhase("loading");
    setErrorInfo(null);

    (async () => {
      try {
        const range = rangeFor(viewMode, anchor, timezone);
        const qs = new URLSearchParams({ from: range.from, to: range.to, hostId: "all" });
        const [cal, capsRes, promptsRes] = await Promise.all([
          request(`/api/engagements/calendar-range?${qs}`),
          api.capabilities().catch(() => null),
          api.prompts("calendar").catch(() => ({ prompts: [] })),
        ]);
        if (!live) return;
        setLiveData(cal);
        setCaps(capsRes);
        // ★ field 4 — "≤1", the server's own catalogue does not cap non-home surfaces (engine.mjs's
        //   own HOME_PROMPT_CEILING is `home`-only), so the client enforces the one-only bound here.
        setPrompts((promptsRes?.prompts ?? []).slice(0, 1));
        setPhase("ready");
      } catch (err) {
        if (!live) return;
        if (err instanceof ApiError && err.status === 403) {
          setPhase("denied");
          setErrorInfo(err);
        } else {
          setPhase("error");
          setErrorInfo(err instanceof ApiError
            ? { message: err.message, requestId: err.requestId }
            : { message: String(err?.message ?? err) });
        }
      }
    })();
    return () => { live = false; };
  }, [timezone, viewMode, anchor, reloadToken]);

  // Dismiss prompt
  async function dismissPromptNow(p) {
    try {
      await api.dismissPrompt(p.kind, p.subjectId ?? null);
      setPrompts((prev) => prev.filter((x) => x.dismissKey !== p.dismissKey));
    } catch {
      // ★ left on screen on failure — same idiom `OnlineBookingScreen`'s dismissPromptNow uses.
    }
  }

  // Check if blocked
  const blocked = caps?.checklist ? blockedResolver(caps.checklist)("/engagements/booking/settings") : false;

  const blockedEmptyBlock = {
    kind: "blocked", icon: "IconCalendar",
    headline: "Add a service first",
    line: "Nothing can be booked until there's something to book. A service is the thing someone " +
          "picks — its length, its price, and who can give it.",
    action: { label: "Add a service", href: "/items/services?new=1" },
  };

  /**
   * ★ `phase !== "ready"` wins outright; once ready, `blocked` is the ONE case this screen hides
   * the grid for — every other empty reading keeps the real 7-day grid on screen (see below).
   */
  const screenPhase = phase !== "ready" ? phase : (blocked ? "empty" : "ready");
  const deniedReason = phase === "denied" ? errorInfo?.message : null;

  const staffName = data.hosts?.find((h) => h.id === hostFilter)?.displayName ?? "them";

  // Calculate heights for bookings
  function heightPctFor(startsAt, endsAt, ymd, tz) {
    const dayLen = dayLengthMinutes(ymd, tz) || 1440;
    const w1 = wallClock(startsAt, tz);
    const w2 = wallClock(endsAt, tz);
    if (!w1 || !w2) return 3;
    const startMin = w1.hour * 60 + w1.minute;
    const endMin = w2.ymd === w1.ymd ? (w2.hour * 60 + w2.minute) : dayLen;
    const durationMin = Math.max(endMin - startMin, 15);
    return Math.max((durationMin / dayLen) * 100, 2.6);
  }

  // Get card text for a booking
  function cardTextFor(b) {
    const timeLabel = zone ? hhmm(b.startsAt, zone) : "";
    const isClass = Number(b.capacity) > 1;
    if (isClass) {
      if (Number(b.taken) === 0) {
        return { title: "Evening slot", subtitle: "New — nobody yet", tone: "session", timeLabel };
      }
      return {
        title: b.serviceName ?? "Class",
        subtitle: `${b.taken} people — ${b.placesLeft} places left`,
        tone: "session", timeLabel,
      };
    }
    const first = firstNameOf(b.who);
    let subtitle, tone = "session";
    if (b.state === "no_show") {
      subtitle = "Didn't turn up"; tone = "noshow";
    } else if (b.consentOnFile) {
      subtitle = "with consent on file";
    } else if (b.isFree) {
      subtitle = `${b.serviceName ?? "Session"} — free`;
    } else if (b.locationDetail) {
      // ★ field 8(a) — the price clause is APPENDED only when `priceMinor` is a number. Absent on a
      //   coach's payload (F05 §4, never `null`), so this renders the location alone, no "$".
      const price = typeof b.priceMinor === "number" ? ` — ${formatDollars(b.priceMinor)}` : "";
      subtitle = `${b.locationDetail}${price}`;
    } else if (b.locationKind === "video") {
      subtitle = "video call";
    } else {
      subtitle = b.serviceName ?? "Session";
    }
    return { title: first, subtitle, tone, timeLabel };
  }

  // Calculate placed bookings
  const placedBookings = (() => {
    if (!zone) return [];
    const out = [];
    for (const b of filteredData.bookings ?? []) {
      if (b.state === "cancelled") continue;
      const at = placeBooking(b.startsAt, zone, days);
      if (!at) continue;
      out.push({ kind: "booking", id: b.id, key: `b-${b.id}`, at, programId: b.programId ?? null,
        heightPct: heightPctFor(b.startsAt, b.endsAt, at.ymd, zone), ...cardTextFor(b) });
    }
    return out;
  })();

  // Calculate unfiltered placed bookings (for empty state determination)
  const placedBookingsUnfiltered = (() => {
    if (!zone) return [];
    let n = 0;
    for (const b of data.bookings ?? []) {
      if (b.state === "cancelled") continue;
      if (placeBooking(b.startsAt, zone, days)) n++;
    }
    return n;
  })();

  // Calculate placed blocks
  const placedBlocks = (() => {
    if (!zone) return [];
    const out = [];
    for (const bl of filteredData.blocks ?? []) {
      const at = placeBooking(bl.startsAt, zone, days);
      if (!at) continue;
      out.push({ kind: "block", id: bl.id, key: `k-${bl.id}`, at,
        heightPct: heightPctFor(bl.startsAt, bl.endsAt, at.ymd, zone), label: bl.label });
    }
    return out;
  })();

  const placedAll = [...placedBookings, ...placedBlocks];

  function itemsForDay(i) {
    return placedAll.filter((p) => p.at.dayIndex === i).sort((a, b) => a.at.minuteOfDay - b.at.minuteOfDay);
  }

  const countByDay = (() => {
    const m = [0, 0, 0, 0, 0, 0, 0];
    for (const p of placedBookings) m[p.at.dayIndex]++;
    return m;
  })();

  const emptyKind = (() => {
    if (blocked) return null; // handled by screenPhase="empty" instead
    if (placedBookings.length > 0) return null;
    if ((hostFilter !== "all" || programFilter !== "all") && placedBookingsUnfiltered > 0) return "filtered";
    return "first-run";
  })();

  // Navigation step
  function step(dir) {
    // ★ stepping in Day view would move a fetch window nothing on screen actually honours.
    if (viewMode === "day") return;
    if (viewMode === "month") {
      setAnchor(new Date(Date.UTC(monthYM.year, monthYM.month - 1 + dir, 15, 12)));
    } else {
      setAnchor(new Date(anchor.getTime() + dir * 7 * 86_400_000));
    }
  }

  // Drag handlers
  function handleDragStart(e, id) {
    setDraggingId(id);
    e.dataTransfer?.setData("text/plain", String(id));
  }

  function handleDrop(e, dayIndex) {
    e.preventDefault();
    const id = draggingId;
    setDraggingId(null);
    if (!id || !zone) return;
    const b = (filteredData.bookings ?? []).find((x) => x.id === id);
    const day = days[dayIndex];
    if (!b || !day) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const dayLen = dayLengthMinutes(day.ymd, zone) || 1440;
    let minute = Math.round(((offsetY / Math.max(rect.height, 1)) * dayLen) / 15) * 15;
    minute = Math.min(Math.max(minute, 0), Math.max(dayLen - 15, 0));
    const [y, m, d] = day.ymd.split("-").map(Number);
    const toStartsAt = zonedLocalToUtc(y, m, d, minute, zone);
    const durationMs = new Date(b.endsAt).getTime() - new Date(b.startsAt).getTime();
    const toEndsAt = new Date(toStartsAt.getTime() + (Number.isFinite(durationMs) ? durationMs : 50 * 60_000));
    const host = hostsById.get(b.hostId);
    setMoveTarget({
      open: true,
      booking: { id: b.id, personFirstName: firstNameOf(b.who), fromStartsAt: b.startsAt,
                 hostName: host?.displayName ?? `this coach` },
      toStartsAt: toStartsAt.toISOString(), toEndsAt: toEndsAt.toISOString(), clash: null,
    });
  }

  function openFlag(item) {
    const b = (filteredData.bookings ?? []).find((x) => x.id === item.id);
    if (!b) return;
    setFlagTarget({ open: true, booking: { id: b.id, personName: b.who, startsAt: b.startsAt } });
  }

  // Render
  if (!timezone) {
    return (
      <section className="w-full" data-testid="week-view" data-zone="none">
        <header className="mb-4.5">
          <h1 className="m-0 text-page-title font-medium text-ink">{view?.title ?? "Calendar"}</h1>
        </header>
        <p className="text-ui text-mute" data-testid="week-no-zone">
          This practice has no timezone set, so a week cannot be drawn without guessing which day a
          session falls on. Set it in Settings → Practice and this becomes a calendar.
        </p>
      </section>
    );
  }

  // When comparing old and new items in a list, React uses the "key" to determine
  // which DOM node corresponds to which item. When we render the "week" view, we render
  // the grid content directly. For other views (day/month), we delegate to those components.
  const dayColumnsContent = viewMode === "week" ? (
    <div className="grid grid-cols-[62px_repeat(7,1fr)] rounded-card border border-line bg-surface" data-testid="week-grid">
      <div className="h-11 border-b border-line"></div>
      {days.map((d, i) => (
        <div
          key={d.ymd}
          className={`flex h-11 flex-col justify-center border-b border-l border-hair pl-2.5 ${d.ymd === todayISO ? "bg-brand-soft" : ""}`}
          data-testid={`week-dayhead-${i}`}
        >
          <b className={`text-control font-medium ${d.ymd === todayISO ? "text-brand" : "text-ink"}`}>{d.label}</b>
          {countByDay[i] > 0 && <span className="text-[11.5px] text-mute">{countByDay[i]} booked</span>}
        </div>
      ))}

      <div className="flex flex-col" aria-hidden="true">
        {HOURS.map((h) => (
          <div key={h} className="h-13 pt-1 pr-2 text-right text-[11.5px] text-mute">{hourLabel(h)}</div>
        ))}
      </div>
      {days.map((d, i) => (
        <div
          key={d.ymd}
          className="relative h-[1248px] border-l border-hair bg-[repeating-linear-gradient(to_bottom,transparent,transparent_51px,var(--color-hair)_51px,var(--color-hair)_52px)]"
          data-testid={`week-day-${i}`}
          data-ymd={d.ymd}
          onDragOver={(e) => { if (draggingId) e.preventDefault(); }}
          onDrop={(e) => handleDrop(e, i)}
        >
          {itemsForDay(i).map((item) => (
            item.kind === "block" ? (
              <div
                key={item.key}
                className="absolute inset-[3px_5px] overflow-hidden rounded-[7px] bg-[repeating-linear-gradient(45deg,#F4F5F8,#F4F5F8_6px,#EDEFF3_6px,#EDEFF3_12px)] px-2 py-1.25 text-[11.5px] leading-tight text-ink-2"
                data-testid={`week-block-${item.id}`}
                style={{ top: `${item.at.topPct}%`, height: `${item.heightPct}%` }}
              >
                <b className="block font-medium">Blocked</b>{item.label}
              </div>
            ) : (
              <div
                key={item.key}
                className={`absolute inset-[3px_5px] overflow-hidden rounded-[7px] border-l-[3px] px-2 py-1.25 text-[11.5px] leading-tight cursor-pointer ${
                  item.tone === "noshow"
                    ? "bg-warm-bg text-warn border-l-warm-border"
                    : "bg-brand-soft text-[#3B3A6B] border-l-brand"
                }`}
                role="button"
                tabIndex="0"
                data-testid={`week-event-${item.id}`}
                draggable="true"
                onDragStart={(e) => handleDragStart(e, item.id)}
                onClick={() => onOpen?.(view?.recordType ?? "booking", item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen?.(view?.recordType ?? "booking", item.id);
                  }
                }}
                style={{
                  top: `${item.at.topPct}%`, height: `${item.heightPct}%`,
                  ...(colourBy === "program" && item.tone !== "noshow"
                    ? { borderLeftColor: programColourFor(item.programId),
                        backgroundColor: `color-mix(in srgb, ${programColourFor(item.programId)} 16%, white)` }
                    : null),
                }}
                data-program-id={item.programId ?? undefined}
                title={`${item.timeLabel} · ${item.title}`}
                aria-label={`${item.title} — ${item.subtitle}`}
              >
                <span className="block font-medium">{item.title}</span>
                <span className="block">{item.subtitle}</span>
                <button
                  type="button"
                  className="absolute right-1 top-1 text-current opacity-60 hover:opacity-100"
                  data-testid={`week-event-flag-${item.id}`}
                  aria-label="Flag this session"
                  onClick={(e) => { e.stopPropagation(); openFlag(item); }}
                >
                  ⋯
                </button>
              </div>
            )
          ))}
        </div>
      ))}
    </div>
  ) : null;

  const emptyContent = emptyKind === "first-run" ? (
    <div data-testid="week-empty-firstrun">
      <EmptyState
        kind="first-run"
        icon="IconCalendar"
        headline="Nothing booked this week"
        line="Your booking page is live. Nobody has picked a time yet."
        action={{ label: "Book someone", onClick: openBookSomeone }}
        testId="week-empty-firstrun-state"
        onNavigate={onNavigate}
      />
    </div>
  ) : emptyKind === "filtered" ? (
    <div data-testid="week-empty-filtered">
      <EmptyState
        kind="filtered"
        headline={hostFilter !== "all" ? `Nothing for ${staffName} this week` : "Nothing in this program this week"}
        line="Try another week, or clear the filter to see everyone."
        onClearFilters={() => { setHostFilter("all"); setProgramFilter("all"); }}
        testId="week-empty-filtered-state"
        onNavigate={onNavigate}
      />
    </div>
  ) : null;

  return (
    <section
      className="w-full"
      data-testid="week-view"
      data-zone={zone}
      data-rows={data.bookings?.length ?? 0}
      data-placed={placedBookings.length}
    >
      <header className="mb-4.5 flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 mr-2 text-page-title font-medium text-ink">{view?.title ?? "Calendar"}</h1>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex size-(--size-control-sm) items-center justify-center rounded-sm border border-line bg-surface text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            data-testid="week-prev"
            aria-label="Previous"
            disabled={viewMode === "day"}
            title={viewMode === "day" ? "Day view always shows today" : null}
            onClick={() => step(-1)}
          >
            ‹
          </button>
          <span className="mx-1.5 text-control font-medium text-ink" data-testid="week-range">{rangeLabel}</span>
          <button
            type="button"
            className="flex size-(--size-control-sm) items-center justify-center rounded-sm border border-line bg-surface text-ink-2 hover:bg-surface-2 disabled:opacity-50"
            data-testid="week-next"
            aria-label="Next"
            disabled={viewMode === "day"}
            title={viewMode === "day" ? "Day view always shows today" : null}
            onClick={() => step(1)}
          >
            ›
          </button>
        </div>

        <ButtonGroup data-testid="week-view-select" aria-label="Calendar view">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`inline-flex h-(--size-control-sm) items-center justify-center border border-line px-3.25 text-control font-medium ${viewMode === opt.key ? "bg-brand text-white border-brand" : "bg-surface text-ink-2 hover:bg-surface-2"}`}
              data-testid={`week-view-${opt.key}`}
              aria-pressed={viewMode === opt.key}
              onClick={() => { setViewMode(opt.key); }}
            >
              {opt.label}
            </button>
          ))}
        </ButtonGroup>

        <NativeSelect
          data-testid="week-staff-filter"
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
          aria-label="Staff"
        >
          <NativeSelectOption value="all">Everyone</NativeSelectOption>
          {(data.hosts ?? []).map((h) => (
            <NativeSelectOption key={h.id} value={h.id}>{h.displayName}</NativeSelectOption>
          ))}
        </NativeSelect>

        <ProgramFilter value={programFilter} onChange={setProgramFilter} testId="week-program-filter" />

        <button
          type="button"
          className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
          data-testid="week-block-time"
          disabled={!blockHostId}
          title={blockHostId ? null : "No staff to block time for"}
          onClick={() => { setBlockOpen(true); }}
        >
          Block time
        </button>

        <button
          type="button"
          className="inline-flex h-(--size-control-sm) items-center justify-center gap-2 rounded-sm border border-brand bg-brand px-3.25 text-control font-medium text-white hover:bg-brand/90"
          data-testid="week-book-someone"
          onClick={openBookSomeone}
        >
          Book someone
        </button>

        <details className="relative" data-testid="week-overflow">
          <summary className="flex size-(--size-control-sm) cursor-pointer list-none items-center justify-center rounded-sm border border-line bg-surface text-ink-2 hover:bg-surface-2" aria-label="More">⋯</summary>
          <div className="absolute right-0 z-10 mt-1 rounded-card border border-line bg-surface p-1.5 shadow-md">
            <button
              type="button"
              className="inline-flex h-(--size-control-sm) w-full items-center justify-center gap-2 whitespace-nowrap rounded-sm border border-line bg-surface px-3.25 text-control font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50"
              data-testid="week-hours"
              disabled={!blockHostId}
              title={blockHostId ? null : "No staff to set hours for"}
              onClick={() => { setHoursOpen(true); }}
            >
              Working hours
            </button>
          </div>
        </details>
      </header>

      <CalendarSyncBanner
        data={data}
        onNavigate={onNavigate}
        onOpen={(bookingId) => onOpen?.(view?.recordType ?? "booking", bookingId)}
      />

      {viewMode === "month" && (
        <CalendarMonthView
          data={filteredData}
          year={monthYM.year}
          month={monthYM.month}
          phase={screenPhase}
          empty={blockedEmptyBlock}
          error={errorInfo}
          reason={deniedReason}
          onNavigate={onNavigate}
        />
      )}

      {viewMode === "day" && (
        <CalendarTeamView
          data={filteredData}
          phase={screenPhase}
          empty={blockedEmptyBlock}
          error={errorInfo}
          reason={deniedReason}
          onNavigate={onNavigate}
        />
      )}

      {viewMode === "week" && (
        <ScreenState
          phase={screenPhase}
          empty={blockedEmptyBlock}
          error={errorInfo}
          reason={deniedReason}
          onClearFilters={() => { setHostFilter("all"); setProgramFilter("all"); }}
          onNavigate={onNavigate}
          testIds={{ loading: "week-loading", error: "week-error", denied: "week-denied", empty: "week-empty-blocked" }}
        >
          {dayColumnsContent}
          {emptyContent}
        </ScreenState>
      )}

      {prompts.length > 0 && (
        <div className="mt-4.5 flex flex-col gap-2.5" data-testid="week-prompts">
          {prompts.map((p) => (
            <PromptCard
              key={p.dismissKey}
              icon={p.icon}
              tone={p.tone}
              headline={p.headline}
              why={p.why}
              action={p.action}
              kind={p.kind}
              onDismiss={() => dismissPromptNow(p)}
              testId={`week-prompt-${p.dismissKey}`}
            />
          ))}
        </div>
      )}

      <BlockTimePopover
        open={blockOpen}
        hostId={blockHostId}
        timeZone={zone}
        onOpenChange={setBlockOpen}
        onClose={() => { setBlockOpen(false); }}
        onBlocked={() => { setBlockOpen(false); reload(); }}
      />
      <HoursDialog
        open={hoursOpen}
        hostId={blockHostId}
        onOpenChange={setHoursOpen}
        onClose={() => { setHoursOpen(false); }}
        onSaved={() => { setHoursOpen(false); reload(); }}
      />

      {moveTarget && (
        <CalendarMoveModal
          open={moveTarget.open}
          booking={moveTarget.booking}
          toStartsAt={moveTarget.toStartsAt}
          toEndsAt={moveTarget.toEndsAt}
          clash={moveTarget.clash}
          timezone={zone}
          onOpenChange={(open) => { if (!open) setMoveTarget(null); else setMoveTarget({...moveTarget, open}); }}
          onClose={() => { setMoveTarget(null); }}
          onMoved={() => { setMoveTarget(null); reload(); }}
        />
      )}
      {flagTarget && (
        <CalendarFlagModal
          open={flagTarget.open}
          booking={flagTarget.booking}
          timezone={zone}
          onOpenChange={(open) => { if (!open) setFlagTarget(null); else setFlagTarget({...flagTarget, open}); }}
          onClose={() => { setFlagTarget(null); }}
          onFlagged={() => { setFlagTarget(null); reload(); }}
        />
      )}
    </section>
  );
}
