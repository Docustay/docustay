// @ts-check
// BOOKING OVERHAUL, 29 Sep 2026 — RECURRING CLIENT SESSIONS.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ recurrenceCadence/recurrenceGroupId WERE COLUMNS WITH NO WRITER. [MEASURED during recon]
//     `createBooking.mjs` accepts and stores both on a SINGLE row, and `/api/engagements/bookings`'s
//     own schema has taken them since P2.5 — but nothing in `src/` ever called it with either field
//     set: not `BookSessionDialog.jsx`, not the public booking route, not the client portal route.
//     A separate, unrelated recurrence engine exists (`src/booking/blocks.mjs`'s `expandBlock`), but
//     it expands `keystone.booking_block` rows — a coach's own availability/time-off — never
//     `keystone.booking` itself. This module is the first real writer of a client-session series.
//
// ★★★ ONE OCCURRENCE'S CONFLICT DOES NOT LOSE THE REST OF THE SERIES.
//     Postgres marks a transaction ABORTED the instant one statement inside it errors — including the
//     INSERT that `createBooking`'s own guard-1 exclusion constraint refuses. Without a SAVEPOINT
//     around each occurrence, one taken slot in week 6 of a 12-week series would poison the shared
//     transaction and fail every occurrence after it, including ones with no conflict at all. Each
//     occurrence here runs inside its own SAVEPOINT/RELEASE (success) or ROLLBACK TO SAVEPOINT
//     (failure), so the series commits everything it legitimately could and reports the rest.
//
// ★ EACH OCCURRENCE'S INSTANT IS COMPUTED INDEPENDENTLY, FROM ITS OWN LOCAL WALL-CLOCK DATE — never
//   by adding a fixed millisecond duration to the previous occurrence. That is the same DST-safety
//   rule `src/booking/blocks.mjs`'s `expandBlock` documents at length, and `zonedLocalToUtc`/
//   `wallClockIn` (`src/booking/slots.mjs`) are the same, already-reviewed primitives reused here
//   rather than a second implementation of zone-aware date arithmetic.
//
// ★★ THE CADENCE VOCABULARY IS DELIBERATELY SMALL: "every N weeks" (N 1–52, so weekly and biweekly
//    are both N=1/N=2 of ONE pattern, not two) and "specific weekdays, every week". Monthly-by-date
//    and "the 2nd Tuesday" patterns are common in general calendaring but not asked for here and are
//    NOT built — a cadence string outside this vocabulary is refused, named, at parseCadence.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { createBooking, cancelBooking } from "./createBooking.mjs";
import { zonedLocalToUtc, wallClockIn } from "./slots.mjs";
import { invalid, forbidden } from "../http/errors.mjs";

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
/** ★ A bound, not a real-world expectation — see header. 104 = two years of weekly sessions. */
const MAX_OCCURRENCES = 104;
/** ★ Same reasoning: an end-by-date more than this far out is refused before any expansion runs. */
const MAX_SPAN_DAYS = 730;

/** @returns {{kind:"every_n_weeks", n:number} | {kind:"weekdays", codes:string[]}} */
function parseCadence(cadence) {
  if (typeof cadence !== "string" || !cadence.trim()) {
    throw invalid('recurrenceCadence is required — "every_N_weeks" (N 1-52) or "weekdays:MO,WE,FR".');
  }
  const everyN = cadence.match(/^every_(\d+)_weeks$/);
  if (everyN) {
    const n = Number(everyN[1]);
    if (!Number.isInteger(n) || n < 1 || n > 52) {
      throw invalid(`"${cadence}" — N must be a whole number from 1 to 52.`);
    }
    return { kind: "every_n_weeks", n };
  }
  const weekdays = cadence.match(/^weekdays:([A-Z,]+)$/);
  if (weekdays) {
    const codes = [...new Set(weekdays[1].split(","))];
    if (!codes.length || codes.some((c) => !WEEKDAY_CODES.includes(c))) {
      throw invalid(`"${cadence}" — weekdays must be from ${WEEKDAY_CODES.join(", ")}, comma-separated.`);
    }
    return { kind: "weekdays", codes };
  }
  throw invalid(`"${cadence}" is not a recognised recurrence — use "every_N_weeks" or "weekdays:...".`);
}

const pad2 = (n) => String(n).padStart(2, "0");
const dayNumOf = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
const isoOfDayNum = (n) => {
  const d = new Date(n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
/** 0=Sunday … 6=Saturday — matches Postgres EXTRACT(DOW), same convention `blocks.mjs` uses. */
const dowOfDayNum = (n) => new Date(n * 86_400_000).getUTCDay();

/** @returns {{kind:"count", count:number} | {kind:"date", lastDayNum:number}} */
function parseEndMode(recurrenceEnd) {
  if (!recurrenceEnd || typeof recurrenceEnd !== "object") {
    throw invalid('recurrenceEnd is required — { afterCount: N } or { byDate: "YYYY-MM-DD" }.');
  }
  if (recurrenceEnd.afterCount != null) {
    const count = Number(recurrenceEnd.afterCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) {
      throw invalid(`afterCount must be a whole number from 1 to ${MAX_OCCURRENCES}.`);
    }
    return { kind: "count", count };
  }
  if (recurrenceEnd.byDate) {
    const m = String(recurrenceEnd.byDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) throw invalid('byDate must be YYYY-MM-DD.');
    return { kind: "date", lastDayNum: dayNumOf(Number(m[1]), Number(m[2]), Number(m[3])) };
  }
  throw invalid('recurrenceEnd needs either afterCount or byDate.');
}

/** The occurrence calendar dates (day-numbers), ascending, first occurrence always included. */
function occurrenceDayNums(firstDayNum, pattern, endMode) {
  const days = [];
  const withinEnd = (dayNum, count) =>
    endMode.kind === "count" ? count < endMode.count : dayNum <= endMode.lastDayNum;

  if (pattern.kind === "every_n_weeks") {
    const step = pattern.n * 7;
    for (let dayNum = firstDayNum; withinEnd(dayNum, days.length); dayNum += step) {
      days.push(dayNum);
      if (days.length > MAX_OCCURRENCES) break;
    }
    return days;
  }

  // "weekdays" — every week, on each named weekday. The first occurrence is always included (it is
  // the exact slot the booker picked and had checked for availability), whether or not its own
  // weekday happens to be one of the chosen ones.
  const wanted = new Set(pattern.codes);
  for (let dayNum = firstDayNum; withinEnd(dayNum, days.length); dayNum++) {
    if (dayNum === firstDayNum || wanted.has(WEEKDAY_CODES[dowOfDayNum(dayNum)])) {
      days.push(dayNum);
    }
    if (days.length > MAX_OCCURRENCES) break;
  }
  return days;
}

/**
 * Create a recurring series of bookings, sharing one `recurrenceGroupId`, by calling `createBooking`
 * once per occurrence. Every occurrence goes through createBooking's full guard stack — the same
 * double-booking check, consent hold, signature hold and credit reservation a single booking gets.
 *
 * @param {object} tx    a pg client INSIDE a transaction (tenant context already set)
 * @param {object} input everything `createBooking` takes, PLUS:
 *                       recurrenceCadence — "every_N_weeks" | "weekdays:MO,WE,FR"
 *                       recurrenceEnd     — { afterCount } | { byDate }
 *                       inviteeTimezone   — REQUIRED here (optional on a single booking): every
 *                                           occurrence's instant is computed from it
 * @param {object} opts  passed through to each createBooking call unchanged
 * @returns {Promise<{recurrenceGroupId, created: object[], skipped: {startsAt, reason}[]}>}
 */
export async function createRecurringBookings(tx, input, opts = {}) {
  const { tenantId, startsAt, endsAt, inviteeTimezone, recurrenceCadence, recurrenceEnd, ...rest } = input;

  if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) {
    throw new TypeError('startsAt and endsAt must be Date instances (UTC instants)');
  }
  if (!inviteeTimezone) {
    throw invalid('a recurring booking needs inviteeTimezone — every occurrence after the first is ' +
      'computed from it, and computing a weekly repeat in UTC would drift by an hour across DST.');
  }

  const pattern = parseCadence(recurrenceCadence);
  const endMode = parseEndMode(recurrenceEnd);

  const startWall = wallClockIn(startsAt, inviteeTimezone);
  const endWall = wallClockIn(endsAt, inviteeTimezone);
  const startMinutes = startWall.hour * 60 + startWall.minute;
  const endMinutes = endWall.hour * 60 + endWall.minute;
  const firstDayNum = dayNumOf(startWall.year, startWall.month, startWall.day);
  // ★ Usually 0; 1 if the session's own local time crosses midnight — carried to every occurrence
  //   so a late-night session still ends the calendar day after it starts, every time.
  const dayOffset = dayNumOf(endWall.year, endWall.month, endWall.day) - firstDayNum;

  if (endMode.kind === "date" && endMode.lastDayNum - firstDayNum > MAX_SPAN_DAYS) {
    throw invalid(`That end date is more than ${Math.round(MAX_SPAN_DAYS / 365)} years out — pick ` +
      `something closer, or end after a number of sessions instead.`);
  }

  const dayNums = occurrenceDayNums(firstDayNum, pattern, endMode);
  if (dayNums.length === 0) {
    throw invalid('That recurrence produces no sessions — check the pattern and the end condition.');
  }
  if (dayNums.length > MAX_OCCURRENCES) {
    throw invalid(`That recurrence produces more than ${MAX_OCCURRENCES} sessions — narrow the end ` +
      `date or the count.`);
  }

  const occInstant = (dayNum) => {
    const [y, m, d] = isoOfDayNum(dayNum).split("-").map(Number);
    const startsAtI = zonedLocalToUtc(y, m, d, startMinutes, inviteeTimezone);
    const [ey, em, ed] = isoOfDayNum(dayNum + dayOffset).split("-").map(Number);
    const endsAtI = zonedLocalToUtc(ey, em, ed, endMinutes, inviteeTimezone);
    return { startsAt: startsAtI, endsAt: endsAtI };
  };

  const created = [];
  const skipped = [];

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE FIRST OCCURRENCE IS SPECIAL: 0085's own column comment — "every booking in a series
  //     points at the FIRST one, which points at itself" — and `recurrence_group_id` is a composite
  //     FK onto `keystone.booking(tenant_id, id)` (0085). A fresh, unrelated UUID (what this file
  //     generated before this fix) satisfies neither: nothing in the practice has that id, so the
  //     very first INSERT trips `booking_recurrence_group_fkey`. [MEASURED — this exact failure, live,
  //     29 Sep 2026: "insert or update on table booking violates foreign key constraint
  //     booking_recurrence_group_fkey", caught by actually running the flow, not by reading the code.]
  //   ★ So: insert the first occurrence with NEITHER field set (passes booking_recurrence_is_whole,
  //     0085, which requires both null or both set) — an ordinary, uncontroversial single booking —
  //     then UPDATE that same row, in the same transaction, to point at itself. Postgres checks a FK
  //     against the transaction's own view, so every later occurrence can reference this row's id
  //     immediately, without a commit in between.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const firstOcc = occInstant(dayNums[0]);
  const savepoint0 = "recur_occ_0";
  await tx.query(`SAVEPOINT ${savepoint0}`);
  let recurrenceGroupId = null;
  try {
    const firstRow = await createBooking(tx, {
      ...rest, tenantId, inviteeTimezone, startsAt: firstOcc.startsAt, endsAt: firstOcc.endsAt,
    }, opts);
    await tx.query(
      `UPDATE keystone.booking SET recurrence_cadence = $1, recurrence_group_id = id
        WHERE tenant_id = $2 AND id = $3`,
      [recurrenceCadence, tenantId, firstRow.id]);
    await tx.query(`RELEASE SAVEPOINT ${savepoint0}`);
    recurrenceGroupId = firstRow.id;
    created.push({ ...firstRow, recurrence_cadence: recurrenceCadence, recurrence_group_id: firstRow.id });
  } catch (e) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${savepoint0}`);
    skipped.push({ startsAt: firstOcc.startsAt.toISOString(), reason: e.message });
  }

  // ★ A request where the FIRST occurrence failed (a bad hostId, a permission refusal) is a genuine
  //   failure, not a partial success with nothing in it — and there is no series to hang later
  //   occurrences off of anyway, so this refuses before attempting any of them.
  if (!recurrenceGroupId) {
    throw invalid(`No sessions could be created: ${skipped[0]?.reason ?? "unknown reason"}`);
  }

  for (let i = 1; i < dayNums.length; i++) {
    const occ = occInstant(dayNums[i]);
    // ★★ THE SAVEPOINT — see header. Named per-occurrence so a failure never touches another's.
    const savepoint = `recur_occ_${i}`;
    await tx.query(`SAVEPOINT ${savepoint}`);
    try {
      const row = await createBooking(tx, {
        ...rest, tenantId, inviteeTimezone,
        startsAt: occ.startsAt, endsAt: occ.endsAt,
        recurrenceCadence, recurrenceGroupId,
      }, opts);
      await tx.query(`RELEASE SAVEPOINT ${savepoint}`);
      created.push(row);
    } catch (e) {
      await tx.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      skipped.push({ startsAt: occ.startsAt.toISOString(), reason: e.message });
    }
  }

  return { recurrenceGroupId, created, skipped };
}

/**
 * Cancel every future, not-yet-cancelled booking in a recurrence series.
 * ★ "Future" is `starts_at > now()` — a past or already-completed occurrence in the series is left
 *   alone, same reasoning `cancelBooking` itself never touches a booking's history.
 * ★ Reuses `cancelBooking`'s own exactly-once, credit-returning transition for each row — this
 *   function is the loop, not a second definition of what "cancelled" means.
 */
export async function cancelRecurringSeries(tx, { tenantId, recurrenceGroupId, actorUserId = null }) {
  if (!recurrenceGroupId) throw invalid('recurrenceGroupId is required.');

  // ★ THE ROUTE'S OWN COARSE GATE ONLY ASKS "may this actor edit engagements at all" — a series has
  //   no single `booking` id for it to re-ask a per-record question about (`subject: null` on
  //   `/api/engagements/bookings/recurring/cancel`, same shape as the waitlist routes). A series is
  //   always one host by construction (every occurrence is created with the same hostId), so the
  //   real per-record question createBooking itself asks — "may this actor act on THIS host's
  //   calendar" — is asked here instead, once, against that host, before anything is cancelled.
  const { rows: hostRows } = await tx.query(
    `SELECT DISTINCT host_id FROM keystone.booking
      WHERE tenant_id = $1 AND recurrence_group_id = $2`,
    [tenantId, recurrenceGroupId]);
  if (hostRows.length === 0) return { cancelledCount: 0, creditsReturned: 0, totalConsidered: 0 };
  for (const { host_id: hostId } of hostRows) {
    const { rows: mayRows } = await tx.query(
      `SELECT keystone.user_may($1, 'engagement', 'edit', $2) AS allowed`,
      [actorUserId, hostId]);
    if (!mayRows[0]?.allowed) {
      throw forbidden('You do not have permission to cancel sessions on this calendar.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ [MEASURED, live, 29 Sep 2026] `state <> 'cancelled'` ALSO MATCHED `completed` AND `no_show`
  //     — a session already Held or already marked No-show has `starts_at` in the future exactly as
  //     often as a still-open one does (the state is what changed, not the date). Cancelling "the
  //     rest of the series" cancelled two sessions that had ALREADY HAPPENED and been correctly
  //     settled, in a live test of this exact function. Caught by actually running it against a
  //     series with a completed and a no-show occurrence in it, not by reading the code.
  //   ★ Excludes all three TERMINAL states (0510's own closed vocabulary: pending_payment,
  //     pending_consent, pending_signature, confirmed, cancelled, completed, no_show) — a series
  //     cancel only ever touches a booking that has not yet been resolved one way or the other.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const { rows } = await tx.query(
    `SELECT id FROM keystone.booking
      WHERE tenant_id = $1 AND recurrence_group_id = $2
        AND state NOT IN ('cancelled', 'completed', 'no_show') AND starts_at > now()`,
    [tenantId, recurrenceGroupId]);

  let cancelledCount = 0, creditsReturned = 0;
  for (const { id: bookingId } of rows) {
    const result = await cancelBooking(tx, { tenantId, bookingId, actorUserId });
    if (result.cancelled) { cancelledCount++; creditsReturned += result.creditsReturned; }
  }
  return { cancelledCount, creditsReturned, totalConsidered: rows.length };
}
