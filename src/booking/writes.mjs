// @ts-check
// P15B.10 — THE ENGAGEMENTS WRITES. availability_rule · date_override · booking_policy ·
//           booking_participant.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ §B4 STEP 3 — LOCAL WALL-CLOCK PLUS AN IANA ZONE. NEVER A STORED UTC INSTANT.
// ═════════════════════════════════════════════════════════════════════════════
// [MEASURED from the catalog] `availability_rule` stores `day_of_week` (0–6) and `start_minute` /
// `end_minute` (0–1440). There is no timestamp anywhere in it, and that is the design:
//   ★ "Tuesdays, 9am to 5pm" is a rule about a CLOCK, not about a set of instants. Stored as UTC it
//     would silently become 8am-to-4pm for half the year, because the offset a zone applies changes
//     and the rule does not. A coach who set 9am does not expect it to move when the clocks do.
//   ★★ The zone comes from `tenant.timezone`, which `assertStartupInvariants` refuses to start without
//      — so "which clock" is never ambiguous and never guessed per row.
// ★ Therefore NOTHING in this file accepts or produces a UTC instant for availability, and the minute
//   values are validated as minutes-since-local-midnight.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound, forbidden } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
// ★ 13.16 — the one new import this task adds; `setBookingFlag`'s audit row (below) is the only
//   caller in this file. Nothing else in writes.mjs touches `writeAudit`.
import { writeAudit } from "../permissions/audit.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "booking";

/** The parties a booking participant may be. ★ No `both` — a participant is a real, present party. */
export const PARTICIPANT_PARTIES = Object.freeze(
  ["pir", "parent", `coach`, "client", "consultant", "familyMember", "recipient"]);

export const DAY_NAMES = Object.freeze(
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

/** ★ 0–1440, integer. 1440 is midnight-at-the-end-of-day and IS valid as an end. */
function assertMinute(label, m) {
  if (!Number.isInteger(m) || m < 0 || m > 1440) {
    throw invalid(
      `${label} must be an integer number of minutes after LOCAL midnight, 0–1440 — got ${JSON.stringify(m)}. ` +
      `These are wall-clock minutes, not a UTC instant (§B4 STEP 3).`);
  }
}

/**
 * Add a weekly availability rule for a host.
 * @param dayOfWeek 0 = Sunday … 6 = Saturday
 */
export async function createAvailabilityRule(
  tx, { tenantId, hostId, dayOfWeek, startMinute, endMinute, effectiveFrom = null, effectiveTo = null,
        actorUserId = null }
) {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw invalid(`dayOfWeek must be 0 (Sunday) to 6 (Saturday) — got ${JSON.stringify(dayOfWeek)}`);
  }
  assertMinute("startMinute", startMinute);
  assertMinute("endMinute", endMinute);
  // ★★ REFUSED HERE, not left to `rule_is_forward`, because the caller's mistake is almost always a
  //    swap and the message can say so. An overnight window is NOT expressible as one rule and must
  //    not be silently accepted as a zero-length one.
  if (endMinute <= startMinute) {
    throw invalid(
      `endMinute (${endMinute}) must be after startMinute (${startMinute}) — a window that ends before ` +
      `it starts is usually a swap. A span crossing local midnight needs two rules, one per day.`);
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await tx.query(
      `INSERT INTO keystone.availability_rule
         (id, tenant_id, host_id, day_of_week, start_minute, end_minute, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6, coalesce($7::date, CURRENT_DATE), $8)`,
      [id, tenantId, hostId, dayOfWeek, startMinute, endMinute, effectiveFrom, effectiveTo]);
  } catch (e) {
    if (e.code === CHECK_VIOLATION) throw invalid(`the database refused this rule: ${e.constraint ?? e.message}`);
    throw e;
  }

  await emit(tx, {
    tenantId,
    topic: "booking.availability.changed",
    emittedBy: SECTION,
    subjectType: "availability_rule",
    subjectId: id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ The payload names the DAY and the MINUTES, and says explicitly that they are wall-clock. A
    //   consumer that assumed UTC would render the wrong time half the year, and the payload is the
    //   only place it can learn otherwise.
    payload: {
      host_id: hostId, day_of_week: dayOfWeek, day: DAY_NAMES[dayOfWeek],
      start_minute: startMinute, end_minute: endMinute,
      clock: "tenant_local_wall_clock",
    },
  });
  return { id, day_of_week: dayOfWeek, start_minute: startMinute, end_minute: endMinute };
}

/**
 * Close a weekly rule (set `effective_to`) rather than deleting it.
 * ★★ A DELETED RULE MAKES PAST BOOKINGS INEXPLICABLE. "Why was that slot offered in March?" is only
 *    answerable if the rule that offered it still exists with the window it applied to.
 */
export async function endAvailabilityRule(tx, { tenantId, ruleId, onDate = null, actorUserId = null }) {
  const r = await tx.query(
    `UPDATE keystone.availability_rule
        SET effective_to = coalesce($2::date, CURRENT_DATE)
      WHERE id = $1 AND effective_to IS NULL
      RETURNING host_id, day_of_week, effective_to`,
    [ruleId, onDate]);
  if (r.rowCount === 0) throw conflict("no open availability rule with that id in this organisation");

  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: "availability_rule", subjectId: ruleId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: {
      host_id: r.rows[0].host_id, day_of_week: r.rows[0].day_of_week,
      ended_on: r.rows[0].effective_to, clock: "tenant_local_wall_clock",
    },
  });
  return { id: ruleId, effective_to: r.rows[0].effective_to };
}

/**
 * A single-date override — either "not available at all" or "available only between these minutes".
 *
 * ★★★ `override_shape` MAKES THE TWO CASES EXCLUSIVE: unavailable requires BOTH minutes NULL;
 *     available requires BOTH set and ordered. So "available, times to be decided" is unrepresentable,
 *     which is correct — it would offer a day with no hours and the slot search would return nothing
 *     while the calendar claimed the host was working.
 */
export async function upsertDateOverride(
  tx, { tenantId, hostId, onDate, isAvailable, startMinute = null, endMinute = null, reason = null,
        actorUserId = null }
) {
  if (!onDate) throw invalid("onDate is required");
  // ★★ STAGE 20 — THE ROW-SCOPE QUESTION THIS WRITE NEVER ASKED. Its ROUTES entry is `subject: null`
  //    (capability only), so before this any coach could change ANY coach's day. Same one-line
  //    `user_may` question `setWeekHours` (hours.mjs `mayActOnHours`) asks for the whole week.
  await assertMayEditHost(tx, actorUserId, hostId);
  if (typeof isAvailable !== "boolean") {
    throw invalid("isAvailable must be true or false — an override with no direction says nothing");
  }
  if (isAvailable) {
    if (startMinute === null || endMinute === null) {
      throw invalid("an AVAILABLE override needs both startMinute and endMinute — a day open for no hours is not open");
    }
    assertMinute("startMinute", startMinute);
    assertMinute("endMinute", endMinute);
    if (endMinute <= startMinute) throw invalid(`endMinute (${endMinute}) must be after startMinute (${startMinute})`);
  } else if (startMinute !== null || endMinute !== null) {
    // ★ Refused rather than ignored: minutes on an unavailable day mean the caller believes they are
    //   setting hours, and dropping them silently would leave them thinking the host is available.
    throw invalid("an UNAVAILABLE override cannot carry minutes — it closes the whole day");
  }

  // ★★ ONE OVERRIDE PER HOST PER DATE (`UNIQUE (tenant_id, host_id, on_date)`), so this is an UPSERT.
  //    Two rows for one date would be two answers to one question, and the resolver would pick
  //    arbitrarily.
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const { rows } = await tx.query(
    `INSERT INTO keystone.date_override
       (id, tenant_id, host_id, on_date, is_available, start_minute, end_minute, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, host_id, on_date) DO UPDATE
       SET is_available = EXCLUDED.is_available,
           start_minute = EXCLUDED.start_minute,
           end_minute   = EXCLUDED.end_minute,
           reason       = EXCLUDED.reason
     RETURNING id, (xmax <> 0) AS replaced`,
    [id, tenantId, hostId, onDate, isAvailable, startMinute, endMinute, reason]);

  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: "date_override", subjectId: rows[0].id,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    payload: {
      host_id: hostId, on_date: onDate, is_available: isAvailable,
      start_minute: startMinute, end_minute: endMinute,
      // ★ `replaced` distinguishes a new override from a changed one — `xmax <> 0` is true only when
      //   ON CONFLICT actually updated. A consumer notifying affected clients needs to know which.
      replaced: rows[0].replaced,
      clock: "tenant_local_wall_clock",
    },
  });
  return { id: rows[0].id, replaced: rows[0].replaced, is_available: isAvailable };
}

/** ★ Stage 20 — "may this person edit THIS host's availability". Coach: own only; Owner/Admin: any
 *  (the seeded `engagement` grant, scope owned/everything). A missing actor is refused, never waved. */
export async function assertMayEditHost(tx, actorUserId, hostId) {
  if (!hostId) throw invalid("hostId is required");
  if (!actorUserId) throw forbidden("You can change only your own hours.");
  const { rows } = await tx.query(
    `SELECT keystone.user_may($1, 'engagement', 'edit', $2) AS allowed`, [actorUserId, hostId]);
  if (rows[0]?.allowed !== true) throw forbidden("You can change only your own hours.");
}

/** ★ Stage 20 — put one date back to the usual week. Deleting the override IS the revert (the
 *  weekly rule is still there underneath); emits the same topic every availability change does. */
export async function removeDateOverride(tx, { tenantId, hostId, onDate, actorUserId = null }) {
  if (!onDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(onDate))) throw invalid("onDate must be YYYY-MM-DD");
  await assertMayEditHost(tx, actorUserId, hostId);
  const { rows } = await tx.query(
    `DELETE FROM keystone.date_override WHERE tenant_id = $1 AND host_id = $2 AND on_date = $3::date
     RETURNING id`, [tenantId, hostId, onDate]);
  if (rows.length === 0) throw notFound("that day has no change to remove");
  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: "date_override", subjectId: rows[0].id, actor: userActor(actorUserId),
    payload: { host_id: hostId, on_date: onDate, removed: true, clock: "tenant_local_wall_clock" },
  });
  return { removed: true, onDate };
}

/** ★ Stage 20 (0498) — the daily cap. `maxPerDay: null` removes it (no row = no cap). */
export async function setHostDailyCap(tx, { tenantId, hostId, maxPerDay, actorUserId = null }) {
  await assertMayEditHost(tx, actorUserId, hostId);
  if (maxPerDay === null) {
    await run(tx, db
      .deleteFrom("keystone.host_booking_limit")
      .where("tenant_id", "=", tenantId)
      .where("host_id", "=", hostId));
  } else {
    if (!Number.isInteger(maxPerDay) || maxPerDay < 1 || maxPerDay > 48) {
      throw invalid("maxPerDay must be a whole number from 1 to 48, or null for no limit");
    }
    await tx.query(
      `INSERT INTO keystone.host_booking_limit (tenant_id, host_id, max_per_day, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, host_id) DO UPDATE
         SET max_per_day = EXCLUDED.max_per_day, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, hostId, maxPerDay, actorUserId]);
  }
  await emit(tx, {
    tenantId, topic: "booking.availability.changed", emittedBy: SECTION,
    subjectType: "host_booking_limit", subjectId: hostId, actor: userActor(actorUserId),
    payload: { host_id: hostId, max_per_day: maxPerDay },
  });
  return { hostId, maxPerDay };
}

/**
 * Set the booking policy for a service. One policy per service (`UNIQUE (tenant_id, service_id)`).
 * ★ Every value is a MINUTE COUNT or a DAY COUNT — a duration, not a time — so none of them has a
 *   timezone problem. That is why they are safe to store as plain integers while availability is not.
 */
export async function setBookingPolicy(tx, { tenantId, serviceId, ...p }) {
  // ★★★ `serviceId` IS REQUIRED AND WAS NEVER CHECKED — FOUND BY P21C.2 CALLING EVERY ROUTE.
  //     Every OPTIONAL field below is validated carefully; the one MANDATORY field was not, so a body
  //     without it sailed past all of that and hit Postgres as
  //     `23502 null value in column "service_id" … violates not-null constraint` — a **500**.
  //   ★★ A policy with no service is meaningless (the whole row is "the rules for booking THIS
  //      service"), so this is a refusal the caller needs by name, not a server error they might retry.
  if (!serviceId) {
    throw invalid("serviceId is required — a booking policy is the rules for booking one service, " +
                  "so there is nothing for a policy with no service to govern");
  }
  const fields = {
    buffer_before_minutes: p.bufferBeforeMinutes,
    buffer_after_minutes: p.bufferAfterMinutes,
    minimum_notice_minutes: p.minimumNoticeMinutes,
    booking_window_days: p.bookingWindowDays,
    cancellation_notice_minutes: p.cancellationNoticeMinutes,
    // ★ Stage 20 (0498). `null` is meaningful here — "use the practice's interval" — so it is
    //   written through rather than skipped; the CHECK names the allowed values.
    start_interval_minutes: p.startIntervalMinutes,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (k === "start_interval_minutes") {
      if (v !== null && ![5, 10, 15, 20, 30, 45, 60, 90, 120].includes(v)) {
        throw invalid("startIntervalMinutes must be one of 5, 10, 15, 20, 30, 45, 60, 90 or 120 — or null for the practice default");
      }
      continue;
    }
    if (!Number.isInteger(v) || v < 0) throw invalid(`${k} must be a non-negative integer — got ${JSON.stringify(v)}`);
    if (k === "booking_window_days" && v === 0) {
      // ★ Refused explicitly: a zero-day window means nothing can ever be booked, which looks like a
      //   broken booking page rather than a policy. The CHECK says `> 0`; this says why.
      throw invalid("booking_window_days must be at least 1 — a zero-day window makes booking impossible");
    }
  }

  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const vals = cols.map((k) => fields[k]);
  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;

  // ★ Columns not supplied fall to their DEFAULTS on insert and are LEFT ALONE on update — so a
  //   partial update cannot silently reset a policy value the caller did not mention.
  const insertCols = ["id", "tenant_id", "service_id", ...cols];
  const insertVals = [id, tenantId, serviceId, ...vals];
  const setClause = cols.length
    ? cols.map((k) => `${k} = EXCLUDED.${k}`).join(", ")
    : "service_id = EXCLUDED.service_id"; // ★ a no-op SET so ON CONFLICT is still valid

  const { rows } = await tx.query(
    `INSERT INTO keystone.booking_policy (${insertCols.join(", ")})
     VALUES (${insertVals.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (tenant_id, service_id) DO UPDATE SET ${setClause}
     RETURNING id, (xmax <> 0) AS replaced, buffer_before_minutes, buffer_after_minutes,
               minimum_notice_minutes, booking_window_days, cancellation_notice_minutes,
               start_interval_minutes`,
    insertVals);

  await emit(tx, {
    tenantId, topic: "booking.policy.changed", emittedBy: SECTION,
    subjectType: "booking_policy", subjectId: rows[0].id,
    // ★ STAGE 3 TASK 1 — `p` is the `...rest` of the routes/writes.mjs spread object after
    //   `tenantId`/`serviceId` are pulled off, so `p.actorUserId` is the session id.
    actor: userActor(p.actorUserId),
    // ★ The WHOLE effective policy is in the payload, not just the changed fields: a consumer deciding
    //   whether a cancellation is inside notice needs every value, and a partial payload would make it
    //   re-read — at which point it might read a later change and answer about the wrong policy.
    payload: {
      service_id: serviceId, replaced: rows[0].replaced,
      buffer_before_minutes: rows[0].buffer_before_minutes,
      buffer_after_minutes: rows[0].buffer_after_minutes,
      minimum_notice_minutes: rows[0].minimum_notice_minutes,
      booking_window_days: rows[0].booking_window_days,
      cancellation_notice_minutes: rows[0].cancellation_notice_minutes,
      start_interval_minutes: rows[0].start_interval_minutes,
    },
  });
  return { id: rows[0].id, replaced: rows[0].replaced };
}

/**
 * Add a participant to a booking.
 * ★★★ `party` IS REQUIRED AND MUST NAME A REAL PARTY. CLAUDE.md §2.7 — "name the party you mean, never
 *     borrow another's", and the recorded live defect is a GLT tech client appearing under a PIR badge.
 *     There is no default and no fallback here for exactly that reason.
 * ★ `appUserId` is OPTIONAL because a participant need not have an account — a family member attending
 *   one session is a real participant with no login. `display_name` is therefore NOT NULL: it is the
 *   only thing guaranteed to identify them.
 */
export async function addBookingParticipant(
  tx, { tenantId, bookingId, party, displayName, appUserId = null, email = null, actorUserId = null }
) {
  if (!PARTICIPANT_PARTIES.includes(party)) {
    throw invalid(
      `party must name a real party — one of ${PARTICIPANT_PARTIES.join(", ")}. There is no default: a ` +
      `participant recorded under the wrong party's name is how a tech client ends up labelled as a ` +
      `person in recovery (§2.7).`);
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    throw invalid("displayName is required — a participant with no name cannot be identified on an attendance list");
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 13.10 — THE SEAT GUARD. `createBooking` (13.9) only decides what `capacity` STARTS as;
  //     THIS is the write that has to hold that count against two simultaneous joins, and until
  //     now nothing did — a validation-only read-then-insert lets an eleventh person into a
  //     ten-seat class. `client` and `pir` are the only parties that occupy a SEAT (a parent, a
  //     coach, a family member attending are all real participants but never compete for the
  //     room's capacity).
  //   ★★ THE SAME MECHANISM 13.9 NAMED, NOT A SECOND ONE: `SELECT … FOR UPDATE` on the booking row
  //      (serialises two joins on the SAME booking) PLUS the SAME host-keyed advisory-lock key
  //      `createBooking.mjs`'s guard 2 uses (`booking:${tenantId}:${hostId}`, through
  //      `hashtextextended`) — two different locking schemes over one resource is the same as no
  //      lock at all.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (party === "client" || party === "pir") {
    const { rows: bookingRows } = await tx.query(
      `SELECT host_id, capacity, state FROM keystone.booking
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, bookingId]);
    if (!bookingRows.length) throw notFound("no such booking");
    const { host_id: hostId, capacity, state } = bookingRows[0];
    if (state === "cancelled" || state === "completed" || state === "no_show") {
      throw conflict(`this booking is ${state.replace("_", " ")} — nobody can be added to it now.`);
    }

    // ★ Same key, same construction as createBooking.mjs's guard 2 — see that file's own note on
    //   why the lock names the HOST (the thing actually being serialised) rather than a row.
    await tx.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`booking:${tenantId}:${hostId}`]);

    const { rows: countRows } = await tx.query(
      `SELECT count(*)::int AS taken FROM keystone.booking_participant
        WHERE tenant_id = $1 AND booking_id = $2 AND party IN ('client', 'pir')`,
      [tenantId, bookingId]);
    const taken = countRows[0].taken;
    const seats = capacity ?? 1;
    if (taken >= seats) {
      throw conflict(
        "That was the last place — it just went. Join the waitlist?", { field: "capacity" });
    }
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.booking_participant")
      .values({
        id: id ?? null,
        tenant_id: tenantId ?? null,
        booking_id: bookingId ?? null,
        app_user_id: appUserId ?? null,
        display_name: displayName.trim() ?? null,
        email: email ?? null,
        party: party ?? null,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(
        `${displayName.trim()} is already on this booking as "${party}" — add them under a different ` +
        `party if they are attending in two capacities`, { field: "display_name" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "booking.participant.added", emittedBy: SECTION,
    subjectType: "booking", subjectId: bookingId,
    // ★ FIX ROUND 1, I1.
    actor: userActor(actorUserId),
    // ★ Subject is the BOOKING, not the participant row: the fact is "this booking gained someone",
    //   and a feed on the booking's record page is where it belongs.
    payload: { participant_id: id, party, has_account: appUserId !== null },
  });
  return { id, party, display_name: displayName.trim() };
}

/**
 * Mark attendance. ★ `attended` is nullable on purpose — NULL means "not yet recorded", which is a
 * different fact from `false` ("did not attend"). Collapsing them would make every future session look
 * like a no-show.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ P6.26 — TWO SHAPES, ONE ROUTE, AND `outcome` IS THE DISCRIMINATOR.
 *
 *   `POST /api/engagements/attendance` is the only attendance endpoint that exists, and the P6.26
 *   control has to close the BOOKING (which is what emits `booking.booking.completed`), not just
 *   tick one person. Rather than add a second route — `src/routes/writes.mjs` is shared with three
 *   other section batches building concurrently, and a lost write there has nothing to diff
 *   against — the existing route learns the whole-booking shape.
 *
 * ★★ THE DISCRIMINATOR IS `outcome`, NOT `bookingId`, AND THAT IS MEASURED RATHER THAN CHOSEN.
 *    `db/gates/fixtures/seedWorld.mjs:142` ALREADY posts `{bookingId, participantId, attended}` and
 *    `verify/p16_journey.mjs:238` posts the participant shape. Branching on `bookingId` would have
 *    silently changed what seedWorld's call means and broken a fixture every other gate builds on.
 *    Branching on a field neither of them sends cannot.
 * ★ A body carrying BOTH is refused rather than resolved: it is two different requests, and picking
 *   one would leave the caller believing the other also happened.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
export async function setAttendance(tx, args) {
  const { tenantId, participantId, attended, outcome } = args;
  if (outcome !== undefined) {
    if (participantId !== undefined && attended !== undefined) {
      throw invalid(
        "send either a single participant ({participantId, attended}) or a whole booking " +
        "({bookingId, outcome, participants}) — a body carrying both is two different requests, " +
        "and answering one of them would leave you believing the other happened too.");
    }
    // ★ Imported lazily so `writes.mjs` and `attendance.mjs` can reference each other in comments
    //   without a module cycle at load time.
    const { recordAttendance } = await import("./attendance.mjs");
    return recordAttendance(tx, args);
  }
  if (typeof attended !== "boolean") {
    throw invalid(
      "attended must be true or false — leave it unset to mean 'not yet recorded'. NULL and false are " +
      "different facts, and treating an unheld session as a no-show would be wrong in the record.");
  }
  const r = await run(tx, db
    .updateTable("keystone.booking_participant")
    .set({ attended: attended ?? null })
    .where("id", "=", participantId)
    .returning(["booking_id", "party"]));
  if (r.rowCount === 0) throw notFound("no such booking participant in this organisation");

  await emit(tx, {
    tenantId, topic: "booking.participant.added", emittedBy: SECTION,
    subjectType: "booking", subjectId: r.rows[0].booking_id,
    // ★ STAGE 3 TASK 1 — `args` is the whole routes/writes.mjs spread object (not destructured by
    //   this function), so `args.actorUserId` is the session id.
    actor: userActor(args.actorUserId),
    // ★★ REUSES `participant.added` BECAUSE THE CATALOGUE HAS NO `attendance.recorded`, and a topic is
    //    a schema change, not a string (P15B.3). The payload says `attendance_recorded: true` so a
    //    consumer can tell the two apart — borrowing a topic silently would make the feed claim
    //    somebody was added when they were marked present.
    payload: { participant_id: participantId, party: r.rows[0].party, attendance_recorded: true, attended },
  });
  return { id: participantId, attended };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 13.16 — A TEAM FLAG, NOT A CHARGE. `flag`/`flag_note` (0399) are read by the person`s coach`
//     on every session with them (CalendarFlagModal, 13.28); they never reach `/api/app/*` or
//     `/api/public/*`, same discipline as `app_user.care_note`'s own migration comment. Nothing
//     here decides, implies or triggers a charge — that stays a business decision made elsewhere,
//     never a side effect of writing what happened.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const BOOKING_FLAGS = Object.freeze(["longer_slot", "first_session", "be_careful", "other"]);
const EXCLUSION_VIOLATION = "23P01";

/**
 * Set (or clear, with `flag: null`) the team-visible flag on a booking.
 *
 * ★ `be_careful` is the one flag that is about the PERSON rather than the session: it writes
 *   `app_user.care_note` for the booking's client participant, and the booking itself only carries
 *   `flag='be_careful'` — no `flag_note`, so the note is never duplicated in two places that could
 *   disagree. Every other flag (`longer_slot`, `first_session`, `other`, or `null` to clear) writes
 *   `booking.flag`/`booking.flag_note` directly, in one statement; `longer_slot` additionally grows
 *   `buffer_after_minutes` by 30 in that SAME statement, so "blocks the time after it" and the flag
 *   itself are one atomic fact, never a read-then-write a second actor could race.
 *
 * @param tx            a tenant-scoped client inside a transaction
 * @param tenantId      from the GUC, never from the body
 * @param bookingId     the session being flagged
 * @param flag          one of BOOKING_FLAGS, or null to clear
 * @param note          flag_note (or, for be_careful, the person's care_note); null clears it
 * @param actorUserId   who set it, from the session
 */
export async function setBookingFlag(tx, { tenantId, bookingId, flag, note = null, actorUserId }) {
  if (flag !== null && !BOOKING_FLAGS.includes(flag)) {
    throw invalid(
      `flag must be one of ${BOOKING_FLAGS.join(", ")}, or null to clear — got ${JSON.stringify(flag)}`);
  }
  if (flag === "other" && !note) {
    throw invalid("Say what the flag is for.");
  }

  if (flag === "be_careful") {
    // ★ The booking's client participant, if one has an account — same `party = 'client'` closed
    //   vocabulary `calendarPush.mjs`/`blocks.mjs`/`history.mjs` already read by (0013's CHECK).
    const { rows: clientRows } = await run(tx, db
      .selectFrom("keystone.booking_participant")
      .select("app_user_id")
      .where("booking_id", "=", bookingId)
      .where("party", "=", "client")
      .where("app_user_id", "is not", null)
      .orderBy("id", "asc")
      .limit(1));
    const clientAppUserId = clientRows[0]?.app_user_id;
    if (!clientAppUserId) {
      throw invalid("this booking has no client with an account to flag — a care note is written to the person's record");
    }
    await run(tx, db
      .updateTable("keystone.app_user")
      .set({ care_note: note ?? null })
      .where("id", "=", clientAppUserId));
    const r = await run(tx, db
      .updateTable("keystone.booking")
      .set({ flag: "be_careful", flag_note: null })
      .where("id", "=", bookingId)
      .returning(["id", "flag"]));
    if (r.rowCount === 0) throw notFound("no such booking in this organisation");
  } else {
    // ★★ ONE STATEMENT for flag + flag_note + (only for longer_slot) the buffer grow, so the
    //    `booking_occupies_biu` trigger (0013) re-derives `occupies` exactly once per call and a
    //    concurrent booking right after this slot is caught by the SAME EXCLUDE constraint
    //    `createBooking`/`reschedule` already rely on — never a second, hand-written overlap check.
    try {
      const r = await tx.query(
        `UPDATE keystone.booking
            SET flag = $2, flag_note = $3,
                buffer_after_minutes = buffer_after_minutes + CASE WHEN $2 = 'longer_slot' THEN 30 ELSE 0 END
          WHERE id = $1
          RETURNING id, flag`,
        [bookingId, flag, note]);
      if (r.rowCount === 0) throw notFound("no such booking in this organisation");
    } catch (e) {
      if (e.code === EXCLUSION_VIOLATION) {
        throw conflict("Something is already booked right after — move it first.");
      }
      throw e;
    }
  }

  // ★ Same idiom `src/permissions/audit.mjs`'s own `writeAudit` documents for `settings.changed`:
  //   `reason` carries which flag was set (or null, on a clear) — never a second free-text field.
  await writeAudit(tx, {
    tenantId, action: "settings.changed", object: "engagement.flag",
    subjectId: bookingId, actorUserId, reason: flag,
  });

  return { id: bookingId, flag };
}

/**
 * ★★★ TASK C1.1 — MERGED BOOKING POLICY: PRACTICE DEFAULT + PER-SERVICE OVERRIDE
 *
 * Returns the effective booking policy for a service. Practice defaults live in tenant_setting;
 * per-service overrides live on booking_policy. Service values win.
 *
 * @param {object} tx           transaction client
 * @param {uuid}   tenantId     the practice
 * @param {uuid}   serviceId    the service
 * @returns merged policy object with all keys, service values taking precedence
 *
 * ★★ ALL POLICY KEYS ARE INCLUDED, SO A CONSUMER NEVER RE-READS — they get the whole answer, and
 *    nothing changes under their feet between this call and when they use it. (Same rule as the
 *    no-show percentage payload in 06-29 and the reminders row in P2.5.)
 */
export async function policyFor(tx, tenantId, serviceId) {
  // ★ Read practice defaults from tenant_setting. Each getSetting call returns the practice value
  //   if set, or the RULING DEFAULT if unset (never an error).
  const practiceDefaults = {
    client_may_book: await getSetting(tx, 'booking.client_may_book', true),
    client_may_reschedule: await getSetting(tx, 'booking.client_may_reschedule', true),
    client_may_cancel: await getSetting(tx, 'booking.client_may_cancel', true),
    reschedule_notice_minutes: await getSetting(tx, 'booking.reschedule_notice_minutes', 1440),
    late_cancel_behaviour: await getSetting(tx, 'booking.late_cancel_behaviour', 'free'),
    late_cancel_charge_percent: await getSetting(tx, 'booking.late_cancel_charge_percent', 0),
    card_required_at_booking: await getSetting(tx, 'booking.card_required_at_booking', false),
    card_kept_on_file: await getSetting(tx, 'booking.card_kept_on_file', false),
    cancel_requires_contact: await getSetting(tx, 'booking.cancel_requires_contact', false),
    policy_text: await getSetting(tx, 'booking.policy_text', null),
    // ★ Stage 13 (F05) — practice-wide window/notice/gap. Applied on top of anything a service
    //   sets for itself (window_days/notice_minutes as the service's own fallback; gap_* summed
    //   with the service's own buffer, below).
    window_days: await getSetting(tx, 'booking.window_days', 60),
    notice_minutes: await getSetting(tx, 'booking.notice_minutes', 120),
    gap_before_minutes: await getSetting(tx, 'booking.gap_before_minutes', 0),
    gap_after_minutes: await getSetting(tx, 'booking.gap_after_minutes', 0),
    // ★ Stage 20 (0498) — how often a slot may start. 30 = Calendly's and Acuity's own default.
    start_interval_minutes: await getSetting(tx, 'booking.start_interval_minutes', 30),
  };

  // ★ Read per-service overrides from booking_policy (both existing and new columns).
  //   NULL columns mean "use practice default" for the new keys.
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_policy")
    .select([
      "buffer_before_minutes",
      "buffer_after_minutes",
      "minimum_notice_minutes",
      "booking_window_days",
      "cancellation_notice_minutes",
      "payment_mode",
      "deposit_amount_minor",
      "client_may_book",
      "client_may_reschedule",
      "client_may_cancel",
      "reschedule_notice_minutes",
      "late_cancel_behaviour",
      "late_cancel_charge_percent",
      "card_required_at_booking",
      "card_kept_on_file",
      "cancel_requires_contact",
      "policy_text",
      "start_interval_minutes",
    ])
    .where("tenant_id", "=", tenantId)
    .where("service_id", "=", serviceId));

  const serviceOverrides = rows[0] ?? {};

  // ★★ MERGE: service values win over practice defaults. For the new keys, NULL means use default.
  //    The existing fields (buffers, notice, window) have their own defaults in the schema and are
  //    always present on the row if it exists.
  return {
    // Existing fields — always present on booking_policy or defaulted in schema
    // ★ Stage 13 (F05) — the practice's gap_before/after is ADDED to the service's own buffer
    //   ("Applied on top of anything a service sets for itself"), never a fallback that a
    //   service-level buffer would replace.
    buffer_before_minutes: (serviceOverrides.buffer_before_minutes ?? 0) + practiceDefaults.gap_before_minutes,
    buffer_after_minutes: (serviceOverrides.buffer_after_minutes ?? 0) + practiceDefaults.gap_after_minutes,
    minimum_notice_minutes: serviceOverrides.minimum_notice_minutes ?? practiceDefaults.notice_minutes,
    booking_window_days: serviceOverrides.booking_window_days ?? practiceDefaults.window_days,
    start_interval_minutes: serviceOverrides.start_interval_minutes ?? practiceDefaults.start_interval_minutes,
    cancellation_notice_minutes: serviceOverrides.cancellation_notice_minutes ?? 1440,
    payment_mode: serviceOverrides.payment_mode ?? 'free',
    deposit_amount_minor: serviceOverrides.deposit_amount_minor ?? null,
    // New keys — NULL on booking_policy means use practice default
    client_may_book: serviceOverrides.client_may_book !== null && serviceOverrides.client_may_book !== undefined
      ? serviceOverrides.client_may_book : practiceDefaults.client_may_book,
    client_may_reschedule: serviceOverrides.client_may_reschedule !== null && serviceOverrides.client_may_reschedule !== undefined
      ? serviceOverrides.client_may_reschedule : practiceDefaults.client_may_reschedule,
    client_may_cancel: serviceOverrides.client_may_cancel !== null && serviceOverrides.client_may_cancel !== undefined
      ? serviceOverrides.client_may_cancel : practiceDefaults.client_may_cancel,
    reschedule_notice_minutes: serviceOverrides.reschedule_notice_minutes !== null && serviceOverrides.reschedule_notice_minutes !== undefined
      ? serviceOverrides.reschedule_notice_minutes : practiceDefaults.reschedule_notice_minutes,
    late_cancel_behaviour: serviceOverrides.late_cancel_behaviour !== null && serviceOverrides.late_cancel_behaviour !== undefined
      ? serviceOverrides.late_cancel_behaviour : practiceDefaults.late_cancel_behaviour,
    late_cancel_charge_percent: serviceOverrides.late_cancel_charge_percent !== null && serviceOverrides.late_cancel_charge_percent !== undefined
      ? serviceOverrides.late_cancel_charge_percent : practiceDefaults.late_cancel_charge_percent,
    card_required_at_booking: serviceOverrides.card_required_at_booking !== null && serviceOverrides.card_required_at_booking !== undefined
      ? serviceOverrides.card_required_at_booking : practiceDefaults.card_required_at_booking,
    card_kept_on_file: serviceOverrides.card_kept_on_file !== null && serviceOverrides.card_kept_on_file !== undefined
      ? serviceOverrides.card_kept_on_file : practiceDefaults.card_kept_on_file,
    cancel_requires_contact: serviceOverrides.cancel_requires_contact !== null && serviceOverrides.cancel_requires_contact !== undefined
      ? serviceOverrides.cancel_requires_contact : practiceDefaults.cancel_requires_contact,
    policy_text: serviceOverrides.policy_text !== null && serviceOverrides.policy_text !== undefined
      ? serviceOverrides.policy_text : practiceDefaults.policy_text,
  };
}
