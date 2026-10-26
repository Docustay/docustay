// T1.6 — SUBSCRIPTION INVOICES PAID AND FAILED UPDATE DUNNING STATE (F788).
//
// ★★★ STRIPE IS THE MONEY RECORD — THE PLATFORM MIRRORS ONLY. Stripe runs the actual retries (its
//     own Smart Retries setting); this module only reflects what Stripe already decided into the
//     subscription row so every screen in the product shows the right state. `plan.dunning_*` is
//     read by nothing here — Cycle credits are B-2, not here.

import { emit } from "../events/outbox.mjs";

const SECTION = "money";

/**
 * A subscription invoice failed to pay. Marks the subscription past_due, bumps the failed-attempt
 * counter, and emits `money.payment.failed`.
 *
 * @param tx tenant transaction
 * @param event Stripe event; `event.data.object` is the invoice, `.subscription` is the Stripe
 *   subscription id, `.id` is the Stripe invoice id.
 * @param ctx { tenantId }
 * @returns { applied: true } or { applied: false, reason: 'no_such_subscription' }
 */
export async function handleInvoicePaymentFailed(tx, event, { tenantId }) {
  const d = event.data.object;

  const { rows } = await tx.query(
    `UPDATE keystone.subscription
        SET failed_attempts = failed_attempts + 1,
            first_failed_at = COALESCE(first_failed_at, now()),
            failing_stripe_invoice_id = $1,
            state = 'past_due',
            updated_at = now()
      WHERE tenant_id = $2 AND stripe_subscription_id = $3
      RETURNING id`,
    [d.id, tenantId, d.subscription]
  );

  if (rows.length === 0) {
    return { applied: false, reason: "no_such_subscription" };
  }
  const subscriptionId = rows[0].id;

  await emit(tx, {
    tenantId,
    topic: "money.payment.failed",
    emittedBy: SECTION,
    subjectType: "subscription",
    subjectId: subscriptionId,
    actor: "webhook:stripe",
    payload: { subscription_id: subscriptionId, stripe_invoice_id: d.id },
  });

  return { applied: true };
}

/**
 * A subscription invoice paid. Resets the dunning counters and, if the subscription was past_due,
 * returns it to active.
 *
 * @param tx tenant transaction
 * @param event Stripe event; `event.data.object.subscription` is the Stripe subscription id.
 * @param ctx { tenantId }
 * @returns { applied: true } or { applied: false, reason: 'no_such_subscription' }
 */
export async function handleSubscriptionInvoicePaid(tx, event, { tenantId }) {
  const d = event.data.object;

  const { rows } = await tx.query(
    `UPDATE keystone.subscription
        SET failed_attempts = 0,
            first_failed_at = NULL,
            failing_stripe_invoice_id = NULL,
            state = CASE WHEN state = 'past_due' THEN 'active' ELSE state END
      WHERE tenant_id = $1 AND stripe_subscription_id = $2
      RETURNING id`,
    [tenantId, d.subscription]
  );

  if (rows.length === 0) {
    return { applied: false, reason: "no_such_subscription" };
  }

  return { applied: true };
}
