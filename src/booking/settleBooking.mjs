// @ts-check
// BOOKING OVERHAUL, 29 Sep 2026 — SETTLING A SESSION: RECORD ATTENDANCE, THEN ACT ON THE MONEY.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ `attendance.mjs`'s OWN HEADER SAYS WHY IT NEVER CHARGES: "NO MONEY MOVES HERE, DELIBERATELY
//     ... Money is the section that acts on it (§X4: sections never call each other)." This module
//     IS that acting-on — a route-level orchestrator, not a section importing another section's
//     internals: it calls `recordAttendance` (booking) exactly as it always worked, and — only when
//     no package credit already covers the session — either charges the card on file (through the
//     now-mounted `money/charge.mjs`, every one of its 4 locks unchanged) or raises and sends an
//     invoice (`money/writes.mjs` + `money/invoiceSend.mjs`, already-reviewed, already-shipped
//     functions — this module composes them, it does not reimplement either).
//
// ★★★ THE ORDER OF PRECEDENCE, PER TY'S OWN WORDS: A RESERVED PACKAGE CREDIT ALWAYS WINS.
//     `recordAttendance` already consumes any credit RESERVED for this booking (both outcomes, per
//     its own §RUN-2 RULING comment) — if that happens, there is nothing left to charge, and this
//     function stops there regardless of what `paymentMethod` the caller asked for.
//
// ★★★ THE CONFIRMATION IS THE CALLER'S JOB, NOT THIS FUNCTION'S. The route that calls this must have
//     already shown the staff member the amount and gotten an explicit click naming it, per the maintainer's own
//     requirement ("by clicking this button you are agreeing to charge Joe $X"). `approvedBy` is
//     always `actorUserId` — the SESSION's own id, stamped by the route after the body is read,
//     never a value read from the request body (the same F494 discipline `createChargeIntent`'s own
//     header already requires of every caller).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { recordAttendance, resolveNoShowCharge } from "./attendance.mjs";
import { createChargeIntent, ChargePathDisabled, ChargeServiceDisabled, ChargeRefused } from "../money/charge.mjs";
import { createInvoice, createLineItem } from "../money/writes.mjs";
import { sendInvoice } from "../money/invoiceSend.mjs";
import { requestCardUpdate } from "../money/cardUpdate.mjs";
import { reserveCreditForBooking, consumeCreditForBooking, creditStanding } from "../money/credits.mjs";
import { claimBookingFee } from "../money/bookingFeeClaim.mjs";
import { policyFor } from "./writes.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
// ★ FIX, 30 Sep 2026 ("credit-used email" brief) — `recordAttendance`'s own event (attendance.mjs)
//   only carries a credit consumed FROM A PRIOR RESERVATION; the reserve-then-consume block below
//   (paymentMethod === "credit", chosen HERE, not at booking time) happens after that event already
//   fired, so it needs its own.
import { emit, userActor } from "../events/outbox.mjs";

const PAYMENT_METHODS = Object.freeze(["card", "invoice", "credit", "none"]);

/**
 * ★ WHAT THE CONFIRMATION MODAL SHOWS, BEFORE ANYTHING IS CHARGED. Computed with the exact same
 *   query and percent logic `settleBooking` itself uses below, for the same reason
 *   `/api/engagements/attendance-policy`'s own header gives: "the number on the button and the
 *   number that moves the money are the same function's answer" — a preview computed a second way
 *   could show one number and charge another.
 * @returns { amountMinor, currency, percent, serviceName, clientId, clientName, hasSpendableCredit,
 *            alreadyCreditReserved, billable, reason }
 */
export async function previewSettlement(tx, { tenantId, bookingId, outcome }) {
  const { rows: [row] } = await tx.query(
    `SELECT b.service_id, b.state, pr.amount_minor, pr.currency, s.name AS service_name,
            bp.app_user_id AS client_id, u.display_name AS client_name,
            EXISTS (SELECT 1 FROM keystone.entitlement_credit c
                     WHERE c.tenant_id = $1 AND c.booking_id = b.id AND c.status = 'reserved') AS already_reserved
       FROM keystone.booking b
       LEFT JOIN keystone.price pr ON pr.id = b.price_id
       LEFT JOIN keystone.service s ON s.id = b.service_id
       LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
       LEFT JOIN keystone.app_user u ON u.id = bp.app_user_id
      WHERE b.tenant_id = $1 AND b.id = $2`,
    [tenantId, bookingId]);
  if (!row) throw notFound("no such booking in this practice");

  const percent = outcome === "no_show" ? (await resolveNoShowCharge(tx)).percent : 100;
  const amountMinor = row.amount_minor == null ? null : Math.round(row.amount_minor * percent / 100);
  // ★ Part 5 (saved-card brief, 1 Oct 2026) — "3 of 8 left", the exact sentence creditStanding
  //   (src/money/credits.mjs) already exists to render, used here instead of a bare boolean.
  const standing = row.client_id
    ? await creditStanding(tx, { tenantId, ownerUserId: row.client_id, serviceId: row.service_id })
    : null;
  const hasSpendableCredit = (standing?.remaining ?? 0) > 0;

  // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — the read below is `person_card_effective` (Stripe's own
  //   payment methods and default card; already excludes detached), not the platform's cached copy.
  // ★ Part 5 — the card SettleBookingModal.jsx shows ("Visa •••• 4242") or greys out ("No card on
  //   file") comes from the same payment_method table Part 3 keeps synced with Stripe.
  let card = null;
  if (row.client_id) {
    const { rows: cardRows } = await tx.query(
      `SELECT brand, last_four FROM keystone.person_card_effective
        WHERE tenant_id = $1 AND app_user_id = $2 AND is_default = true
        LIMIT 1`,
      [tenantId, row.client_id]);
    card = cardRows[0] ? { brand: cardRows[0].brand, lastFour: cardRows[0].last_four } : null;
  }

  return {
    amountMinor, currency: row.currency ?? "USD", percent,
    serviceName: row.service_name ?? null, clientId: row.client_id ?? null,
    clientName: row.client_name ?? null,
    hasSpendableCredit, creditRemaining: standing?.remaining ?? 0, creditTotal: standing?.total ?? 0,
    alreadyCreditReserved: row.already_reserved === true,
    card, hasCardOnFile: card != null,
    billable: Boolean(row.client_id) && amountMinor != null,
    reason: !row.client_id ? "no client on this session"
      : amountMinor == null ? "no price recorded for this session" : null,
  };
}

/**
 * @param tx a pg client INSIDE a transaction (tenant context already set)
 * @param input { tenantId, bookingId, outcome, participants, actorUserId, paymentMethod }
 *              paymentMethod: "card" | "invoice" | "none" — the staff member's confirmed choice,
 *              ignored (and never charged) when a package credit already covers the session.
 * @returns the same shape `recordAttendance` returns, plus `payment`:
 *          null                                          — nothing to bill (already recorded, or "none")
 *          { method: "credit", entitlementId }            — a reserved credit paid for it
 *          { method: "card", amountMinor, currency, ... } — createChargeIntent's own outcome
 *          { method: "invoice", amountMinor, currency, invoiceId, sent }
 *          { method, outcome: "not_billable", reason }    — no client or no price recorded to bill
 */
export async function settleBooking(tx, {
  tenantId, bookingId, outcome, participants = [], actorUserId = null, paymentMethod = "none",
}) {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw invalid(`paymentMethod must be one of ${PAYMENT_METHODS.join(", ")} — got ${JSON.stringify(paymentMethod)}`);
  }

  const result = await recordAttendance(tx, { tenantId, bookingId, outcome, participants, actorUserId });

  // ★ Already recorded (a double-click, a second coach) — nothing new to charge. Trying again here
  //   would be the exact double-charge an idempotency key elsewhere exists to prevent; refusing to
  //   try is simpler and cannot be wrong.
  if (!result.changed) return { ...result, payment: null };

  // ★ A package credit already paid for this session — see attendance.mjs's own header: BOTH
  //   outcomes consume a reserved credit. There is nothing left to collect, regardless of what
  //   paymentMethod the caller asked for.
  // ★★★ CREDITS defect 10 — a no-show that is SETTLED HERE by a credit, or by "don't charge", must CLAIM the no-show fee BEFORE it returns.
  //     Those branches returned without claiming, so `raiseNoShowCharge` (the automatic listener on the SAME `completed` event) then found
  //     the fee unclaimed and raised a fee invoice for a session already paid by a credit / deliberately waived. Claiming here is what makes
  //     the listener's own `claimBookingFee` lose, by construction.
  const claimNoShowSettled = async () => {
    if (outcome === "no_show") await claimBookingFee(tx, { tenantId, bookingId, feeType: "no_show", actorUserId });
  };
  if (result.creditConsumed) {
    await claimNoShowSettled();
    return { ...result, payment: { method: "credit", entitlementId: result.creditConsumed.entitlement_id } };
  }

  if (paymentMethod === "none") { await claimNoShowSettled(); return { ...result, payment: null }; }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ THE CLIENT HAS A PACKAGE CREDIT, BUT NONE WAS RESERVED AT BOOKING TIME — the maintainer's own ask:
  //     "the charge credit logic... for people who have packages... needs to go into the held
  //     button as well." No caller sets `creditForUserId` today (BookSessionDialog.jsx never has),
  //     so this is the FIRST place a spendable credit can actually be spent for most sessions.
  //     Reserve-then-consume, in this same transaction, so a credit can never appear spent with no
  //     session behind it or vice versa — the identical atomicity `createBooking`'s own reservation
  //     already gets, just later.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  if (paymentMethod === "credit") {
    const { rows: [client] } = await tx.query(
      `SELECT bp.app_user_id AS client_id, b.service_id
         FROM keystone.booking b
         LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
        WHERE b.id = $1`,
      [bookingId]);
    if (!client?.client_id) {
      return { ...result, payment: { method: "credit", outcome: "not_billable", reason: "there is no client on this session" } };
    }
    const reserved = await reserveCreditForBooking(tx, {
      tenantId, ownerUserId: client.client_id, serviceId: client.service_id, bookingId,
    });
    if (!reserved) {
      return { ...result, payment: { method: "credit", outcome: "no_credit", reason: "this client has no spendable credit for this service" } };
    }
    const consumed = await consumeCreditForBooking(tx, { tenantId, bookingId });
    await claimNoShowSettled();
    const entitlementId = consumed?.entitlement_id ?? reserved.entitlementId;
    if (consumed) {
      // ★ Same dedicated topic `recordAttendance` (attendance.mjs) emits for the ordinary
      //   reserved-at-booking-time path — this is the OTHER path to a consumed credit (chosen here,
      //   at settlement, with no prior reservation), so it emits the identical event rather than a
      //   second, differently-shaped one a listener would have to know about separately.
      await emit(tx, {
        tenantId,
        topic: "booking.booking.credit_consumed",
        emittedBy: "booking",
        subjectType: "booking",
        subjectId: bookingId,
        actor: userActor(actorUserId),
        payload: { entitlement_id: entitlementId, service_id: client.service_id },
      });
    }
    return { ...result, payment: { method: "credit", entitlementId } };
  }

  // ★★★ the maintainer, 1 Oct 2026 — THE MERGE. `raiseNoShowCharge` (money/noShow.mjs) is the automatic
  //     counterpart fired when a session is marked no-show through `POST /api/bookings/:id/complete`
  //     (a route with no payment decision of its own) rather than through this modal. Both paths
  //     end at the SAME booking, so claim the fee HERE, before any amount is even computed — if
  //     something else already claimed it (most likely the automatic listener, racing on the same
  //     commit), there is nothing left to do, by construction, not by re-checking what the other
  //     path happened to create.
  if (outcome === "no_show") {
    const claimed = await claimBookingFee(tx, { tenantId, bookingId, feeType: "no_show", actorUserId });
    if (!claimed) {
      return { ...result, payment: {
        method: paymentMethod, outcome: "already_billed",
        reason: "this no-show fee was already charged or invoiced through another path",
      } };
    }
  }

  // ── the amount: the booking's own price SNAPSHOT (never re-priced), at the percent this outcome earns ──
  const { rows: [row] } = await tx.query(
    `SELECT b.service_id, pr.amount_minor, pr.currency, s.name AS service_name,
            bp.app_user_id AS client_id
       FROM keystone.booking b
       LEFT JOIN keystone.price pr ON pr.id = b.price_id
       LEFT JOIN keystone.service s ON s.id = b.service_id
       LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
      WHERE b.id = $1`,
    [bookingId]);

  if (!row?.amount_minor || !row?.client_id) {
    return { ...result, payment: {
      method: paymentMethod, outcome: "not_billable",
      reason: !row?.client_id
        ? "there is no client on this session to bill"
        : "this session has no price recorded — nothing to charge or invoice",
    } };
  }

  const percent = outcome === "no_show" ? (await resolveNoShowCharge(tx)).percent : 100;
  const amountMinor = Math.round(row.amount_minor * percent / 100);
  const currency = row.currency ?? "USD";
  const description = outcome === "no_show"
    ? `${row.service_name ?? "Session"} — ${percent}% no-show charge`
    : `${row.service_name ?? "Session"}`;

  const payment = await chargeOrInvoiceForBooking(tx, {
    tenantId, bookingId, payerUserId: row.client_id, serviceId: row.service_id,
    amountMinor, currency, description, paymentMethod, actorUserId,
    idempotencyKey: `settle:${bookingId}:${outcome}`,
  });
  return { ...result, payment };
}

/**
 * ★★★ the maintainer, 1 Oct 2026 — EXTRACTED FROM `settleBooking`'S OWN BODY, UNCHANGED BEHAVIOUR. This is the
 *     "merge into one path" the no-show/late-cancel brief asks for: both the no-show branch above
 *     and `chargeLateCancelFee` below call this SAME function for the actual card/invoice decision
 *     — one implementation of "how a fee is collected", not two that happen to agree today and
 *     drift tomorrow. `idempotencyKey` is the caller's to set (one per booking + fee-type/outcome,
 *     per the header's own existing reasoning) — this function does not invent one.
 * @returns the same `payment` shape settleBooking has always returned for a card/invoice decision.
 */
async function chargeOrInvoiceForBooking(tx, {
  tenantId, bookingId, payerUserId, serviceId, amountMinor, currency, description,
  paymentMethod, actorUserId, idempotencyKey,
}) {
  const raiseAndSendInvoice = async () => {
    // paymentMethod === "invoice", OR the fallback from a declined/unavailable card charge below —
    // raised OPEN (not draft) and sent immediately: the staff member already confirmed the amount
    // before this ran, so there is no separate "review the draft" step.
    const invoice = await createInvoice(tx, {
      tenantId, payerUserId, amountMinor, currency,
      status: "open", title: description, actorUserId, source: "staff",
    });
    await createLineItem(tx, {
      tenantId, parentType: "invoice", parentId: invoice.id, sourceType: "service", sourceId: serviceId,
      nameSnapshot: description, unitAmountMinor: amountMinor, currency, bookingId, actorUserId,
    });
    const sent = await sendInvoice(tx, { tenantId, invoiceId: invoice.id, actorUserId });
    return { invoiceId: invoice.id, sent };
  };

  if (paymentMethod === "card") {
    // ★★★ Part 4/5 (saved-card brief, 1 Oct 2026) — a charge that cannot go through (the path is
    //     off, no card on file, a decline, or the bank requires authentication that nobody is
    //     present to complete) falls back to Send invoice automatically, in PLAIN WORDS — never the
    //     developer-facing refusal text these error classes carry for their own callers/tests.
    //     ChargePathDisabled/ChargeServiceDisabled/ChargeRefused are all THROWN (not returned), so
    //     they need their own catch; a provider decline/auth-required comes back as a normal
    //     `{ok:false, outcome:'provider_refused', error_code}` return instead.
    let charge;
    try {
      charge = await createChargeIntent(tx, {
        tenantId, payerUserId, amountMinor, currency,
        idempotencyKey,
        description, approvedBy: actorUserId, actorUserId,
      });
    } catch (e) {
      if (e instanceof ChargePathDisabled || e instanceof ChargeServiceDisabled) {
        const { invoiceId, sent } = await raiseAndSendInvoice();
        return {
          method: "invoice", amountMinor, currency, invoiceId, sent,
          fell_back_from: "card",
          staff_message: "Card charging is turned off for this practice. Nothing was charged. An invoice was sent instead.",
        };
      }
      if (e instanceof ChargeRefused) {
        const { invoiceId, sent } = await raiseAndSendInvoice();
        return {
          method: "invoice", amountMinor, currency, invoiceId, sent,
          fell_back_from: "card",
          staff_message: "This client has no card on file to charge. Nothing was charged. An invoice was sent instead.",
        };
      }
      throw e;
    }

    if (charge.ok) {
      return { method: "card", amountMinor, currency, ...charge };
    }

    // ── a normal (non-thrown) refusal from Stripe itself — decline, or the bank wants authentication ──
    const needsAuth = charge.error_code === "authentication_required";
    const { invoiceId, sent } = await raiseAndSendInvoice();
    // ★ Part 3/4 — tell the client to update their card whenever the reason IS the card (declined,
    //   expired, authentication needed) rather than something on the platform's own side.
    await requestCardUpdate(tx, { tenantId, appUserId: payerUserId, channel: "email", actorUserId });
    return {
      method: "invoice", amountMinor, currency, invoiceId, sent,
      fell_back_from: "card",
      staff_message: needsAuth
        ? "The client's bank needs them to confirm this card in person, so it couldn't be charged automatically. Nothing was charged. An invoice was sent instead, and the client has been emailed to update their card."
        : "The card on file was declined. Nothing was charged. An invoice was sent instead, and the client has been emailed to update their card.",
    };
  }

  const { invoiceId, sent } = await raiseAndSendInvoice();
  return { method: "invoice", amountMinor, currency, invoiceId, sent };
}

/**
 * ★★★ the maintainer, 1 Oct 2026 — LATE-CANCEL FEES, ON THE SAME PATH AS NO-SHOW. Driven by the existing
 *     policy setting (`booking.late_cancel_behaviour` / `booking.late_cancel_charge_percent`,
 *     `src/booking/writes.mjs::policyFor`) that `cancelBookingByRequest` already COMPUTES for every
 *     outside-the-window client cancellation but — until this — never ACTED on; it only carried
 *     `late_cancel_behaviour` in the `booking.booking.cancelled` event payload for a listener that
 *     did not exist. `'credit_back'` is deliberately NOT handled here: it is "return a credit that
 *     was reserved for this session", a credits-ledger action, not a charge — out of this
 *     function's scope, which is money collection only.
 * @param {{tenantId, bookingId, actorUserId?, paymentMethod?}} args `paymentMethod` defaults to
 *   "card" — there is no staff member present to choose on a CLIENT-initiated cancellation, and
 *   `chargeOrInvoiceForBooking`'s own card branch already falls back to an invoice (with the
 *   client emailed to update their card) on any decline, disabled path, or missing card, so
 *   defaulting to "card" never leaves a late-cancel fee uncollected-and-unexplained.
 * @returns `{ skipped: true, reason }` when the policy does not call for a charge, or a `payment`
 *   shape identical to settleBooking's own.
 */
export async function chargeLateCancelFee(tx, { tenantId, bookingId, actorUserId = null, paymentMethod = "card" }) {
  const { rows: [row] } = await tx.query(
    `SELECT b.service_id, b.state, pr.amount_minor, pr.currency, s.name AS service_name,
            bp.app_user_id AS client_id
       FROM keystone.booking b
       LEFT JOIN keystone.price pr ON pr.id = b.price_id
       LEFT JOIN keystone.service s ON s.id = b.service_id
       LEFT JOIN keystone.booking_participant bp ON bp.booking_id = b.id AND bp.party = 'client'
      WHERE b.tenant_id = $1 AND b.id = $2`,
    [tenantId, bookingId]);
  if (!row) throw notFound("no such booking in this practice");
  if (row.state !== "cancelled") {
    // ★ A late-cancel fee only ever follows an actual cancellation — never a guess from a caller
    //   that has not itself confirmed the booking reached that state.
    throw conflict("this booking is not cancelled — a late-cancel fee cannot be charged against it");
  }

  const policy = await policyFor(tx, tenantId, row.service_id);
  if (policy.late_cancel_behaviour !== "charge_percent") {
    return { skipped: true, reason: `this practice's late-cancel policy is "${policy.late_cancel_behaviour}", not a charge` };
  }
  const percent = policy.late_cancel_charge_percent;
  if (!percent || percent <= 0 || !row.amount_minor || !row.client_id) {
    return { skipped: true, reason: !row.client_id ? "there is no client on this session to bill"
      : !row.amount_minor ? "this session has no price recorded"
      : "the late-cancel charge percent is zero — nothing to collect" };
  }

  const claimed = await claimBookingFee(tx, { tenantId, bookingId, feeType: "late_cancel", actorUserId });
  if (!claimed) {
    return { method: paymentMethod, outcome: "already_billed",
      reason: "this late-cancel fee was already charged or invoiced" };
  }

  const amountMinor = Math.round(row.amount_minor * percent / 100);
  const currency = row.currency ?? "USD";
  const description = `${row.service_name ?? "Session"} — ${percent}% late-cancellation fee`;

  return chargeOrInvoiceForBooking(tx, {
    tenantId, bookingId, payerUserId: row.client_id, serviceId: row.service_id,
    amountMinor, currency, description, paymentMethod, actorUserId,
    idempotencyKey: `late_cancel:${bookingId}`,
  });
}
