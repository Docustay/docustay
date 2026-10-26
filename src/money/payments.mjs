// @ts-check
// Stage 15 Task 15.14 — PAYMENTS: the one way an invoice gets paid, manual payments, fee mirror
//
// ★★★ THIS MODULE IS LOAD-BEARING. Several modules built earlier (15.22, 15.65, 15.67, 15.29)
// import functions from here with a dynamic-import-with-fallback pattern because this module didn't
// exist yet. Building this correctly unblocks them.

import { invalid } from "../http/errors.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { asPracticeOwner } from "./asPracticeOwner.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same ON CONFLICT target/filter, same
//   parameterization). `sql` is the escape hatch for computed SET expressions, casts and
//   COALESCE — per the L3 per-file ruling.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * Apply a payment amount to an invoice.
 *
 * Called from webhook handlers and from manual payment recording.
 * Increments paid_minor and marks invoice as paid if the full amount is now covered.
 *
 * ★★ REPLAY-SAFE: if the invoice is not open or no rows are updated (e.g. already paid),
 *     returns `{closed: false, skipped: true}` instead of throwing.
 *
 * @param tx a tenant transaction
 * @param options
 *   tenantId: the practice id
 *   invoiceId: the invoice id
 *   amountMinor: amount to apply in minor units (cents)
 * @returns {Promise<{closed: boolean, paidMinor: number, skipped?: boolean}>}
 */
export async function applyPaymentToInvoice(tx, { tenantId, invoiceId, amountMinor }) {
  if (!tenantId) throw new Error("applyPaymentToInvoice: tenantId is required");
  if (!invoiceId) throw new Error("applyPaymentToInvoice: invoiceId is required");
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("applyPaymentToInvoice: amountMinor must be a positive integer");
  }

  const { rows } = await run(tx, db
    .updateTable("keystone.invoice")
    .set({
      paid_minor: sql`paid_minor + ${amountMinor}`,
      status: sql`CASE WHEN paid_minor + ${amountMinor} >= amount_minor THEN 'paid' ELSE status END`,
      paid_at: sql`CASE WHEN paid_minor + ${amountMinor} >= amount_minor THEN now() ELSE paid_at END`,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId)
    .where("status", "=", "open")
    .returning(["status", "paid_minor"]));

  if (rows.length === 0) {
    return { closed: false, skipped: true };
  }

  const status = rows[0].status;
  const paidMinor = rows[0].paid_minor;
  return { closed: status === 'paid', paidMinor };
}

/**
 * Handle a Stripe payment_intent.succeeded event.
 *
 * ★★★ FIRST BRANCH: if metadata.keystone_allocation_id exists, this is a client-portal
 * multi-invoice payment. Call applyClientPayment and return immediately — do NOT fall through
 * to the single-invoice path below, or it would double-write or close the wrong invoice.
 *
 * Otherwise, create a payment row and apply it to a single invoice (or no invoice).
 *
 * @param tx a tenant transaction
 * @param event the Stripe webhook event with data.object = PaymentIntent
 * @param options
 *   tenantId: the practice id
 * @returns {Promise<{applied: boolean, reason?: string, payment_id?: string}>}
 */
// ★★★ ONE PAYMENT, ONE ROW (found in the sandbox browser test, 2 Oct 2026). Stripe's current API no longer puts `payment_intent` on an Invoice; it links the
//     two through the INVOICE PAYMENT (the mirror's keystone.mirror_invoice_payment: invoice ⇄ payment.payment_intent). So `handleStripeInvoicePaid` read
//     `d.payment_intent` (absent), fell back to the invoice id, and recorded a SECOND payment row (`in_…`) for the money `payment_intent.succeeded`
//     had already recorded (`pi_…`) — and both rows had no invoice_id (the metadata key is `invoice_id`, not `keystone_invoice_id`). Anything summing
//     keystone.payment would count the money twice. Both handlers now resolve the same PaymentIntent and the same invoice through the mirror, so the
//     second event finds the first one's row and only links it.
async function mirrorInvoicePayment(tx, { stripeInvoiceId = null, intentId = null }) {
  const key = stripeInvoiceId ?? intentId;
  if (!key) return null;
  const { rows } = await tx.query(
    `SELECT invoice, payment->>'payment_intent' AS intent FROM keystone.mirror_invoice_payment WHERE ${stripeInvoiceId ? "invoice" : "payment->>'payment_intent'"} = $1 LIMIT 1`,
    [key]).catch(() => ({ rows: [] }));
  return rows[0] ?? null;
}
// The mirror may not have the invoice payment yet (the two events arrive within milliseconds of each other and the mirror writes as each is
// processed — found live: the in_ row was still recorded). Ask Stripe itself, once; any failure just means "unknown" and the caller falls back.
async function intentFromStripe(tx, { tenantId, stripeInvoiceId }) {
  try {
    const { stripeConnectedRequest } = await import("./stripeConnected.mjs");
    const { body } = await stripeConnectedRequest(tx, {
      tenantId, method: "GET", path: "/invoice_payments", query: { invoice: stripeInvoiceId, limit: 1 }, movesMoney: false, purpose: "invoice_payment_intent_lookup",
    });
    return body?.data?.[0]?.payment?.payment_intent ?? null;
  } catch { return null; }
}
async function keystoneInvoiceIdForStripe(tx, { tenantId, stripeInvoiceId }) {
  if (!stripeInvoiceId) return null;
  const { rows } = await tx.query(`SELECT id FROM keystone.invoice WHERE tenant_id = $1 AND stripe_invoice_id = $2 LIMIT 1`, [tenantId, stripeInvoiceId]);
  return rows[0]?.id ?? null;
}
/** The row exists already (the other event got there first): make sure it knows its invoice. */
async function linkExistingPayment(tx, { tenantId, providerPaymentId, invoiceId }) {
  if (!invoiceId) return;
  await tx.query(`UPDATE keystone.payment SET invoice_id = $3 WHERE tenant_id = $1 AND provider_payment_id = $2 AND invoice_id IS NULL`, [tenantId, providerPaymentId, invoiceId]);
}

export async function handlePaymentIntentSucceeded(tx, event, { tenantId }) {
  if (!tenantId) throw new Error("handlePaymentIntentSucceeded: tenantId is required");

  const d = event.data?.object ?? {};
  const meta = d.metadata ?? {};

  // ★★★ FIRST BRANCH — allocation path, DO NOT fall through after this
  if (meta.keystone_allocation_id) {
    // Import and call applyClientPayment — this handles multi-invoice payments
    // (client portal payments already have their allocation rows set up by createClientPayment)
    const { applyClientPayment } = await import("./clientPayments.mjs");
    return applyClientPayment(tx, event, { tenantId });
  }

  // ─── SINGLE-INVOICE PATH ─────────────────────────────────────────────────────────────
  let invoiceId = meta.keystone_invoice_id ?? d.keystone_invoice_id ?? null;
  // ★ a PaymentIntent that Stripe made for an INVOICE carries no the platform metadata: find its invoice through the mirror
  if (!invoiceId) {
    const link = await mirrorInvoicePayment(tx, { intentId: d.id });
    invoiceId = await keystoneInvoiceIdForStripe(tx, { tenantId, stripeInvoiceId: link?.invoice ?? null });
  }
  // ★★★ FOUND LIVE, receipts brief (1 Oct 2026, Part 1) — MEASURED: this read `meta.keystone_payer_id`,
  //     a key `src/money/metadata.mjs`'s own `payment_intent` allow-list documents as belonging to
  //     `clientPayments.mjs`'s writer ("20.2 one-writer") — `src/money/charge.mjs::createChargeIntent`
  //     (the Held/no-show/off-session charge path, fixed earlier in this same brief's Part 4) sends
  //     `person_id` instead, via the SAME allow-list's OTHER entry. So for every charge created
  //     through createChargeIntent, `payerId` was ALWAYS null here.
  let payerId = meta.keystone_payer_id ?? meta.person_id ?? d.keystone_payer_id ?? null;
  const providerPaymentId = d.id;
  const amountMinor = d.amount_received ?? d.amount_paid;
  const currency = (d.currency ?? "usd").toUpperCase();

  if (!providerPaymentId || !Number.isInteger(amountMinor)) {
    throw new Error("handlePaymentIntentSucceeded: missing provider_payment_id or amount");
  }

  // ★ Fallback — resolve the payer from the Stripe customer if metadata somehow carried neither
  //   key (an older charge, or a future caller that forgets the metadata contract). NOT NULL below
  //   needs a real answer, not a best-effort one, so this is exhausted before insert, not after.
  if (!payerId && d.customer) {
    const { rows: byCustomer } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select("id")
      .where("tenant_id", "=", tenantId)
      .where("stripe_customer_id", "=", d.customer)
      .where("archived_at", "is", null)
      .limit(1));
    payerId = byCustomer[0]?.id ?? null;
  }
  if (!payerId) {
    throw new Error(
      `handlePaymentIntentSucceeded: could not resolve a payer for PaymentIntent ${providerPaymentId} ` +
      `— no person_id/keystone_payer_id in metadata and no app_user matches customer ${d.customer ?? "(none)"}. ` +
      `keystone.payment.payer_user_id is NOT NULL; recording an unattributed payment is not an option.`);
  }

  // ★★★ Map method from Stripe's payment_method_types to our vocabulary
  const stripeMethod = d.payment_method_types?.[0];
  let method = "other";
  if (stripeMethod === "card") method = "card";
  else if (stripeMethod === "card_present") method = "card_present";
  else if (stripeMethod === "us_bank_account") method = "bank";
  else if (stripeMethod === "link") method = "link";

  // ★ The card actually charged, when Stripe's payload includes it (payment_method's own object,
  //   present when Stripe was asked to expand it; harmless nulls otherwise — see this file's own
  //   note on why the RECEIPT can no longer rely solely on "the payer's current default card").
  const chargedCard = d.payment_method?.card ?? d.charges?.data?.[0]?.payment_method_details?.card ?? null;

  // ★★★ INSERT payment row with ON CONFLICT for idempotency
  // ★★★ FOUND LIVE — `payer_user_id` (NOT NULL, 0015) and `invoice_id` were computed above
  //     (`payerId`/`invoiceId`) and then NEVER PASSED to this INSERT. Every direct off-session
  //     charge (Held/no-show, or any future no-invoice charge) would have thrown a not-null
  //     constraint violation the first time a real charge ever succeeded — recording nothing,
  //     retrying forever, and (per §Z2.12) leaving the invoice — if any — never marked paid.
  const { rows: paymentRows } = await run(tx, db
    .insertInto("keystone.payment")
    .values({
      tenant_id: tenantId ?? null,
      invoice_id: invoiceId ?? null,
      payer_user_id: payerId,
      provider: "stripe",
      status: "succeeded",
      provider_payment_id: providerPaymentId ?? null,
      stripe_charge_id: d.latest_charge ?? null,
      application_fee_minor: d.application_fee_amount ?? null,
      method: method ?? null,
      amount_minor: amountMinor ?? null,
      currency: currency ?? null,
      card_brand: chargedCard?.brand ?? null,
      card_last_four: chargedCard?.last4 ?? null,
    })
    .onConflict((oc) => oc
      .columns(["tenant_id", "provider_payment_id"])
      .where("provider_payment_id", "is not", null)
      .doNothing())
    .returning("id"));

  if (paymentRows.length === 0) {
    await linkExistingPayment(tx, { tenantId, providerPaymentId, invoiceId });
    return { applied: false, reason: 'replay' };
  }

  const paymentId = paymentRows[0].id;

  // ★★★ Apply to invoice if one is named
  let invoiceClosed = false;
  if (invoiceId) {
    const result = await applyPaymentToInvoice(tx, { tenantId, invoiceId, amountMinor });
    invoiceClosed = result.closed;
  }

  // ★★★ Emit success events (matching the shape from webhook.mjs:111-125)
  await emit(tx, {
    tenantId,
    topic: "money.payment.succeeded",
    emittedBy: "money",
    subjectType: "payment",
    subjectId: paymentId,
    actor: "webhook:stripe",
    payload: {
      payment_id: paymentId,
      invoice_id: invoiceId,
      amount_minor: amountMinor,
      currency,
      method,
    },
  });

  if (invoiceClosed) {
    await emit(tx, {
      tenantId,
      topic: "money.invoice.paid",
      emittedBy: "money",
      subjectType: "payment",
      subjectId: paymentId,
      actor: "webhook:stripe",
      payload: {
        invoice_id: invoiceId,
        invoice_closed: true,
        amount_minor: amountMinor,
        currency,
      },
    });
  }

  return { applied: true, payment_id: paymentId };
}

/**
 * Handle a Stripe invoice.payment_succeeded event.
 *
 * Creates a payment row keyed by the Stripe invoice id, and applies it to our invoice.
 *
 * @param tx a tenant transaction
 * @param event the Stripe webhook event with data.object = Stripe Invoice
 * @param options
 *   tenantId: the practice id
 * @returns {Promise<{applied: boolean, reason?: string}>}
 */
export async function handleStripeInvoicePaid(tx, event, { tenantId }) {
  if (!tenantId) throw new Error("handleStripeInvoicePaid: tenantId is required");

  const d = event.data?.object ?? {};

  // Find our invoice by provider_invoice_id or metadata
  // the platform's invoice: by the Stripe id we stored when we sent it (reliable), else the metadata (key `invoice_id` — or the older `keystone_invoice_id`)
  const invoiceId = (await keystoneInvoiceIdForStripe(tx, { tenantId, stripeInvoiceId: d.id }))
    ?? d.metadata?.keystone_invoice_id ?? d.metadata?.invoice_id ?? null;
  // the PaymentIntent that paid it — the SAME id payment_intent.succeeded records, so the two events share ONE row (see mirrorInvoicePayment)
  const providerPaymentId = d.payment_intent ?? (await mirrorInvoicePayment(tx, { stripeInvoiceId: d.id }))?.intent
    ?? (await intentFromStripe(tx, { tenantId, stripeInvoiceId: d.id })) ?? d.id;
  const amountMinor = d.amount_paid ?? 0;
  const currency = (d.currency ?? "usd").toUpperCase();

  if (!providerPaymentId || !Number.isInteger(amountMinor)) {
    throw new Error("handleStripeInvoicePaid: missing provider_payment_id or amount");
  }

  // ★★★ FOUND LIVE, receipts brief (1 Oct 2026, Part 1) — MEASURED, same class of bug as
  //     handlePaymentIntentSucceeded's own fix above: `payerId` was computed from `d.customer_email`
  //     (a raw email string — not even the right shape for the NOT NULL uuid column it was never
  //     actually passed to) and then never used. keystone.payment.payer_user_id is NOT NULL with
  //     no default (0015) — this INSERT would have thrown on every real invoice/subscription
  //     payment ever processed by THIS handler. The reliable source is the invoice's OWN
  //     payer_user_id when one is named; falling back to the Stripe customer match otherwise
  //     (a subscription-renewal invoice may carry no `keystone_invoice_id` metadata at all).
  let payerId = null;
  if (invoiceId) {
    const { rows: invRows } = await tx.query(
      `SELECT payer_user_id FROM keystone.invoice WHERE tenant_id = $1 AND id = $2`,
      [tenantId, invoiceId]);
    payerId = invRows[0]?.payer_user_id ?? null;
  }
  if (!payerId && d.customer) {
    const { rows: byCustomer } = await tx.query(
      `SELECT id FROM keystone.app_user
        WHERE tenant_id = $1 AND stripe_customer_id = $2 AND archived_at IS NULL LIMIT 1`,
      [tenantId, d.customer]);
    payerId = byCustomer[0]?.id ?? null;
  }
  if (!payerId) {
    throw new Error(
      `handleStripeInvoicePaid: could not resolve a payer for invoice ${d.id} (keystone invoice ` +
      `${invoiceId ?? "(none)"}, Stripe customer ${d.customer ?? "(none)"}) — payer_user_id is NOT NULL.`);
  }
  const chargedCard = d.payment_method?.card ?? d.charge?.payment_method_details?.card ?? null;

  // INSERT payment row with ON CONFLICT for idempotency
  const { rows: paymentRows } = await run(tx, db
    .insertInto("keystone.payment")
    .values({
      tenant_id: tenantId ?? null,
      invoice_id: invoiceId ?? null,
      payer_user_id: payerId,
      provider: "stripe",
      status: "succeeded",
      provider_payment_id: providerPaymentId ?? null,
      amount_minor: amountMinor ?? null,
      currency: currency ?? null,
      card_brand: chargedCard?.brand ?? null,
      card_last_four: chargedCard?.last4 ?? null,
    })
    .onConflict((oc) => oc
      .columns(["tenant_id", "provider_payment_id"])
      .where("provider_payment_id", "is not", null)
      .doNothing())
    .returning("id"));

  if (paymentRows.length === 0) {
    await linkExistingPayment(tx, { tenantId, providerPaymentId, invoiceId });
    return { applied: false, reason: 'replay' };
  }

  const paymentId = paymentRows[0].id;

  // Apply to invoice if one is named
  let invoiceClosed = false;
  if (invoiceId) {
    const result = await applyPaymentToInvoice(tx, { tenantId, invoiceId, amountMinor });
    invoiceClosed = result.closed;
  }

  // Emit success events
  await emit(tx, {
    tenantId,
    topic: "money.payment.succeeded",
    emittedBy: "money",
    subjectType: "payment",
    subjectId: paymentId,
    actor: "webhook:stripe",
    payload: {
      payment_id: paymentId,
      invoice_id: invoiceId,
      amount_minor: amountMinor,
      currency,
    },
  });

  if (invoiceClosed) {
    await emit(tx, {
      tenantId,
      topic: "money.invoice.paid",
      emittedBy: "money",
      subjectType: "payment",
      subjectId: paymentId,
      actor: "webhook:stripe",
      payload: {
        invoice_id: invoiceId,
        invoice_closed: true,
        amount_minor: amountMinor,
        currency,
      },
    });
  }

  return { applied: true, payment_id: paymentId };
}

/**
 * Record a manual (offline) payment.
 *
 * ★★ `method` must be one of `cash|cheque|transfer|other`. Anything else (e.g. `"card"`)
 * returns a 400 error and writes NO row.
 *
 * @param tx a tenant transaction
 * @param options
 *   tenantId: the practice id
 *   payerUserId: the person who paid (if known)
 *   invoiceId: optional invoice to apply the payment to
 *   amountMinor: the amount in minor units
 *   method: one of cash|cheque|transfer|other (required, validated)
 *   receivedAt: when the payment was received (required)
 *   note: optional note about the payment (max 500 chars)
 *   sendReceipt: whether to send a receipt (optional)
 *   actorUserId: the staff member recording the payment (required)
 * @returns {Promise<{payment_id: string}>}
 * @throws if method is not one of the allowed values
 */
export async function recordManualPayment(tx, {
  tenantId,
  payerUserId = null,
  invoiceId = null,
  amountMinor,
  method,
  receivedAt,
  note = null,
  sendReceipt = false,
  actorUserId,
}) {
  if (!tenantId) throw new Error("recordManualPayment: tenantId is required");
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("recordManualPayment: amountMinor must be a positive integer");
  }
  if (!receivedAt) throw new Error("recordManualPayment: receivedAt is required");
  if (!actorUserId) throw new Error("recordManualPayment: actorUserId is required");

  // ★★★ METHOD VALIDATION — do NOT allow 'card' or other Stripe-only methods
  const ALLOWED_METHODS = ['cash', 'cheque', 'transfer', 'other'];
  if (!ALLOWED_METHODS.includes(method)) {
    throw invalid(`payment method must be one of ${ALLOWED_METHODS.join(', ')}, got "${method}"`);
  }

  // ★ INSERT payment row
  // ★★ payer_user_id is NOT NULL and the row named neither payer, invoice nor currency — no manual
  //    payment could ever be written (26 Sep 2026). With an invoice, both come from the invoice.
  let currency = null;
  if (invoiceId) {
    const { rows: [inv] } = await run(tx, db
      .selectFrom("keystone.invoice")
      .select(["payer_user_id", "currency"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", invoiceId));
    if (!inv) throw invalid("no such invoice in this practice");
    payerUserId = payerUserId ?? inv.payer_user_id;
    currency = inv.currency;
  }
  if (!payerUserId) throw invalid("who paid is required when the payment is not against an invoice");

  const { rows: paymentRows } = await run(tx, db
    .insertInto("keystone.payment")
    .values({
      tenant_id: tenantId ?? null,
      provider: "manual",
      status: "succeeded",
      method: method ?? null,
      received_at: receivedAt ?? null,
      recorded_by: actorUserId ?? null,
      note: note ?? null,
      amount_minor: amountMinor ?? null,
      invoice_id: invoiceId ?? null,
      payer_user_id: payerUserId ?? null,
      currency: sql`COALESCE(${currency ?? null}, 'USD')`,
    })
    .returning("id"));

  if (paymentRows.length === 0) {
    throw new Error("recordManualPayment: payment row was not created");
  }

  const paymentId = paymentRows[0].id;

  // ★ Apply to invoice if provided
  if (invoiceId) {
    await applyPaymentToInvoice(tx, { tenantId, invoiceId, amountMinor });
  }

  // ★ Emit audit and event
  await writeAudit(tx, {
    tenantId,
    action: "payment.recorded_offline",
    object: "payment",
    subjectId: paymentId,
    after: { amount_minor: amountMinor, method },
    actorUserId,
  });

  await emit(tx, {
    tenantId,
    topic: "money.payment.recorded_offline",
    emittedBy: "money",
    subjectType: "payment",
    subjectId: paymentId,
    actor: userActor(actorUserId),  // a string — emit() refuses an object, and did, every time
    payload: {
      payment_id: paymentId,
      invoice_id: invoiceId,
      amount_minor: amountMinor,
      method,
      send_receipt: sendReceipt,
    },
  });

  return { payment_id: paymentId };
}

/**
 * The payment fee mirror fact module.
 * Finds Stripe payments without mirrored fees and fetches their charge details from Stripe.
 *
 * ★★★ IDEMPOTENT BY CONSTRUCTION: find excludes rows where fees_mirrored_at IS NOT NULL, so a
 *     second run on the same payment makes ZERO fetch calls.
 *
 * ★★ PER-ROW FAILURE HANDLING: a Stripe error on one row leaves it untouched for the next
 *     sweep — we catch and skip, not throw.
 */
export const PAYMENT_FEE_MIRROR_FACT = Object.freeze({
  key: "payment_fee_mirror",
  why: "a Stripe payment's fees, card and landing date are not yet copied from Stripe",

  find: (tx, { tenantId }) => run(tx, db
    .selectFrom("keystone.payment")
    .select(["id", "stripe_charge_id"])
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", "stripe")
    .where("fees_mirrored_at", "is", null)
    .where("stripe_charge_id", "is not", null)
    .where(sql`created_at < now() - interval '2 minutes'`)
    .orderBy("created_at")
    .limit(20)),

  act: async (tx, { tenantId, row }) => {
    // ★ Run as Owner so stripeConnectedRequest passes its permission checks
    return asPracticeOwner(tx, tenantId, async () => {
      const paymentId = row.id;
      const stripeChargeId = row.stripe_charge_id;

      try {
        // ─── STEP 1: Fetch the charge with balance_transaction ─────────────────────────
        const { body } = await stripeConnectedRequest(tx, {
          tenantId,
          method: "GET",
          path: `/charges/${stripeChargeId}?expand[]=balance_transaction`,
          sdk: (s, o, form, query) => s.charges.retrieve(stripeChargeId, { expand: ["balance_transaction"] }, o),
          movesMoney: false,
          purpose: "charge_read",
          actorUserId: null,
        });

        // ─── STEP 2: Extract fees from fee_details ──────────────────────────────────────
        const feeDetails = body.fee_details ?? [];
        let stripeFeeMinor = 0;
        let applicationFeeMinor = null;

        for (const fd of feeDetails) {
          if (fd.type === "stripe_fee") {
            stripeFeeMinor += fd.amount ?? 0;
          } else if (fd.type === "application_fee" && applicationFeeMinor === null) {
            // Only set application_fee_minor if currently null
            applicationFeeMinor = fd.amount ?? 0;
          }
        }

        // ─── STEP 3: Extract balance transaction details ────────────────────────────────
        const bt = body.balance_transaction ?? {};
        const netMinor = bt.net ?? null;
        const availableOn = bt.available_on ? new Date(bt.available_on * 1000).toISOString().split('T')[0] : null;

        // ─── STEP 4: Extract card details ───────────────────────────────────────────────
        const cardInfo = body.payment_method_details?.card || body.payment_method_details?.card_present;
        const cardBrand = cardInfo?.brand ?? null;
        const cardLastFour = cardInfo?.last4 ?? null;

        // ─── STEP 5: Extract risk and checks ────────────────────────────────────────────
        const riskScore = body.outcome?.risk_score ?? null;
        const checks = {
          cvc_check: body.cvc_check ?? null,
          address_postal_code_check: body.address_postal_code_check ?? null,
          three_d_secure: body.three_d_secure ?? null,
          read_method: body.read_method ?? null,
        };

        // ─── STEP 6: UPDATE payment row ─────────────────────────────────────────────────
        await run(tx, db
          .updateTable("keystone.payment")
          .set({
            stripe_fee_minor: (stripeFeeMinor || null) ?? null,
            application_fee_minor: sql`COALESCE(application_fee_minor, ${applicationFeeMinor ?? null})`,
            net_minor: netMinor ?? null,
            available_on: sql`${availableOn ?? null}::date`,
            card_brand: cardBrand ?? null,
            card_last_four: cardLastFour ?? null,
            risk_score: riskScore ?? null,
            checks: sql`${JSON.stringify(checks)}::jsonb`,
            fees_mirrored_at: sql`now()`,
          })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", paymentId));

        return `payment ${paymentId} fees mirrored`;
      } catch (error) {
        // ★ On Stripe error, skip this row and continue — do not throw out of the fact
        console.warn(`Payment fee mirror skipping ${paymentId}: ${error.message}`);
        return null;
      }
    });
  },
});
