// @ts-check
// src/people/offboard.mjs — Task 1.5 (01-team-and-roles.md §2, §3, §4, §12,
// FEATURES-COMBINED-PLAN.md Task 1.5) — TeamRemove's two writers: the offboard PREVIEW read and the
// offboard WRITE itself.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NO MIGRATION. Spec 01 §3 and CONTRACTS-FEATURES.md both state this explicitly: "TeamRemove
//     reassignment/offboarding needs no new columns" — every fact this file touches already has a
//     column and a writer (`app_user.owner_user_id`/`assignPerson`, `app_user.lifecycle_status`/
//     `setLifecycleStatus`, `keystone.user_role`/`revokeRole`, `keystone.booking.host_id`/`state`,
//     `keystone.calendar_connection`/`disconnectConnection`). This file is the ORCHESTRATION that
//     spec §13 calls "ordinary UPDATE/DELETE-of-a-grant operations", not a new storage shape.
//
// ★★★ ONE TRANSACTION (spec §2's route table: "one transaction — §3/§4"). Every function here takes
//     `tx` and never opens one of its own — same discipline as `src/people/writes.mjs`'s own header
//     note. A clash found while moving future sessions throws BEFORE any write in this file runs
//     (see `offboardTeamMember` below), so a partial offboard — some clients reassigned, some
//     sessions stuck, the departing person still active — cannot exist: either the whole thing lands
//     or the caller's transaction rolls back all of it.
//
// ★★ THE SPEC NAMES A "422" FOR AN UNRESOLVABLE CLASH (§2's route table). `src/http/errors.mjs`'s
//    `ErrorKind` is a CLOSED, NINE-MEMBER taxonomy (`test/s5_error_envelope.test.mjs` asserts the
//    count) with no 422 among them, and that file is not in this task's file list — adding a tenth
//    kind is out of scope and would break that test. `conflict()` (409) is used instead, the same
//    kind this file already uses for "the only Owner" and the same kind `assignPerson`'s own
//    optimistic-concurrency refusal uses — the closest existing fit, not a new invention. ★ FLAGGED
//    in this task's own build report as a spec/codebase mismatch, not a silent substitution.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit, userActor } from "../events/outbox.mjs";
import { revokeRole } from "../permissions/writes.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { assignPerson, setLifecycleStatus } from "./writes.mjs";
import { revokeSessionsForUser } from "../auth/session.mjs";
import { disconnectConnection } from "../booking/calendarConnect.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { teamSeatUsage } from "./seats.mjs";
import { db, run } from "../db/kysely.mjs";
import { openInstanceCountsBySubject, pendingCountersignaturesFor, sessionNoteCountAuthoredBy } from "../documents/api.mjs";
import { sql } from "kysely";

const SECTION = "people";

/** ★ Spec 03b / 0309 — the three NON-TERMINAL booking states; a "future session" is one of these
 *   starting after now(). Mirrors the set `booking_pending_consent_idx` and the EXCLUDE guard both
 *   already treat uniformly (0309's own header note). */
const OPEN_BOOKING_STATES = Object.freeze(["pending_payment", "pending_consent", "confirmed"]);

/** Look up the departing person, and refuse anything that is not an existing staff row. Shared by
 *  both the preview read and the write, so the two can never disagree about who "personId" is. */
async function loadDepartingStaff(tx, personId) {
  if (!personId) throw invalid("personId is required", { field: "personId" });
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["id", "display_name", "staff_role", "lifecycle_status"])
    .where("id", "=", personId)
    .where("role", "=", "staff"));
  const person = rows[0];
  // ★ Deliberately one message for "no such id" and "not staff" — same discipline
  //   `setStaffRole`/`assignPerson` already use (src/people/writes.mjs) — RLS already hid a
  //   cross-tenant id identically, so distinguishing the two here would leak which is which.
  if (!person) throw notFound("no such staff member in this organisation");
  return person;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ the maintainer's brief, 1 Oct 2026 — "suspend" was a listed Team feature with NO mechanism behind it.
//     `lifecycle_status` already supports active↔paused (0076, setLifecycleStatus) and offboarding
//     already drives it to 'former', but PAUSING a staff member did nothing beyond flip the column:
//     nothing revoked their live sessions and nothing at request time refused a paused person, so a
//     "suspended" coach kept full access until an Owner remembered to run the full offboard-with-
//     reassignment flow. These two functions are the real mechanism — session revocation here, and
//     the actual access refusal in src/http/app.mjs's per-request person load (search for
//     "lifecycle_status !== \"active\"" there). Unlike offboardTeamMember this never touches a
//     caseload or future sessions: it is a pause, meant to be reversed, not a departure.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Suspend a team member: active → paused, every live session of theirs ended immediately. */
export async function suspendTeamMember(tx, { tenantId, personId, reason = null, actorUserId = null }) {
  const person = await loadDepartingStaff(tx, personId);
  if (person.staff_role === "owner") {
    throw conflict("the Owner cannot be suspended — make somebody else Owner first, or remove them instead");
  }
  if (person.lifecycle_status !== "active") {
    throw conflict(`${person.display_name} is already ${person.lifecycle_status} — suspend only applies from active`);
  }

  await setLifecycleStatus(tx, {
    tenantId, personId, status: "paused", reason: reason ?? "suspended from the team", actorUserId,
  });
  // ★ Kick out every session they hold RIGHT NOW — the per-request gate in app.mjs stops anything
  //   new, but a session minted before this moment is still valid until it is actually revoked.
  await revokeSessionsForUser(tx, tenantId, personId, "suspended");
  await writeAudit(tx, {
    tenantId, action: "staff.suspended", object: "person", subjectId: personId,
    before: { lifecycle_status: "active" }, after: { lifecycle_status: "paused" },
    reason, actorUserId,
  });

  return { ok: true, personId, status: "paused" };
}

/** Reactivate a suspended team member: paused → active. They can sign in again immediately. */
export async function reactivateTeamMember(tx, { tenantId, personId, reason = null, actorUserId = null }) {
  const person = await loadDepartingStaff(tx, personId);
  if (person.lifecycle_status !== "paused") {
    throw conflict(`${person.display_name} is ${person.lifecycle_status}, not paused — nothing to reactivate`);
  }

  await setLifecycleStatus(tx, {
    tenantId, personId, status: "active", reason: reason ?? "reactivated", actorUserId,
  });
  await writeAudit(tx, {
    tenantId, action: "staff.reactivated", object: "person", subjectId: personId,
    before: { lifecycle_status: "paused" }, after: { lifecycle_status: "active" },
    reason, actorUserId,
  });

  return { ok: true, personId, status: "active" };
}

/**
 * §2's `GET /api/people/team/:personId/offboard-preview` — the four facts TeamRemove's page load
 * needs, read-only, no writes, no transaction concerns beyond the caller's own read.
 *
 * ★ `openItemCount`, PER CLIENT — spec §2's wire contract gives a single number, no breakdown, and
 *   no prior art for "open item" exists anywhere in this codebase (grepped clean). Defined here as
 *   this client's own future sessions with THIS departing coach, plus this client's own
 *   not-yet-executed documents — the two things TeamRemove's OWN two sections already show, so the
 *   count agrees with what the page displays rather than inventing a third, undocumented metric.
 *   ★★ DOCUMENTED SIMPLIFICATION, not a guess at a number that does not exist elsewhere.
 *
 * ★ `pendingCountersignatures` — `document_instance` carries no "assigned staff" column (traced
 *   through 0009/0036; `SIGNER_CONFIGS`, src/documents/vocabulary.mjs, names PARTY ROLES like
 *   `'coach'`, never an individual staff id). The only traceable link from a document to THIS
 *   departing coach is through its subject's `owner_user_id`. A document is "pending" this coach's
 *   countersignature when its subject is one of this coach's own clients and the instance is
 *   `partially_signed` (the client's own signature is in, the coach's is the one outstanding).
 *
 * ★ `hasConnectedCalendar` — any non-revoked `keystone.calendar_connection` row for this host.
 */
export async function getOffboardPreview(tx, { personId }) {
  const person = await loadDepartingStaff(tx, personId);

  // ★ DOCUSTAY WALL FIX — the document half of this per-client open-item count used to be an
  //   inline correlated subquery in the same SELECT; now a separate grouped call through
  //   documents/api.mjs, summed here. Same final "openItemCount" per client.
  const { rows: clientBookingCounts } = await tx.query(
    `SELECT p.id, p.display_name AS "displayName",
            (SELECT count(*) FROM keystone.booking b
               WHERE b.host_id = $1 AND b.starts_at > now()
                 AND b.state = ANY($2::text[])
                 AND EXISTS (SELECT 1 FROM keystone.booking_participant bp
                              WHERE bp.booking_id = b.id AND bp.app_user_id = p.id))::int AS "bookingOpenCount"
       FROM keystone.app_user p
      WHERE p.owner_user_id = $1 AND p.role <> 'staff'
      ORDER BY p.display_name`,
    [personId, OPEN_BOOKING_STATES]);
  const docOpenCounts = await openInstanceCountsBySubject(tx, {
    subjectUserIds: clientBookingCounts.map((c) => c.id),
  });
  const clients = clientBookingCounts.map((c) => ({
    id: c.id, displayName: c.displayName,
    openItemCount: c.bookingOpenCount + (docOpenCounts[c.id] ?? 0),
  }));

  const { rows: futureSessions } = await tx.query(
    `SELECT b.id, b.starts_at AS "startsAt",
            (SELECT string_agg(bp.display_name, ', ' ORDER BY bp.display_name)
               FROM keystone.booking_participant bp
              WHERE bp.booking_id = b.id AND bp.party <> 'coach') AS "clientName"
       FROM keystone.booking b
      WHERE b.host_id = $1 AND b.starts_at > now() AND b.state = ANY($2::text[])
      ORDER BY b.starts_at`,
    [personId, OPEN_BOOKING_STATES]);

  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const pendingCountersignatures = await pendingCountersignaturesFor(tx, { ownerUserId: personId });

  const { rows: calRows } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(sql`1`)
    .where("host_id", "=", personId)
    .where("status", "<>", "revoked")
    .limit(1));

  // ★ 12.13 — the counts the preview's own drawn shape needs: completed bookings this person has
  //   hosted, session notes they authored, and what team-seat usage would look like once they are
  //   former (this is a READ-ONLY preview — the seat is not actually freed until the write below).
  const { rows: sessionsGivenRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.booking WHERE host_id = $1 AND state = 'completed'`,
    [personId]);
  const sessionsGiven = sessionsGivenRows[0]?.n ?? 0;

  // ★ DOCUSTAY WALL FIX — routed through documents/api.mjs; same query, relocated verbatim.
  const notesWritten = await sessionNoteCountAuthoredBy(tx, { authorUserId: personId });

  const seatUsage = await teamSeatUsage(tx);

  return {
    person: { id: person.id, displayName: person.display_name, staffRole: person.staff_role },
    clients,
    futureSessions,
    pendingCountersignatures,
    hasConnectedCalendar: calRows.length > 0,
    sessionsGiven,
    notesWritten,
    seats: { usedAfter: seatUsage.used - 1, limit: seatUsage.limit },
  };
}

/**
 * §2's `POST /api/people/team/:personId/offboard` — the one write, one transaction.
 *
 * Order (spec §13's list, plus the two pre-checks that make a clash and a last-Owner both refuse
 * BEFORE anything moves):
 *  1. the departing person exists and is staff (404 otherwise)
 *  2. the departing person is not the practice's only Owner (409 otherwise — §4's plain-language
 *     surfacing of `keystone.enforce_last_owner()`'s own rule; see the note below on why THIS
 *     function is the real enforcement for THIS write)
 *  3. every `reassignments[].clientId` is currently owned by the departing person (rejects a body
 *     trying to reassign somebody else's client through this route)
 *  4. `futureSessions.mode === "reassign"`: every future session's target host is free at that
 *     session's time (409 — this task's own substitute for the spec's "422", see file header)
 *  5. reassign each listed client (`assignPerson`)
 *  6. move, cancel, or (mode `"leave"`, the frame's "Remove her anyway") LEAVE every future session
 *  7. revoke every role the departing person currently holds (`revokeRole`, once per row)
 *  8. end every live session of theirs (`revokeSessionsForUser`, reason `"removed_from_team"`)
 *  9. disconnect any calendar connection of theirs (`disconnectConnection`)
 *  9b. if they had a `booking_slug`, redirect it (`keystone.record_booking_slug_redirect`, to the
 *      new host when `mode === "reassign"`, else to the practice page) and clear the slug
 *  10. `lifecycle_status → 'former'` (`setLifecycleStatus`) — done LAST, so every write above still
 *      sees them as the row they are reassigning things away from.
 *  11. emit `people.person.removed_from_team`
 *
 * ★★★ WHY THIS FUNCTION RE-CHECKS "ONLY OWNER" ITSELF, RATHER THAN LEANING ON THE DATABASE TRIGGER
 *     SPEC §4 NAMES AS THE BACKSTOP. `keystone.enforce_last_owner()` (0188) fires
 *     `BEFORE DELETE OR UPDATE OF staff_role, tenant_id` — MEASURED at
 *     db/migrations/0188_one_owner_per_practice_not_one_per_database.sql:183-185. Offboarding never
 *     touches `staff_role` (only `lifecycle_status`), so that trigger does not fire on this write at
 *     all and is not actually a backstop for it. This pre-check is therefore the ONLY enforcement —
 *     not defence-in-depth on top of the trigger, its replacement for this specific write. ★ FLAGGED
 *     in this task's own build report: spec §4's claim that the trigger already refuses this is
 *     inaccurate for a lifecycle-only offboard.
 *
 * ★ Documents pending the departing coach's countersignature (surfaced by the preview above) are NOT
 *   redirected by this write. No schema column ties a `document_instance` to an individual signer
 *   (only to a PARTY ROLE, resolved elsewhere at sign time) and no file implementing that resolution
 *   is in this task's file list — see the preview's own note. Scoped out, not guessed at.
 */
export async function offboardTeamMember(tx, {
  tenantId, personId, reassignments = [], futureSessions, actorUserId = null,
}) {
  const person = await loadDepartingStaff(tx, personId);

  // ── 2. the only-Owner refusal — the real enforcement for THIS write (see note above) ──────────
  if (person.staff_role === "owner") {
    const { rows: otherOwners } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(sql`1`)
      .where("role", "=", "staff")
      .where("staff_role", "=", "owner")
      .where("lifecycle_status", "<>", "former")
      .where("id", "<>", personId)
      .limit(1));
    if (otherOwners.length === 0) {
      throw conflict(
        "this is the only Owner — offboarding them would leave the practice with no Owner. " +
        "Make somebody else Owner first.");
    }
  }

  if (!Array.isArray(reassignments)) {
    throw invalid("reassignments must be a list of {clientId, newOwnerUserId}", { field: "reassignments" });
  }
  const mode = futureSessions?.mode;
  if (mode !== "reassign" && mode !== "cancel_no_charge" && mode !== "leave") {
    throw invalid('futureSessions.mode must be "reassign", "cancel_no_charge", or "leave"',
      { field: "futureSessions.mode" });
  }
  if (mode === "reassign" && !futureSessions?.newHostUserId) {
    throw invalid("futureSessions.newHostUserId is required when mode is \"reassign\"",
      { field: "futureSessions.newHostUserId" });
  }

  // ── 3. every reassigned client must currently belong to the departing person ───────────────────
  for (const r of reassignments) {
    if (!r?.clientId || !r?.newOwnerUserId) {
      throw invalid("each reassignment needs a clientId and a newOwnerUserId", { field: "reassignments" });
    }
    const { rows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(sql`1`)
      .where("id", "=", r.clientId)
      .where("owner_user_id", "=", personId));
    if (rows.length === 0) {
      throw invalid(
        `${r.clientId} is not currently one of this staff member's clients`, { field: "reassignments" });
    }
  }

  // ── 4. future sessions — pre-check the WHOLE "reassign" set for a clash before writing anything
  const { rows: openSessions } = await run(tx, db
    .selectFrom("keystone.booking")
    .select(["id", "occupies"])
    .where("host_id", "=", personId)
    .where("starts_at", ">", sql`now()`)
    .where(sql`state = ANY(${sql.val(OPEN_BOOKING_STATES)})`)
  );

  const clashes = [];
  if (mode === "reassign" && openSessions.length > 0) {
    for (const s of openSessions) {
      const { rows: clash } = await tx.query(
        `SELECT 1 FROM keystone.booking
          WHERE host_id = $1 AND state <> 'cancelled' AND occupies && $2::tstzrange
          LIMIT 1`,
        [futureSessions.newHostUserId, s.occupies]);
      if (clash.length > 0) {
        clashes.push({ bookingId: s.id, reason: "the new host already has a booking at that time" });
      }
    }
    if (clashes.length > 0) {
      throw conflict(
        `${clashes.length} future session${clashes.length === 1 ? "" : "s"} could not move automatically — ` +
        "the new host already has a conflicting booking. Nothing was changed.",
        { clashes });
    }
  }

  // ── 5. reassign clients ──────────────────────────────────────────────────────────────────────
  for (const r of reassignments) {
    await assignPerson(tx, { tenantId, personId: r.clientId, ownerUserId: r.newOwnerUserId, actorUserId });
  }

  // ── 6. move, cancel, or (mode "leave") LEAVE every future session exactly where it is ─────────
  let movedSessions = 0;
  let cancelledSessions = 0;
  let leftSessions = 0;
  if (mode === "reassign") {
    for (const s of openSessions) {
      await tx.query(
        `UPDATE keystone.booking SET host_id = $2, updated_at = now() WHERE id = $1`,
        [s.id, futureSessions.newHostUserId]);
      movedSessions++;
    }
  } else if (mode === "cancel_no_charge") {
    for (const s of openSessions) {
      await run(tx, db
        .updateTable("keystone.booking")
        .set({
          state: "cancelled",
          cancelled_at: sql`now()`,
          updated_at: sql`now()`
        })
        .where("id", "=", s.id));
      await emit(tx, {
        tenantId,
        topic: "booking.booking.cancelled",
        emittedBy: "booking",
        subjectType: "booking",
        subjectId: s.id,
        actor: userActor(actorUserId),
        payload: { reason: "coach_offboarded", charged: false },
      });
      cancelledSessions++;
    }
  } else {
    // mode === "leave" — the frame's "Remove her anyway": nothing moves, nothing cancels, every
    // future booking stays exactly as it was.
    leftSessions = openSessions.length;
  }

  // ── 7. revoke every role the departing person currently holds ───────────────────────────────
  const { rows: heldRoles } = await run(tx, db
    .selectFrom("keystone.user_role")
    .select(["role_id"])
    .where("tenant_id", "=", tenantId)
    .where("user_id", "=", personId));
  for (const { role_id } of heldRoles) {
    await revokeRole(tx, { tenantId, userId: personId, roleId: role_id, actorId: actorUserId });
  }

  // ── 8. end every live session ────────────────────────────────────────────────────────────────
  await revokeSessionsForUser(tx, tenantId, personId, "removed_from_team");

  // ── 9. disconnect any calendar connection ────────────────────────────────────────────────────
  const { rows: connections } = await run(tx, db
    .selectFrom("keystone.calendar_connection")
    .select(["id"])
    .where("host_id", "=", personId)
    .where("status", "<>", "revoked"));
  for (const { id: connectionId } of connections) {
    await disconnectConnection(tx, { tenantId, hostId: personId, connectionId });
  }

  // ── the booking-link redirect — after disconnecting the calendar, before the lifecycle flip,
  //    so the redirect exists before the departing person's own row stops being "active" ────────
  const { rows: slugRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["booking_slug"])
    .where("id", "=", personId));
  const bookingSlug = slugRows[0]?.booking_slug ?? null;
  if (bookingSlug) {
    await tx.query(
      `SELECT keystone.record_booking_slug_redirect($1, $2, 'coach', $3)`,
      [tenantId, bookingSlug, mode === "reassign" ? futureSessions.newHostUserId : null]);
    await run(tx, db
      .updateTable("keystone.app_user")
      .set({
        booking_slug: null,
        accepting_new_bookings: false
      })
      .where("id", "=", personId));
  }

  // ── 10. lifecycle_status → 'former', last, so every write above still saw them as the owner ──
  await setLifecycleStatus(tx, {
    tenantId, personId, status: "former", reason: "removed from the team", actorUserId,
  });

  await emit(tx, {
    tenantId,
    topic: "people.person.removed_from_team",
    emittedBy: "people",
    subjectType: "person",
    subjectId: personId,
    actor: userActor(actorUserId),
    payload: { mode, moved: movedSessions, cancelled: cancelledSessions, left: leftSessions },
  });

  return {
    ok: true,
    reassignedClients: reassignments.length,
    movedSessions,
    cancelledSessions,
    leftSessions,
    sessionsRequiringManualClash: [],
  };
}
