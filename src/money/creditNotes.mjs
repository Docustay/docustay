// @ts-check
// Stage 20 Task 20.62 — CREDIT NOTES ADJUST FINALIZED INVOICES
//
// ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS.
// A credit note issued against a finalized invoice creates a Stripe CreditNote with
// line fidelity, then mirrors the result into credit_note and credit_note_line.
// Destinations: refund (via 0434 approval path), credit (via 20.66 ledger), out_of_band.
// Over-crediting is refused with remaining amount named (positive control: exactly remaining succeeds).

import { invalid, conflict, forbidden } from "../http/errors.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { nextInvoiceNumber } from "./invoiceNumbers.mjs";
import { requestRefund } from "./refunds.mjs";
import { emit, userActor } from "../events/outbox.mjs";
import { metadataFor } from "./metadata.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same RETURNING columns, same parameterization).
//   `sql` is the escape hatch for what the builder itself does not express — computed columns,
//   `NULLS LAST`, `now()` — per the L3 per-file ruling.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const CREDIT_NOTE_REASONS = Object.freeze([
  "duplicate",
  "fraudulent",
  "order_change",
  "product_unsatisfactory",
]);

const CREDIT_NOTE_DESTINATIONS = Object.freeze([
  "refund",
  "credit",
  "out_of_band",
]);

/**
 * Issue a credit note against a finalized invoice.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options {
 *   tenantId, invoiceId, lines (array of {line_item_id, quantity, amount_minor}),
 *   reason (one of CREDIT_NOTE_REASONS), destination (one of CREDIT_NOTE_DESTINATIONS),
 *   memo, principal, actorUserId
 * }
 * @returns {Promise<{id, stripe_credit_note_id, number_ours, total_minor}>}
 */
export async function issueCreditNote(tx, {
  tenantId, invoiceId, lines, reason, destination, memo = null, principal, actorUserId,
} = {}) {
  if (!tenantId || !invoiceId) {
    throw invalid("tenantId and invoiceId are required");
  }

  // ★ Authorization: money:write (admin only, not coach)
  await assertMay(tx, principal, { object: "invoice", action: "edit" }, {});

  if (!CREDIT_NOTE_REASONS.includes(reason)) {
    throw invalid(`reason must be one of: ${CREDIT_NOTE_REASONS.join(", ")}`);
  }

  if (!CREDIT_NOTE_DESTINATIONS.includes(destination)) {
    throw invalid(`destination must be one of: ${CREDIT_NOTE_DESTINATIONS.join(", ")}`);
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    throw invalid("lines must be a non-empty array");
  }

  // ── Load the invoice ──────────────────────────────────────────────────────────
  const { rows: invoiceRows } = await run(tx, db
    // ★ STRIPE MIRROR (0574) — status/amount/pdf come from invoice_effective (Stripe's word); the
    //   the platform-owned subtotal/tax stay on the base row, joined by id.
    .selectFrom("keystone.invoice as i")
    .innerJoin("keystone.invoice_effective as ie", "ie.id", "i.id")
    .select([
      "i.id as id",
      "i.stripe_invoice_id as stripe_invoice_id",
      "ie.amount_minor as total_minor",
      "i.subtotal_minor as subtotal_minor",
      "i.tax_minor as tax_minor",
      "i.payer_user_id as payer_user_id",
      "ie.status as status",
      "ie.invoice_pdf_url as invoice_pdf_url",
    ])
    .where("i.tenant_id", "=", tenantId)
    .where("i.id", "=", invoiceId));

  if (invoiceRows.length === 0) {
    throw invalid("invoice not found");
  }

  const invoice = invoiceRows[0];
  // ★ STRIPE MIRROR — Stripe calls a finalized, unpaid invoice `open`; the platform's own cache says `finalized`.
  if (invoice.status !== "finalized" && invoice.status !== "open" && invoice.status !== "paid") {
    throw invalid("credit notes can only be issued against finalized or paid invoices");
  }

  if (!invoice.stripe_invoice_id) {
    throw invalid("invoice must be mirrored to Stripe to issue a credit note");
  }

  // ── Load invoice line items and compute remaining creditable amounts ──────────
  // ★ the table is line_item; a line's amount is unit × quantity less its discount
  const { rows: lineItemRows } = await run(tx, db
    .selectFrom("keystone.line_item")
    .select([
      "id",
      "quantity",
      sql`(unit_amount_minor * quantity - COALESCE(discount_minor, 0))`.as("amount_minor"),
      "name_snapshot as description",
    ])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .orderBy(sql`position NULLS LAST`)
    .orderBy("created_at"));

  if (lineItemRows.length === 0) {
    throw invalid("invoice has no line items");
  }

  const lineItemMap = new Map(lineItemRows.map(r => [r.id, r]));

  // ★ Compute remaining creditable per line and total
  const lineItemCredited = new Map();
  const { rows: existingCreditRows } = await run(tx, db
    .selectFrom("keystone.credit_note_line as cnl")
    .innerJoin("keystone.credit_note_effective as cn", "cn.id", "cnl.credit_note_id")
    .select([
      "cnl.line_item_id",
      sql`SUM(cnl.amount_minor)::bigint`.as("credited"),
    ])
    .where("cn.tenant_id", "=", tenantId)
    .where("cn.invoice_id", "=", invoiceId)
    .where("cn.status", "=", "issued")
    .groupBy("cnl.line_item_id"));

  for (const row of existingCreditRows) {
    lineItemCredited.set(row.line_item_id, row.credited);
  }

  let totalCreditRequested = 0;
  const lineDetails = [];

  for (const line of lines) {
    const lineItem = lineItemMap.get(line.line_item_id);
    if (!lineItem) {
      throw invalid(`line item ${line.line_item_id} not found on this invoice`);
    }

    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw invalid("quantity must be a positive integer");
    }

    if (!Number.isInteger(line.amount_minor) || line.amount_minor <= 0) {
      throw invalid("amount_minor must be a positive integer");
    }

    const alreadyCredited = lineItemCredited.get(line.line_item_id) ?? 0;
    const remaining = lineItem.amount_minor - alreadyCredited;

    if (line.amount_minor > remaining) {
      throw conflict(
        `line item ${line.line_item_id}: cannot credit more than remaining ${remaining} minor units`,
        { remaining }
      );
    }

    totalCreditRequested += line.amount_minor;
    lineDetails.push({
      line_item_id: line.line_item_id,
      quantity: line.quantity,
      amount_minor: line.amount_minor,
      description: lineItem.description || "Line item",
    });
  }

  // ── Generate our credit note number ───────────────────────────────────────────
  const numberOurs = await nextInvoiceNumber(tx, tenantId);

  // ── Create credit note in Stripe ──────────────────────────────────────────────
  const stripeLineItems = lineDetails.map(l => ({
    invoice_line_item: l.line_item_id, // Stripe line item reference (when available)
    quantity: l.quantity,
    unit_amount_decimal: (l.amount_minor / 100).toFixed(2),
  }));

  const stripeCreateForm = {
    invoice: invoice.stripe_invoice_id,
    reason: reason === "product_unsatisfactory" ? "product_unsatisfactory" : reason,
  };

  // Add metadata as flat keys
  const metaObj = metadataFor("credit_note", {
    practice_id: tenantId,
    invoice_id: invoiceId,
  });
  for (const [k, v] of Object.entries(metaObj)) {
    stripeCreateForm[`metadata[${k}]`] = v;
  }

  // Add line items
  stripeLineItems.forEach((line, idx) => {
    const prefix = `lines[${idx}]`;
    stripeCreateForm[`${prefix}[quantity]`] = line.quantity;
    stripeCreateForm[`${prefix}[unit_amount_decimal]`] = line.unit_amount_decimal;
  });

  let stripeCreditNote;
  try {
    const resp = await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/credit_notes`,
      sdk: (s, o, form, query) => s.creditNotes.create(form, o),
      form: stripeCreateForm,
      idempotencyKey: `credit-note-${invoiceId}-${numberOurs}`,
      movesMoney: false,
      purpose: "credit_note_issue",
      actorUserId,
    });
    stripeCreditNote = resp.body;
    if (!stripeCreditNote?.id) {
      throw new Error("Stripe CreditNote create returned no id");
    }
  } catch (e) {
    throw invalid(`Stripe credit note creation failed: ${e.message}`);
  }

  // ── Record credit note locally ────────────────────────────────────────────────
  const { rows: cnRows } = await run(tx, db
    .insertInto("keystone.credit_note")
    .values({
      tenant_id: tenantId ?? null,
      invoice_id: invoiceId ?? null,
      stripe_credit_note_id: stripeCreditNote.id ?? null,
      number_ours: numberOurs ?? null,
      status: "issued",
      reason: reason ?? null,
      memo: memo ?? null,
      subtotal_minor: (stripeCreditNote.subtotal || 0) ?? null,
      tax_minor: (stripeCreditNote.tax || 0) ?? null,
      total_minor: (stripeCreditNote.total || totalCreditRequested) ?? null,
      destination: destination ?? null,
      effective_at: sql`now()`,
      created_by: actorUserId ?? null,
    })
    .returning("id"));

  const creditNoteId = cnRows[0].id;

  // ── Record credit note lines ──────────────────────────────────────────────────
  for (const line of lineDetails) {
    await run(tx, db
      .insertInto("keystone.credit_note_line")
      .values({
        tenant_id: tenantId ?? null,
        credit_note_id: creditNoteId ?? null,
        line_item_id: line.line_item_id ?? null,
        quantity: line.quantity ?? null,
        amount_minor: line.amount_minor ?? null,
        description_snapshot: line.description ?? null,
      }));
  }

  // ── Execute destination action ────────────────────────────────────────────────
  if (destination === "refund") {
    // ★ Request refund via 0434 approval path (never bypass)
    const { rows: paymentRows } = await run(tx, db
      .selectFrom("keystone.invoice")
      .select("payer_user_id")
      .where("id", "=", invoiceId));
    if (paymentRows.length > 0 && paymentRows[0].payer_user_id) {
      // Create a refund request that goes through approval if needed
      await requestRefund(tx, {
        tenantId,
        paymentId: null, // Credit note maps to invoice, not payment
        amount: totalCreditRequested,
        reason: "duplicate", // Map credit note reason to refund reason
        receiptLine: `Credit note ${numberOurs}`,
        returnCredit: false,
        principal,
        actorUserId,
      });
    }
  } else if (destination === "credit") {
    // ★ Add to customer credit ledger via 20.66 (append-only ledger)
    const { rows: invoiceRows2 } = await run(tx, db
      .selectFrom("keystone.invoice")
      .select("payer_user_id")
      .where("id", "=", invoiceId));
    if (invoiceRows2.length > 0 && invoiceRows2[0].payer_user_id) {
      await run(tx, db
        .insertInto("keystone.customer_credit_entry")
        .values({
          tenant_id: tenantId ?? null,
          subject_type: "person",
          subject_id: invoiceRows2[0].payer_user_id ?? null,
          amount_minor: totalCreditRequested ?? null,
          type: "credit_note",
          credit_note_id: creditNoteId ?? null,
          created_by: actorUserId ?? null,
        }));
    }
  }
  // out_of_band: record only, no side effect

  // ── Emit event ────────────────────────────────────────────────────────────────
  await emit(tx, {
    tenantId,
    topic: "money.credit_note.issued",
    emittedBy: "money",
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: userActor(actorUserId),
    payload: {
      credit_note_id: creditNoteId,
      stripe_credit_note_id: stripeCreditNote.id,
      number_ours: numberOurs,
      total_minor: totalCreditRequested,
      reason,
      destination,
    },
  });

  // ── Audit ─────────────────────────────────────────────────────────────────────
  await writeAudit(tx, {
    tenantId,
    actorUserId,
    action: "credit_note.issued",
    // ★ R7 (RECONCILE) — writeAudit's real shape: `object` (required) + `after`. The old
    //   subjectType/objectId/details keys are not read by writeAudit, and a missing `object` threw.
    object: "invoice",
    subjectId: invoiceId,
    after: { credit_note_id: creditNoteId, reason, destination, total_minor: totalCreditRequested },
  });

  return {
    id: creditNoteId,
    stripe_credit_note_id: stripeCreditNote.id,
    number_ours: numberOurs,
    total_minor: totalCreditRequested,
  };
}

/**
 * Void a credit note (reverse both sides).
 *
 * @param {object} tx a tenant transaction
 * @param {object} options { tenantId, creditNoteId, principal, actorUserId }
 * @returns {Promise<{id}>}
 */
export async function voidCreditNote(tx, {
  tenantId, creditNoteId, principal, actorUserId,
} = {}) {
  if (!tenantId || !creditNoteId) {
    throw invalid("tenantId and creditNoteId are required");
  }

  // ★ Authorization: money:write (admin only)
  await assertMay(tx, principal, { object: "invoice", action: "edit" }, {});

  // ── Load the credit note ──────────────────────────────────────────────────────
  const { rows: cnRows } = await run(tx, db
    .selectFrom("keystone.credit_note_effective")
    .select(["id", "status", "stripe_credit_note_id", "invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", creditNoteId));

  if (cnRows.length === 0) {
    throw invalid("credit note not found");
  }

  const creditNote = cnRows[0];
  if (creditNote.status === "void") {
    throw conflict("credit note is already void");
  }

  // ── Void in Stripe ────────────────────────────────────────────────────────────
  try {
    await stripeConnectedRequest(tx, {
      tenantId,
      method: "POST",
      path: `/credit_notes/${creditNote.stripe_credit_note_id}/void`,
      sdk: (s, o, form, query) => s.creditNotes.voidCreditNote(creditNote.stripe_credit_note_id, {}, o),
      form: {},
      idempotencyKey: `void-cn-${creditNoteId}`,
      movesMoney: false,
      purpose: "credit_note_void",
      actorUserId,
    });
  } catch (e) {
    throw invalid(`Stripe void failed: ${e.message}`);
  }

  // ── Mark as void locally ──────────────────────────────────────────────────────
  await run(tx, db
    .updateTable("keystone.credit_note")
    .set({ status: "void", voided_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", creditNoteId));

  // ── Emit event ────────────────────────────────────────────────────────────────
  await emit(tx, {
    tenantId,
    topic: "money.credit_note.voided",
    emittedBy: "money",
    subjectType: "invoice",
    subjectId: creditNote.invoice_id,
    actor: userActor(actorUserId),
    payload: {
      credit_note_id: creditNoteId,
      stripe_credit_note_id: creditNote.stripe_credit_note_id,
    },
  });

  return { id: creditNoteId };
}

/**
 * P3.S3 — Preview a credit note before issuing it. No Stripe write, no local mutation, no event
 * (this is a read). When the invoice has never been pushed to Stripe, the answer is computed
 * straight from the given lines. Otherwise Stripe's own `/credit_notes/preview` is asked, and its
 * totals are returned instead — EXCEPT when that call fails: this is the one place a Stripe
 * failure does not become `dependency(...)`, because it is a read and OUR totals are still a
 * useful answer.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options {
 *   tenantId, invoiceId,
 *   lines (array of {line_item_id, quantity, amount_minor} — the candidate credit lines),
 *   principal (for the invoice.view check)
 * }
 * @returns {Promise<{total, tax, lines, source: "ours"|"stripe", note?}>}
 */
export async function previewCreditNote(tx, {
  tenantId, invoiceId, lines, principal,
} = {}) {
  if (!tenantId || !invoiceId) {
    throw invalid("tenantId and invoiceId are required");
  }

  // ★ Authorization: invoice.view (a VERB action — assertMay resolves the invoice's owner
  //   through the payer's owning coach, same as issueCreditNote's invoice.edit check above).
  await assertMay(tx, principal, { object: "invoice", action: "view", subjectId: invoiceId }, {});

  if (!Array.isArray(lines) || lines.length === 0) {
    throw invalid("lines must be a non-empty array");
  }

  // ── Load the invoice ──────────────────────────────────────────────────────────
  const { rows: invoiceRows } = await run(tx, db
    .selectFrom("keystone.invoice")
    .select(["id", "stripe_invoice_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", invoiceId));

  if (invoiceRows.length === 0) {
    throw invalid("invoice not found");
  }

  const invoice = invoiceRows[0];

  // ★ OUR totals, computed straight from the given lines — the not-pushed answer, and the
  //   fallback answer when Stripe's preview call fails.
  const ourTotals = () => {
    let total = 0;
    for (const line of lines) {
      if (!Number.isInteger(line.amount_minor) || line.amount_minor <= 0) {
        throw invalid("amount_minor must be a positive integer");
      }
      total += line.amount_minor;
    }
    return { total, tax: 0, lines, source: "ours" };
  };

  // 1. invoice must have stripe_invoice_id, else return totals computed from OUR lines.
  if (!invoice.stripe_invoice_id) {
    return ourTotals();
  }

  // 2. GET /v1/credit_notes/preview?invoice=…&lines[n][invoice_line_item]=…&lines[n][quantity]=…
  const query = {
    invoice: invoice.stripe_invoice_id,
    lines: lines.map((line) => ({
      invoice_line_item: line.line_item_id,
      quantity: line.quantity,
    })),
  };

  let resp;
  try {
    resp = await stripeConnectedRequest(tx, {
      tenantId,
      method: "GET",
      path: "/credit_notes/preview",
      sdk: (s, o, form, query) => s.creditNotes.preview(query, o),
      query,
      movesMoney: false,
      purpose: "credit_note_preview",
    });
  } catch {
    // ★ THE ONE PLACE A STRIPE FAILURE DOES NOT BECOME dependency(...) — it is a read, so a
    //   Stripe outage still gets an answer: OUR totals, flagged as such.
    return { ...ourTotals(), note: "Stripe didn't answer" };
  }

  // 3. return { total, tax, lines, source: "stripe" }
  const body = resp.body ?? {};
  return {
    total: body.total,
    tax: body.tax,
    lines: body.lines?.data ?? [],
    source: "stripe",
  };
}

/**
 * P3.S4 — List an invoice's credit notes. A read: no Stripe call, no mutation, no event — the
 * mirror (`credit_note_effective`, Stripe's own credit notes plus the platform-only ones) is the answer.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options { tenantId, invoiceId }
 * @returns {Promise<Array<object>>}
 */
export async function listInvoiceCreditNotes(tx, { tenantId, invoiceId } = {}) {
  if (!tenantId || !invoiceId) {
    throw invalid("tenantId and invoiceId are required");
  }

  const { rows } = await run(tx, db
    .selectFrom("keystone.credit_note_effective")
    .select([
      "id", "number as number_ours", "total_minor", "reason", "status", "memo", "destination",
      "created_at", "voided_at", "pdf_url",
    ])
    .where("tenant_id", "=", tenantId)
    .where("invoice_id", "=", invoiceId)
    .orderBy("created_at"));

  return rows;
}
