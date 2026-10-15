// @ts-check
// Stage 20 Task 20.61 — MORE-ACTIONS MENU FOR INVOICES AND DISPUTES
//
// ★★★ mark-paid, mark-uncollectible, duplicate, and close-dispute as routes with events and audit.
// Every action: 403-before-404, audited, evented.
//
// STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES.
// mark-paid calls Stripe `pay` with `paid_out_of_band:true` when stripe_invoice_id present.
// duplicate is dashboard-parity for the no-endpoint action: copies lines to the cent with fresh
// invoice number and NO stripe id.
// mark-uncollectible is bad debt: status transition from `open` ONLY (draft/paid → 409).
// close-dispute concedes: money is lost and it cannot be undone, requires typed confirmation.

import { invalid, conflict, notFound, dependency } from "../http/errors.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { normaliseReason, keepReason } from "../events/reasons.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { metadataFor } from "./metadata.mjs";
import { nextInvoiceNumber } from "./invoiceNumbers.mjs";
import { archiveRecord } from "../records/archive.mjs";
// ★ L3 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same RETURNING columns, same ON CONFLICT
//   behaviour). `sql` is the escape hatch for `now()` literals and NULLS LAST ordering, per the
//   L3 per-file ruling.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "money";

/**
 * ★ MARK AN INVOICE PAID BY OFFLINE METHOD.
 * Records payment offline, marks status as paid, calls Stripe `pay` with `paid_out_of_band:true`
 * when stripe_invoice_id is present. Emits `money.invoice.marked_paid` and writes audit.
 *
 * @param tx database transaction
 * @param options { tenantId, invoiceId, method: 'cash'|'cheque'|'other', note?, actorUserId }
 */
export async function markPaidInvoice(tx, {
  tenantId, invoiceId, method, note, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");
  if (!method || !["cash", "cheque", "other"].includes(method)) {
    throw invalid("method must be one of: cash, cheque, other");
  }

  // ★ Load invoice
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select([
      "id", "status", "payer_user_id", "amount_minor", "currency", "stripe_invoice_id",
      "tenant_id", "amount_remaining_minor", "paid_minor",
    ])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];

  // ★ Only allow from open status (draft/paid → 409)
  if (invoice.status !== "open") {
    throw conflict(
      invoice.status === "paid" ? "This invoice is already paid."
        : invoice.status === "draft" ? "Send the invoice first, then mark it paid."
          : `Cannot mark a ${invoice.status} invoice as paid.`);
  }

  // ★★★ STRIPE FIRST (Stripe is the money record). This wrote the payment and flipped the invoice
  //     to paid LOCALLY, then called Stripe and only logged a failure — Keystone "paid", Stripe
  //     "open". Now a Stripe refusal throws and nothing local is written. (The local insert also named
  //     columns that do not exist — no invoice was ever marked paid this way. 26 Sep 2026.)
  if (invoice.stripe_invoice_id) {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/invoices/${invoice.stripe_invoice_id}/pay`,
      sdk: (s, o, form, query) => s.invoices.pay(invoice.stripe_invoice_id, form, o),
      form: { paid_out_of_band: "true" },
      movesMoney: false, // a record, not a charge
      purpose: "mark_invoice_paid_offline",
      actorUserId,
    });
  }

  // ★ ONE manual-payment writer: the payment row (payer + currency from the invoice) and the
  //   invoice's paid_minor / status / paid_at, applied together.
  const { recordManualPayment } = await import("./payments.mjs");
  const remaining = invoice.amount_remaining_minor ?? (invoice.amount_minor - (invoice.paid_minor ?? 0));
  if (!Number.isInteger(remaining) || remaining <= 0) {
    throw conflict("Nothing is left to pay on this invoice.");
  }
  await recordManualPayment(tx, {
    tenantId, invoiceId, amountMinor: remaining, method,
    receivedAt: new Date().toISOString(), note: note ?? null, actorUserId,
  });
  await run(tx, db
    .updateTable("keystone.invoice")
    .set({ amount_remaining_minor: 0 })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.invoice.marked_paid",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    // ★ `note` dropped from the payload (§2.4 — no text keys). Already on the record
    //   (`keystone.payment.note`, written by `recordManualPayment` above); no consumer of
    //   `money.invoice.marked_paid` reads `payload.note` (grepped src/, n8n/workflows/).
    payload: {
      method,
      amount_minor: invoice.amount_minor,
      payer_user_id: invoice.payer_user_id,
    },
  });

  // ★ Write audit
  await writeAudit(tx, {
    tenantId,
    action: "invoice.marked_paid",
    object: "invoice",
    subjectId: invoiceId,
    after: { status: "paid", payment_method: method, note: note ?? null },
    actorUserId,
  });

  return { id: invoiceId, status: "paid" };
}

/**
 * ★ MARK AN INVOICE UNCOLLECTIBLE (BAD DEBT).
 * Status transition from `open` ONLY — draft/paid → 409 pair.
 * Emits `money.invoice.marked_uncollectible` with consequence stated in audit wording.
 *
 * @param tx database transaction
 * @param options { tenantId, invoiceId, reason?, actorUserId }
 */
export async function markUncollectibleInvoice(tx, {
  tenantId, invoiceId, reason, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");
  // ★ R26 (RECONCILE) — validated BEFORE Stripe is told anything, so a refused (over-long) reason
  //   changes nothing anywhere.
  const keptReason = normaliseReason(reason);

  // ★ Load invoice
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status", "payer_user_id", "amount_minor", "currency", "tenant_id", "stripe_invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];

  // ★ Only allow from open status
  if (invoice.status !== "open") {
    throw conflict(
      invoice.status === "draft" ? "Send the invoice first."
        : invoice.status === "paid" ? "This invoice is already paid — it cannot be uncollectible."
          : invoice.status === "uncollectible" ? "This invoice is already marked uncollectible."
            : `Cannot mark a ${invoice.status} invoice as uncollectible.`);
  }

  // ★★★ STRIPE FIRST (Stripe is the money record). A refusal throws and nothing local is
  //     written — the same shape as markPaidInvoice above. Writing off an invoice stops
  //     Stripe's reminders for it.
  if (invoice.stripe_invoice_id) {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/invoices/${invoice.stripe_invoice_id}/mark_uncollectible`,
      sdk: (s, o, form, query) => s.invoices.markUncollectible(invoice.stripe_invoice_id, {}, o),
      form: {},
      movesMoney: false,
      purpose: "mark_invoice_uncollectible",
      actorUserId,
    });
  }

  // ★ Update status to uncollectible
  await run(tx, db
    .updateTable("keystone.invoice")
    .set({ status: "uncollectible", amount_remaining_minor: 0, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  // ★ Emit event — ★ R26 (RECONCILE): NO `reason` in the payload. emit() refuses typed text (§2.4),
  //   so it threw on every write-off with a reason. The text is kept beside the event instead.
  const writtenOff = await emit(tx, {
    tenantId,
    topic: "money.invoice.marked_uncollectible",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: {
      amount_minor: invoice.amount_minor,
      payer_user_id: invoice.payer_user_id,
    },
  });
  await keepReason(tx, {
    tenantId, eventId: writtenOff.id, subjectType: "invoice", subjectId: invoiceId,
    kind: "write_off", reason: keptReason, createdBy: actorUserId ?? null,
  });

  // ★ Write audit with consequence stated plainly
  await writeAudit(tx, {
    tenantId,
    action: "invoice.marked_uncollectible",
    object: "invoice",
    subjectId: invoiceId,
    after: { status: "uncollectible" }, // the reason is in record_reason (R26)
    actorUserId,
  });

  return { id: invoiceId, status: "uncollectible" };
}

/**
 * ★ DUPLICATE AN INVOICE.
 * Dashboard-parity for the no-endpoint action: copies OUR row and OUR lines into a new DRAFT
 * with fresh invoice number, NO stripe id, and `duplicated_from` in metadata.
 * It never calls Stripe.
 *
 * @param tx database transaction
 * @param options { tenantId, invoiceId, actorUserId }
 * @returns { id: newInvoiceId, invoice_number: newNumber }
 */
export async function duplicateInvoice(tx, {
  tenantId, invoiceId, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");

  // ★ Load source invoice
  // ★ real columns only — reminder_days / invoice_prefix / account_id / created_by_user_id /
  //   metadata do not exist on invoice; this never ran (26 Sep 2026)
  const { rows: sourceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select([
      "id", "title", "message", "memo", "due_at", "payer_user_id", "currency", "subtotal_minor",
      "discount_minor", "tax_minor", "amount_minor", "custom_fields", "payment_terms_days",
    ])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (sourceRows.length === 0) throw notFound("no such invoice in this practice");

  const source = sourceRows[0];

  // ★ Generate fresh invoice number
  const newInvoiceNumber = await nextInvoiceNumber(tx, tenantId);

  // ★ A DRAFT copy. Where it came from is the money.invoice.duplicated event + audit below
  //   (invoice has no metadata column); Stripe metadata is written when the draft is sent.
  const { rows: newInvoiceRows } = await run(tx, db
    .insertInto("keystone.invoice")
    .values({
      tenant_id: tenantId ?? null,
      invoice_number: newInvoiceNumber ?? null,
      title: source.title ?? null,
      message: source.message ?? null,
      memo: source.memo ?? null,
      due_at: source.due_at ?? null,
      payment_terms_days: source.payment_terms_days ?? null,
      payer_user_id: source.payer_user_id ?? null,
      currency: source.currency ?? null,
      subtotal_minor: source.subtotal_minor ?? null,
      discount_minor: source.discount_minor ?? null,
      tax_minor: source.tax_minor ?? null,
      amount_minor: source.amount_minor ?? null,
      status: "draft",
      custom_fields: (source.custom_fields ? JSON.stringify(source.custom_fields) : null) ?? null,
      created_by: actorUserId ?? null,
      amount_remaining_minor: source.amount_minor ?? null,
      amount_overpaid_minor: 0,
    })
    .returning(["id", "invoice_number"]));

  const newInvoiceId = newInvoiceRows[0].id;

  // ★ Copy all line items from source (to the cent)
  const { rows: sourceLines } = await run(tx, db
    .selectFrom("keystone.line_item")
    .select([
      "unit_amount_minor", "quantity", "discount_minor", "tax_minor", "currency", "name_snapshot",
      "status", "price_id", "service_id", "package_id", "plan_id", "unit", "position",
    ])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .orderBy(sql`position NULLS LAST`)
    .orderBy("created_at", "asc"));

  for (const line of sourceLines) {
    await run(tx, db
      .insertInto("keystone.line_item")
      .values({
        tenant_id: tenantId ?? null,
        invoice_id: newInvoiceId ?? null,
        unit_amount_minor: line.unit_amount_minor ?? null,
        quantity: line.quantity ?? null,
        discount_minor: line.discount_minor ?? null,
        tax_minor: line.tax_minor ?? null,
        currency: line.currency ?? null,
        name_snapshot: line.name_snapshot ?? null,
        status: line.status ?? null,
        price_id: line.price_id ?? null,
        service_id: line.service_id ?? null,
        package_id: line.package_id ?? null,
        plan_id: line.plan_id ?? null,
        unit: line.unit ?? null,
        position: line.position ?? null,
      }));
  }

  // ★ Copy reminders (if any)
  const { rows: sourceReminders } = await run(tx, db
    .selectFrom("keystone.invoice_reminder")
    .select(["offset_days"])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId));

  for (const reminder of sourceReminders) {
    await run(tx, db
      .insertInto("keystone.invoice_reminder")
      .values({ tenant_id: tenantId ?? null, invoice_id: newInvoiceId ?? null, offset_days: reminder.offset_days ?? null })
      .onConflict((oc) => oc.columns(["invoice_id", "offset_days"]).doNothing()));
  }

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.invoice.duplicated",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: newInvoiceId,
    actor: userActor(actorUserId),
    payload: {
      duplicated_from_id: invoiceId,
      new_invoice_number: newInvoiceNumber,
      amount_minor: source.amount_minor,
      payer_user_id: source.payer_user_id,
    },
  });

  // ★ Write audit
  await writeAudit(tx, {
    tenantId,
    action: "invoice.duplicated",
    object: "invoice",
    subjectId: newInvoiceId,
    after: { duplicated_from: invoiceId, status: "draft" },
    actorUserId,
  });

  return { id: newInvoiceId, invoice_number: newInvoiceNumber };
}

/**
 * ★ ATTACH A STRIPE PAYMENT TO AN OPEN INVOICE (Task 20.73).
 * Idempotent: attaching the same payment to the same invoice returns 409 on second call.
 * Pairs a Stripe PaymentIntent (walk-in payment) onto an open invoice.
 *
 * @param tx database transaction
 * @param options { tenantId, invoiceId, stripePaymentIntentId, actorUserId }
 * @returns { id: invoiceId, payment_intent_id: stripePaymentIntentId }
 */
export async function attachPaymentToInvoice(tx, {
  tenantId, invoiceId, stripePaymentIntentId, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId || !stripePaymentIntentId) {
    throw invalid("tenantId, invoiceId, and stripePaymentIntentId are required");
  }

  // ★ Load invoice
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status", "payer_user_id", "amount_minor", "currency", "tenant_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];

  // ★ Only allow attaching to open invoices
  if (invoice.status !== "open") {
    throw conflict(
      invoice.status === "draft" ? "Send the invoice first before attaching a payment."
        : invoice.status === "paid" ? "This invoice is already paid."
          : `Cannot attach a payment to a ${invoice.status} invoice.`);
  }

  // ★★★ IDEMPOTENCY: check if this payment is already attached to this invoice
  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.payment_allocation")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .where("group_id", "=", stripePaymentIntentId)
    .where("state", "=", "intended")
    .limit(1));

  if (existingRows.length > 0) {
    throw conflict("This payment is already attached to this invoice.");
  }

  // ★ Create payment_allocation record linking the PaymentIntent to this invoice
  const { rows: allocRows } = await run(tx, db
    .insertInto("keystone.payment_allocation")
    .values({
      tenant_id: tenantId ?? null,
      group_id: stripePaymentIntentId ?? null,
      invoice_id: invoiceId ?? null,
      payer_user_id: invoice.payer_user_id ?? null,
      amount_minor: invoice.amount_minor ?? null,
      currency: invoice.currency ?? null,
      state: "intended",
      created_at: sql`now()`,
    })
    .returning(["id"]));

  // ★ Emit event
  await emit(tx, {
    tenantId,
    topic: "money.invoice.payment_attached",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: {
      stripe_payment_intent_id: stripePaymentIntentId,
      amount_minor: invoice.amount_minor,
      payer_user_id: invoice.payer_user_id,
    },
  });

  // ★ Write audit
  await writeAudit(tx, {
    tenantId,
    action: "invoice.payment_attached",
    object: "invoice",
    subjectId: invoiceId,
    after: { payment_intent_id: stripePaymentIntentId },
    actorUserId,
  });

  return { id: invoiceId, payment_intent_id: stripePaymentIntentId };
}

/**
 * ★ DELETE A DRAFT INVOICE (P3.S1).
 * Only a draft can be deleted — an issued invoice is a statement (409 otherwise).
 * If a Stripe draft was pushed, Stripe is asked to delete it first (Stripe deletes drafts
 * only); a refusal propagates and nothing local changes. Never hard-deleted: archived
 * through the one writer (P2.9), then `money.invoice.deleted` is emitted.
 *
 * @param tx database transaction
 * @param options { tenantId, invoiceId, actorUserId }
 */
export async function deleteDraftInvoice(tx, {
  tenantId, invoiceId, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");

  // ★ Load invoice
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status", "stripe_invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];

  // ★ Only a draft can be deleted
  if (invoice.status !== "draft") {
    throw conflict("Only a draft can be deleted — this one has been sent.");
  }

  // ★★★ STRIPE FIRST (Stripe is the money record). Stripe only allows deleting draft
  //     invoices — a refusal propagates and nothing local is written.
  if (invoice.stripe_invoice_id) {
    try {
      await stripeConnectedRequest(tx, {
        tenantId,
        method: "DELETE",
        path: `/invoices/${invoice.stripe_invoice_id}`,
        sdk: (s, o, form, query) => s.invoices.del(invoice.stripe_invoice_id, {}, o),
        movesMoney: false, // deleting a draft, not a charge
        purpose: "delete_draft_invoice",
        actorUserId,
      });
    } catch (err) {
      throw dependency(`Stripe refused this: ${err.message}`, err);
    }
  }

  // ★ Never hard-deleted (P2.9) — the one writer archives it, emits
  //   `money.invoice.archived`, and keeps the reason.
  await archiveRecord(tx, {
    tenantId, object: "invoice", id: invoiceId, actorUserId, reason: "draft deleted",
  });

  // ★ Emit the delete-specific event on top of the archive's own event.
  await emit(tx, {
    tenantId,
    topic: "money.invoice.deleted",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: {},
  });

  return { id: invoiceId, deleted: true };
}
