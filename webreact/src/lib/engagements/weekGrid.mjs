// ═══════════════════════════════════════════════════════════════════════════════════════════════
// U5 — THE WEEK'S ARITHMETIC. ★BUILD, NOT A RESTYLE.
//
// ★★★ WHY THIS IS A SEPARATE, PURE MODULE. Everything hard about a week view is date arithmetic in
//     a named timezone, and none of it needs a DOM. Kept here it can be driven directly by a gate
//     with a spring-forward week and a fall-back week — which is the only way to prove the one
//     thing that can actually be WRONG rather than merely ugly.
//
// ★★★ THE RULE: LOCAL WALL-CLOCK PLUS AN IANA ZONE. NEVER STORED UTC, NEVER THE BROWSER'S ZONE.
//     `booking.starts_at` is a `timestamptz` — an instant. The practice's zone turns it into the
//     wall-clock a coach actually reads, and the two differ by a whole hour twice a year.
//
// ★★★ AND DST IS NOT A CORNER CASE HERE, IT IS THE DEFINING ONE. The week containing a transition
//     has a 23-hour day and a 25-hour day. A grid that assumes 7 × 24 either overlaps two sessions
//     or leaves an hour-tall hole, and it does so **twice a year, on a Sunday, silently.**
//   ★★ Both directions are tested, and fall-back is the harder one because an hour REPEATS: two
//      distinct instants share one wall-clock reading, and a naive `hours × 60 + minutes` offset
//      puts them in the same slot.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ THE ONLY CORRECT WAY TO READ A WALL-CLOCK IN A NAMED ZONE FROM A `Date`.
 *
 * `Intl.DateTimeFormat(…).formatToParts` asks the platform's own tz database. ★★ Every arithmetic
 * alternative is wrong at a transition: `getTimezoneOffset()` reports the BROWSER's zone, and a
 * cached offset is by definition the offset of the moment it was captured — which is the bug.
 */
const PARTS = new Map();
function partsIn(zone) {
  let f = PARTS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short",
    });
    PARTS.set(zone, f);
  }
  return f;
}

const DAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * The wall-clock reading of an instant, in a named zone.
 * @returns {{y:number,m:number,d:number,hour:number,minute:number,weekday:number,ymd:string}}
 */
export function wallClock(instant, zone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const got = {};
  for (const p of partsIn(zone).formatToParts(date)) got[p.type] = p.value;
  // ★ `hour: "2-digit"` with `hour12:false` yields "24" for midnight on some platforms — a real
  //   documented quirk, and it would put midnight at the BOTTOM of the previous day.
  const hour = Number(got.hour) % 24;
  return {
    y: Number(got.year), m: Number(got.month), d: Number(got.day),
    hour, minute: Number(got.minute),
    weekday: DAY_INDEX[got.weekday] ?? 0,
    ymd: `${got.year}-${got.month}-${got.day}`,
  };
}

/**
 * The seven local dates of the week containing `instant`, Monday first.
 * ★★ Stepping by 24h from the Monday would DRIFT ACROSS A TRANSITION — add 24h to a 23-hour day and
 *    you land at 01:00 on the next day, which is still the right DATE, but add it seven times and
 *    the accumulated error is what moves a session into the wrong column. So each day is derived
 *    from the week's anchor independently, and re-read through the zone every time.
 */
export function weekDays(instant, zone) {
  const here = wallClock(instant, zone);
  if (!here) return [];
  const anchor = Date.UTC(here.y, here.m - 1, here.d);          // ★ a pure calendar date, no zone
  const monday = anchor - here.weekday * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => {
    const t = new Date(monday + i * 86_400_000);
    const y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate();
    return { ymd: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, index: i,
             label: new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric",
                                                         timeZone: "UTC" }).format(t) };
  });
}

/**
 * ★★★ HOW TALL IS EACH DAY, IN MINUTES. Normally 1440. On a spring-forward day 1380; on a fall-back
 *     day 1500. **THIS FUNCTION IS THE ENTIRE REASON U5 IS A BUILD** — a grid that hardcodes 1440
 *     is wrong twice a year and wrong in a way no screenshot of an ordinary week can reveal.
 */
export function dayLengthMinutes(ymd, zone) {
  const [y, m, d] = ymd.split("-").map(Number);
  // ★ Midnight-to-midnight as INSTANTS, found by probing the zone rather than assuming an offset.
  const startUtc = localMidnightUtc(y, m, d, zone);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const endUtc = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), zone);
  return Math.round((endUtc - startUtc) / 60_000);
}

/**
 * The UTC instant of local midnight on a given local date, found by correcting a first guess.
 *
 * ★★★ THE FIRST VERSION OF THIS FUNCTION WAS WRONG AT A MONTH BOUNDARY, AND THE GATE CAUGHT IT
 *     BEFORE ANY COMPONENT EXISTED. It measured the drift as
 *     `(hour*60+minute) + (w.d !== d ? (w.d > d ? +1440 : -1440) : 0)` — comparing DAY-OF-MONTH
 *     NUMBERS. For local midnight on **1 November**, the first guess reads back as **31 October**
 *     in Los Angeles, and `31 > 1` is true, so it corrected in the wrong direction by a whole day.
 *   ★★ The damage was not a wrong answer, it was an ABSURD one: `dayLengthMinutes("2026-10-31")`
 *      returned **-4320** and `"2026-11-01"` returned **7260**. ★ Spring forward was unaffected
 *      because 8 March is mid-month — **so a test that only checked the spring transition would
 *      have passed over it**, which is precisely why this gate insists on both directions.
 *
 * ★★★ THE FIX IS TO COMPARE DATES, NOT DIGITS. `Date.UTC` of the observed calendar date minus
 *     `Date.UTC` of the target gives the drift in whole days with the correct SIGN across any
 *     boundary — month, year, or neither.
 */
function localMidnightUtc(y, m, d, zone) {
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  // ★ Two passes settle every real zone: one to remove the offset, one to confirm. The third is a
  //   backstop, not an expectation — an unbounded loop here would hang on a zone we mis-handle.
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(guess), zone);
    if (!w) break;
    const observed = Date.UTC(w.y, w.m - 1, w.d);
    const driftMin = (observed - target) / 60_000 + w.hour * 60 + w.minute;
    if (driftMin === 0) break;
    guess -= driftMin * 60_000;
  }
  return guess;
}

/**
 * Place one booking in the grid.
 * @returns {{ymd, dayIndex, minuteOfDay, topPct}} — or null when the instant is unreadable.
 * ★★ `topPct` is a FRACTION OF THAT DAY'S OWN LENGTH, not of 1440. On a 25-hour day 12:00 is not
 *    halfway down, and using 1440 there is exactly the hour-tall hole this module exists to avoid.
 */
export function placeBooking(startsAt, zone, days) {
  const w = wallClock(startsAt, zone);
  if (!w) return null;
  const day = days.find((x) => x.ymd === w.ymd);
  if (!day) return null;
  const minuteOfDay = w.hour * 60 + w.minute;
  const len = dayLengthMinutes(w.ymd, zone) || 1440;
  return { ymd: w.ymd, dayIndex: day.index, minuteOfDay, topPct: (minuteOfDay / len) * 100 };
}
