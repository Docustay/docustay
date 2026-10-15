// Stage 15 Task 15.17 — public invoice view and recording

import { emit } from "../events/outbox.mjs";

/**
 * Record a view of an invoice by a payer.
 *
 * Updates the invoice's view_count and viewed_at, and emits a `money.invoice.viewed` event
 * with the NEW view_count. Each real view counts — this is not idempotent by design.
 *
 * @param {object} tx a tenant transaction (viewer is set by the caller)
 * @param {object} params { tenantId, invoiceId }
 * @returns {Promise<void>}
 */
export async function recordInvoiceView(tx, { tenantId, invoiceId }) {
  const { rows } = await tx.query(
    `UPDATE keystone.invoice
      SET view_count = view_count + 1, viewed_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING view_count`,
    [tenantId, invoiceId]);

  if (rows.length === 0) return;

  const newViewCount = rows[0].view_count;

  await emit(tx, {
    tenantId,
    topic: "money.invoice.viewed",
    emittedBy: "money",
    subjectType: "invoice",
    subjectId: invoiceId,
    actor: "worker",
    payload: {
      invoice_id: invoiceId,
      view_count: newViewCount,
    },
  });
}

/**
 * Fetch an invoice's public view data.
 *
 * Returns the invoice details suitable for public display, including line items and
 * payment state. Both the invoice and its line items are read under the caller's
 * viewer context (set before calling this function).
 *
 * @param {object} tx a tenant transaction (viewer is set by the caller)
 * @param {object} params { tenantId, invoiceId }
 * @returns {Promise<object>} invoice view object with state and payUrl
 */
export async function publicInvoiceView(tx, { tenantId, invoiceId }) {
  // ★ Fetch the invoice with all columns needed for state decision and display
  const { rows: invoiceRows } = await tx.query(
    `SELECT id, invoice_number, title, amount_minor, paid_minor, currency AS currency_code,
            due_at, status, hosted_invoice_url
       FROM keystone.invoice
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, invoiceId]);

  if (invoiceRows.length === 0) {
    return null;
  }

  const invoice = invoiceRows[0];

  // ★ Fetch the practice name for display
  const { rows: practiceRows } = await tx.query(
    `SELECT name FROM keystone.tenant WHERE id = $1`,
    [tenantId]);

  const practiceName = practiceRows.length > 0 ? practiceRows[0].name : "";

  // ★ Fetch active line items (not deleted)
  const { rows: lineItems } = await tx.query(
    // ★ real columns; a removed line is status 'void' (there is no deleted_at)
    `SELECT name_snapshot AS name, quantity AS qty, unit_amount_minor AS each_minor,
            (unit_amount_minor * quantity - COALESCE(discount_minor, 0)) AS total_minor
       FROM keystone.line_item
      WHERE tenant_id = $1 AND invoice_id = $2 AND status <> 'void'
      ORDER BY position NULLS LAST, created_at`,
    [tenantId, invoiceId]);

  // ★ Determine the invoice state based on status, payment, and hosted_invoice_url
  let state;
  if (invoice.status === 'void') {
    state = 'void';
  } else if (invoice.paid_minor >= invoice.amount_minor) {
    state = 'paid';
  } else if (invoice.hosted_invoice_url && invoice.status === 'open') {
    state = 'payable';
  } else {
    state = 'not_online';
  }

  const notOnlineSentence = "This invoice can't be paid online yet — the practice will tell you how to pay.";

  return {
    practiceName,
    invoiceNumber: invoice.invoice_number,
    title: invoice.title,
    lines: lineItems.map((line) => ({
      name: line.name,
      qty: line.qty,
      each: line.each_minor,
      total: line.total_minor,
    })),
    amountMinor: invoice.amount_minor,
    paidMinor: invoice.paid_minor,
    currency: invoice.currency_code,
    dueAt: invoice.due_at,
    state,
    payUrl: invoice.hosted_invoice_url || null,
    notOnlineSentence,
  };
}
