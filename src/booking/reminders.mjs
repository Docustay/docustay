// @ts-check
// P2.5 — THE SESSION REMINDER. THE TEMPLATE HAS EXISTED SINCE P18 AND HAS NEVER BEEN SENT.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ [MEASURED] `src/email/templates.mjs:97` defines `booking.reminder` and :122 declares the five
//     variables it requires. Its ONLY other reference in the project is `db/gates/p18_email.mjs:94`,
//     which renders it to check the WORDING. **Nothing schedules it. Nothing sends it.** A reminder
//     template that has never reminded anybody is the orphan class this project keeps finding — and
//     P2.5's "reminder" field would have been a preference governing nothing without this module.
//
// ★★★ THE RULING THAT SHAPES IT: THE JOB CHECKS THE BOOKING'S STATE AT FIRE TIME. It does NOT rely
//     on anything remembering to cancel it.
//   ★★ The obvious design schedules on create and REMOVES the job on cancel. That is a second place
//      the truth lives, and it fails in the direction that hurts: a cancel path that forgets to
//      unschedule sends "This is a reminder of your session" for a session that is not happening —
//      to a client, by email, hours before a slot they have already been told is cancelled.
//   ★ Asking the database at fire time cannot drift, and it answers the question the house keeps
//     asking: **who supplies the condition the guard checks?** Here it is the booking row, not the
//     scheduler and not the test.
//
// ★★ AND IT IS RE-CHECKED, NOT TRUSTED FROM THE PAYLOAD. The job carries a booking id and a tenant;
//    every fact that decides whether to send is read under RLS when it fires.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/** The practice-wide default, in minutes, when a booking does not name its own. */
export const DEFAULT_REMINDER_MINUTES = 1440; // 24 hours

/** The setting a practice overrides it with. ★ P6.29's booking-settings screen is what writes it. */
export const REMINDER_SETTING_KEY = "booking.reminder_minutes";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ BOOKING OVERHAUL, 29 Sep 2026 — MORE THAN ONE REMINDER PER BOOKING, EACH ITS OWN TOGGLE.
//     the maintainer's ask: "48 hours, 24 hours, and one hour before, and a toggle that turns each one on or
//     off." `booking.reminder_minutes_before` (above) stays exactly what it always was — a single
//     per-booking value, `null` meaning an explicit opt-out, honoured unchanged by `scheduleReminderFrom`
//     (queue/tasks.mjs). What changes is what the DEFAULT means: instead of one number, the practice
//     now configures a SET of offsets, each independently on or off, and `scheduleReminderFrom`
//     schedules one job per enabled offset (never more than three — the vocabulary is closed).
// ★ A CLOSED SET OF THREE, NOT AN ARBITRARY LIST. the maintainer named exactly 48h/24h/1h; `normalizeReminderOffsets`
//   below keeps only those three minute values from whatever is stored, so a malformed or
//   hand-edited setting cannot schedule a reminder at an offset nothing in the product can turn
//   on or off again.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** The setting a practice's Run → Templates / booking settings screen writes the three toggles to. */
export const REMINDER_OFFSET_SETTING_KEY = "booking.reminder_offsets";

/** ★ Off/off + 24h-on reproduces the exact single-reminder behaviour every booking had before this
 *   task, so a practice that never touches this setting sees no change at all. */
export const DEFAULT_REMINDER_OFFSETS = Object.freeze([
  Object.freeze({ minutes: 2880, enabled: false }), // 48 hours — new, off by default
  Object.freeze({ minutes: 1440, enabled: true }),  // 24 hours — matches the old single default
  Object.freeze({ minutes: 60,   enabled: false }), // 1 hour — new, off by default
]);

/**
 * ★ Reads whatever is stored (a hand-edited or stale value included) and returns exactly the three
 *   known offsets, each either what was stored for it or its own default. Never returns a fourth.
 */
export function normalizeReminderOffsets(raw) {
  const byMinutes = new Map(
    (Array.isArray(raw) ? raw : [])
      .filter((o) => o && Number.isInteger(o?.minutes))
      .map((o) => [o.minutes, o.enabled === true]));
  return DEFAULT_REMINDER_OFFSETS.map((d) => ({
    minutes: d.minutes,
    enabled: byMinutes.has(d.minutes) ? byMinutes.get(d.minutes) : d.enabled,
  }));
}

/** ★ One job key per (booking, offset) — a booking with two enabled offsets holds two live jobs,
 *  each independently replaceable on reschedule without touching the other. */
export const reminderOffsetJobKey = (bookingId, minutes) => `booking-reminder:${bookingId}:${minutes}`;

/** The states that can still be reminded about. ★ `completed` and `no_show` are in the past. */
const REMINDABLE = new Set(["confirmed", "pending_payment"]);

/**
 * ★★★ IS THIS BOOKING STILL ONE ANYBODY SHOULD BE REMINDED ABOUT? State and preference only — NO
 *     CLOCK. This is the question the SCHEDULED JOB asks when it fires, and separating it from
 *     `reminderRunAt` is a correction, not a nicety.
 *
 * ★★★ [EXECUTED] THE FIRST VERSION OF `sendBookingReminder` CALLED `reminderRunAt` AT FIRE TIME AND
 *     IT COULD NEVER SEND ANYTHING. `reminderRunAt` refuses a run time that has already passed —
 *     correct when SCHEDULING, and exactly backwards when FIRING, because by then the reminder's
 *     moment is precisely what HAS arrived. Every call returned null and every reminder was silently
 *     skipped.
 *   ★★ AND IT MADE THE CANCELLED-SESSION ASSERTION VACUOUS. §6 of the gate cancels a booking, runs
 *      the job, and requires that nothing is emitted — and it passed, over a task that emitted
 *      nothing for ANY booking. **The negative was green because the feature was entirely broken.**
 *      Its positive control in §7 is what exposed it: a live booking sent nothing either.
 *   ★ Two questions, two functions. "Should this exist?" has no clock in it; "when should it run?"
 *     is all clock.
 */
export function stillRemindable(booking) {
  if (!stillRemindableAtAll(booking)) return false;
  const minutes = booking.reminder_minutes_before;
  return minutes !== null && minutes !== undefined;
}

/**
 * ★ BOOKING OVERHAUL, 29 Sep 2026 — the state-only half of `stillRemindable`, split out so the new
 *   multi-offset reminders (which are gated by the PRACTICE'S offset settings, not by the booking's
 *   own single `reminder_minutes_before` column) can ask the same state question `stillRemindable`
 *   always asked, without also asking about a column that no longer decides whether a NAMED offset
 *   fires. `stillRemindable` itself is unchanged above — every existing caller and gate keeps its
 *   exact behaviour.
 */
export function stillRemindableAtAll(booking) {
  if (!booking) return false;
  if (!REMINDABLE.has(booking.state)) return false;
  // ★★★ AN ARCHIVED BOOKING IS NOT A SESSION THAT IS HAPPENING. [MEASURED, P2 CLOSE §VISUAL] an
  //     archived booking returned `stillRemindable → true` and emailed every participant — the exact
  //     failure this module's header describes, *"sends 'This is a reminder of your session' for a
  //     session that is not happening"*, arriving through ARCHIVE instead of CANCEL.
  //   ★★ It belongs HERE and not in the query, because it is a STATE fact and this is where the
  //      state decision lives — testable without a database, like every other line in this function.
  if (booking.archived_at) return false;
  return true;
}

/**
 * Has this session already happened?
 *
 * ★★★ A SEPARATE FUNCTION BECAUSE IT IS A SEPARATE KIND OF QUESTION, AND THE SPLIT IS THE POINT.
 *     `stillRemindable` has NO CLOCK in it on purpose — that was a correction, recorded above, and
 *     it stays. But [MEASURED, P2 CLOSE §VISUAL] a booking whose `starts_at` was TEN DAYS AGO and
 *     whose state was still `confirmed` returned `stillRemindable → true`.
 *   ★★ The module's comment assumed *"`completed` and `no_show` are in the past"* — and nothing
 *      forces a confirmed booking to transition. A retried or re-dispatched job therefore reminds
 *      somebody about a session that already happened.
 *   ★ So the clock question is asked explicitly, by name, at the one place that fires: two
 *     predicates, each honest about whether it reads a clock.
 * ★ The grace window is deliberate. A job that fires a few seconds after `starts_at` is the reminder
 *   arriving on time, not late; only a session comfortably behind us is stale.
 */
const LATE_GRACE_MS = 15 * 60 * 1000;

export function alreadyHappened(booking, now) {
  if (!booking?.starts_at) return false;
  return new Date(booking.starts_at).getTime() + LATE_GRACE_MS < now.getTime();
}

/**
 * When the reminder for this booking should run, or null if it should not run at all.
 *
 * ★★★ PURE, AND SEPARATE FROM THE QUEUE ON PURPOSE. Every branch below is a decision a person could
 *     argue with, and a decision buried inside a task handler can only be tested by running a
 *     worker. This is the part worth asserting directly.
 *
 * @param {{starts_at: Date|string, state: string, reminder_minutes_before: number|null}} booking
 * @param {Date} now
 * @returns {Date|null}
 */
export function reminderRunAt(booking, now) {
  return reminderRunAtFor(booking, booking?.reminder_minutes_before, now);
}

/**
 * ★ BOOKING OVERHAUL, 29 Sep 2026 — the same computation as `reminderRunAt`, but for a NAMED offset
 *   rather than the booking's own single column. `reminderRunAt` is now a one-line call onto this
 *   with `booking.reminder_minutes_before` as the offset, so its behaviour (and every gate asserting
 *   it) is unchanged. The multi-offset scheduler calls this once per enabled offset instead.
 * @param {{starts_at: Date|string, state: string}} booking
 * @param {number|null|undefined} minutes
 * @param {Date} now
 * @returns {Date|null}
 */
export function reminderRunAtFor(booking, minutes, now) {
  if (!booking) return null;
  if (!REMINDABLE.has(booking.state)) return null;

  // ★★ NULL IS "NO REMINDER", EXPLICITLY — it is not "use the default". A column (or offset) that
  //    means "ask a setting" makes a booking's behaviour depend on a value somebody can change
  //    afterwards, and the row then no longer records what was promised.
  if (minutes === null || minutes === undefined) return null;

  const startsAt = booking.starts_at instanceof Date ? booking.starts_at : new Date(booking.starts_at);
  if (Number.isNaN(startsAt.getTime())) return null;

  const runAt = new Date(startsAt.getTime() - minutes * 60_000);

  // ★★★ A REMINDER WHOSE TIME HAS ALREADY PASSED IS NOT SENT LATE — IT IS NOT SENT.
  //     A booking made two hours before a session, with a 24-hour reminder, would otherwise fire
  //     immediately and tell somebody about a session they are about to attend. ★ The session itself
  //     still being in the future is a DIFFERENT check and is not the one being made here: the
  //     reminder's own moment is what has passed.
  if (runAt.getTime() <= now.getTime()) return null;

  return runAt;
}

/**
 * The job key for a booking's reminder. ★ One per booking, `replace` mode, so rescheduling a session
 * moves its reminder instead of queueing a second one.
 */
export const reminderJobKey = (bookingId) => `booking-reminder:${bookingId}`;

/**
 * Read the facts a reminder needs, under the caller's transaction.
 * ★★ EVERY VALUE THE EMAIL RENDERS COMES FROM HERE, at fire time — never from the job payload. A
 *    payload written at create time would say the old time after a reschedule.
 * ★ `invitee_timezone` falls back to the TENANT's zone: the template names the zone it is quoting,
 *   and "10:00" with no zone is how somebody misses a session.
 */
export async function reminderFacts(tx, bookingId) {
  const { rows } = await tx.query(
    // ★ `archived_at` is SELECTED, not filtered: `stillRemindable` makes the decision and says why
    //   in its log line. A query that silently dropped the row would report "booking no longer
    //   exists", which is a different and wrong reason.
    `SELECT b.id, b.starts_at, b.state, b.reminder_minutes_before, b.archived_at,
            b.title, b.location_kind, b.location_detail,
            coalesce(b.invitee_timezone, t.timezone) AS timezone,
            s.name  AS service_name,
            t.name  AS practice_name
       FROM keystone.booking b
       JOIN keystone.tenant t  ON t.id = b.tenant_id
       JOIN keystone.service s ON s.id = b.service_id
      WHERE b.id = $1`,
    [bookingId]);
  return rows[0] ?? null;
}

/**
 * The people to remind: participants who are real users of this practice.
 * ★★ A participant row can carry a display_name and email for somebody who has NO account (a guest).
 *    They are deliberately NOT returned: a notification needs a recipient row, and this project's
 *    notification preferences — including do-not-email — hang off `app_user`. **Emailing a guest
 *    through this path would route around the one place consent is recorded** (the same rule F153
 *    is about, arriving from the booking side).
 * ★ Optional attendees ARE reminded. Optional means they may decline, not that they are not told.
 */
export async function reminderRecipients(tx, bookingId) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_participant as bp")
    .innerJoin("keystone.app_user as u", "u.id", "bp.app_user_id")
    .select(["bp.app_user_id", "u.display_name"])
    .where("bp.booking_id", "=", bookingId)
    .where("bp.app_user_id", "is not", null));
  return rows;
}
