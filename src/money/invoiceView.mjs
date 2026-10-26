// src/money/invoiceView.mjs
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ONE VIEW-MODEL, BUILT FROM PLATFORM'S OWN DATA — never from a live Stripe object. the maintainer's
//     ruling (specs/INVOICE-SEND-FIX.md §1): "Editing = the platform only... nothing touches Stripe
//     while editing", and this is the one builder used by the editor's PDF/Email/Payment-page
//     tabs, the server PDF attached to the invoice-issued email, and the public PDF download route
//     — so the preview a staff member sees editing a draft, the PDF Stripe never sees until Send,
//     and the PDF a client downloads are always the exact same render of the exact same data.
//
// ★★ Totals are computed HERE, from the active line items passed in — never read back from a
//     cached column (`keystone.invoice.subtotal_minor` etc. can drift if a caller forgets to
//     recompute; summing the lines directly cannot). `amountPaid`/`amountDue` ARE read from the
//     invoice row (`paid_minor`, `amount_remaining_minor`) because those reflect real payments,
//     which this module has no other way to know about.
//
// ★ The previous version of this file (Part 3 rebuild, 1 Oct 2026) built from a retrieved Stripe
//   invoice object instead. Removed per the same ruling — see specs/INVOICE-SEND-FIX.md for the
//   full reasoning (the due-date mismatch and "Send just saves" symptoms both trace back to that
//   design: two independently-fetched sources of the same invoice, racing).
//
// ★ PLAIN `Error`, NEVER `../http/errors.mjs` — that module pulls in `node:crypto`, which would
//   make this file unimportable from the browser. Same reason invoicePdf.mjs (this directory)
//   stays dependency-free: `InvoiceEditor.jsx` imports this file DIRECTLY, via the pre-existing
//   `@keystone` alias, so the editor's preview is this exact function, not a re-implementation of
//   it kept in sync by hand.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { z } from "zod";

function invalid(message) {
  return new Error(message);
}

const InvoiceLineViewSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitAmount: z.number(), // minor units
  amount: z.number(),
});

export const InvoiceViewSchema = z.object({
  invoiceNumber: z.string(),
  status: z.enum(["draft", "open", "paid", "uncollectible", "void"]),
  currency: z.string(),
  issueDate: z.string(), // ISO 8601 — invoice.issued_at once sent, else now() for a draft preview
  dueDate: z.string().nullable(),
  practice: z.object({
    name: z.string(),
    logoUrl: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  customer: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  lines: z.array(InvoiceLineViewSchema),
  subtotal: z.number(),
  discountTotal: z.number(),
  taxTotal: z.number(),
  total: z.number(),
  amountDue: z.number(),
  amountPaid: z.number(),
  footer: z.string().nullable(),
  customFields: z.array(z.object({ name: z.string(), value: z.string() })).max(4),
  memo: z.string().nullable(),
  hostedInvoiceUrl: z.string().nullable(), // null pre-send; Stripe's own URL once set at Send
});

/**
 * ★ Build the one view-model from the platform's own rows.
 *
 * @param options {
 *   invoice: the keystone.invoice row — needs at least status, currency, invoice_number, due_at,
 *     issued_at, custom_fields, rendering, memo, hosted_invoice_url, paid_minor,
 *     amount_remaining_minor,
 *   lines: active keystone.line_item rows — name_snapshot, unit_amount_minor, quantity,
 *     discount_minor, tax_minor,
 *   payer: { display_name, email } or null,
 *   practiceBranding: { name, logoUrl, phone },
 *   invoicePrefix: the practice's invoice-number prefix setting, or null/empty — OURS wins, never
 *     Stripe's own `number`.
 * }
 * @returns {object} validated against InvoiceViewSchema
 */
export function buildInvoiceView({ invoice, lines, payer, practiceBranding, invoicePrefix = null } = {}) {
  if (!invoice) throw invalid("buildInvoiceView requires an invoice");
  if (!Array.isArray(lines)) throw invalid("buildInvoiceView requires an array of lines");

  const lineViews = lines.map((l) => {
    const unitAmount = l.unit_amount_minor ?? 0;
    const quantity = l.quantity ?? 1;
    const amount = Math.round(unitAmount * quantity - (l.discount_minor ?? 0) + (l.tax_minor ?? 0));
    return {
      description: l.name_snapshot ?? "",
      quantity,
      unitAmount,
      amount,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + (l.unit_amount_minor ?? 0) * (l.quantity ?? 1), 0);
  const discountTotal = lines.reduce((sum, l) => sum + (l.discount_minor ?? 0), 0);
  const taxTotal = lines.reduce((sum, l) => sum + (l.tax_minor ?? 0), 0);
  const total = subtotal - discountTotal + taxTotal;

  // ★ Pre-send (draft preview), nothing has been paid and nothing is "remaining" yet — amountDue
  //   is simply the total. Once sent, `amount_remaining_minor` is the real mirror of what Stripe
  //   (and any webhook-reported payment) says is still owed; fall back to total-minus-paid only if
  //   that mirror was never set (shouldn't happen post-send, but never divide by an absent column).
  const amountPaid = invoice.paid_minor ?? 0;
  const amountDue = invoice.status === "draft"
    ? total
    : (invoice.amount_remaining_minor ?? Math.max(0, total - amountPaid));

  const fullInvoiceNumber = invoicePrefix
    ? `${invoicePrefix}${invoice.invoice_number ?? ""}`
    : (invoice.invoice_number || "DRAFT");

  const rendering = invoice.rendering && typeof invoice.rendering === "object" ? invoice.rendering : {};
  // ★ F817 (carried forward) — custom_fields defaults to a jsonb OBJECT ('{}'), never trust it as
  //   an array without checking.
  const customFields = (Array.isArray(invoice.custom_fields) ? invoice.custom_fields : [])
    .filter((f) => f && f.name)
    .slice(0, 4)
    .map((f) => ({ name: f.name, value: f.value ?? "" }));

  const view = {
    invoiceNumber: fullInvoiceNumber,
    status: invoice.status ?? "draft",
    currency: (invoice.currency || "usd").toLowerCase(),
    issueDate: new Date(invoice.issued_at ?? Date.now()).toISOString(),
    dueDate: invoice.due_at ? new Date(invoice.due_at).toISOString() : null,
    practice: {
      name: practiceBranding?.name ?? "",
      logoUrl: practiceBranding?.logoUrl ?? null,
      phone: practiceBranding?.phone ?? null,
    },
    customer: {
      name: payer?.display_name ?? null,
      email: payer?.email ?? null,
    },
    lines: lineViews,
    subtotal,
    discountTotal,
    taxTotal,
    total,
    amountDue,
    amountPaid,
    footer: rendering.footer ?? null,
    customFields,
    memo: invoice.memo ?? null,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
  };

  return InvoiceViewSchema.parse(view);
}
