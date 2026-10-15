// @ts-check
// src/booking/settingsSummary.mjs — Stage 13 task 13.25. The reads behind the booking settings
// hub, the online-booking leaf, the service-rules matrix and the "what we send" leaf.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ DERIVED FROM `policyFor` (src/booking/writes.mjs:387, task 13.8), NEVER A SECOND READ OF THE
//     RAW SETTINGS. A settings summary that re-reads `tenant_setting`/`booking_policy` on its own
//     is a second source of truth and will drift from what the write routes actually enforce —
//     the exact failure class CLAUDE.md names first ("built and wired to nothing"), one step
//     removed: a screen that tells a practice owner a number the enforcement path never reads.
//     Every merged policy value below comes from `policyFor(tx, tenantId, serviceId)`; the ONLY
//     things read directly are (a) the raw `booking.*` key/value pairs the `keys` field must show
//     verbatim (that IS the settings store, not a derived fact) and (b) the two Stage-13 F05 keys
//     `policyFor` does not cover at all — `booking.who_can_book` (service-rules) and
//     `booking.show_staff_choice` (online-booking `rules`) — read here for DISPLAY ONLY. Neither
//     enforces anything: 13.21 and 13.20 remain the named enforcement readers (src/settings/
//     keys.mjs:347-352). Showing a practice its own setting is not the same claim as enforcing it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { getSetting } from "../settings/writes.mjs";
import { policyFor } from "./writes.mjs";
import { policySentence } from "./policySentence.mjs";
import { formatMinor, formatDayMonth, numberWord } from "../money/format.mjs";
import { wallClockIn, zonedLocalToUtc } from "./slots.mjs";
import { DEFAULT_REMINDER_MINUTES, DEFAULT_REMINDER_OFFSETS } from "./reminders.mjs";
import { RULED_NO_SHOW_CHARGE_PERCENT } from "./attendance.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★ EVERY `booking.*` KEY, CLOSED — 22 of them (MEASURED, `src/settings/keys.mjs`, 26 Sep; +1 on
//   29 Sep for `booking.reminder_offsets`, the multi-offset reminder toggle).
//   The default here is the SAME default `getSetting`'s caller would use; three of the twenty-two are
//   imported from the module that owns their ruling (`DEFAULT_REMINDER_MINUTES`,
//   `DEFAULT_REMINDER_OFFSETS`, `RULED_NO_SHOW_CHARGE_PERCENT`) rather than re-typed, so this list
//   cannot silently disagree with the reader that actually enforces them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const BOOKING_SETTING_DEFAULTS = Object.freeze({
  "booking.reminder_minutes": DEFAULT_REMINDER_MINUTES,
  "booking.reminder_offsets": DEFAULT_REMINDER_OFFSETS,
  "booking.client_may_book": true,
  "booking.client_may_reschedule": true,
  "booking.client_may_cancel": true,
  "booking.reschedule_notice_minutes": 1440,
  "booking.late_cancel_behaviour": "free",
  "booking.late_cancel_charge_percent": 0,
  "booking.card_required_at_booking": false,
  "booking.card_kept_on_file": false,
  "booking.cancel_requires_contact": false,
  "booking.policy_text": null,
  "booking.no_show_charge_percent": RULED_NO_SHOW_CHARGE_PERCENT,
  "booking.window_days": 60,
  "booking.notice_minutes": 120,
  "booking.gap_before_minutes": 0,
  "booking.gap_after_minutes": 0,
  "booking.who_can_book": "anyone",
  "booking.show_staff_choice": true,
  "booking.online_enabled": true,
  "booking.waitlist_offer_minutes": 60,
  "booking.consent_hold_hours": 24,
});
const BOOKING_SETTING_KEYS = Object.freeze(Object.keys(BOOKING_SETTING_DEFAULTS));

// ★ The policy fields `policyFor` merges (service value winning over the practice default) that
//   are meaningful to compare service-vs-practice — `buffer_before/after_minutes` are excluded
//   because they are ADDITIVE (practice gap + service buffer, never a coalesce, "applied on top of
//   anything a service sets for itself" — writes.mjs:387's own doc), and `payment_mode`/
//   `deposit_amount_minor` are excluded because there is no practice-level counterpart for them —
//   every service carries its own (0311), so "differs from the practice" is not a meaningful
//   question for those two.
const OVERRIDE_COMPARE_FIELDS = Object.freeze([
  "client_may_book", "client_may_reschedule", "client_may_cancel",
  "reschedule_notice_minutes", "late_cancel_behaviour", "late_cancel_charge_percent",
  "card_required_at_booking", "card_kept_on_file", "cancel_requires_contact", "policy_text",
  "minimum_notice_minutes", "booking_window_days", "cancellation_notice_minutes",
]);

async function tenantTimeZone(tx, tenantId) {
  const { rows } = await run(tx, db.selectFrom("keystone.tenant").select(["timezone"]).where("id", "=", tenantId));
  return rows[0]?.timezone ?? "UTC";
}

/** Midnight, 1 January, in the tenant's OWN zone — never a bare UTC year boundary (§B4 STEP 3). */
function startOfYearLocal(timeZone, now = new Date()) {
  const w = wallClockIn(now, timeZone);
  return zonedLocalToUtc(w.year, 1, 1, 0, timeZone);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/engagements/booking-settings — the settings hub + the turn-off modal's counts.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export async function readBookingSettings(tx, { tenantId }) {
  const keys = {};
  for (const key of BOOKING_SETTING_KEYS) {
    keys[key] = await getSetting(tx, key, BOOKING_SETTING_DEFAULTS[key]);
  }

  const { rows: services } = await run(tx, db.selectFrom("keystone.service").select(["id", "name"]).where("tenant_id", "=", tenantId).orderBy("name", "asc"));

  // ★ 13.8: serviceId may be null — a practice-only answer, since the booking_policy SELECT
  //   matches zero rows for NULL. This IS the practice baseline every override is compared to.
  const practiceOnly = await policyFor(tx, tenantId, null);

  const overrides = [];
  for (const svc of services) {
    const merged = await policyFor(tx, tenantId, svc.id);
    const fields = OVERRIDE_COMPARE_FIELDS.filter((f) => merged[f] !== practiceOnly[f]);
    if (fields.length > 0) overrides.push({ serviceId: svc.id, serviceName: svc.name, fields });
  }

  const timeZone = await tenantTimeZone(tx, tenantId);
  const yearStart = startOfYearLocal(timeZone);

  const { rows: [ahead] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.booking
      WHERE tenant_id = $1 AND state <> 'cancelled' AND starts_at > now()`, [tenantId]);
  const { rows: [waiting] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.booking_waitlist_entry
      WHERE tenant_id = $1 AND status = 'waiting'`, [tenantId]);
  const { rows: [thisYear] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.booking
      WHERE tenant_id = $1 AND state <> 'cancelled' AND created_at >= $2`, [tenantId, yearStart]);
  // ★ MEASURED — `createBooking.mjs`'s closed vocabulary is 'staff'|'portal'|'public'|'waitlist'|
  //   'rwg' (BOOKING_SOURCES), but `publicBooking.mjs`'s own emit still writes the pre-13.9 literal
  //   "public_booking" into the row's `source` column via its INSERT — a pre-existing mismatch in a
  //   sibling-owned file, out of this task's file list to fix. `ILIKE 'public%'` catches both.
  const { rows: [viaOnline] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.booking
      WHERE tenant_id = $1 AND state <> 'cancelled' AND created_at >= $2 AND source ILIKE 'public%'`,
    [tenantId, yearStart]);

  // ★ lastChanged — the plan's own words: "from the newest tenant_setting.updated_at/updated_by
  //   among booking.* keys", not the general settings `audit_entry`/`lastChangedBy` idiom
  //   (src/routes/settings.mjs:207) other settings screens use. Followed literally: this reads
  //   `tenant_setting` directly, on purpose, not `audit_entry`.
  const { rows: [changed] } = await tx.query(
    `SELECT ts.updated_at AS at, u.display_name
       FROM keystone.tenant_setting ts
       LEFT JOIN keystone.app_user u ON u.tenant_id = ts.tenant_id AND u.id = ts.updated_by
      WHERE ts.tenant_id = $1 AND ts.key LIKE 'booking.%'
      ORDER BY ts.updated_at DESC
      LIMIT 1`, [tenantId]);

  return {
    keys,
    overrides,
    turnOff: {
      bookingsAhead: ahead.n,
      waitlistWaiting: waiting.n,
      bookingsThisYear: thisYear.n,
      viaOnlineThisYear: viaOnline.n,
      portalStillBooks: practiceOnly.client_may_book,
    },
    lastChanged: changed ? { by: changed.display_name ?? "an operator", at: changed.at } : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/engagements/online-booking — per-service public rows, practice rules, link-share.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * F05 §2.6's four drawn sentences, in priority order: a service that is not public reads its
 * not-public state first (nothing else about it matters on this screen); a free service says so;
 * a card-required service says so; a multi-seat service with an upcoming occurrence counts down
 * seats; everything else falls back to price + duration.
 * ★ `isAddOnOnly` is ALWAYS false here — Stage 14 has not yet landed the column that would carry
 *   it (plan field 4's own note: "only when the service is add-on-only (Stage 14 column)"). Until
 *   then every not-public service reads "Not on your booking page." — never guessed as add-on-only.
 */
function onlineBookingSentence({ publicBookable, paymentMode, cardRequired, priceMinor,
                                  durationMinutes, nextClass, isAddOnOnly = false }) {
  if (!publicBookable) {
    return isAddOnOnly
      ? "Sold alongside something else, never on its own."
      : "Not on your booking page.";
  }
  if (paymentMode === "free") {
    return `Free, ${durationMinutes} minutes.`;
  }
  const price = formatMinor(priceMinor);
  if (cardRequired) {
    return `${price}. A card on file is required before anyone can book.`;
  }
  if (nextClass) {
    const placesLeft = Math.max(0, (nextClass.capacity ?? 0) - nextClass.taken);
    const word = numberWord(placesLeft);
    const capWord = word.charAt(0).toUpperCase() + word.slice(1);
    return `${price}. ${capWord} places left on ${formatDayMonth(nextClass.starts_at)}.`;
  }
  return `${price}, ${durationMinutes} minutes.`;
}

/**
 * ★ "Where bookings came from" (spec 03b §2.3's own reader, `src/booking/bookingLinks.mjs:38-58`)
 *   answers this per-COACH; this is the PRACTICE-WIDE roll-up the online-booking leaf's share
 *   prompt needs ("41 of 48 bookings came through the maintainer's personal link"). There is no column that
 *   directly records `this booking used a coach's OWN personal link page` — `app_user.source`
 *   (the free-text `srcTag` `POST /api/public/book` writes, CT-120) is the only signal available.
 *   ★★ BEST-EFFORT, NAMED AS SUCH: a booking is counted as "via a personal link" when its client's
 *   tag matches that booking's OWN host's `booking_slug` case-insensitively — the one real,
 *   grounded relationship the schema offers (a personal link`s URL segment IS the coach`s slug),
 *   never a fabricated number. Reported at build time (13.25) rather than left silent.
 */
async function onlineBookingLinkShare(tx, tenantId) {
  const { rows } = await tx.query(
    `SELECT b.host_id, h.display_name AS host_name, count(DISTINCT b.id)::int AS n
       FROM keystone.booking b
       JOIN keystone.booking_participant bp
         ON bp.tenant_id = b.tenant_id AND bp.booking_id = b.id AND bp.party = 'client'
       JOIN keystone.app_user au ON au.tenant_id = b.tenant_id AND au.id = bp.app_user_id
       JOIN keystone.app_user h  ON h.tenant_id  = b.tenant_id AND h.id  = b.host_id
      WHERE b.tenant_id = $1 AND b.source ILIKE 'public%'
        AND h.booking_slug IS NOT NULL
        AND au.source IS NOT NULL AND lower(au.source) = lower(h.booking_slug)
      GROUP BY b.host_id, h.display_name
      ORDER BY n DESC`,
    [tenantId]);
  const { rows: [totalRow] } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.booking WHERE tenant_id = $1 AND source ILIKE 'public%'`,
    [tenantId]);
  const viaPersonalLinks = rows.reduce((sum, r) => sum + r.n, 0);
  return { viaPersonalLinks, total: totalRow.n, topHostName: rows[0]?.host_name ?? null };
}

export async function readOnlineBooking(tx, { tenantId }) {
  const { rows: services } = await run(tx, db.selectFrom("keystone.service").select(["id", "name", "price_minor", "duration_minutes", "public_bookable"]).where("tenant_id", "=", tenantId).orderBy("name", "asc"));

  const practicePolicy = await policyFor(tx, tenantId, null);
  // ★ display-only read of one of 13.8's five not-yet-enforced keys — 13.20 remains the gate.
  const showStaffChoice = await getSetting(tx, "booking.show_staff_choice", true);

  const out = [];
  for (const svc of services) {
    const policy = await policyFor(tx, tenantId, svc.id);
    // ★ "the page reads PRICE ROWS" (F05 §2.7) — `keystone.current_price()` (0015) is the ONE
    //   effective-dated answer to "what does this cost right now", reused rather than a second
    //   effective-dating implementation. Falls back to the legacy `service.price_minor` only when
    //   no active price row exists yet.
    const { rows: [priceRow] } = await tx.query(
      `SELECT amount_minor FROM keystone.current_price('service', $1)`, [svc.id]);
    const priceMinor = priceRow?.amount_minor ?? svc.price_minor;

    const { rows: [booked] } = await tx.query(
      `SELECT count(*)::int AS n FROM keystone.booking
        WHERE tenant_id = $1 AND service_id = $2 AND state <> 'cancelled'
          AND starts_at >= now() - interval '90 days' AND starts_at <= now()`,
      [tenantId, svc.id]);

    const { rows: [nextClass] } = await tx.query(
      `SELECT b.starts_at, b.capacity,
              (SELECT count(*)::int FROM keystone.booking_participant p
                WHERE p.tenant_id = b.tenant_id AND p.booking_id = b.id AND p.party = 'client') AS taken
         FROM keystone.booking b
        WHERE b.tenant_id = $1 AND b.service_id = $2 AND b.state <> 'cancelled'
          AND b.capacity IS NOT NULL AND b.capacity > 1 AND b.starts_at > now()
        ORDER BY b.starts_at ASC LIMIT 1`,
      [tenantId, svc.id]);

    out.push({
      id: svc.id,
      name: svc.name,
      publicBookable: svc.public_bookable,
      priceMinor,
      paymentMode: policy.payment_mode,
      cardRequired: policy.card_required_at_booking,
      bookedCount: booked.n,
      sentence: onlineBookingSentence({
        publicBookable: svc.public_bookable,
        paymentMode: policy.payment_mode,
        cardRequired: policy.card_required_at_booking,
        priceMinor,
        durationMinutes: svc.duration_minutes,
        nextClass: nextClass ?? null,
      }),
    });
  }

  return {
    services: out,
    rules: {
      noticeMinutes: practicePolicy.minimum_notice_minutes,
      windowDays: practicePolicy.booking_window_days,
      cardRequiredExceptFree: practicePolicy.card_required_at_booking,
      showStaffChoice,
    },
    linkShare: await onlineBookingLinkShare(tx, tenantId),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/engagements/service-rules — the override matrix (Service × Who can book · Paying ·
// Notice · Cancelling), amber = differs from the practice default.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function payingLabel(policy) {
  if (policy.payment_mode === "free") return "Free";
  if (policy.payment_mode === "deposit" && policy.deposit_amount_minor != null) {
    return `Deposit ${formatMinor(policy.deposit_amount_minor)}`;
  }
  if (policy.payment_mode === "card_on_file") return "Card on file";
  if (policy.payment_mode === "pay_in_full") return "Pay in full";
  return "Free";
}

function noticeLabel(minutes) {
  return Number.isInteger(minutes) && minutes % 60 === 0
    ? `${minutes / 60} hours`
    : `${minutes} minutes`;
}

export async function readServiceRules(tx, { tenantId }) {
  const { rows: services } = await run(tx, db.selectFrom("keystone.service").select(["id", "name"]).where("tenant_id", "=", tenantId).orderBy("name", "asc"));
  const practiceOnly = await policyFor(tx, tenantId, null);
  // ★ display-only read of another of 13.8's five not-yet-enforced keys — 13.21 remains the gate.
  const whoCanBook = await getSetting(tx, "booking.who_can_book", "anyone");

  const rows = [];
  for (const svc of services) {
    const policy = await policyFor(tx, tenantId, svc.id);
    rows.push({
      serviceId: svc.id,
      name: svc.name,
      whoCanBook,
      paying: payingLabel(policy),
      notice: noticeLabel(policy.minimum_notice_minutes),
      cancelling: policySentence(policy).short,
      differs: {
        // ★ There is no `booking_policy.who_can_book` column (0013/0311 — MEASURED) — the F05 key
        //   is practice-only with no per-service override mechanism, so it can never differ.
        whoCanBook: false,
        paying: policy.payment_mode !== "free" || policy.deposit_amount_minor != null,
        notice: policy.minimum_notice_minutes !== practiceOnly.minimum_notice_minutes,
        cancelling:
          policy.cancellation_notice_minutes !== practiceOnly.cancellation_notice_minutes ||
          policy.late_cancel_behaviour !== practiceOnly.late_cancel_behaviour ||
          policy.late_cancel_charge_percent !== practiceOnly.late_cancel_charge_percent,
      },
    });
  }
  return { rows };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GET /api/engagements/sending-matrix — THE FOURTEEN ROWS, DECIDED BY THE SERVER (R-13.6).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THIS TABLE IS THE FROZEN CENSUS — task 13.41's own field 4 quotes it in full and calls it
//     "the list that stops a builder inventing a control". Every row here is MEASURED against the
//     real modules by `test/s13_25_booking_reads.test.mjs`'s own case (e): the state a row claims
//     must match what `src/queue/tasks.mjs` and `src/notifications/topics.mjs` actually do, not
//     what this file merely asserts — the "who supplies the condition" rule applied to a table
//     instead of a GUC. Do not add, remove or re-state a row without re-measuring against those
//     two files first (25/26 Sep sweep).
export const SENDING_ROWS = Object.freeze([
  { key: "booked", name: "They book something", meaning: "Confirms a new booking to the client.",
    timing: "Straight away", topic: "booking.booking.created", state: "always_on",
    reason: null, sharesWith: null },
  { key: "accept_request", name: "You accept a request",
    meaning: "Tells the client their booking request was approved.",
    timing: null, topic: null, state: "not_built",
    reason: "Nobody can ask to book yet — there is no booking-request model.", sharesWith: null },
  { key: "decline_request", name: "You turn a request down",
    meaning: "Tells the client their booking request was declined.",
    timing: null, topic: null, state: "not_built",
    reason: "Nobody can ask to book yet — there is no booking-request model.", sharesWith: null },
  { key: "reminder", name: "A reminder", meaning: "Reminds the client of an upcoming session.",
    timing: "1 day before", topic: "booking.booking.reminder", state: "switchable",
    reason: null, sharesWith: null },
  { key: "reminder_unconfirmed", name: "A second reminder",
    meaning: "Reminds anyone who has not confirmed.",
    timing: "for anyone who hasn't confirmed", topic: null, state: "not_built",
    reason: "Nobody is asked to confirm yet — there is no confirmation step.", sharesWith: null },
  { key: "you_move", name: "You move a session", meaning: "Tells the client their session moved.",
    timing: "Straight away", topic: "booking.booking.rescheduled", state: "no_switch",
    reason: "Always sent — no switch for this one yet.", sharesWith: null },
  { key: "they_move", name: "They move a session",
    meaning: "Tells the practice a client moved their own session.",
    timing: "Straight away", topic: "booking.booking.rescheduled", state: "shared",
    reason: null, sharesWith: "you_move" },
  { key: "ask_to_move", name: "They ask to move one",
    meaning: "A client asks to move a session instead of moving it themselves.",
    timing: null, topic: null, state: "not_built",
    reason: "There is no ask-instead flow — moving is off or on, nothing in between.",
    sharesWith: null },
  { key: "you_cancel", name: "You cancel", meaning: "Tells the client their session was cancelled.",
    timing: "Straight away", topic: "booking.booking.cancelled", state: "always_on",
    reason: null, sharesWith: null },
  { key: "they_cancel", name: "They cancel", meaning: "Tells the practice a client cancelled.",
    timing: "Straight away", topic: "booking.booking.cancelled", state: "shared",
    reason: null, sharesWith: "you_cancel" },
  { key: "late_cancel_charge", name: "A late cancellation charge",
    meaning: "Warns before a late-cancellation charge is taken.",
    timing: "before you take it", topic: null, state: "not_built",
    reason: "Nothing charges yet — the charge decision travels in the event and Money (Stage 15) acts on it.",
    sharesWith: null },
  { key: "no_show", name: "They didn't turn up",
    meaning: "Tells the client they were marked as a no-show.",
    timing: null, topic: "booking.booking.completed", state: "not_built",
    reason: "The no-show decision is recorded, but no message is sent — that waits on Stage 15.",
    sharesWith: null },
  { key: "package_running_out", name: "Their package is running out",
    meaning: "Tells the client their package/entitlement is nearly used up.",
    timing: null, topic: "booking.entitlement.expiring", state: "not_built",
    reason: "The topic is emitted and opens a task for the practice; no client message exists yet.",
    sharesWith: null },
  { key: "waitlist_offer", name: "A slot they wanted opened up",
    meaning: "Offers a freed slot to someone on the waitlist.",
    timing: "Straight away", topic: "booking.waitlist.offered", state: "no_switch",
    reason: "Always sent — no switch for this one yet.", sharesWith: null },
]);

/**
 * ★ PURE — no database. `push`'s availability is a DEPLOYMENT fact, not a per-tenant one: the same
 *   condition `PRODUCTION_SENDERS` itself uses (`src/notifications/send.mjs:278-281`, MEASURED).
 *   `text` is hard-false: `notification_rule_channel_check` admits only `in_app|email|push`
 *   (MEASURED), so a text toggle could not be stored even if this screen offered one.
 */
export function sendingMatrix() {
  return {
    channelsAvailable: {
      email: true,
      text: false,
      push: Boolean(process.env.KEYSTONE_FIREBASE_PROJECT_ID),
    },
    rows: SENDING_ROWS.map((r) => ({ ...r })),
  };
}
