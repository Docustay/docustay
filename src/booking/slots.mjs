// P7.4 / §B4 STEP 3 — SLOT COMPUTATION, OFFLINE.
//
// ★★ "Availability computed FROM RULES, never stored slots."
// A stored slot is a cached answer to a question whose inputs change — a coach edits their week,
// a holiday is added, a booking is cancelled — and every one of those makes the cache wrong
// silently. Nothing here writes a slot; `generateSlots()` is a pure function of (rules,
// overrides, bookings, policy, zone, day).
//
// ★★★ THE RULE THIS FILE EXISTS TO HONOUR, §B4 STEP 3 VERBATIM:
//   "Working hours, holidays and cutoffs stored as LOCAL time with the business's IANA zone.
//    Bookings stored as UTC instants. ★ STORING EVERYTHING IN UTC IS THE MISTAKE — a 09:00 slot
//    is wall-clock time in a timezone, not a point in time."
//
// ★ The consequence, concretely: a coach who works 09:00–17:00 works 09:00–17:00 in March and in
// November. If those hours were stored as UTC instants, the day the clocks change they would
// silently become 08:00–16:00 or 10:00–18:00 — and the first symptom is a client arriving an hour
// early to an appointment the system thinks is correct.

/**
 * ★★ Convert a LOCAL wall-clock moment in an IANA zone to a real UTC instant.
 *
 * ★★★ THERE IS NO BUILT-IN THAT DOES THIS. `new Date("2026-03-08T09:00")` uses the RUNNING
 * PROCESS's zone, which on a server is usually UTC and is never reliably the business's. So the
 * offset is MEASURED for that instant in that zone, using Intl — the only mechanism in the
 * platform that actually knows the rules — and applied.
 *
 * ★ Method: guess the instant as if local were UTC, ask the zone what wall-clock that instant
 * shows, and correct by the difference. Iterate once more, because near a transition the first
 * correction can land on the other side of it.
 */
export function zonedLocalToUtc(year, month, day, minutesFromMidnight, timeZone) {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  // ★ Start from the naive instant — correct only if the zone is UTC.
  let ts = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  for (let i = 0; i < 2; i++) {
    const shown = wallClockIn(ts, timeZone);
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day,
                                shown.hour, shown.minute, 0, 0);
    const drift = wantedAsUtc - shownAsUtc;
    if (drift === 0) break;
    ts += drift;
  }
  return new Date(ts);
}

/** ★ What wall-clock time does `timeZone` show at this instant? Measured, not computed. */
export function wallClockIn(instant, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(instant instanceof Date ? instant : new Date(instant))
       .filter((x) => x.type !== 'literal')
       .map((x) => [x.type, Number(x.value)]));
  // ★ `hour12: false` can render midnight as 24 in some ICU versions. Normalise it, or a
  // midnight slot lands on the wrong day.
  if (p.hour === 24) p.hour = 0;
  return p;
}

/** ★ Render an instant as HH:MM in a zone — what the human at that location actually reads. */
export function localTimeString(instant, timeZone) {
  const w = wallClockIn(instant, timeZone);
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** ★ 0 = Sunday, matching Postgres EXTRACT(DOW) so no translation layer is needed. */
export function dayOfWeekIn(instant, timeZone) {
  const w = wallClockIn(instant, timeZone);
  // ★ Build the date in UTC from the LOCAL calendar fields, then read its weekday. Using the raw
  // instant's UTC weekday would be wrong for any local time within the offset of midnight.
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/**
 * ★ Pairwise overlap of two minute-window lists (each `{start, end}` in minutes-from-midnight).
 * Every window in `a` is intersected against every window in `b`; empty overlaps are dropped.
 * Used to narrow a day's availability windows down to a shift's windows — shifts never widen.
 */
export function intersectWindows(a, b) {
  const result = [];
  for (const wa of a) {
    for (const wb of b) {
      const start = Math.max(wa.start, wb.start);
      const end = Math.min(wa.end, wb.end);
      if (start < end) result.push({ start, end });
    }
  }
  return result;
}

/**
 * ★★★ GENERATE THE BOOKABLE SLOTS for one LOCAL calendar day.
 *
 * @param {object}   o
 * @param {string}   o.date       'YYYY-MM-DD' — a LOCAL calendar day, not an instant
 * @param {string}   o.timeZone   the BUSINESS's IANA zone
 * @param {Array}    o.rules      [{ day_of_week, start_minute, end_minute, effective_from, effective_to }]
 * @param {Array}    o.overrides  [{ on_date, is_available, start_minute, end_minute }]
 * @param {Array}    o.busy       [{ startsAt: Date, endsAt: Date }] — UTC instants, buffers included
 * @param {object}   o.policy     { durationMinutes, slotStepMinutes, minimumNoticeMinutes,
 *                                  bufferBeforeMinutes, bufferAfterMinutes }
 * @param {Date}     o.now        the instant "now", passed in so this stays a PURE function
 * @param {Array|null} o.shifts   [{ on_date, start_minute, end_minute }] — `null` means this
 *                                person has no shifts at all recorded, so availability alone
 *                                governs (the solo rule); a non-null array (even empty for this
 *                                date) NARROWS the resolved windows to the shift windows.
 * @param {Array}    o.timeOff    [{ starts_on, ends_on }] — day-granular closures (F02 §2.5); any
 *                                covering row for this LOCAL date beats both shifts and rules.
 * @returns {Array<{startsAt: Date, endsAt: Date, localTime: string}>}
 */
export function generateSlots(input) {
  const day = resolveDay(input);
  if (day.closed) return [];
  const slots = [];
  for (const m of candidateStarts(day)) {
    const verdict = judgeStart(day, m);
    if (verdict.ok) slots.push(verdict.slot);
  }
  return slots;
}

/**
 * ★★★ STAGE 20 — "WHY ISN'T 2PM SHOWING?", answered by the SAME code that decides what is shown.
 *     `generateSlots` above is now `resolveDay` → `candidateStarts` → `judgeStart`; this function
 *     runs `resolveDay` + `judgeStart` for ONE requested minute. There is no second copy of any rule,
 *     so the explanation cannot disagree with the slot list — if it says "offered", `generateSlots`
 *     offers it, and vice versa.
 *
 * @param {object} input   exactly `generateSlots`' input
 * @param {number} minute  the requested LOCAL start, minutes from midnight
 * @returns {{offered: boolean, reason: string, detail: string, clash?: object}}
 *   reason ∈ offered · time_off · day_closed · no_hours · not_on_shift · outside_hours ·
 *            does_not_fit · not_a_start_time · nonexistent_time · too_soon · day_full · taken
 */
export function explainStart(input, minute) {
  const day = resolveDay(input);
  if (day.closed) return { offered: false, reason: day.closed, detail: day.closedDetail };
  const fits = day.windows.find((w) => minute >= w.start && minute < w.end);
  if (!fits) {
    return {
      offered: false, reason: "outside_hours",
      detail: day.windows.length
        ? `Outside the hours that day: ${day.windows.map((w) => `${minutesToHHMM(w.start)}–${minutesToHHMM(w.end)}`).join(", ")}.`
        : "No hours that day.",
    };
  }
  if (minute + day.durationMinutes > fits.end) {
    return { offered: false, reason: "does_not_fit",
             detail: `A ${day.durationMinutes}-minute session starting then would run past ${minutesToHHMM(fits.end)}.` };
  }
  const anchor = day.alignToMidnight ? 0 : fits.start;
  if ((minute - anchor) % day.intervalMinutes !== 0) {
    return { offered: false, reason: "not_a_start_time",
             detail: `Sessions start every ${day.intervalMinutes} minutes, so ${minutesToHHMM(minute)} is not a start time.` };
  }
  const verdict = judgeStart(day, minute);
  if (verdict.ok) return { offered: true, reason: "offered", detail: "That time is offered." };
  return { offered: false, reason: verdict.reason, detail: verdict.detail, ...(verdict.clash ? { clash: verdict.clash } : {}) };
}

/** ★ Resolve the day to LOCAL-minute windows — no instant is constructed here, so a DST
 *  transition cannot move a working day's boundaries (§B4 STEP 3). */
function resolveDay({ date, timeZone, rules = [], overrides = [], busy = [], policy = {},
                      now = new Date(), shifts = null, timeOff = [] }) {
  const [year, month, dayOfMonth] = date.split('-').map(Number);
  const durationMinutes = policy.durationMinutes ?? 60;
  const base = {
    date, timeZone, year, month, dayOfMonth, busy, now, durationMinutes,
    // ★ Start-time interval (0498). `slotStepMinutes` is the older name for the same thing, kept so
    //   existing callers and tests read the same; absent both, the duration (the old behaviour).
    intervalMinutes: policy.startIntervalMinutes ?? policy.slotStepMinutes ?? durationMinutes,
    // ★ Only an explicit start interval aligns to local midnight; the legacy step keeps stepping
    //   from each window's own start, exactly as before 0498, so older callers read the same.
    alignToMidnight: policy.startIntervalMinutes != null,
    minimumNoticeMinutes: policy.minimumNoticeMinutes ?? 0,
    bufferBeforeMinutes: policy.bufferBeforeMinutes ?? 0,
    bufferAfterMinutes: policy.bufferAfterMinutes ?? 0,
    maxPerDay: policy.maxPerDay ?? null,
    bookedCount: policy.bookedCount ?? 0,
    windows: [],
    closed: null, closedDetail: "",
  };

  // ★ TIME OFF BEATS BOTH the weekly rule and any shift — a covering row for this LOCAL date
  // means nothing is offered, full stop.
  if (timeOff.some((t) => toISODate(t.starts_on) <= date && date <= toISODate(t.ends_on))) {
    return { ...base, closed: "time_off", closedDetail: "Time off that day." };
  }

  let windows;
  const override = overrides.find((o) => toISODate(o.on_date) === date);
  if (override) {
    // ★ A closure wins outright. An opening REPLACES the weekly rule rather than adding to it —
    // "I am working Saturday 10–14" means 10–14, not 10–14 plus the usual Saturday.
    if (!override.is_available) {
      return { ...base, closed: "day_closed",
               closedDetail: `That day is marked not working${override.reason ? ` (${override.reason})` : ""}.` };
    }
    windows = [{ start: override.start_minute, end: override.end_minute }];
  } else {
    // ★ Weekday computed from the LOCAL date, and effective-dating applied on the LOCAL date too.
    const dow = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
    windows = rules
      .filter((r) => r.day_of_week === dow)
      .filter((r) => {
        const from = toISODate(r.effective_from);
        const to   = toISODate(r.effective_to);
        return (!from || date >= from) && (!to || date <= to);
      })
      .map((r) => ({ start: r.start_minute, end: r.end_minute }));
    if (windows.length === 0) {
      return { ...base, closed: "no_hours", closedDetail: "No working hours on that weekday." };
    }
  }

  // ★ SHIFTS NARROW, THEY NEVER WIDEN. `shifts === null` means this person has no shifts at all
  // recorded — the solo rule — so availability alone governs and windows pass through unchanged.
  // A non-null array (even empty for this date) intersects, so a shift-tracked person is offered
  // nothing on a day with no shift row.
  if (shifts !== null) {
    windows = intersectWindows(windows, shifts
      .filter((s) => toISODate(s.on_date) === date)
      .map((s) => ({ start: s.start_minute, end: s.end_minute })));
    if (windows.length === 0) {
      return { ...base, closed: "not_on_shift", closedDetail: "Not rostered on a shift that day." };
    }
  }

  // ★ DAILY CAP (0498) — counted over the occupying states for this host's LOCAL day by the caller.
  if (base.maxPerDay != null && base.bookedCount >= base.maxPerDay) {
    return { ...base, windows, closed: "day_full",
             closedDetail: `The day is full: ${base.bookedCount} of ${base.maxPerDay} sessions already booked.` };
  }
  return { ...base, windows };
}

/** ★ Every candidate start, ALIGNED TO THE INTERVAL FROM LOCAL MIDNIGHT (Ruling, 0498): a 30-minute
 *  interval offers :00 and :30 even when the window opens at 9:10 — "slots land on :00 and :30" is
 *  the point of the setting, and aligning to the window start would re-create 9:10, 9:40. */
function* candidateStarts(day) {
  const step = day.intervalMinutes;
  for (const w of day.windows) {
    const first = day.alignToMidnight ? Math.ceil(w.start / step) * step : w.start;
    for (let m = first; m + day.durationMinutes <= w.end; m += step) yield m;
  }
}

/** ★ The per-start checks, in one place — DST, notice, collision. */
function judgeStart(day, m) {
  const { year, month, dayOfMonth, timeZone, durationMinutes } = day;
  // ★★★ HERE, AND ONLY HERE, DOES A WALL-CLOCK MINUTE BECOME AN INSTANT.
  const startsAt = zonedLocalToUtc(year, month, dayOfMonth, m, timeZone);
  const endsAt   = new Date(startsAt.getTime() + durationMinutes * 60_000);

  // ★★ A SPRING-FORWARD SKIPS AN HOUR OF WALL-CLOCK TIME THAT DOES NOT EXIST. Asking for
  // 02:30 on such a day yields an instant that renders as 03:30 — the zone has no 02:30.
  // ★ Such a slot is DROPPED: offering a time that does not exist books a client into
  // nothing, and the confirmation email would show a different time than they clicked.
  if (localTimeString(startsAt, timeZone) !== minutesToHHMM(m)) {
    return { ok: false, reason: "nonexistent_time",
             detail: `${minutesToHHMM(m)} does not exist that day — the clocks go forward.` };
  }

  const noticeCutoff = new Date(day.now.getTime() + day.minimumNoticeMinutes * 60_000);
  if (startsAt < noticeCutoff) {
    return { ok: false, reason: "too_soon",
             detail: `Too soon: bookings need ${day.minimumNoticeMinutes} minutes' notice.` };
  }

  // ★ Collision is checked on the BUFFERED extent, matching what the database's EXCLUDE
  // constraint guards — so the UI never offers a slot the write would refuse.
  const occStart = new Date(startsAt.getTime() - day.bufferBeforeMinutes * 60_000);
  const occEnd   = new Date(endsAt.getTime()   + day.bufferAfterMinutes  * 60_000);
  const clash = day.busy.find((b) => occStart < b.endsAt && b.startsAt < occEnd);
  if (clash) {
    const what = clash.kind === "block" ? "Blocked time" : "Already booked";
    const buffered = day.bufferBeforeMinutes || day.bufferAfterMinutes
      ? ` (including the ${day.bufferBeforeMinutes}/${day.bufferAfterMinutes}-minute gaps before/after)` : "";
    return {
      ok: false, reason: "taken",
      detail: `${what} ${localTimeString(clash.startsAt, timeZone)}–${localTimeString(clash.endsAt, timeZone)}${buffered}.`,
      clash: { kind: clash.kind ?? "booking", id: clash.id ?? null,
               startsAt: clash.startsAt, endsAt: clash.endsAt },
    };
  }
  return { ok: true, slot: { startsAt, endsAt, localTime: localTimeString(startsAt, timeZone) } };
}

/**
 * ★★★ NORMALISE A DATE-ISH VALUE TO 'YYYY-MM-DD'.
 * [MEASURED, P7.12] the driver returns a Postgres `date` column as a JS **Date object**, and
 * `String(aDate).slice(0, 10)` yields **"Sat Jan 01"** — which string-compares against
 * "2026-03-08" as FALSE, because 'S' > '2'. ★ Every effective-dated rule was therefore filtered
 * out and the generator returned an EMPTY DAY.
 * ★★ The unit test did not catch it because it passed plain strings. **A shape the database
 * actually returns is not the same as a shape that looks right in a fixture** — and this is the
 * §2.8a lesson arriving in a new place: dump the object, do not assume the type.
 * ★ Note it failed CLOSED — no slots offered, rather than wrong slots offered — which is why it
 * surfaced as "0 slots" and not as a client booking a time the coach does not work.
 */
function toISODate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    // ★ UTC parts: a `date` has no time or zone, and using local parts would shift it a day
    // for anyone west of Greenwich.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-` +
           `${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

function minutesToHHMM(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
