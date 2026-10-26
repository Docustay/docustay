// Stage 15 task 15.66 — LOYALTY ACCRUAL (BOTH LEGS)
//
// Two listener bodies: accrueLoyaltyForPayment (for money.payment.succeeded and
// money.payment.recorded_offline) and accrueLoyaltyForReferral (for people.referral.outcome_set).
// Both deliberately thin — neither computes points, neither checks if the rule is on, neither
// writes a ledger row directly. That is ALL accrueLoyalty's job (src/items/loyalty.mjs).

import { accrueLoyalty } from "../items/loyalty.mjs";
import { asPracticeOwner } from "./asPracticeOwner.mjs";

/**
 * Listener body for `money.payment.succeeded` and `money.payment.recorded_offline` events.
 * A cash payment accrues exactly like a card payment — "per dollar", not "per card".
 *
 * @param {object} tx — tenant-scoped transaction
 * @param {object} ev — event from the outbox, with payload.payment_id
 * @param {object} config — { tenantId }
 * @returns {Promise<{accrued: boolean, reason?: string, points?: number}>}
 */
export async function accrueLoyaltyForPayment(tx, ev, { tenantId }) {
  // Read the payment row as the practice Owner (the dispatcher's transaction carries no viewer).
  // ★ Trust the PAYMENT ROW's `amount_minor`, never `ev.payload.amount_minor` — the event
  // payload is a copy, the row is the record.
  const payment = await asPracticeOwner(tx, tenantId, async (txOwner) => {
    const { rows } = await txOwner.query(
      // ★ STRIPE MIRROR (0574) — status/amount are Stripe's word (payment_effective), not the cache row.
      `SELECT id, status, payer_user_id, amount_minor
       FROM keystone.payment_effective WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.payload.payment_id]);
    return rows.length > 0 ? rows[0] : null;
  });

  if (!payment) {
    return { accrued: false, reason: "payment_not_found" };
  }

  // If the row's `status` is not `'succeeded'`: return refunded.
  // (the mirror says `partially_refunded` once some money is back — the payment still earned its points)
  if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
    return { accrued: false, reason: "refunded" };
  }

  // If `payer_user_id` is null: return no_payer.
  if (payment.payer_user_id === null) {
    return { accrued: false, reason: "no_payer" };
  }

  // Call accrueLoyalty and return its result unchanged.
  return accrueLoyalty(tx, {
    tenantId,
    appUserId: payment.payer_user_id,
    reason: "earn_payment",
    sourceType: "payment",
    sourceId: payment.id,
    amountMinor: payment.amount_minor,
  });
}

/**
 * Listener body for `people.referral.outcome_set` events.
 * A referral earns when it converts; credits the FRIEND WHO BROUGHT THEM, never the referred
 * person themselves.
 *
 * @param {object} tx — tenant-scoped transaction
 * @param {object} ev — event from the outbox, with payload.outcome and subjectId
 * @param {object} config — { tenantId }
 * @returns {Promise<{accrued: boolean, reason?: string, points?: number}>}
 */
export async function accrueLoyaltyForReferral(tx, ev, { tenantId }) {
  // If outcome is not 'became_client': return not_a_conversion.
  // A referral earns when it converts, not when sent/taken/in-progress/declined/no-reply.
  if (ev.payload.outcome !== "became_client") {
    return { accrued: false, reason: "not_a_conversion" };
  }

  // Read the network_referral row by subjectId as the practice Owner.
  const referral = await asPracticeOwner(tx, tenantId, async (txOwner) => {
    const { rows } = await txOwner.query(
      `SELECT id, direction, referred_person_id
       FROM keystone.network_referral WHERE tenant_id = $1 AND id = $2`,
      [tenantId, ev.subjectId]);
    return rows.length > 0 ? rows[0] : null;
  });

  if (!referral) {
    return { accrued: false, reason: "referral_not_found" };
  }

  // If direction is not 'in': return outbound.
  // An OUTBOUND referral sends one of OUR clients to a partner practice — nobody here earns.
  if (referral.direction !== "in") {
    return { accrued: false, reason: "outbound" };
  }

  // Read referred_by_id from app_user for the referral's referred_person_id.
  const referrerResult = await asPracticeOwner(tx, tenantId, async (txOwner) => {
    const { rows } = await txOwner.query(
      `SELECT referred_by_id FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`,
      [tenantId, referral.referred_person_id]);
    return rows.length > 0 ? rows[0] : null;
  });

  if (!referrerResult) {
    return { accrued: false, reason: "referred_person_not_found" };
  }

  const referrerId = referrerResult.referred_by_id;

  // If referred_by_id is null: return referrer_is_a_party.
  // A party holds no loyalty balance, so there's nobody to credit.
  if (referrerId === null) {
    return { accrued: false, reason: "referrer_is_a_party" };
  }

  // If non-null: call accrueLoyalty to credit the friend who brought them.
  return accrueLoyalty(tx, {
    tenantId,
    appUserId: referrerId,
    reason: "earn_referral",
    sourceType: "referral",
    sourceId: referral.id,
    amountMinor: null,
  });
}
