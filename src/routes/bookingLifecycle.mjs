// Task 20.28 — CHECK-IN AND COMPLETE ROUTES FOR BOOKING SESSIONS.
// Spec: specs/features/20-data-tables.md §20.28 (routes), (permissions), (events).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ CHECK-IN AND COMPLETE EXIST ON THE SERVER; SESSION LIFECYCLE CLOSES THE ORPHAN EMITTER.
//     `booking.booking.completed` was declared in the outbox (§5) and listened for in two places
//     (`src/tasks/chains.mjs`, `src/queue/tasks.mjs`) but never emitted — a booking could move to
//     `completed` or `no_show` in the database with no event to tell downstream systems. This task
//     closes the gap with `recordAttendance()` (src/booking/attendance.mjs), which emits exactly
//     this topic as part of the state transition.
//
// ★★★ REFUSAL ORDER IS ABSOLUTE: role/permission 403 is decided BEFORE existence 404. A coach
//     asking about another coach's session gets 403, never 404, and an unknown id as an
//     authorised caller gets 404. See src/http/errors.mjs:18-21 (CT-F45 pattern).
//
// ★★ `checked_in_at` IS IDEMPOTENT: a second check-in call on the same booking returns 200 with
//    the same timestamp (no update, no conflict).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { atLeastRank } from "../nav/authorise.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { invalid, forbidden, notFound } from "../http/errors.mjs";
import { recordAttendance } from "../booking/attendance.mjs";

/**
 * ★ A coach may check in their own session only; an admin may check in any.
 * The booking must exist and be in an open state (pending_payment or confirmed).
 */
async function mayCheckInBooking(db, { tenantId, principal, bookingId }) {
  const role = atLeastRank(principal, "member");
  if (!role) throw forbidden(`only coaches and admins may check in a session`);

  // RLS supplies the tenant; id alone identifies the row.
  const { rows: found } = await db.query(
    `SELECT b.id, b.host_id, b.state FROM keystone.booking b WHERE b.id = $1`,
    [bookingId]
  );

  if (found.length === 0) throw notFound("no such booking");

  const booking = found[0];

  // ★ Coach can only check in their own session
  if (role === "member" && principal.appUserId !== booking.host_id) {
    throw forbidden("you may only check in your own sessions");
  }

  return booking;
}

/**
 * ★ A coach may complete their own session only; an admin may complete any.
 * The booking must exist and be in an open state (pending_payment or confirmed).
 */
async function mayCompleteBooking(db, { tenantId, principal, bookingId }) {
  const role = atLeastRank(principal, "member");
  if (!role) throw forbidden(`only coaches and admins may complete a session`);

  const { rows: found } = await db.query(
    `SELECT b.id, b.host_id FROM keystone.booking b WHERE b.id = $1`,
    [bookingId]
  );

  if (found.length === 0) throw notFound("no such booking");

  const booking = found[0];

  // ★ Coach can only complete their own session
  if (role === "member" && principal.appUserId !== booking.host_id) {
    throw forbidden("you may only complete your own sessions");
  }

  return booking;
}

export function registerBookingLifecycleRoutes(app, { runTenantScoped }) {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/bookings/:id/check-in
  // Check in to a booking session and record the check-in timestamp.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/bookings/:id/check-in", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.appUserId) throw invalid("sign-in required");

      const bookingId = c.req.param("id");
      if (!bookingId) throw invalid("booking id is required");

      // ★ Refusal order: permission 403 before existence 404
      await mayCheckInBooking(ctx.db, {
        tenantId: ctx.tenantId,
        principal: ctx.principal,
        bookingId,
      });

      // ★ Idempotent: set checked_in_at, or return the existing timestamp
      const { rows: result } = await ctx.db.query(
        `UPDATE keystone.booking
         SET checked_in_at = COALESCE(checked_in_at, now())
         WHERE id = $1 AND (state = 'pending_payment' OR state = 'confirmed')
         RETURNING checked_in_at`,
        [bookingId]
      );

      if (result.length === 0) {
        throw notFound("booking not found or not in a state that may be checked in");
      }

      return { checkedInAt: result[0].checked_in_at };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/bookings/:id/complete
  // Record session completion with an outcome: {attended: true} or {no_show: true} (exactly one).
  // Emits `booking.booking.completed` event and consumes credits if attended.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/bookings/:id/complete", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.appUserId) throw invalid("sign-in required");
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");

      const bookingId = c.req.param("id");
      if (!bookingId) throw invalid("booking id is required");

      const { attended, no_show } = ctx.body;

      // ★ Exactly one of attended or no_show must be present and true
      const hasAttended = attended === true;
      const hasNoShow = no_show === true;

      if (hasAttended === hasNoShow) {
        // Both true, both false, or both absent
        throw invalid(
          "body must contain exactly one of: {attended: true} or {no_show: true}"
        );
      }

      const outcome = hasAttended ? "completed" : "no_show";

      // ★ Refusal order: permission 403 before existence 404
      await mayCompleteBooking(ctx.db, {
        tenantId: ctx.tenantId,
        principal: ctx.principal,
        bookingId,
      });

      // ★ Call the attendance writer with the outcome
      const result = await recordAttendance(ctx.db, {
        tenantId: ctx.tenantId,
        bookingId,
        outcome,
        actorUserId: ctx.principal.appUserId,
      });

      return {
        id: result.id,
        state: result.state,
        changed: result.changed,
        event: result.event ? { id: result.event.id, topic: result.event.topic } : null,
      };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
