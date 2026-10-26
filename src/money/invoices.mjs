// @ts-check
// Stage 15 task 15.5 — invoice draft editing, line positions, total recomputation, and voiding.
// Stage 20 task 20.60 — void Stripe invoice when present

import { emit, userActor } from "../events/outbox.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid, conflict, notFound, dependency } from "../http/errors.mjs";
import { voidStripeInvoice } from "./invoiceStripe.mjs";
// ★ L3.money/invoices — every `tx.query(<static SQL>)` below now goes through the builder + `run`;
//   the SQL semantics are unchanged (same WHERE clauses, same RETURNING columns, same ON CONFLICT
//   behaviour). `sql` is the escape hatch for what the builder itself does not express — jsonb
//   operators, a dynamically-built SET list — per the L3 per-file ruling: "SQL that calls plpgsql
//   or uses features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { asPracticeOwner } from "./asPracticeOwner.mjs";

const SECTION = "money";

/**
 * ★★ UPDATE DRAFT INVOICES ONLY. An issued invoice is a statement and cannot be edited.
 * Refuses (409) unless the invoice's `status = 'draft'`.
 * Refuses (409) if the row's real `updated_at` does not match `expectedUpdatedAt`.
 * Refuses (400) if `payerUserId` refers to an archived person.
 * Otherwise updates the given fields: title, message, dueAt, payerUserId, reminderDays, customFields.
 */
export async function updateInvoiceDraft(tx, {
  tenantId, invoiceId, expectedUpdatedAt, title, message, dueAt,
  payerUserId, reminderDays, customFields, actorUserId,
  collectionMethod, paymentMethodTypes, statementDescriptor,
  footer, rendering_page_size, rendering_template_id, remindersEnabled, memo,
}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");

  // ★ F857 (FINDINGS-OPEN.md) — a plain SELECT against keystone.invoice from a no-viewer tx
  //   returns zero rows (tenant_isolation's own viewer-gated OR branch never matches).
  // ★ Read the current row to check status and updated_at
  const { rows: invoiceRows } = await asPracticeOwner(tx, tenantId, () => run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status", "updated_at", "payer_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId)));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];
  if (invoice.status !== 'draft') {
    throw conflict("Only a draft can be edited — this one has been sent.");
  }

  // ★ F531-class bug, MEASURED live 29 Sep 2026 — `invoice.updated_at` here is a JS `Date` (pg's
  //   default parse of `timestamptz`, no custom type parser is registered anywhere in this repo)
  //   while `expectedUpdatedAt` is the STRING the client round-tripped through JSON. `Date !==
  //   string` is `true` unconditionally — no coercion happens under strict inequality — so this
  //   check refused EVERY draft-invoice edit that sent `expectedUpdatedAt` (InvoiceEditor.jsx does,
  //   every save), regardless of whether anything had actually changed. Compared as millisecond
  //   timestamps instead, which is what both sides actually carry once JSON has touched either one.
  if (expectedUpdatedAt && invoice.updated_at.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw conflict("Someone changed this invoice since you opened it.");
  }

  // ★ If payerUserId is changing, check it's not archived
  if (payerUserId && payerUserId !== invoice.payer_user_id) {
    const { rows: userRows } = await run(tx, db
      .selectFrom("keystone.app_user")
      .select(["id", "archived_at"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", payerUserId));

    if (userRows.length === 0) throw notFound("that person does not exist");
    if (userRows[0].archived_at) throw invalid("That person is archived.");
  }

  if (reminderDays !== undefined) {
    // ★ reminderDays updates the reminder rows
    // First, delete old reminder rows
    await run(tx, db
      .deleteFrom("keystone.invoice_reminder")
      .where("tenant_id", "=", tenantId)
      .where("invoice_id", "=", invoiceId));

    // Then insert new ones
    if (Array.isArray(reminderDays)) {
      for (const offsetDays of reminderDays) {
        await run(tx, db
          .insertInto("keystone.invoice_reminder")
          .values({ tenant_id: tenantId ?? null, invoice_id: invoiceId ?? null, offset_days: offsetDays ?? null })
          .onConflict((oc) => oc.columns(["invoice_id", "offset_days"]).doNothing()));
      }
    }
  }

  // ★ Build the SET list, only for provided fields — same fields, same order, same conditions as
  //   before. The manual `$N` placeholder bookkeeping is gone (each `sql` fragment below carries
  //   its own parameter), but every fragment is the SAME text with the SAME value it always was.
  const setFragments = [];

  if (title !== undefined) setFragments.push(sql`title = ${title}`);
  if (message !== undefined) setFragments.push(sql`message = ${message}`);
  // ★ F859 (FINDINGS-OPEN.md) — `memo` is what Stripe's own `description` field mirrors
  //   (pushInvoiceToStripe, invoiceStripe.mjs) — this update path had no way to ever SET it
  //   locally, so a practice's typed memo never reached Stripe.
  if (memo !== undefined) setFragments.push(sql`memo = ${memo}`);
  if (dueAt !== undefined) setFragments.push(sql`due_at = ${dueAt}`);
  if (payerUserId !== undefined) setFragments.push(sql`payer_user_id = ${payerUserId}`);
  if (customFields !== undefined) setFragments.push(sql`custom_fields = ${JSON.stringify(customFields)}`);

  // ◆ 20.68 — rendering overrides: footer, page_size, template_id
  // ★ the maintainer, 29 Sep 2026 — F815: these three used to push THREE separate `rendering = jsonb_set(...)`
  //   fragments into the same SET list. Postgres refuses an UPDATE that assigns the same column
  //   twice ("multiple assignments to same column") — every real save sends footer AND
  //   rendering_page_size AND rendering_template_id together, so this 500'd on every save that had
  //   more than one of the three set, which in practice was every save. Fixed by chaining the
  //   jsonb_set calls into ONE expression assigned to `rendering` exactly once.
  if (footer !== undefined || rendering_page_size !== undefined || rendering_template_id !== undefined) {
    let renderingExpr = sql`COALESCE(rendering, '{}'::jsonb)`;
    if (footer !== undefined) {
      renderingExpr = sql`jsonb_set(${renderingExpr}, '{footer}', ${JSON.stringify(footer)}::jsonb)`;
    }
    if (rendering_page_size !== undefined) {
      renderingExpr = sql`jsonb_set(${renderingExpr}, '{page_size}', ${JSON.stringify(rendering_page_size)}::jsonb)`;
    }
    if (rendering_template_id !== undefined) {
      renderingExpr = sql`jsonb_set(${renderingExpr}, '{template_id}', ${JSON.stringify(rendering_template_id)}::jsonb)`;
    }
    setFragments.push(sql`rendering = ${renderingExpr}`);
  }

  // ◆ 20.63 COLLECTION — per-invoice overrides
  if (collectionMethod !== undefined) {
    if (!['send_invoice', 'charge_automatically'].includes(collectionMethod)) {
      throw invalid("collection_method must be 'send_invoice' or 'charge_automatically'");
    }
    setFragments.push(sql`collection_method = ${collectionMethod}`);
  }
  if (paymentMethodTypes !== undefined) {
    setFragments.push(sql`payment_method_types = ${paymentMethodTypes ? JSON.stringify(paymentMethodTypes) : null}`);
  }
  if (statementDescriptor !== undefined) {
    // Validate statement_descriptor (5-22 chars, Stripe charset)
    if (statementDescriptor && (typeof statementDescriptor !== 'string' || statementDescriptor.length < 5 || statementDescriptor.length > 22)) {
      throw invalid('statement_descriptor must be 5 to 22 characters');
    }
    if (statementDescriptor && !/^[A-Za-z0-9 .\-]*$/.test(statementDescriptor)) {
      throw invalid('statement_descriptor must contain only letters, numbers, spaces, periods and hyphens');
    }
    setFragments.push(sql`statement_descriptor = ${statementDescriptor}`);
  }

  // ◆ F819 — tri-state reminders override (0535). `remindersEnabled === null` is a deliberate
  //   "go back to not decided" (the client can send it explicitly); `undefined` means the field
  //   was not part of this request at all, so it's left untouched, same as every other field here.
  if (remindersEnabled !== undefined) {
    setFragments.push(sql`reminders_enabled = ${remindersEnabled}`);
  }

  // ★ Always update updated_at
  setFragments.push(sql`updated_at = now()`);

  if (setFragments.length === 1) {
    // Only updated_at changed, nothing else
    return { id: invoiceId, updated_at: new Date() };
  }

  // ★ F857 — same gap, the UPDATE side (tenant_isolation's SELECT policy also gates finding the
  //   "old" row for an UPDATE, ANDed with tenant_update's own simpler, viewer-free USING clause).
  const { rows } = await asPracticeOwner(tx, tenantId, () => run(tx, sql`UPDATE keystone.invoice
               SET ${sql.join(setFragments)}
               WHERE tenant_id = ${tenantId} AND id = ${invoiceId}
               RETURNING id, updated_at`));
  if (rows.length === 0) throw notFound("invoice was not updated");

  return { id: rows[0].id, updated_at: rows[0].updated_at };
}

/**
 * ★ SET LINE ITEM POSITIONS. Writes position (0, 1, 2, …) onto each line item in the given order.
 */
export async function setLinePositions(tx, { tenantId, invoiceId, orderedLineIds }) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");
  if (!Array.isArray(orderedLineIds)) throw invalid("orderedLineIds must be an array");

  for (let pos = 0; pos < orderedLineIds.length; pos++) {
    const lineId = orderedLineIds[pos];
    await run(tx, db
      .updateTable("keystone.line_item")
      .set({ position: pos ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", lineId)
      .where("invoice_id", "=", invoiceId));
  }
}

/**
 * ★ RECOMPUTE TOTALS ON A DRAFT INVOICE ONLY. On any other status: 409, totals unchanged.
 * For a draft: sums the active line items and sets subtotal_minor, discount_minor, tax_minor, amount_minor.
 */
export async function recomputeDraftTotals(tx, { tenantId, invoiceId }) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");

  // ★ Check status is 'draft'
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  if (invoiceRows[0].status !== 'draft') {
    throw conflict("Only a draft can be recomputed — this one has been sent.");
  }

  // ★ Sum the line items
  const { rows: sumRows } = await run(tx, db
    .selectFrom("keystone.line_item")
    .select([
      sql`COALESCE(SUM(unit_amount_minor * quantity), 0)::int`.as("subtotal"),
      sql`COALESCE(SUM(discount_minor), 0)::int`.as("discount"),
      sql`COALESCE(SUM(tax_minor), 0)::int`.as("tax"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .where("status", "=", "active"));

  const { subtotal, discount, tax } = sumRows[0];
  const amount = subtotal - discount + tax;

  // ★ Update the invoice
  const { rows } = await run(tx, db
    .updateTable("keystone.invoice")
    .set({
      subtotal_minor: subtotal ?? null,
      discount_minor: discount ?? null,
      tax_minor: tax ?? null,
      amount_minor: amount ?? null,
      updated_at: sql`now()`,
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId)
    .returning(["id", "subtotal_minor", "discount_minor", "tax_minor", "amount_minor"]));

  if (rows.length === 0) throw notFound("invoice was not updated");

  return {
    id: rows[0].id,
    subtotal_minor: rows[0].subtotal_minor,
    discount_minor: rows[0].discount_minor,
    tax_minor: rows[0].tax_minor,
    amount_minor: rows[0].amount_minor,
  };
}

/**
 * ★ VOID AN INVOICE. Only works when status is `draft` or `open`.
 * Sets `status='void'`, `voided_at=now()`, `void_reason=reason`.
 * Soft-deletes any unsent reminder rows: `deleted_at = now()` on rows where `sent_at IS NULL`.
 * Emits `money.invoice.voided`.
 * Writes an audit entry `invoice.voided` with field `void_reason`.
 * Calling it twice: the second call is 409.
 */
export async function voidInvoice(tx, {
  tenantId, invoiceId, reason, actorUserId,
}) {
  if (!tenantId || !invoiceId) throw invalid("tenantId and invoiceId are required");
  if (!reason) throw invalid("reason is required");

  // ★ Check status is 'draft' or 'open'
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "status", "payer_user_id", "amount_minor", "currency", "invoice_number"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) throw notFound("no such invoice in this practice");

  const invoice = invoiceRows[0];
  if (invoice.status !== 'draft' && invoice.status !== 'open') {
    throw conflict("Only draft or open invoices can be voided.");
  }

  // ★ Idempotent by status: already voided is a conflict
  if (invoice.status === 'void') {
    throw conflict("This invoice is already voided.");
  }

  // ★ Void Stripe invoice if present (20.60) — Stripe must accept before any local UPDATE
  try {
    await voidStripeInvoice(tx, { tenantId, invoiceId, actorUserId });
  } catch (err) {
    throw dependency(`Stripe refused this: ${err.message}`, err);
  }

  // ★ Soft-delete unsent reminders
  await run(tx, db
    .updateTable("keystone.invoice_reminder")
    .set({ deleted_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .where("sent_at", "is", null));

  // ★ Set the invoice to voided
  const { rows } = await run(tx, db
    .updateTable("keystone.invoice")
    .set({ status: "void", voided_at: sql`now()`, void_reason: reason ?? null, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId)
    .where("status", "<>", "void")
    .returning(["id"]));

  if (rows.length === 0) throw conflict("This invoice is already voided.");

  // ★ Emit the voided event
  await emit(tx, {
    tenantId,
    topic: "money.invoice.voided",
    emittedBy: SECTION,
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: {
      payer_user_id: invoice.payer_user_id,
      amount_minor: invoice.amount_minor,
      currency: invoice.currency,
      invoice_number: invoice.invoice_number,
      void_reason: reason,
    },
  });

  // ★ Write audit entry
  await writeAudit(tx, {
    tenantId,
    action: "invoice.voided",
    object: "invoice",
    subjectId: invoiceId,
    after: { void_reason: reason },
    actorUserId,
  });

  return { id: invoiceId, status: "void", voided_at: new Date() };
}

/**
 * ★ PHASE-4 L5.1 — STRIPE'S SIDE MOVED THE INVOICE TO `void` OR `uncollectible`, AND THIS MIRRORS
 * IT. This is the webhook-driven counterpart to `voidInvoice` above: that function is called FROM
 * this app and tells Stripe; this one is called when Stripe's own state already changed (an invoice
 * voided or written off directly in the Stripe dashboard) and there is nothing left to tell it.
 *
 * Looks up `keystone.invoice` by `tenant_id` + `stripe_invoice_id = event.data.object.id`.
 * No such invoice → `{ applied: false, reason: 'no_such_invoice' }`, nothing changes.
 * `invoice.voided` → `status='void', voided_at=now(), void_reason='voided in Stripe'`, emits
 * `money.invoice.voided`.
 * `invoice.marked_uncollectible` → `status='uncollectible'`, emits
 * `money.invoice.marked_uncollectible`.
 * ★★ ONLY UPDATES WHEN THE STATUS ACTUALLY CHANGES — a Stripe redelivery of the same event is a
 * no-op, same discipline as every other handler in webhook.mjs.
 */
export async function handleStripeInvoiceStatusEvent(tx, event, { tenantId }) {
  const stripeInvoiceId = event.data?.object?.id;

  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "payer_user_id", "amount_minor", "currency", "invoice_number", "status"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_invoice_id", "=", stripeInvoiceId));

  if (invoiceRows.length === 0) {
    return { applied: false, reason: 'no_such_invoice' };
  }

  const invoice = invoiceRows[0];

  if (event.type === 'invoice.voided') {
    const { rows } = await run(tx, db
      .updateTable("keystone.invoice")
      .set({ status: "void", voided_at: sql`now()`, void_reason: "voided in Stripe", updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", invoice.id)
      .where("status", "<>", "void")
      .returning(["id"]));

    if (rows.length === 0) {
      return { applied: false, reason: 'replay', invoiceId: invoice.id };
    }

    await emit(tx, {
      tenantId,
      topic: "money.invoice.voided",
      emittedBy: SECTION,
      subjectType: "invoice",
      subjectId: invoice.id,
      actor: "webhook:stripe",
      payload: {
        payer_user_id: invoice.payer_user_id,
        amount_minor: invoice.amount_minor,
        currency: invoice.currency,
        invoice_number: invoice.invoice_number,
        void_reason: 'voided in Stripe',
      },
    });

    return { applied: true, reason: 'invoice_voided', invoiceId: invoice.id };
  }

  if (event.type === 'invoice.marked_uncollectible') {
    const { rows } = await run(tx, db
      .updateTable("keystone.invoice")
      .set({ status: "uncollectible", updated_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", invoice.id)
      .where("status", "<>", "uncollectible")
      .returning(["id"]));

    if (rows.length === 0) {
      return { applied: false, reason: 'replay', invoiceId: invoice.id };
    }

    await emit(tx, {
      tenantId,
      topic: "money.invoice.marked_uncollectible",
      emittedBy: SECTION,
      subjectType: "invoice",
      subjectId: invoice.id,
      actor: "webhook:stripe",
      payload: {
        payer_user_id: invoice.payer_user_id,
        amount_minor: invoice.amount_minor,
        currency: invoice.currency,
        invoice_number: invoice.invoice_number,
      },
    });

    return { applied: true, reason: 'invoice_marked_uncollectible', invoiceId: invoice.id };
  }

  // ★ Unreachable via the webhook switch (only these two event types dispatch here), kept as an
  // explicit guard rather than a silent fallthrough.
  return { applied: false, reason: 'unhandled_event_type', type: event.type };
}
