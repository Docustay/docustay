// @ts-check
// P6.26 / P8.9 — RECORD ATTENDANCE, AND EMIT THE ONE EVENT THAT SAYS THE SESSION HAPPENED.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ `booking.booking.completed` WAS DECLARED AND NEVER FIRED. [MEASURED 2026-09-15 — one grep
//     over src/, db/, web/, test/, e2e/, verify/] the string appears in exactly four places and
//     **not one of them is an `emit()`**:
//       · `src/events/outbox.mjs:94`  — the catalogue entry that declares it
//       · `src/tasks/chains.mjs:67`   — `write_session_note`, which OPENS ON it
//       · `src/tasks/writes.mjs:118`  — a comment about that chain
//       · `src/queue/tasks.mjs:889`   — a comment saying it "needs a task and no side effect"
//     So the chain that tells a coach to write the session note has an opener that cannot open,
//     and the outbox's own comment — *"nothing downstream could tell a session that happened from
//     one still in the future"* — describes a defect nobody had closed.
//
// ★★★ AND IT IS NOT DERIVABLE FROM THE CLOCK. `starts_at < now()` is a booking that has PASSED,
//     which is a different fact from a booking that HAPPENED. A coach who was ill has bookings in
//     the past that did not take place. `booking_participant.attended` is the fact; this module is
//     the only place it becomes an event.
//
// ★★ THE TRANSITION AND THE EVENT ARE ONE TRANSACTION, AND THE EVENT FIRES ONLY ON A REAL
//    TRANSITION. `setAttendance()` (writes.mjs) flips one participant's flag and emits
//    `booking.participant.added` with `attendance_recorded:true` — a per-ROW fact. That is not the
//    same event and must not be mistaken for one: a booking with three participants would emit
//    three of them, and the charge would be decided three times.
//
// ★★★ NO MONEY MOVES HERE, DELIBERATELY. The charge DECISION travels in the payload — basis,
//     percent, and where the percent came from — and Money is the section that acts on it (§X4:
//     sections never call each other). Charging from the Engagements section would also put a live
//     Stripe call behind a coach ticking a checkbox, which is exactly the thing that is not
//     allowed to happen by accident.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit, userActor } from "../events/outbox.mjs";
import { consumeCreditForBooking } from "../money/credits.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
import { SettingViolation } from "../settings/keys.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "booking";

/**
 * ★★★ THE TWO OUTCOMES A HELD-OR-NOT SESSION CAN REACH, AND NOTHING ELSE.
 *  `cancelled` is NOT here: cancelling is a decision made BEFORE the time, by a person, and it has
 *  its own topic (`booking.booking.cancelled`). Recording attendance is what happens AT or AFTER
 *  the time. Letting one control reach both would let a coach "cancel" a session that already took
 *  place, which rewrites history rather than recording it.
 */
export const ATTENDANCE_OUTCOMES = Object.freeze(["completed", "no_show"]);

/** ★ The states a booking may still be moved OUT of. Mirrors the 0013 CHECK constraint. */
const OPEN_STATES = Object.freeze(["pending_payment", "confirmed"]);

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ NO-SHOW IS A PART-CHARGE, IT IS 50%, AND IT IS A SETTING — NOT A NUMBER IN AN `if`.
//
//   §OPEN-QUESTIONS Q5 asked "charge, part-charge or waive?" and recorded that **no default is safe
//   here — it is a business decision that moves money.** the maintainer ruled: PART-CHARGE, 50%.
//
// ★★ A RULING IS NOT THE SAME AS A HARD-CODED CONSTANT. Two practices on one Keystone will not
//    agree about this, and the practice that disagrees must be able to change it without a deploy.
//    So the ruled 50 is the DEFAULT OF A SETTING, and the key and the default live here — beside
//    the logic that reads them — exactly as `REMINDER_SETTING_KEY` / `DEFAULT_REMINDER_MINUTES`
//    live in `reminders.mjs`. Neither the screen nor the writer can then disagree about what "the
//    practice default" means.
//
// ★★★ AND THE PAYLOAD SAYS WHERE THE NUMBER CAME FROM. A consumer that is about to take half of
//     somebody's session fee needs to know whether that half was chosen by this practice or
//     inherited from a ruling, and `percent: 50` alone cannot tell it apart.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const NO_SHOW_SETTING_KEY = "booking.no_show_charge_percent";
export const RULED_NO_SHOW_CHARGE_PERCENT = 50;

/**
 * ★ The validator for `NO_SHOW_SETTING_KEY`, exported from HERE so that registering the key in
 *   `src/settings/keys.mjs` is a one-line import rather than a second opinion about what a legal
 *   percentage is. (That registration is a shared-file edit — see
 *   `~/example-rebuild/handoffs/p6-engagements.md`.)
 * ★★ 0 and 100 are BOTH legal and both meaningful: 0 is "we waive it" and 100 is "we charge in
 *    full". Q5 named all three answers, so the setting has to be able to express all three —
 *    refusing the endpoints would quietly remove two of the options the maintainer was choosing between.
 */
export function noShowChargePercent(v) {
  return typeof v !== "number" || !Number.isInteger(v)
    ? "must be a whole number of percent"
    : v < 0 || v > 100
      ? "must be between 0 (waive) and 100 (charge in full)"
      : null;
}

/**
 * Resolve the practice's no-show charge, with its provenance.
 *
 * ★★★ `getSetting()` THROWS ON A KEY THAT IS NOT IN THE CATALOGUE — it does not return the
 *     fallback (`src/settings/writes.mjs:80`). So until the key is registered in `SETTING_KEYS`,
 *     a naive read here would turn every recorded no-show into a 500. ★ Caught by NAME and
 *     reported as provenance rather than swallowed: the event then carries
 *     `source:"ruling_pending_catalogue_registration"`, which is a true statement about the system
 *     and is visible to anybody reading the outbox — instead of a silent 50 that looks configured.
 */
export async function resolveNoShowCharge(tx) {
  try {
    const v = await getSetting(tx, NO_SHOW_SETTING_KEY, undefined);
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ `null` IS CHECKED AS WELL AS `undefined`, AND LEAVING IT OUT WAS A REAL BUG THAT ONLY
    //     APPEARED WHEN THE KEY WAS REGISTERED (P6.B12). `getSetting(tx, key, fallback = null)`
    //     has a DEFAULT PARAMETER, so passing `undefined` explicitly does not pass `undefined` —
    //     it triggers the default and the function returns **null** for an unset key.
    //   ★★ So `v === undefined` was never true. Before the key was in the catalogue that was
    //      invisible: `getSetting` threw "is not a known setting" on the line above and the catch
    //      below returned the pending-registration provenance, so the unset path never got here.
    //      Registering the key moved the failure from a mislabelled default to a **thrown
    //      SettingViolation on every no-show in every practice that has not set a value** — which
    //      is every practice. [EXECUTED] `"booking.no_show_charge_percent" must be a whole number
    //      of percent — stored value null`.
    //   ★★★ THE CLASS: A FIX THAT UNMASKS. The registration was correct and the reader was already
    //       wrong; the two were only ever tested together in the state where the first was missing.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    if (v === undefined || v === null) {
      return { percent: RULED_NO_SHOW_CHARGE_PERCENT, source: "ruling_default" };
    }
    const problem = noShowChargePercent(v);
    if (problem) {
      // ★ A stored value that no longer validates is REPORTED, not corrected. Silently substituting
      //   the default would bill somebody a number the practice never agreed to.
      throw new SettingViolation(`"${NO_SHOW_SETTING_KEY}" ${problem} — stored value ${JSON.stringify(v)}`);
    }
    return { percent: v, source: "tenant_setting" };
  } catch (e) {
    if (e instanceof SettingViolation && /is not a known setting/.test(e.message)) {
      return {
        percent: RULED_NO_SHOW_CHARGE_PERCENT,
        source: "ruling_pending_catalogue_registration",
      };
    }
    throw e;
  }
}

/**
 * ★★★ RECORD ATTENDANCE FOR A WHOLE BOOKING AND CLOSE IT.
 *
 * @param tx            a tenant-scoped client INSIDE a transaction (same contract as `emit()`)
 * @param tenantId      from the GUC, never from the body
 * @param bookingId     the session being recorded
 * @param outcome       'completed' | 'no_show' — REQUIRED, no default
 * @param participants  [{ participantId, attended }] — optional; per-person flags
 * @param actorUserId   who recorded it (from the session)
 *
 * @returns { id, state, changed, event }  — `changed:false` means it was already in that state
 */
export async function recordAttendance(
  tx, { tenantId, bookingId, outcome, participants = [], actorUserId = null }
) {
  if (!tenantId) throw invalid("recording attendance requires a tenantId — call it inside withTenant()");
  if (!bookingId) throw invalid("recording attendance requires a bookingId — which session was this?");
  if (!ATTENDANCE_OUTCOMES.includes(outcome)) {
    // ★★ NO DEFAULT. "It happened" and "they did not come" are different facts about a person, one
    //    of them moves money, and guessing between them is not a thing a server may do.
    throw invalid(
      `outcome must be one of ${ATTENDANCE_OUTCOMES.join(", ")} — got ${JSON.stringify(outcome)}. ` +
      `There is no default: "the session happened" and "they did not come" are different facts, ` +
      `and one of them part-charges the client.`);
  }
  if (!Array.isArray(participants)) {
    throw invalid("participants must be a list of { participantId, attended }");
  }

  // ── the booking, and whether it is ours to close ──────────────────────────────────────────────
  // ★ RLS supplies the tenant; the id alone identifies the row. A `tenant_id = $2` predicate here
  //   would be a hand-written tenant filter, which this codebase forbids.
  // ★ STAGE 3 TASK 3 — the `client_name` subselect this query used to carry is gone: it fed the
  //   event payload only (see below), and that is now a privacy violation rather than a convenience.
  //   `write_session_note` (`src/tasks/chains.mjs`) runs the equivalent query itself, at task-open
  //   time, against the CURRENT `booking_participant` rows.
  const { rows: found } = await run(tx, db.selectFrom("keystone.booking").select(["id", "state", "starts_at", "host_id", "service_id"]).where("id", "=", bookingId));
  if (found.length === 0) throw notFound("no such booking in this organisation");
  const booking = found[0];

  if (booking.state === "cancelled") {
    // ★★ A CANCELLED SESSION CANNOT BE MARKED ATTENDED. It was called off; recording attendance on
    //    it would assert that a session both did not and did happen, and the charge would follow the
    //    second claim.
    throw conflict(
      "this session was cancelled — a cancelled session cannot be marked attended or missed. " +
      "If it went ahead after all, it needs to be booked again.");
  }

  // ── per-participant flags, inside the same transaction ────────────────────────────────────────
  // ★★★ SCOPED TO **THIS** BOOKING. `setAttendance()` updates by participant id alone; passing an
  //     id belonging to another booking would silently mark the wrong person present. The
  //     `booking_id = $3` predicate is not a tenant filter — RLS still supplies the tenant — it is
  //     an assertion that the participant belongs to the session being recorded.
  let recorded = 0;
  for (const p of participants) {
    if (!p || !p.participantId) throw invalid("each participant needs a participantId");
    if (typeof p.attended !== "boolean") {
      throw invalid(
        "attended must be true or false — leave a participant out to mean 'not yet recorded'. " +
        "NULL and false are different facts, and treating an unheld session as a no-show would be " +
        "wrong in the record.");
    }
    const r = await tx.query(
      `UPDATE keystone.booking_participant SET attended = $2
        WHERE id = $1 AND booking_id = $3 RETURNING id`,
      [p.participantId, p.attended, bookingId]);
    if (r.rowCount === 0) {
      throw notFound(
        `participant ${p.participantId} is not on this booking — refusing rather than marking ` +
        `somebody else present`);
    }
    recorded += 1;
  }

  // ── the transition ────────────────────────────────────────────────────────────────────────────
  // ★★★ CONDITIONAL ON THE CURRENT STATE, SO THE EVENT CANNOT FIRE TWICE. Two coaches pressing the
  //     button at once, or one double-click past the idempotency window, must not open two session-
  //     note tasks and must not part-charge twice. The second UPDATE matches no row.
  // ★ 13.16 — `no_show_at` (0399) is recorded IN THE SAME STATEMENT as the state transition, not a
  //   second UPDATE after it: splitting it into read-then-write would open a race where two actors
  //   marking one row at once could see the state move but the timestamp lag behind it, or vice
  //   versa. The column records WHEN this was marked no-show — a fact, never a charge decision;
  //   the charge (`charge`, below) is computed and carried in the event exactly as before and this
  //   edit does not touch that.
  const { rows: moved } = await tx.query(
    `UPDATE keystone.booking SET state = $2,
            no_show_at = CASE WHEN $2 = 'no_show' THEN now() ELSE no_show_at END
      WHERE id = $1 AND state = ANY($3) RETURNING id, state`,
    [bookingId, outcome, OPEN_STATES]);

  if (moved.length === 0) {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // ★★★ RE-READ THE STATE, DO NOT REPORT THE ONE FROM BEFORE THE UPDATE.
    // [EXECUTED 2026-09-15, two concurrent recordings of one booking] the loser's UPDATE BLOCKED on
    // the winner's row lock, then re-evaluated and matched nothing. The row read at the top of this
    // function still said `confirmed` — so the refusal came out as *"this session is 'confirmed'
    // and cannot be moved to 'no_show'`*, which is self-contradictory nonsense to the coach who`
    // reads it: confirmed is precisely the state that CAN be recorded.
    //  ★★ The message was wrong about the world in the one situation the guard exists for. A stale
    //     read inside a refusal is how a correct guard teaches people the product is broken.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const { rows: fresh } = await run(tx, db.selectFrom("keystone.booking").select(["state"]).where("id", "=", bookingId));
    booking.state = fresh[0]?.state ?? booking.state;
    if (booking.state === outcome) {
      // ★★ ALREADY THERE IS NOT AN ERROR. Idempotent by predicate, like `markNotificationRead`:
      //    `changed:false` is an honest answer and the caller can render "already recorded".
      return { id: bookingId, state: booking.state, changed: false, event: null };
    }
    throw conflict(
      `this session is "${booking.state}" and cannot be moved to "${outcome}" — ` +
      `only a ${OPEN_STATES.join(" or ")} session can have its attendance recorded`);
  }

  // ── the charge decision, carried not executed ─────────────────────────────────────────────────
  const charge = outcome === "no_show"
    ? { ...(await resolveNoShowCharge(tx)), basis: "part_charge" }
    : { percent: 100, source: "session_held", basis: "full" };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ P8.6 — THE SESSION HAPPENED, SO THE CREDIT IS SPENT FOR GOOD. `reserved → consumed`, in the
  //     same transaction as the state change and the event, so a booking cannot be `completed` while
  //     the credit it used still reads as reserved.
  //   ★★ ONLY ON `completed`. A NO-SHOW is a different question: whether the client loses the credit
  //      is the same business ruling as the no-show CHARGE (§OPEN-QUESTIONS Q5), and **guessing it
  //      would take a session off somebody for a decision nobody has made.** The credit stays
  //      `reserved` — visibly attached to the booking, waiting for that ruling — which is the honest
  //      state and is trivially revisited. It is recorded in the handoff rather than settled here.
  //   ★ A booking with no credit consumes nothing and says so: the update matches zero rows and
  //     returns null. Paying cash is not an error.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★ RUN-2 RULING (26 Sep 2026): a NO-SHOW CONSUMES THE CREDIT TOO. The comment above records the
  //    question as unmade; THE-TEST.md §6 (25 Sep, the test spec written with the maintainer) makes it: "No-shows once,
  //    and the credit IS consumed — that is the point of a no-show." The newer written rule governs. The
  //    no-show CHARGE (booking.no_show_charge_percent) is a separate, money decision and is unchanged.
  // ★★★ FIX, 30 Sep 2026 ("credit-used email" brief) — MOVED BEFORE THE EVENT BELOW, deliberately:
  //   the event is the only thing a listener can react to, so if it does not carry the outcome of
  //   the consume, no consumer can ever know a credit was spent without a second, racier read.
  const creditConsumed = ATTENDANCE_OUTCOMES.includes(outcome)
    ? await consumeCreditForBooking(tx, { tenantId, bookingId })
    : null;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE EVENT. ONE PER BOOKING, IN THE SAME TRANSACTION AS THE TRANSITION.
  //
  // ★★ IT IS EMITTED FOR **BOTH** OUTCOMES, AND `outcome` IS WHAT TELLS THEM APART. There is no
  //    `booking.booking.no_show` topic — the catalogue is closed and adding one is an edit to
  //    `src/events/outbox.mjs`, a file this batch does not own. The alternative was to stay SILENT
  //    on a no-show, and that is worse than borrowing the topic: the part-charge decision would
  //    then have no emitter at all, which is the exact defect this module exists to close. ★ It is
  //    recorded as an open question in the handoff rather than settled quietly.
  //  ★★★ STAGE 3 TASK 3 — `client_name` WAS IN THIS PAYLOAD ("`chains.mjs:67` titles the
  //    session-note task with it") — DROPPED, and it is a genuine offender (§2.4 bans names
  //    outright). `write_session_note` (`src/tasks/chains.mjs`) is rewired to look the client's
  //    CURRENT `booking_participant.display_name` up at task-open time instead, from the same
  //    query this function runs a few lines above — see that file's own comment.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const event = await emit(tx, {
    tenantId,
    topic: "booking.booking.completed",
    emittedBy: SECTION,
    subjectType: "booking",
    subjectId: bookingId,
    // ★ STAGE 3 TASK 1 — same fact as payload's `recorded_by` below, now also on the envelope.
    actor: userActor(actorUserId),
    payload: {
      outcome,
      host_id: booking.host_id,
      service_id: booking.service_id,
      starts_at: booking.starts_at,
      participants_recorded: recorded,
      recorded_by: actorUserId,
      // ★★★ THE DECISION, NOT THE ACT. Money reads this and decides what to raise; nothing here
      //     touches a payment processor.
      charge,
      // ★ FIX, 30 Sep 2026 ("credit-used email" brief) — carries the entitlement so a reader can see
      //   it without a second, racier read of a row this transaction already changed. The actual
      //   EMAIL listens on the dedicated event just below, not on this one — see that event's own
      //   note for why.
      credit_consumed: creditConsumed ? { entitlement_id: creditConsumed.entitlement_id } : null,
    },
  });

  // ★ FIX, 30 Sep 2026 ("credit-used email" brief) — a DEDICATED event, not a listener on
  //   `booking.booking.completed` above: that topic also fires for a card/invoice/no-payment
  //   outcome, and mapping it to a credit-used email would send one on every completed session.
  if (creditConsumed) {
    await emit(tx, {
      tenantId,
      topic: "booking.booking.credit_consumed",
      emittedBy: SECTION,
      subjectType: "booking",
      subjectId: bookingId,
      actor: userActor(actorUserId),
      payload: { entitlement_id: creditConsumed.entitlement_id, service_id: booking.service_id },
    });
  }

  return {
    id: bookingId, state: moved[0].state, changed: true,
    event: { id: event.id, topic: event.topic },
    creditConsumed: creditConsumed ? { id: creditConsumed.id } : null,
  };
}
