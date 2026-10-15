// @ts-check
// TASK 13.22 — WORKING HOURS AS ONE SAVE, AND THE G20 QUEUE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THIS REPLACES. Weekly rules used to be edited one row at a time
//     (`createAvailabilityRule`/`endAvailabilityRule`, `src/booking/writes.mjs:46-98/101-…`, NEITHER
//     BODY TOUCHED HERE). `DialogHours` (specs/mockups/DialogHours.frame.html) edits a whole week and
//     saves it once — this file is that one save, built ON TOP of the two untouched functions, never
//     re-implementing what they already validate.
//
// ★★★ §B4 STEP 3 AGAIN, ONE LEVEL UP. `createAvailabilityRule`/`endAvailabilityRule` already store
//     wall-clock minutes with no timestamp — nothing here does instant arithmetic on a BOOKING. But a
//     week-SAVE has to decide "as of which calendar day does the old week stop and the new one start",
//     and THAT decision is a real calendar date, in the TENANT's zone, not the database session's. Using
//     SQL `CURRENT_DATE` there would ask the wrong question near midnight for a tenant whose zone lands
//     the boundary on a different day than the session's — so `tenantTodayISO` below measures "today"
//     the same way `src/booking/slots.mjs`'s `wallClockIn` measures every other wall-clock fact in this
//     codebase (Intl, not a UTC assumption), and both bounds (`effective_to` on the OLD rule, `effective_
//     from` on the NEW one) are computed from that one shared value so they can never disagree by a day.
//
// ★★★ A WEEK-SAVE NEVER TOUCHES `booking`. Ending a rule (`effective_to`) and inserting new ones only
//     changes what CAN be booked going forward — `keystone.booking` rows are never read, updated or
//     deleted by this file. §13.22's plan text does not describe checking existing booked shifts against
//     the new hours, and this file does not invent that check: a coach CAN narrow their hours under an
//     already-booked session with no warning today. Reported, not silently "fixed" — see the build report.
//
// ★★★ PERMISSION IS DB-BACKED, NOT A RANK GUESS. `src/people/scheduling.mjs`'s `mayEditHours` (task
//     12.3) answers the identical question — "may this viewer act on THIS host's `engagement` row" —
//     with `keystone.user_may(viewer, 'engagement', <verb>, host)`, which already encodes `Coach: own`
//     row only (scope 'owned'), Owner/Admin: everyone (scope 'everything')" from the seeded grant
//     (`src/permissions/defaults.mjs:104`, `EDIT_OWN` on `engagement` for coach). `setWeekHours` is
//     invoked directly as a `src/routes/writes.mjs` ROUTES-table `fn` (task 13.27a) with `subject: null`
//     — the central dispatcher's `assertMay` therefore asks only the CAPABILITY question ("can an
//     engagement be edited at all"), never the ROW-scope one, so the own-vs-other check has to live
//     HERE, inside the write, exactly as `src/people/bulk.mjs`'s header explains for its own per-row
//     `assertMay` calls. The verb ladder (`delete` implies `edit` implies `view`, `db/migrations/
//     0192…sql:57-59`) means the same one-line SQL call answers both the read scope (`readHours`'s
//     caller-side check, in `src/routes/engagementsHours.mjs`) and the write scope below, at 'view' and
//     'edit' respectively — a local helper mirroring `mayEditHours`'s SQL exactly, not importing across
//     the booking/people module boundary the plan's field 2 does not name.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, forbidden } from "../http/errors.mjs";
import { createAvailabilityRule, endAvailabilityRule, DAY_NAMES } from "./writes.mjs";
import { wallClockIn } from "./slots.mjs";
import { createManualTask } from "../tasks/writes.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { addDays, formatISO } from "date-fns";
import { TZDate } from "@date-fns/tz";

const DAY_INDEXES = Object.freeze([0, 1, 2, 3, 4, 5, 6]);

/** ★ Mirrors `src/booking/writes.mjs`'s private `assertMinute` exactly (that one is not exported —
 *  it is a module-private helper, not part of `writes.mjs`'s export surface — so the shape is
 *  reproduced here rather than reached into). Validating here, before any row is touched, means an
 *  invalid day in a 7-day submission fails the WHOLE save instead of leaving three days rewritten
 *  and four not. */
function assertMinuteLocal(label, m) {
  if (!Number.isInteger(m) || m < 0 || m > 1440) {
    throw invalid(
      `${label} must be an integer number of minutes after LOCAL midnight, 0–1440 — got ${JSON.stringify(m)}. ` +
      `These are wall-clock minutes, not a UTC instant (§B4 STEP 3).`);
  }
}

/** ★ Same one-line question `mayEditHours` (`src/people/scheduling.mjs:76`) asks, for either verb —
 *  the verb ladder means 'view' and 'edit' are both answerable through the same `user_may` call. */
async function mayActOnHours(tx, viewerId, hostId, verb) {
  const { rows } = await tx.query(
    `SELECT keystone.user_may($1, 'engagement', $3, $2) AS allowed`,
    [viewerId, hostId, verb]);
  return rows[0]?.allowed === true;
}

/** ★ "Today" in the TENANT's zone (Intl-measured, §B4 STEP 3 — see file header), as YYYY-MM-DD. */
function tenantTodayISO(timeZone) {
  const w = wallClockIn(new Date(), timeZone);
  return `${String(w.year).padStart(4, "0")}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** ★ Plain calendar-date arithmetic on Y/M/D already in hand — no zone conversion needed a second
 *  time, same technique `src/people/scheduling.mjs`'s `addDays` uses for the same reason. */
function isoDateMinusOneDay(iso) {
  return formatISO(addDays(new TZDate(new Date(iso + "T00:00:00Z").getTime(), "UTC"), -1), { representation: "date" });
}

/**
 * READ a host's current working hours — the open (`effective_to IS NULL`) `availability_rule` rows,
 * shaped as one entry PER DAY OF WEEK (0=Sunday…6=Saturday), always all seven, so a day with no rule
 * reads as `ranges: []` ("not working") rather than being absent from the array.
 *
 * ★ `listingMismatch` is always `null` here — computing it against the coach's connected Google
 *   listing is Stage 16's (task 16.24, per this task's field 10 / CT-F32); this task returns the key,
 *   honestly empty, rather than fabricate a comparison it cannot make.
 *
 * ★ NO PERMISSION CHECK IN THIS FUNCTION — its signature (plan field 4) carries no viewer at all.
 *   The "own only / any for Owner-Admin" question is the ROUTE's (`src/routes/engagementsHours.mjs`,
 *   this task; mounted by 13.27b), which resolves `hostId` BEFORE calling this, the same shape
 *   `src/routes/calendar.mjs`'s `resolveHostId` uses for the equivalent "own calendar + team read".
 */
export async function readHours(tx, { tenantId, hostId }) {
  if (!tenantId) throw new Error("readHours needs a tenantId");
  if (!hostId) throw invalid("hostId is required");

  const { rows } = await run(tx, db
    .selectFrom("keystone.availability_rule")
    .select(["day_of_week", "start_minute", "end_minute"])
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where("effective_to", "is", null)
    .orderBy("day_of_week", "asc")
    .orderBy("start_minute", "asc"));

  const days = DAY_INDEXES.map((dayOfWeek) => ({
    dayOfWeek,
    ranges: rows
      .filter((r) => r.day_of_week === dayOfWeek)
      .map((r) => ({ startMinute: r.start_minute, endMinute: r.end_minute })),
  }));

  return { hostId, days, listingMismatch: null };
}

/** ★ dayOfWeek → ranges, defaulting an unmentioned day to `[]` — the shape both `readHours`'s output
 *  and a partial `setWeekHours` submission are compared through, so "day left out of the payload" and
 *  "day submitted with an empty ranges array" read as the identical, correct thing: not working. */
function daysToRangesByDay(days) {
  const byDay = new Map(days.map((d) => [d.dayOfWeek, d.ranges]));
  return DAY_INDEXES.map((dow) => byDay.get(dow) ?? []);
}

function rangesEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.startMinute === b[i].startMinute && r.endMinute === b[i].endMinute);
}

function daysEqual(oldDays, newDays) {
  const a = daysToRangesByDay(oldDays);
  const b = daysToRangesByDay(newDays);
  return a.every((ranges, i) => rangesEqual(ranges, b[i]));
}

/**
 * SAVE a whole week of working hours in one write, per plan field 4:
 *   - validates every day/range in the submission (reusing `assertMinuteLocal`, `createAvailabilityRule`'s
 *     own swap/range check, and a same-day overlap check this function alone can ask, since a single
 *     `createAvailabilityRule` call sees only one range at a time);
 *   - ends EVERY currently open rule for the host, `effective_to` = the tenant-local day BEFORE today;
 *   - creates the submitted ranges as new rules, `effective_from` = the tenant-local today — so the two
 *     bounds can never leave a gap or an overlap day, both being the SAME measured "today";
 *   - when `fixGoogle` is true AND at least one day actually changed from what was there before, opens
 *     one manual task naming the mismatch to fix; otherwise queues nothing.
 *
 * @returns {Promise<{hours: object, queuedTaskId: string|null}>}
 */
export async function setWeekHours(tx, { tenantId, hostId, days, fixGoogle = false, actorUserId }) {
  if (!tenantId) throw new Error("setWeekHours needs a tenantId");
  if (!hostId) throw invalid("hostId is required");
  if (!actorUserId) throw new Error("setWeekHours needs actorUserId to track who changed it");
  if (!Array.isArray(days)) throw invalid("days must be an array of {dayOfWeek, ranges}");

  // ★★★ PERMISSIONS ARE DECIDED ON THE SERVER, ON EVERY REQUEST — see file header. This route is
  //     wired through writes.mjs's ROUTES table with `subject: null` (task 13.27a), which asks no
  //     per-row scope question; this is the only place that question gets asked for a POST.
  if (!(await mayActOnHours(tx, actorUserId, hostId, "edit"))) {
    throw forbidden("You can change only your own hours.");
  }

  const seenDays = new Set();
  const plan = [];
  for (const entry of days) {
    if (!entry || typeof entry !== "object") {
      throw invalid("each day entry must be an object with dayOfWeek and ranges");
    }
    const { dayOfWeek, ranges } = entry;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw invalid(`dayOfWeek must be 0 (Sunday) to 6 (Saturday) — got ${JSON.stringify(dayOfWeek)}`);
    }
    if (seenDays.has(dayOfWeek)) {
      throw invalid(`${DAY_NAMES[dayOfWeek]} was submitted more than once`);
    }
    seenDays.add(dayOfWeek);
    if (!Array.isArray(ranges)) {
      throw invalid(`${DAY_NAMES[dayOfWeek]}'s ranges must be an array`);
    }

    const normalised = ranges
      .map((r) => {
        assertMinuteLocal(`${DAY_NAMES[dayOfWeek]} startMinute`, r?.startMinute);
        assertMinuteLocal(`${DAY_NAMES[dayOfWeek]} endMinute`, r?.endMinute);
        if (r.endMinute <= r.startMinute) {
          throw invalid(
            `${DAY_NAMES[dayOfWeek]}: endMinute (${r.endMinute}) must be after startMinute ` +
            `(${r.startMinute}) — a window that ends before it starts is usually a swap.`);
        }
        return { startMinute: r.startMinute, endMinute: r.endMinute };
      })
      .sort((a, b) => a.startMinute - b.startMinute);

    for (let i = 1; i < normalised.length; i++) {
      if (normalised[i].startMinute < normalised[i - 1].endMinute) {
        throw invalid(`${DAY_NAMES[dayOfWeek]} has overlapping ranges — a window cannot start before the previous one ends`);
      }
    }

    plan.push({ dayOfWeek, ranges: normalised });
  }

  // ★ Read the BEFORE state to decide whether anything actually changed — the G20 task only fires
  //   when it did (plan field 4: "when fixGoogle is true AND at least one day changed").
  const before = await readHours(tx, { tenantId, hostId });
  const changed = !daysEqual(before.days, plan);

  const { rows: tzRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select(["timezone"])
    .where("id", "=", tenantId));
  const timeZone = tzRows[0]?.timezone ?? "UTC";
  const todayISO = tenantTodayISO(timeZone);
  const yesterdayISO = isoDateMinusOneDay(todayISO);

  const { rows: openRules } = await run(tx, db
    .selectFrom("keystone.availability_rule")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("host_id", "=", hostId)
    .where("effective_to", "is", null));
  for (const rule of openRules) {
    await endAvailabilityRule(tx, { tenantId, ruleId: rule.id, onDate: yesterdayISO, actorUserId });
  }
  for (const day of plan) {
    for (const range of day.ranges) {
      await createAvailabilityRule(tx, {
        tenantId, hostId, dayOfWeek: day.dayOfWeek,
        startMinute: range.startMinute, endMinute: range.endMinute,
        effectiveFrom: todayISO, actorUserId,
      });
    }
  }

  let queuedTaskId = null;
  if (fixGoogle && changed) {
    const { id } = await createManualTask(tx, {
      tenantId, topic: "run.listing.hours_fix", subjectType: "person", subjectId: hostId,
      title: "Update your Google listing to match your new hours",
      createdByAppUserId: actorUserId, assigneeId: actorUserId,
    });
    queuedTaskId = id;
  }

  const hours = await readHours(tx, { tenantId, hostId });
  return { hours, queuedTaskId };
}
