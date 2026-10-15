// @ts-check
// Stage 15 task 15.15 — REFUND REQUEST AND EXECUTION
//
// Handle refund requests with optional approval workflow for non-Owners.
//
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same RETURNING columns, same ON CONFLICT
//   behaviour, same parameterization). `sql` is the escape hatch for what the builder itself does
//   not express (e.g. `refunded_minor + $n`, `now()`).

import { forbidden, invalid, conflict, dependency } from "../http/errors.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { openChainTask, closeChainTasks } from "../tasks/writes.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { practiceOwnerId } from "./asPracticeOwner.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { metadataFor } from "./metadata.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { voidCreditsForRefundedCharge } from "./creditGrant.mjs";

export const REFUND_REASONS = Object.freeze([
  "requested_by_customer",
  "duplicate",
  "service_not_delivered",
  "goodwill",
  "other",
]);

/**
 * Calculate the total cost of a refund, including Stripe's fee.
 * @param {number} refundMinor the refund amount in minor units
 * @param {number} stripeFeeMinor the Stripe fee in minor units (optional)
 * @returns {number} the total cost in minor units
 */
export function refundCostMinor({ refundMinor, stripeFeeMinor }) {
  return refundMinor + (stripeFeeMinor ?? 0);
}

/**
 * Generate a sentence explaining the cost of a refund to the user.
 * @param {number} refundMinor the refund amount in minor units
 * @param {number} stripeFeeMinor the Stripe fee in minor units (optional)
 * @param {string} payerDisplayName the payer's display name (for possessive form)
 * @param {string} currency the currency code (default 'USD')
 * @returns {string} a formatted sentence
 */
export function refundCostSentence({ refundMinor, stripeFeeMinor, payerDisplayName, currency = "USD" }) {
  const totalMinor = refundCostMinor({ refundMinor, stripeFeeMinor });
  const totalMajor = (totalMinor / 100).toFixed(2);

  // Construct possessive form: add "'s" or just "'" if already ends with 's'
  const possessive = payerDisplayName.endsWith("s")
    ? `${payerDisplayName}'`
    : `${payerDisplayName}'s`;

  let amount;
  if (currency === "USD") {
    amount = `$${totalMajor}`;
  } else {
    amount = `${currency} ${totalMajor}`;
  }

  return `This can't be undone. It takes 5 to 10 days to reach ${possessive}, and Stripe's fee on the original payment doesn't come back to you — so this refund actually costs you ${amount}.`;
}

/**
 * Request a refund. If the principal has invoice.refund permission, execute immediately;
 * otherwise, create a refund_request and open an approval task.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   paymentId: the payment to refund
 *   amount: the refund amount in minor units
 *   reason: one of REFUND_REASONS
 *   receiptLine: optional receipt line (max 200 chars)
 *   returnCredit: whether to return a booking credit (default false)
 *   principal: the session principal
 *   actorUserId: the user making the request
 * @param {object} deps optional dependencies for the payer's display name
 * @returns {Promise<{approvalNeeded: boolean, requestId?: string} | refund object>}
 */
export async function requestRefund(tx, {
  tenantId,
  paymentId,
  amount,
  reason,
  receiptLine = null,
  returnCredit = false,
  principal,
  actorUserId,
}) {
  // Load the payment
  const { rows: paymentRows } = await run(tx, db
    // ★ STRIPE MIRROR (0574) — status / amount / refunded are Stripe's word (payment_effective). The join to
    //   keystone.payment keeps this to payments the platform has a row for: executeRefund and refund_request
    //   write rows with a payment_id FK to it, so a Stripe-only charge cannot be refunded from here yet.
    .selectFrom("keystone.payment_effective as pe")
    .innerJoin("keystone.payment as p", (join) => join
      .onRef("p.tenant_id", "=", "pe.tenant_id")
      .onRef("p.id", "=", "pe.id"))
    .select([
      "pe.id as id", "pe.provider as provider", "pe.status as status", "pe.amount_minor as amount_minor",
      "pe.refunded_minor as refunded_minor", "pe.invoice_id as invoice_id", "pe.payer_user_id as payer_user_id",
    ])
    .where("pe.tenant_id", "=", tenantId)
    .where("pe.id", "=", paymentId));

  if (paymentRows.length === 0) {
    throw invalid("payment not found");
  }

  const payment = paymentRows[0];
  if (payment.provider !== "stripe") {
    throw invalid("only Stripe payments can be refunded");
  }
  // ★ the mirror says `partially_refunded` for a charge with some money already back — still refundable.
  if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
    throw invalid("only succeeded payments can be refunded");
  }

  const refundableAmount = payment.amount_minor - (payment.refunded_minor || 0);
  if (amount > refundableAmount) {
    throw invalid(`cannot refund more than the refundable amount (${refundableAmount} minor units)`);
  }

  // Get the payer for display
  const { rows: personRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select(["id", "display_name"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", payment.payer_user_id));

  const payer = personRows[0];
  const payerDisplayName = payer?.display_name || "customer";

  // Try to refund with permission check
  try {
    await assertMay(tx, principal, { object: "invoice", action: "invoice.refund" }, {});
    // Permission granted — execute immediately
    return executeRefund(tx, {
      tenantId,
      paymentId,
      amountMinor: amount,
      reason,
      receiptLine,
      returnCredit,
      actorUserId,
    });
  } catch (err) {
    if (err.statusCode !== 403) throw err;
    // Permission denied — create approval request
    const { rows: requestRows } = await run(tx, db
      .insertInto("keystone.refund_request")
      .values({
        tenant_id: tenantId ?? null,
        payment_id: paymentId ?? null,
        amount_minor: amount ?? null,
        reason: reason ?? null,
        receipt_line: receiptLine ?? null,
        return_credit: returnCredit ?? null,
        requested_by: actorUserId ?? null,
        state: "requested",
      })
      .returning("id"));

    const requestId = requestRows[0].id;

    // ★ FOUND in the sandbox browser test (a non-Owner staff member requesting a refund → HTTP 500): `openChainTask` REFUSES a task with no
    //   `createdByEventId` (it de-duplicates on it, 0353), and this opened the task BEFORE the event existed. Emit first, then open the task
    //   under that event's id.
    const approvalEvent = await emit(tx, {
      tenantId,
      topic: "money.refund.approval_needed",
      emittedBy: "money",
      subjectType: "refund_request",
      subjectId: requestId,
      actor: userActor(actorUserId), // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back
      payload: {
        payment_id: paymentId,
        amount_minor: amount,
        reason,
        request_id: requestId,
      },
    });

    // Open approval task
    const ownerUserId = await practiceOwnerId(tx, tenantId);
    await openChainTask(tx, {
      tenantId,
      topic: "money.refund.approval_needed",
      subjectType: "person",
      subjectId: payment.payer_user_id,
      title: `Approve a $${(amount / 100).toFixed(2)} refund for ${payerDisplayName}`,
      createdByEventId: approvalEvent.id,
      assigneeId: ownerUserId,
    });

    return { approvalNeeded: true, requestId };
  }
}

/**
 * Execute a refund against Stripe and update the database.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   paymentId: the payment to refund
 *   amountMinor: the refund amount in minor units
 *   reason: one of REFUND_REASONS
 *   receiptLine: optional receipt line
 *   returnCredit: whether to return a booking credit
 *   actorUserId: the user making the request
 *   requestId: optional refund_request id (for idempotency)
 * @returns {Promise<refund object>}
 */
/**
 * ★★ RUN-2 T14 (26 Sep 2026): the credits a refund gives back. This used to call
 *    `returnCreditForBooking(tx, { bookingId: paymentId })` — a PAYMENT id where a BOOKING id belongs —
 *    so it matched nothing and silently returned no credit, while RefundDialog defaults "return the
 *    credit" to ON. A payment reaches its sessions through its invoice's line items: line_item.booking_id (0512 —
 *    a REFERENCE beside the invoice parent; booking.invoice_id was dropped by 0513). Every credit held by one of those bookings — reserved (not yet held) OR consumed
 *    (the session happened and is being refunded) — goes back to 'returned', with booking_id and
 *    consumed_at cleared as entitlement_credit's CHECK requires. Returns the credit ids returned.
 */
export async function returnCreditsForRefundedPayment(tx, { tenantId, paymentId }) {
  const { rows } = await run(tx, db
    .updateTable("keystone.entitlement_credit as c")
    .set({ status: "returned", booking_id: null, consumed_at: null })
    .where("c.tenant_id", "=", tenantId)
    .where("c.status", "in", ["reserved", "consumed"])
    // ★ R1 (RECONCILE) — `booking.invoice_id` is gone (0513): a payment reaches its sessions through
    //   its invoice's line items (0512's `line_item.booking_id`).
    .where("c.booking_id", "in", db
      .selectFrom("keystone.payment as p")
      .innerJoin("keystone.line_item as li", (join) => join
        .onRef("li.tenant_id", "=", "p.tenant_id")
        .onRef("li.invoice_id", "=", "p.invoice_id"))
      .select("li.booking_id")
      .where("p.tenant_id", "=", tenantId)
      .where("p.id", "=", paymentId)
      .where("li.booking_id", "is not", null))
    .returning("c.id"));
  return rows.map((r) => r.id);
}

export async function executeRefund(tx, {
  tenantId,
  paymentId,
  amountMinor,
  reason,
  receiptLine = null,
  returnCredit = false,
  actorUserId,
  requestId = null,
}) {
  // Reload payment for metadata
  const { rows: paymentRows } = await run(tx, db
    .selectFrom("keystone.payment")
    .select(["provider_payment_id", "stripe_charge_id", "amount_minor", "refunded_minor"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", paymentId));

  const payment = paymentRows[0];

  // Compose metadata from metadataFor("refund", ...)
  const metadata = metadataFor("refund", {
    payment_id: paymentId,
    practice_id: tenantId,
    reason_code: reason,
  });

  const form = {
    payment_intent: payment.provider_payment_id,
    amount: amountMinor,
    refund_application_fee: true,
    ...(reason === "requested_by_customer" || reason === "duplicate" ? { reason } : {}),
    metadata,
  };

  // Call Stripe
  const stripeResponse = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/refunds",
    sdk: (s, o, form, query) => s.refunds.create(form, o),
    form,
    movesMoney: true,
    purpose: "refund",
    idempotencyKey: `refund:${tenantId}:${paymentId}:${requestId ?? amountMinor}`,
    actorUserId,
  });

  const stripeRefund = stripeResponse.body;
  const stripeRefundId = stripeRefund.id;

  // Insert refund row
  const { rows: refundRows } = await run(tx, db
    .insertInto("keystone.refund")
    .values({
      tenant_id: tenantId ?? null,
      stripe_id: stripeRefundId ?? null,
      stripe_charge_id: payment.stripe_charge_id ?? null,
      payment_id: paymentId ?? null,
      amount_minor: amountMinor ?? null,
      state: "pending",
    })
    .onConflict((oc) => oc.columns(["tenant_id", "stripe_id"]).doNothing())
    .returning("id"));

  const refundId = refundRows[0]?.id;

  // Update payment refunded_minor
  await run(tx, db
    .updateTable("keystone.payment")
    .set({ refunded_minor: sql`refunded_minor + ${amountMinor}` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", paymentId));

  // Return credit if requested
  if (returnCredit) {
    await returnCreditsForRefundedPayment(tx, { tenantId, paymentId });
  }

  // ★ credits defect 16 — a package refunded IN FULL voids the credits nobody has used yet
  await voidCreditsForRefundedCharge(tx, {
    tenantId, paymentId, refundedMinor: (payment.refunded_minor ?? 0) + amountMinor, totalMinor: payment.amount_minor, actorUserId,
  });

  // Write audit
  await writeAudit(tx, {
    tenantId,
    action: "invoice.refunded",
    object: "payment",
    subjectId: paymentId,
    actorUserId,
  });

  // Emit event
  await emit(tx, {
    tenantId,
    topic: "money.payment.refunded",
    emittedBy: "money",
    subjectType: "payment",
    subjectId: paymentId,
    actor: userActor(actorUserId), // RUN-2: emit() takes an actor STRING (outbox.mjs ACTOR_SHAPE); the object/word here threw TopicViolation and rolled the write back
    payload: {
      payment_id: paymentId,
      refund_id: refundId,
      amount_minor: amountMinor,
      reason,
    },
  });

  return { id: refundId };
}

/**
 * Approve a refund request (Owner only).
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   requestId: the refund_request id to approve
 *   principal: the session principal
 *   actorUserId: the user approving
 */
export async function approveRefundRequest(tx, {
  tenantId,
  requestId,
  principal,
  actorUserId,
}) {
  // Owner permission check
  await assertMay(tx, principal, { object: "invoice", action: "invoice.refund" }, {});

  // Load the request
  const { rows: requestRows } = await run(tx, db
    .selectFrom("keystone.refund_request")
    .select(["payment_id", "amount_minor", "reason", "receipt_line", "return_credit"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", requestId));

  const request = requestRows[0];
  if (!request) {
    throw invalid("refund request not found");
  }

  // Execute the refund
  const refund = await executeRefund(tx, {
    tenantId,
    paymentId: request.payment_id,
    amountMinor: request.amount_minor,
    reason: request.reason,
    receiptLine: request.receipt_line,
    returnCredit: request.return_credit,
    actorUserId,
    requestId,
  });

  // Update the request
  await run(tx, db
    .updateTable("keystone.refund_request")
    .set({ state: "executed", decided_by: actorUserId ?? null, refund_id: refund.id ?? null, decided_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", requestId));

  // Close the task
  const { rows: paymentRows } = await run(tx, db
    .selectFrom("keystone.payment")
    .select("payer_user_id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", request.payment_id));

  const payerId = paymentRows[0]?.payer_user_id;
  if (payerId) {
    await closeChainTasks(tx, {
      tenantId,
      openingTopic: "money.refund.approval_needed",
      subjectType: "person",
      subjectId: payerId,
      closedByEventId: null, // TODO: this should be the event id if called from a chain
    });
  }

  // Write audit
  await writeAudit(tx, {
    tenantId,
    action: "approval.granted",
    object: "refund_request",
    subjectId: requestId,
    actorUserId,
  });
}

/**
 * Decline a refund request.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   requestId: the refund_request id to decline
 *   actorUserId: the user declining
 */
export async function declineRefundRequest(tx, {
  tenantId,
  requestId,
  actorUserId,
}) {
  // Load the request for the payer_user_id
  const { rows: requestRows } = await run(tx, db
    .selectFrom("keystone.refund_request as r")
    .innerJoin("keystone.payment as p", (join) => join
      .onRef("p.tenant_id", "=", "r.tenant_id")
      .onRef("p.id", "=", "r.payment_id"))
    .select(["r.id", "p.payer_user_id"])
    .where("r.tenant_id", "=", tenantId)
    .where("r.id", "=", requestId));

  const request = requestRows[0];
  if (!request) {
    throw invalid("refund request not found");
  }

  // Update to declined
  await run(tx, db
    .updateTable("keystone.refund_request")
    .set({ state: "declined", decided_by: actorUserId ?? null, decided_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", requestId));

  // Close the task
  await closeChainTasks(tx, {
    tenantId,
    openingTopic: "money.refund.approval_needed",
    subjectType: "person",
    subjectId: request.payer_user_id,
    closedByEventId: null, // TODO: this should be the event id if called from a chain
  });
}

/**
 * P3.S10 — Cancel a pending refund. Stripe only cancels refunds still in `requires_action`
 * (tracked here as state 'pending'); anything else is a conflict.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   refundId: the keystone.refund id to cancel
 *   actorUserId: the user cancelling
 * @returns {Promise<{id: string, state: string}>}
 */
export async function cancelRefund(tx, { tenantId, refundId, actorUserId }) {
  const { rows: refundRows } = await run(tx, db
    .selectFrom("keystone.refund")
    .select(["id", "state", "stripe_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", refundId));

  if (refundRows.length === 0) {
    throw invalid("refund not found");
  }

  const refund = refundRows[0];

  if (refund.state !== 'pending') {
    throw conflict("Only a pending refund can be cancelled.");
  }

  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/refunds/${refund.stripe_id}/cancel`,
      sdk: (s, o, form, query) => s.refunds.cancel(refund.stripe_id, {}, o),
      form: {},
      movesMoney: false,
      purpose: "cancel_refund",
      actorUserId,
    });
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  const { rows } = await run(tx, db
    .updateTable("keystone.refund")
    .set({ state: "canceled", updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", refundId)
    .where("state", "=", "pending")
    .returning(["id", "state"]));

  if (rows.length === 0) {
    throw conflict("Only a pending refund can be cancelled.");
  }

  await emit(tx, {
    tenantId,
    topic: "money.refund.cancelled",
    emittedBy: "money",
    subjectType: "refund",
    subjectId: refundId,
    actor: userActor(actorUserId),
    payload: { refund_id: refundId },
  });

  return { id: rows[0].id, state: rows[0].state };
}
