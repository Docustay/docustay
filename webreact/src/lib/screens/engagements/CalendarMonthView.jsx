import { Badge } from "@/lib/components/ui/badge.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { wallClock } from "@/lib/engagements/weekGrid.mjs";

export default function CalendarMonthView({
  data = null,
  year,
  month,
  phase = "ready",
  empty = null,
  error = null,
  reason = null,
  onNavigate = null,
  now = new Date(),
}) {
  const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAY_LONG = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const NUMBER_WORDS = [
    null,
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];

  function numberWord(n) {
    return n >= 1 && n <= 12 ? NUMBER_WORDS[n] : String(n);
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function weekStartIdx() {
    const w = data?.settings?.weekStarts;
    return Number.isInteger(w) && w >= 0 && w <= 6 ? w : 1; // default Monday
  }

  const columns = Array.from({ length: 7 }, (_, i) =>
    (weekStartIdx() + i) % 7
  );

  const monthLabel =
    year && month
      ? new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
          month: "long",
          timeZone: "UTC",
        })
      : "";

  // THE GRID — pure calendar-date arithmetic, UTC-epoch day numbers
  const grid = (() => {
    if (!year || !month) return [];
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun..6=Sat
    const leading = (firstDow - weekStartIdx() + 7) % 7;
    const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayOfMonth = i - leading + 1;
      if (dayOfMonth >= 1 && dayOfMonth <= daysInMonth) {
        const dt = new Date(Date.UTC(year, month - 1, dayOfMonth));
        cells.push({
          date: `${year}-${pad2(month)}-${pad2(dayOfMonth)}`,
          dayOfMonth,
          dow: dt.getUTCDay(),
          inMonth: true,
        });
      } else {
        cells.push({
          date: null,
          dayOfMonth: null,
          dow: null,
          inMonth: false,
        });
      }
    }
    return cells;
  })();

  const dayMap = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const hostsById = new Map((data?.hosts ?? []).map((h) => [h.id, h]));
  const timezone = data?.timezone ?? "UTC";

  const bookingsByDate = (() => {
    const m = new Map();
    for (const b of data?.bookings ?? []) {
      if (b.state === "cancelled") continue;
      const w = wallClock(b.startsAt, timezone);
      if (!w) continue;
      if (!m.has(w.ymd)) m.set(w.ymd, []);
      m.get(w.ymd).push(b);
    }
    return m;
  })();

  const blocksByDate = (() => {
    const m = new Map();
    for (const bl of data?.blocks ?? []) {
      const w = wallClock(bl.startsAt, timezone);
      if (!w) continue;
      if (!m.has(w.ymd)) m.set(w.ymd, []);
      m.get(w.ymd).push(bl);
    }
    return m;
  })();

  const todayISO = wallClock(now, timezone)?.ymd ?? null;

  function chipsFor(date) {
    if (!date) return [];
    const chips = [];
    const count = dayMap.get(date)?.bookedCount ?? 0;
    if (count > 0)
      chips.push({
        kind: "count",
        text: `${count} session${count === 1 ? "" : "s"}`,
      });
    const dayBookings = bookingsByDate.get(date) ?? [];
    const classNames = [...new Set(
      dayBookings
        .filter((b) => Number(b.capacity) > 1 && b.serviceName)
        .map((b) => b.serviceName)
    )];
    for (const name of classNames) chips.push({ kind: "class", text: name });
    for (const bl of blocksByDate.get(date) ?? []) {
      const host = hostsById.get(bl.hostId);
      const hostName = host?.displayName ?? "Someone";
      const isAway =
        String(bl.label ?? "").trim().toLowerCase() === "away";
      chips.push(
        isAway
          ? { kind: "away", text: `${hostName} away` }
          : { kind: "blocked", text: `Blocked — ${bl.label}` }
      );
    }
    return chips;
  }

  // THE HEADER SENTENCE
  const totalSessions = (() => {
    let total = 0;
    for (const cell of grid) {
      if (!cell.inMonth) continue;
      total += dayMap.get(cell.date)?.bookedCount ?? 0;
    }
    return total;
  })();

  const emptyWeekdayClause = (() => {
    const weeksEmptyByDow = Array(7).fill(0);
    for (const cell of grid) {
      if (!cell.inMonth) continue;
      const count = dayMap.get(cell.date)?.bookedCount ?? 0;
      if (count === 0) weeksEmptyByDow[cell.dow]++;
    }
    for (const dow of columns) {
      const k = weeksEmptyByDow[dow];
      if (k >= 2)
        return `, and ${numberWord(k)} weeks where ${WEEKDAY_LONG[dow]}s went empty`;
    }
    return "";
  })();

  const summaryLine = monthLabel
    ? `${monthLabel}. ${totalSessions} session${totalSessions === 1 ? "" : "s"}${emptyWeekdayClause}.`
    : "";

  const CHIP_TONE = {
    count: "bg-brand-soft text-brand",
    class: "bg-ok-soft text-ok",
    away: "bg-mute-bg text-mute",
    blocked: "bg-mute-bg text-mute",
  };

  return (
    <div className="w-full" data-testid="calendar-month">
      <ScreenState
        phase={phase}
        empty={empty}
        error={error}
        reason={reason}
        onNavigate={onNavigate}
        testIds={{
          loading: "calendar-month-loading",
          error: "calendar-month-error",
          denied: "calendar-month-denied",
          empty: "calendar-month-empty",
        }}
      >
        <div className="mb-4.5">
          <h1 className="m-0 text-page-title font-medium text-ink">Calendar</h1>
          <p className="m-0 mt-1.25 text-control text-mute" data-testid="calendar-month-summary">
            {summaryLine}
          </p>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card border border-line bg-hair" data-testid="calendar-month-grid">
          {columns.map((dow) => (
            <div key={dow} className="bg-surface-2 px-2.75 py-2.25 text-caption font-medium text-mute">
              {WEEKDAY_SHORT[dow]}
            </div>
          ))}
          {grid.map((cell, i) => {
            if (!cell.inMonth) {
              return (
                <div
                  key={i}
                  className="min-h-28 bg-surface-2 px-2.25 py-2"
                  data-testid={`calendar-month-pad-${i}`}
                ></div>
              );
            }
            return (
              <div
                key={i}
                className="flex min-h-28 flex-col gap-0.75 bg-surface px-2.25 py-2"
                data-testid={`calendar-month-day-${cell.date}`}
              >
                <div className={`mb-0.5 text-caption ${cell.date === todayISO ? "font-semibold text-brand" : "text-mute"}`}>{cell.dayOfMonth}</div>
                {chipsFor(cell.date).map((chip, ci) => (
                  <Badge
                    key={ci}
                    className={`!inline-block !h-auto w-fit !justify-start whitespace-normal rounded-chip px-1.5 py-0.75 text-[10.5px] leading-tight ${CHIP_TONE[chip.kind] ?? CHIP_TONE.blocked}`}
                    data-testid={`calendar-month-chip-${cell.date}-${ci}`}
                  >
                    {chip.text}
                  </Badge>
                ))}
              </div>
            );
          })}
        </div>
      </ScreenState>
    </div>
  );
}
