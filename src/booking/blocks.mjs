// @ts-check
// STAGE 13 TASK 13.17 — BLOCK TIME: CREATE, STOP, SKIP ONE DAY, WITH THE COLLISION WARNING.
// specs/features/plans/STAGE-13-PLAN.md §13.17. Schema: migration 0402 (keystone.booking_block,
// task 13.7) — READ from the file, never a live connection (0402 is written, not applied here).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ YOU OWN THE REFUSAL, AND NOTHING ELSE DOES. 0402 has no FK, no exclusion constraint and no
//     trigger against `keystone.booking` — nothing in the schema stops a booking from being written
//     into a blocked time. The only place a block ever actually keeps a slot from being offered is
//     13.18's `readSlots`, which composes `expandBlock`'s occurrences into its `busy` list (13.18's
//     own field 4: "busy += expanded booking_block occurrences for the host on date … via
//     expandBlock, 13.17"). That is a READ-TIME filter, not a write-time guard: it is honest ONLY
//     because `expandBlock` is honest. If this function drops an occurrence, mis-handles a DST
//     transition, or expands past `repeat_until`/`skipped_dates` wrongly, 13.18 offers the slot and
//     nothing anywhere refuses the booking. There is no second guard behind this one.
// ★★★ AND IT DOES NOT CLOSE THE RACE. A booking POSTed directly for a time inside a block is not
//     refused by anything in this codebase, concurrently or not — `createBooking.mjs`'s guards
//     (the EXCLUDE constraint, the advisory lock) serialise booking-vs-booking overlap only; neither
//     one reads `keystone.booking_block` at all. Named here, not hidden: this module supplies the
//     data 13.18 uses to keep the slot off the list in the first place; it is not, and cannot be by
//     itself, a write-time lock.
// ★ WHAT THIS MODULE ITSELF DOES MAKE SAFE UNDER CONCURRENCY: `stopBlock` and `skipBlockDay` are
//   each a SINGLE atomic UPDATE (no read-then-write in JS) — Postgres's own row-level locking
//   serialises two concurrent callers on the same block row, so neither can silently lose the
//   other's change. `createBlock`'s clash list is informational only (the block is created
//   regardless — "Blocking won't cancel it"), so a race there can only make one report stale, never
//   produce a wrong write.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// ★★ WHO CALLS THIS: `expandBlock` ← `src/booking/read.mjs`'s `readSlots` (13.18, availability
//    composition) and `src/booking/calendarRead` (13.23, drawing the week). `createBlock` /
//    `stopBlock` / `skipBlockDay` ← the `/api/engagements/blocks*` routes 13.27a adds to
//    `src/routes/writes.mjs`'s `ROUTES` table (CT-F51 — 201 on success), themselves called from
//    `BlockTimePopover` (13.29). Nothing in THIS build calls them yet — both are later, named tasks,
//    not a guess.

import { zonedLocalToUtc, wallClockIn } from "./slots.mjs";
import { invalid, forbidden, notFound } from "../http/errors.mjs";
import { effectiveRank } from "../nav/authorise.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { addDays, formatISO } from "date-fns";
import { TZDate } from "@date-fns/tz";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS MODULE WROTE THREE TIMES AND EMITTED NOTHING (found 25 Sep 2026, fixed in place).
//     `createBlock` INSERTs and `stopBlock`/`skipBlockDay` UPDATE `keystone.booking_block`, and the
//     file contained **zero** occurrences of `emit`. Its sibling `src/booking/writes.mjs` emits
//     `booking.availability.changed` from all three of ITS availability writes (:81, :114, :172),
//     and Stage 13's own write-census table asserts this module does the same — it does not.
//   ★★ THE CONSUMER IS REAL AND IT IS THE AUDIT TRAIL: `src/audit/queries.mjs:51` maps
//      `booking.availability.changed` to the phrase "changed availability". So a coach blocking out
//      a fortnight, ending a repeat early, or skipping a day left **no audit line at all**, while
//      the identical-in-kind act of editing a weekly rule left one. "Why was that slot not offered
//      in March?" was unanswerable for exactly the writes most likely to be questioned.
//   ★ Found by 13.27b, which was classifying writers for the census, measured the contradiction
//     against its own plan text, and refused to add a `DOMAIN_WRITERS` row for a module that does
//     not emit — the gate would have failed it. Reporting it was right; this closes it.
//   ★★ `subjectType: null` deliberately: `waitlist.mjs`'s emits in this same stage use that shape,
//      and the block id travels in the payload. Inventing a new `subject_type` value for a closed
//      vocabulary I have not read is how an emit passes review and fails on insert.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const SECTION = "booking";

/** ★ The closed repeat vocabulary — matches 0402's `repeat` CHECK exactly. */
const REPEAT_KINDS = Object.freeze(["none", "daily", "weekdays", "weekly"]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DATE ARITHMETIC — all of it in a UTC-epoch "day number", never mixed with a real zoned instant.
// A calendar date (`2026-03-08`) is not a point in time; doing calendar math on it with a zoned
// clock is exactly the class of bug §B4 STEP 3 exists to prevent. `zonedLocalToUtc`/`wallClockIn`
// are used ONLY at the two edges: reading the block's own local wall-clock time, and turning a
// candidate calendar date + that wall-clock time back into a real UTC instant.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const pad2 = (n) => String(n).padStart(2, "0");

function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** ★ Normalises either a `date`-typed pg value (comes back as a UTC-midnight `Date`) or a string to
 *  'YYYY-MM-DD'. Reading UTC parts off the `Date` is deliberate — local parts would shift the date
 *  by one for anyone west of Greenwich (same fix as `slots.mjs`'s own `toISODate`, not exported
 *  there, so restated here rather than reaching into that module's internals). */
function toISODate(v) {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function dateToDayNum(y, m, d) {
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}
function dayNumToISO(n) {
  return formatISO(addDays(new TZDate(0, "UTC"), n), { representation: "date" });
}
/** 0=Sunday … 6=Saturday, matching Postgres EXTRACT(DOW) — same convention as `slots.mjs:72`'s
 *  `dayOfWeekIn`, restated here for a plain day number rather than an instant. */
function dowOfDayNum(n) {
  return addDays(new TZDate(0, "UTC"), n).getUTCDay();
}

export function addDaysISO(iso, days) {
  const [y, m, d] = parseISO(iso);
  return dayNumToISO(dateToDayNum(y, m, d) + days);
}

// ★★ THE BOUND. A caller-supplied window this wide is almost certainly a mistake, not real usage —
//    the NORMAL bound is simply `fromDate`..`toDate` themselves (13.18 passes one day ± 1; this
//    module's own clash check passes 60 days). This is a backstop against an unbounded eager
//    expansion, never the expected path.
const MAX_EXPANSION_DAYS = 3660; // ~10 years

/**
 * ★ A recurrence expansion, honouring `repeat` (daily / weekdays Mon–Fri / weekly same weekday),
 * `repeat_until` and `skipped_dates` — bounded ALWAYS by the caller's own `[fromDate, toDate]`
 * window, never by how far the recurrence itself runs (an open `repeat_until` is a real, permitted
 * value: "forever" is not expanded past what the caller asked for).
 *
 * Each occurrence's start and end are computed INDEPENDENTLY via `zonedLocalToUtc`, from that
 * occurrence's own calendar date — never by adding a fixed millisecond duration to the previous
 * occurrence's instant. That is what keeps a weekly 12:00–13:00 block at 12:00 local on BOTH sides
 * of a DST transition: the real UTC instant shifts by the zone's own offset change; the wall clock
 * does not.
 *
 * @param block    a `keystone.booking_block` row (or shape-alike): starts_at, ends_at, repeat,
 *                 repeat_until, skipped_dates
 * @param fromDate 'YYYY-MM-DD' (or a `Date`) — inclusive
 * @param toDate   'YYYY-MM-DD' (or a `Date`) — inclusive
 * @param timeZone an IANA zone — the practice's own (§B4 STEP 3: never a bare stored UTC)
 * @returns [{ startsAt: Date, endsAt: Date }] ascending
 */
export function expandBlock(block, fromDate, toDate, timeZone) {
  if (!block || !block.starts_at || !block.ends_at) {
    throw invalid("expandBlock needs a block with starts_at and ends_at");
  }
  if (!REPEAT_KINDS.includes(block.repeat)) {
    throw invalid(`expandBlock: unrecognised repeat ${JSON.stringify(block.repeat)}`);
  }
  if (!timeZone) throw invalid("expandBlock needs an IANA timeZone");

  const fromISO = toISODate(fromDate);
  const toISO = toISODate(toDate);
  if (!fromISO || !toISO) throw invalid("expandBlock needs YYYY-MM-DD fromDate and toDate");

  const startsAtDate = block.starts_at instanceof Date ? block.starts_at : new Date(block.starts_at);
  const endsAtDate = block.ends_at instanceof Date ? block.ends_at : new Date(block.ends_at);

  // ★ The block's own local wall-clock time — read ONCE, from its stored instant, in the
  //   practice`s zone. This is the "12:00–13:00" a coach actually typed in.`
  const startWall = wallClockIn(startsAtDate, timeZone);
  const endWall = wallClockIn(endsAtDate, timeZone);
  const startMinutes = startWall.hour * 60 + startWall.minute;
  const endMinutes = endWall.hour * 60 + endWall.minute;

  const baseDayNum = dateToDayNum(startWall.year, startWall.month, startWall.day);
  const endBaseDayNum = dateToDayNum(endWall.year, endWall.month, endWall.day);
  // ★ Usually 0; 1 if the block's own local time crosses midnight (23:30–00:15). Carried forward to
  //   every occurrence so a midnight-crossing block still ends the calendar day AFTER it starts.
  const dayOffset = endBaseDayNum - baseDayNum;

  const repeatUntilISO = toISODate(block.repeat_until);
  const skipped = new Set((block.skipped_dates ?? []).map(toISODate).filter(Boolean));

  const fromDayNum = dateToDayNum(...parseISO(fromISO));
  let toDayNum = dateToDayNum(...parseISO(toISO));
  if (repeatUntilISO) {
    toDayNum = Math.min(toDayNum, dateToDayNum(...parseISO(repeatUntilISO)));
  }
  const iterFrom = Math.max(fromDayNum, baseDayNum);
  const iterTo = toDayNum;

  if (iterTo < iterFrom) return [];
  if (iterTo - iterFrom > MAX_EXPANSION_DAYS) {
    throw invalid(
      `expandBlock's window is too wide (${iterTo - iterFrom} days) — pass a bounded fromDate/toDate`);
  }

  const push = (occurrences, dayNum) => {
    const occISO = dayNumToISO(dayNum);
    if (skipped.has(occISO)) return;
    const [y, m, d] = parseISO(occISO);
    const startsAt = zonedLocalToUtc(y, m, d, startMinutes, timeZone);
    const [ey, em, ed] = parseISO(dayNumToISO(dayNum + dayOffset));
    const endsAt = zonedLocalToUtc(ey, em, ed, endMinutes, timeZone);
    occurrences.push({ startsAt, endsAt });
  };

  const occurrences = [];
  if (block.repeat === "none") {
    if (baseDayNum >= iterFrom && baseDayNum <= iterTo) push(occurrences, baseDayNum);
    return occurrences;
  }

  for (let dayNum = iterFrom; dayNum <= iterTo; dayNum++) {
    if (block.repeat === "weekdays") {
      const dow = dowOfDayNum(dayNum);
      if (dow === 0 || dow === 6) continue;
    } else if (block.repeat === "weekly") {
      if ((dayNum - baseDayNum) % 7 !== 0) continue;
    }
    // 'daily' — every day in range, no further filter.
    push(occurrences, dayNum);
  }
  return occurrences;
}

/**
 * ★ Coach may block only their own `hostId`; owner/admin anyone. Fail-closed: any rank other than
 * 'owner'/'admin' acting on a host that is not themselves is refused — not only the literal `coach`
 * case the plan names, the same way `effectiveRank` itself fails closed on an unrecognised role.
 */
async function assertMayBlockHost(tx, { tenantId, hostId, actorUserId }) {
  if (hostId === actorUserId) return;
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["role", "staff_role"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", actorUserId));
  const rank = effectiveRank(rows[0] ?? null);
  if (rank !== "owner" && rank !== "admin") {
    throw forbidden("You may only block your own calendar.");
  }
}

/**
 * Create a block. Always succeeds if the caller may act on `hostId` — "Blocking won't cancel it":
 * any already-booked session inside the block's occurrences is reported back as a clash, never
 * cancelled or refused.
 *
 * @param tx a pg client INSIDE a transaction (tenant context already set)
 * @param input { tenantId, hostId, label, startsAt, endsAt, repeat, repeatUntil=null, actorUserId }
 * @returns { id, clashes: [{ bookingId, personName, startsAt }] }
 */
export async function createBlock(tx, input) {
  const {
    tenantId, hostId, label, startsAt, endsAt,
    repeat, repeatUntil = null, actorUserId,
  } = input;

  if (!tenantId) throw invalid("a block needs a tenantId");
  if (!hostId) throw invalid("a block needs a hostId — whose calendar is this?");
  if (!label || !String(label).trim()) throw invalid("a block needs a label");
  if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) {
    throw new TypeError("startsAt and endsAt must be Date instances (UTC instants)");
  }
  if (endsAt <= startsAt) throw new RangeError("endsAt must be after startsAt");
  if (!REPEAT_KINDS.includes(repeat)) {
    throw invalid(`repeat must be one of ${REPEAT_KINDS.join(", ")}`);
  }
  if (repeatUntil && repeat === "none") {
    throw invalid("repeatUntil only applies to a repeating block (0402's own booking_block_until_needs_repeat)");
  }

  // ═══ PERMISSION, BEFORE ANY WRITE — same ordering as createBooking.mjs's 7.18 guard. ═══
  await assertMayBlockHost(tx, { tenantId, hostId, actorUserId });

  const { rows: tzRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select(["timezone"])
    .where("id", "=", tenantId));
  const timeZone = tzRows[0]?.timezone ?? "UTC";

  const { rows } = await run(tx, db
    .insertInto("keystone.booking_block")
    .values({
      tenant_id: tenantId ?? null,
      host_id: hostId ?? null,
      label: String(label).trim() ?? null,
      starts_at: startsAt ?? null,
      ends_at: endsAt ?? null,
      repeat: repeat ?? null,
      repeat_until: repeatUntil ?? null,
      created_by: actorUserId ?? null,
    })
    .returning(["id", "tenant_id", "host_id", "label", "starts_at", "ends_at", "repeat", "repeat_until", "skipped_dates"]));
  const block = rows[0];

  // ═══ CLASH CHECK — the next 60 LOCAL days, informational only; the block stands regardless. ═══
  const nowWall = wallClockIn(new Date(), timeZone);
  const fromDate = `${nowWall.year}-${pad2(nowWall.month)}-${pad2(nowWall.day)}`;
  const toDate = addDaysISO(fromDate, 60);
  const occurrences = expandBlock(block, fromDate, toDate, timeZone);

  let clashes = [];
  if (occurrences.length > 0) {
    let minStart = occurrences[0].startsAt, maxEnd = occurrences[0].endsAt;
    for (const o of occurrences) {
      if (o.startsAt < minStart) minStart = o.startsAt;
      if (o.endsAt > maxEnd) maxEnd = o.endsAt;
    }
    // ★★ `keystone.booking` HAS NO `person_id` COLUMN — the person is recorded on
    //    `booking_participant` (party='client', its own snapshotted `display_name`, 0013/13.9), not
    //    on the booking row itself. `DISTINCT ON (b.id)` keeps this to one row per booking even for
    //    a group session with more than one client participant.
    const { rows: bookingRows } = await tx.query(
      `SELECT DISTINCT ON (b.id)
              b.id AS "bookingId", b.starts_at AS "startsAt", b.ends_at AS "endsAt",
              bp.display_name AS "personName"
         FROM keystone.booking b
         LEFT JOIN keystone.booking_participant bp
           ON bp.tenant_id = b.tenant_id AND bp.booking_id = b.id AND bp.party = 'client'
        WHERE b.tenant_id = $1 AND b.host_id = $2 AND b.state <> 'cancelled'
          AND b.starts_at < $4 AND b.ends_at > $3
        ORDER BY b.id, bp.display_name`,
      [tenantId, hostId, minStart, maxEnd]);

    clashes = bookingRows
      .filter((b) => occurrences.some((o) => o.startsAt < b.endsAt && b.startsAt < o.endsAt))
      .map((b) => ({ bookingId: b.bookingId, personName: b.personName, startsAt: b.startsAt }));
  }

  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: {
      block_id: block.id, change: "block_created",
      // ★ R24 (RECONCILE, the maintainer 27 Sep) — no `label`: a block's label is typed text ("Standing time off"), which emit()
      //   refuses in a payload (§2.4), so creating any block threw TopicViolation. block_id identifies it.
      host_id: hostId,
      starts_at: block.starts_at, ends_at: block.ends_at,
      repeat: block.repeat, repeat_until: block.repeat_until,
      // ★★ THE CLASH COUNT, NOT THE CLASHES. The clash list names real clients and the times of
      //    their sessions; an audit payload is read by a wider audience than the coach who made the
      //    block, and `outbox.mjs:109` already records that these payloads are a bounded vocabulary
      //    chosen for exactly this privacy reason. The count carries the fact that matters — this
      //    block was made over existing bookings — without carrying who they are.
      clash_count: clashes.length,
      clock: "tenant_local_wall_clock",
    },
  });
  return { id: block.id, clashes };
}

/**
 * Stop a (repeating) block from `fromDate` onward — sets `repeat_until = fromDate - 1`, a single
 * atomic UPDATE. A `repeat: 'none'` block has nothing to stop (0402's own
 * `booking_block_until_needs_repeat` CHECK would refuse the write); refused here first, as a named
 * 400, rather than surfacing that constraint's SQLSTATE.
 *
 * @param tx a pg client INSIDE a transaction (tenant context already set)
 * @param input { tenantId, blockId, fromDate }
 */
// ★ `actorUserId` added 25 Sep 2026 alongside this function's first emit — optional and defaulting
//   to null, exactly as `createBlock` already treats it, so every existing caller is unaffected and
//   `userActor(null)` degrades to the same system actor the sibling writes use.
export async function stopBlock(tx, { tenantId, blockId, fromDate, actorUserId = null }) {
  if (!tenantId) throw invalid("stopBlock needs a tenantId");
  if (!blockId) throw invalid("stopBlock needs a blockId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromDate ?? ""))) {
    throw invalid("stopBlock needs a YYYY-MM-DD fromDate");
  }

  const { rows: existing } = await run(tx, db
    .selectFrom("keystone.booking_block")
    .select(["id", "repeat"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", blockId));
  if (!existing.length) throw notFound("That block does not exist, or you cannot see it.");
  if (existing[0].repeat === "none") {
    throw invalid("This block does not repeat — it already covers only its one occurrence.");
  }

  const until = addDaysISO(fromDate, -1);
  const { rows } = await run(tx, db
    .updateTable("keystone.booking_block")
    .set({ repeat_until: until ?? null })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", blockId)
    .returning(["id", "repeat_until"]));

  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: {
      block_id: blockId, change: "block_stopped",
      // ★ A DATE, not a timestamp: `repeat_until` is a calendar day in the practice's own zone, and
      //   labelling the clock is the same discipline the sibling emits use — a consumer that
      //   assumed UTC would render the wrong day either side of midnight.
      repeat_until: rows[0]?.repeat_until ?? null,
      clock: "tenant_local_wall_clock",
    },
  });
  return rows[0];
}

/**
 * Skip one day of a (repeating or single) block — an idempotent single atomic UPDATE appending to
 * `skipped_dates` (no read-then-write: two concurrent skips of the same day cannot double-append or
 * lose each other, and skipping the same day twice is a no-op, not an error).
 *
 * @param tx a pg client INSIDE a transaction (tenant context already set)
 * @param input { tenantId, blockId, date }
 */
export async function skipBlockDay(tx, { tenantId, blockId, date, actorUserId = null }) {
  if (!tenantId) throw invalid("skipBlockDay needs a tenantId");
  if (!blockId) throw invalid("skipBlockDay needs a blockId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) {
    throw invalid("skipBlockDay needs a YYYY-MM-DD date");
  }

  const { rows } = await tx.query(
    `UPDATE keystone.booking_block
        SET skipped_dates = CASE WHEN $3::date = ANY(skipped_dates) THEN skipped_dates
                                  ELSE array_append(skipped_dates, $3::date) END
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, skipped_dates`,
    [tenantId, blockId, date]);
  if (!rows.length) throw notFound("That block does not exist, or you cannot see it.");

  // ★★ EMITTED AFTER the not-found check, so a skip that changed nothing emits nothing. ★ Note the
  //    UPDATE is deliberately idempotent (skipping the same day twice is a no-op), so this CAN emit
  //    for a second identical skip — a repeated intent is still an act somebody took, and the
  //    payload carries the full `skipped_dates` so a reader can see nothing moved.
  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: {
      block_id: blockId, change: "block_day_skipped",
      date, skipped_dates: rows[0]?.skipped_dates ?? null,
      clock: "tenant_local_wall_clock",
    },
  });
  return rows[0];
}
