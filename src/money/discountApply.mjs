// src/money/discountApply.mjs — Stage 20 task 20.64. APPLY COUPON TO PERSON.
//
// ★★★ WRITER: apply/remove coupon on a PERSON (app_user.applied_coupon_id). Emits
//     `money.coupon.applied_to_person` / `money.coupon.removed_from_person` in the same
//     transaction as the update (P15B.2 discipline — write + event, no silent state change).
//     This coupon appears on the person's NEXT subscription create, pushed as Stripe
//     `customer.discount` coupon param.

import { emit } from "../events/outbox.mjs";

const SECTION = "money";

/**
 * Apply a coupon to a person. The coupon appears on their next subscription create.
 * @param {PgTransaction} tx
 * @param {Object} ctx
 * @param {string} ctx.tenantId
 * @param {string} ctx.userId - the app_user id
 * @param {string} ctx.couponId - the coupon id
 * @returns {Promise<void>}
 */
export async function applyPersonCoupon(tx, { tenantId, userId, couponId }) {
  // Update the person's applied coupon
  await tx.query(
    `UPDATE keystone.app_user
      SET applied_coupon_id = $3
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId, couponId]
  );

  // Emit the event
  await emit(tx, {
    tenantId,
    topic: "money.coupon.applied_to_person",
    emittedBy: SECTION,
    payload: { app_user_id: userId, coupon_id: couponId },
  });
}

/**
 * Remove a coupon from a person.
 * @param {PgTransaction} tx
 * @param {Object} ctx
 * @param {string} ctx.tenantId
 * @param {string} ctx.userId - the app_user id
 * @returns {Promise<void>}
 */
export async function removePersonCoupon(tx, { tenantId, userId }) {
  // Clear the applied coupon
  await tx.query(
    `UPDATE keystone.app_user
      SET applied_coupon_id = NULL
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId]
  );

  // Emit the event
  await emit(tx, {
    tenantId,
    topic: "money.coupon.removed_from_person",
    emittedBy: SECTION,
    payload: { app_user_id: userId },
  });
}
