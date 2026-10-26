// @ts-check
// Stage 15 task 15.65 — CLIENT-PORTAL MONEY: allocate client payments across invoices
//
// ★★★ A SINGLE STRIPE PAYMENTINTENT SETTLES MULTIPLE INVOICES IN ONE ACTION
// The payer presents a group of invoices they want to settle together, and the allocation
// rows tie that one PaymentIntent (group_id) across all of them. A replay on the same group_id
// cannot re-create an allocation row (UNIQUE constraint), and a retried create cannot double-bill.
//
// ★★★ THE BLOCKED LIST NEVER ENTERS STRIPE — date_of_birth, sobriety_date, recovery_programme,
//     sponsor_name, support_network, notes, emergency_contact_*, consent_status_detail,
//     guardian_relationship must NEVER leave the platform, not even in metadata.

import { randomUUID } from "node:crypto";
import { forbidden, notFound, invalid, conflict } from "../http/errors.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { ensureCustomer } from "./customers.mjs";
import { stripeConnectedRequest, applicationFeeMinor } from "./stripeConnected.mjs";
import { metadataFor } from "./metadata.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same locking, same ON CONFLICT, same RETURNING).
//   `sql` is the escape hatch for what the builder itself does not express — `= ANY(...)`.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * ★★★ THE ADOLESCENT REFUSAL STRING — exported as a constant, used in both places where teens are checked.
 * EXACTLY this string, byte-for-byte, so test (a) can match it.
 */
export const ADOLESCENT_PAYMENT_REFUSAL = "Payments are handled by your parent or guardian.";

/**
 * Create a client payment across one or more invoices.
 *
 * REFUSAL ORDER (teen check before any invoice read, so this never becomes an oracle):
 *   1. Check payer role — adolescent clients and all staff are forbidden, FIRST.
 *   2. Check each invoice — valid, open, belonging to payer; notFound covers all three reasons deliberately.
 *   3. Check stripe_enabled flag.
 *   4. Check currencies match.
 *   5. Check something is owed.
 *   6. Insert allocation rows.
 *   7. Stripe call.
 *
 * @param tx a tenant transaction
 * @param options
 *   tenantId: the practice's id
 *   payerUserId: the person paying (adult_client or parent, never adolescent_client or staff)
 *   invoiceIds: array of invoice ids, 1-10, deduplicated
 *   idempotencyKey: Stripe idempotency key (optional, Stripe will mint one if omitted)
 * @returns { paymentIntentId, clientSecret, amountMinor, currency, invoiceIds }
 */
export async function createClientPayment(tx, {
  tenantId, payerUserId, invoiceIds, idempotencyKey,
}) {
  if (!tenantId) throw new Error("createClientPayment: tenantId is required");
  if (!payerUserId) throw new Error("createClientPayment: payerUserId is required");
  if (!invoiceIds || !Array.isArray(invoiceIds)) throw new Error("createClientPayment: invoiceIds must be an array");

  // ★★★ STEP 1: Check payer role FIRST — before any invoice read.
  const { rows: payerRows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("role")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", payerUserId));
  if (payerRows.length === 0) {
    throw notFound("no such invoice"); // Same message as invoice checks; oracle-safe
  }
  const payer = payerRows[0];

  // Adolescent clients cannot pay
  if (payer.role === "adolescent_client") {
    throw forbidden(ADOLESCENT_PAYMENT_REFUSAL);
  }

  // Staff cannot use the client payment path
  if (payer.role.startsWith("staff_") || payer.role === "staff") {
    throw forbidden(ADOLESCENT_PAYMENT_REFUSAL); // Different error, but same effect: forbidden
  }

  // ★ Deduplicate invoiceIds
  const uniqueInvoiceIds = Array.from(new Set(invoiceIds));
  if (uniqueInvoiceIds.length === 0) {
    throw invalid("At least one invoice is required.");
  }
  if (uniqueInvoiceIds.length > 10) {
    throw invalid("Cannot pay more than 10 invoices at once.");
  }

  // ★★★ STEP 2: Check each invoice — open, belongs to payer, sums are correct
  const { rows: invoiceRows } = await run(tx, db
    // ★ STRIPE-MIRROR: whether an invoice is open, and how much of it is still owed, are Stripe's
    //   (keystone.invoice_effective), not the platform's cached status/paid columns. origin='mainstay' keeps
    //   the set to invoices that have a the platform row — payment_allocation.invoice_id points at it, so a
    //   Stripe-only invoice (md5-derived id, no base row) answers "no such invoice" as it always did.
    .selectFrom("keystone.invoice_effective")
    .select(["id", "amount_minor", "paid_minor", "amount_remaining_minor", "currency", "status", "payer_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("origin", "=", "mainstay")
    .where(sql`id = ANY(${sql.val(uniqueInvoiceIds)})`));

  // ★ Verify we got exactly the invoices requested (none missing, none nonexistent)
  if (invoiceRows.length !== uniqueInvoiceIds.length) {
    throw notFound("no such invoice");
  }

  // ★ Verify all invoices belong to this payer and are open
  const invoicesByPayer = {};
  let totalAmountMinor = 0;
  let currency = null;

  for (const inv of invoiceRows) {
    // Every invoice must belong to this payer
    if (inv.payer_user_id !== payerUserId) {
      throw notFound("no such invoice"); // Same message as "doesn't exist" or "already paid"
    }

    // Every invoice must be open (not paid, not cancelled, etc.)
    if (inv.status !== "open") {
      throw notFound("no such invoice"); // Also covers "already paid" — same message
    }

    // Calculate what is owed on this invoice
    // (Stripe's amount_remaining — also right after a credit note, which lowers it without raising paid.)
    const owedMinor = inv.amount_remaining_minor;
    if (owedMinor <= 0) {
      throw notFound("no such invoice");
    }

    invoicesByPayer[inv.id] = { ...inv, owedMinor };
    totalAmountMinor += owedMinor;

    // All invoices must be in the same currency
    if (currency === null) {
      currency = inv.currency;
    } else if (currency !== inv.currency) {
      throw invalid("Those invoices are in different currencies — pay them separately.");
    }
  }

  // ★ If we somehow collected 0 owed, something is very wrong
  if (totalAmountMinor <= 0) {
    throw conflict("Nothing is owed on those.");
  }

  // ★★★ STEP 3: Check stripe_enabled flag (reuse EXACT sentence from app.mjs:1078-1079)
  const stripeEnabled = await flagIsOn(tx, "stripe_enabled", tenantId);
  if (!stripeEnabled) {
    throw forbidden(
      "stripe_enabled is off for this practice — a platform operator turned it off. No payment " +
      "can be taken until it is switched back on.");
  }

  // ★★★ STEP 4: Generate group_id and insert allocation rows (BEFORE Stripe call)
  const groupId = randomUUID();

  for (const invoiceId of uniqueInvoiceIds) {
    const inv = invoicesByPayer[invoiceId];
    const owedMinor = inv.owedMinor;

    // Insert allocation row for this invoice
    // ★ ON CONFLICT is the idempotency mechanism: a replay cannot create a second row
    await run(tx, db
      .insertInto("keystone.payment_allocation")
      .values({
        tenant_id: tenantId ?? null,
        group_id: groupId ?? null,
        invoice_id: invoiceId ?? null,
        payer_user_id: payerUserId ?? null,
        amount_minor: owedMinor ?? null,
        currency: currency ?? null,
        state: "intended",
      })
      .onConflict((oc) => oc.columns(["tenant_id", "group_id", "invoice_id"]).doNothing()));
  }

  // ★★★ STEP 5: Ensure customer exists on connected account
  const customerResult = await ensureCustomer(tx, {
    tenantId,
    personId: payerUserId, // ★ The param is named `personId`, not `payerUserId`
  });
  const stripeCustomerId = customerResult.customerId;

  // ★★★ STEP 6: Call Stripe to create PaymentIntent
  // ★★★ METADATA CARRIES EXACTLY THREE KEYS AND NOTHING ELSE
  // — no name, no email, no invoice description, no blocked list
  const stripeResponse = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: "/payment_intents",
    sdk: (s, o, form, query) => s.paymentIntents.create(form, o),
    form: {
      amount: totalAmountMinor,
      currency,
      customer: stripeCustomerId,
      "automatic_payment_methods[enabled]": "true",
      application_fee_amount: applicationFeeMinor(totalAmountMinor),
      ...Object.fromEntries(
        Object.entries(metadataFor("payment_intent", {
          keystone_tenant_id: tenantId,
          keystone_payer_id: payerUserId,
          keystone_allocation_id: groupId,
        })).map(([k, v]) => [`metadata[${k}]`, v])
      ),
    },
    movesMoney: true,
    purpose: "client_payment",
    idempotencyKey,
  });

  // ★★★ STEP 7: Emit the payment intent created event
  await emit(tx, {
    tenantId,
    topic: "money.payment.intent_created",
    emittedBy: "money",
    subjectType: "invoice", // One of the invoices in the group
    subjectId: uniqueInvoiceIds[0], // First invoice as the subject
    actor: userActor(payerUserId),
    payload: {
      payer_user_id: payerUserId,
      invoice_ids: uniqueInvoiceIds,
      amount_minor: totalAmountMinor,
      currency,
    },
  });

  // ★★★ STEP 8: Return the Stripe response
  return {
    paymentIntentId: stripeResponse.body.id,
    clientSecret: stripeResponse.body.client_secret,
    amountMinor: totalAmountMinor,
    currency,
    invoiceIds: uniqueInvoiceIds,
  };
}

/**
 * Apply a successful payment to its allocations and invoices.
 *
 * Called from the Stripe webhook when a PaymentIntent succeeds and carries
 * keystone_allocation_id metadata.
 *
 * ★★★ REPLAY-SAFE: if all allocations are already applied, returns early with `{applied: false, reason: 'replay'}`.
 *
 * @param tx a tenant transaction
 * @param event the Stripe webhook event, with data.object = the PaymentIntent
 * @param options
 *   tenantId: the practice's id
 * @returns { applied: true, invoiceIds } on success, or { applied: false, reason: 'replay' } if already applied
 */
export async function applyClientPayment(tx, event, { tenantId }) {
  if (!tenantId) throw new Error("applyClientPayment: tenantId is required");
  if (!event?.data?.object?.metadata?.keystone_allocation_id) {
    throw new Error("applyClientPayment: no allocation_id in event metadata");
  }

  const groupId = event.data.object.metadata.keystone_allocation_id;
  const paymentIntentId = event.data.object.id;
  const amountReceived = event.data.object.amount_received;

  // ★★★ STEP 1: Load all allocation rows for this group, FOR UPDATE (row-lock them)
  const { rows: allocations } = await run(tx, db
    .selectFrom("keystone.payment_allocation")
    .select(["id", "invoice_id", "amount_minor", "payer_user_id", "state"])
    .where("tenant_id", "=", tenantId)
    .where("group_id", "=", groupId)
    .orderBy("invoice_id")
    .forUpdate());

  if (allocations.length === 0) {
    throw new Error(`applyClientPayment: no allocations found for group ${groupId}`);
  }

  // ★★★ STEP 2: Check for replay — if all already applied, return early
  const allApplied = allocations.every((a) => a.state === "applied");
  if (allApplied) {
    return { applied: false, reason: "replay" };
  }

  // ★★★ STEP 3: Insert the payment row (stripe provider)
  // ★ invoice_id stays NULL on the payment row deliberately — allocation rows are the link
  // ★ ON CONFLICT so a replay doesn't create a second payment
  // ★★★ FOUND LIVE, receipts brief (1 Oct 2026, Part 1) — MEASURED, the SAME class of bug found
  //     and fixed twice already in src/money/payments.mjs: `payer_user_id` (NOT NULL, 0015) and
  //     `amount_minor`/`currency` (also NOT NULL, `amount_minor > 0` CHECK) were all missing from
  //     this INSERT despite `allocations[0].payer_user_id` and `amountReceived` sitting right
  //     there — a portal payment split across several invoices would have thrown on every attempt.
  const chargedCard = event.data.object.payment_method?.card
    ?? event.data.object.charges?.data?.[0]?.payment_method_details?.card ?? null;
  const { rows: paymentRows } = await run(tx, db
    .insertInto("keystone.payment")
    .values({
      tenant_id: tenantId ?? null,
      provider: "stripe",
      status: "succeeded",
      provider_payment_id: paymentIntentId ?? null,
      invoice_id: null,
      payer_user_id: allocations[0].payer_user_id,
      amount_minor: amountReceived,
      currency: (event.data.object.currency ?? "usd").toUpperCase(),
      card_brand: chargedCard?.brand ?? null,
      card_last_four: chargedCard?.last4 ?? null,
    })
    .onConflict((oc) => oc.columns(["tenant_id", "provider_payment_id"]).doNothing())
    .returning("id"));

  // ★ If this is a true replay (same provider_payment_id seen before), paymentRows will be empty
  // In that case, fetch the existing payment
  let paymentId = paymentRows[0]?.id;
  if (!paymentId) {
    const { rows: existing } = await run(tx, db
      .selectFrom("keystone.payment")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("provider_payment_id", "=", paymentIntentId));
    paymentId = existing[0]?.id;
  }

  // ★★★ STEP 4: ASSERT the sum of allocations matches amount_received
  const allocationSum = allocations.reduce((sum, a) => sum + a.amount_minor, 0);
  if (allocationSum !== amountReceived) {
    throw new Error(
      `applyClientPayment: allocation sum (${allocationSum}) does not match ` +
      `amount_received (${amountReceived}) — rolling back`
    );
  }

  // ★★★ STEP 5: Apply each allocation to its invoice
  const appliedInvoiceIds = [];

  for (const alloc of allocations) {
    if (alloc.state === "applied") {
      // Already applied in a previous attempt — skip
      continue;
    }

    // ★ Call applyPaymentToInvoice (from src/money/payments.mjs, 15.14)
    // Forward-dependency-safe call: if the module/function doesn't exist yet, this will throw
    // at runtime when the first allocation is applied. The test will mark it as UNRUN with the reason.
    try {
      const { applyPaymentToInvoice } = await import("./payments.mjs").catch(() => ({}));
      if (!applyPaymentToInvoice) {
        throw new Error("applyPaymentToInvoice is not available yet (task 15.14)");
      }
      await applyPaymentToInvoice(tx, {
        tenantId,
        invoiceId: alloc.invoice_id,
        amountMinor: alloc.amount_minor,
      });
    } catch (e) {
      // Re-throw with context
      throw new Error(`Failed to apply payment to invoice ${alloc.invoice_id}: ${e.message}`);
    }

    // ★ Update the allocation row to 'applied'
    await run(tx, db
      .updateTable("keystone.payment_allocation")
      .set({ state: "applied", payment_id: paymentId ?? null, applied_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", alloc.id));

    appliedInvoiceIds.push(alloc.invoice_id);
  }

  // ★★★ STEP 6: Emit success events
  // One money.payment.succeeded event for the payment
  await emit(tx, {
    tenantId,
    topic: "money.payment.succeeded",
    emittedBy: "money",
    subjectType: "invoice",
    subjectId: appliedInvoiceIds[0] || allocations[0].invoice_id,
    actor: "webhook:stripe",
    payload: {
      payment_provider_id: paymentIntentId,
      amount_minor: amountReceived,
      currency: event.data.object.currency.toUpperCase(),
    },
  });

  // One money.invoice.paid event per invoice that was actually closed by this payment
  for (const invoiceId of appliedInvoiceIds) {
    // Check if invoice is now fully paid
    const { rows: invoiceCheck } = await run(tx, db
      .selectFrom("keystone.invoice")
      .select(["id", "amount_minor", "paid_minor"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", invoiceId));
    if (invoiceCheck.length > 0) {
      const inv = invoiceCheck[0];
      if (inv.paid_minor >= inv.amount_minor) {
        // Invoice is fully paid
        await emit(tx, {
          tenantId,
          topic: "money.invoice.paid",
          emittedBy: "money",
          subjectType: "invoice",
          subjectId: invoiceId,
          actor: "webhook:stripe",
          payload: {
            amount_minor: inv.amount_minor,
            currency: event.data.object.currency.toUpperCase(),
          },
        });
      }
    }
  }

  return { applied: true, invoiceIds: appliedInvoiceIds };
}
