// src/money/schemas/invoices.mjs — L1.0 (RECONCILE de-code, 27 Sep 2026): the body schemas for the
// invoice write routes. Keyed by the ROUTES row's `path` in src/routes/writes.mjs.
//
// ★ THE L1 RULE (respec/L1-money.md): a schema is the handler's destructured parameter list with a
//   TYPE on each key, and NOTHING MORE.
//   · Every key is `.nullish()` — required-ness and value rules (non-negative, allowed statuses, 5–22
//     characters…) stay in the handler, which already refuses with its own message. A schema that
//     made a key required would change which error a caller gets, not whether it gets one.
//   · Unknown keys are STRIPPED (Zod's default) — exactly what the handler's destructuring already
//     did with them, so no body that works today stops working because of an extra key.
//   · `tenantId`, `actorUserId` and `principal` are NOT listed: the runner stamps them AFTER this
//     parse, from the session, never from the body.
//   · A key the handler only JSON-stringifies is `z.unknown().optional()` — ★ never a bare
//     `z.unknown()`: in Zod 4 that key is REQUIRED ("expected nonoptional", measured 27 Sep).
import { z } from "zod";

const id = z.guid();

export const INVOICE_SCHEMAS = Object.freeze({
  // createInvoice — src/money/writes.mjs:595 (the route forces status:"draft", so `status` is not read)
  "/api/money/invoices": z.object({
    payerUserId: id.nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    subtotalMinor: z.number().nullish(),
    taxMinor: z.number().nullish(),
    discountMinor: z.number().nullish(),
    memo: z.string().nullish(),
    billingLine1: z.string().nullish(),
    billingLine2: z.string().nullish(),
    billingCity: z.string().nullish(),
    billingStateRegion: z.string().nullish(),
    billingPostcode: z.string().nullish(),
    billingCountry: z.string().nullish(),
    paymentTermsDays: z.number().nullish(),
    title: z.string().nullish(),
    message: z.string().nullish(),
    source: z.string().nullish(),
    reminderDays: z.array(z.number()).nullish(),
    saveCardOffered: z.boolean().nullish(),
    customFields: z.unknown().optional(),
  }),
  // createLineItem — src/money/writes.mjs:127
  "/api/money/line-items": z.object({
    parentType: z.string().nullish(),
    parentId: id.nullish(),
    sourceType: z.string().nullish(),
    sourceId: id.nullish(),
    nameSnapshot: z.string().nullish(),
    unitAmountMinor: z.number().nullish(),
    quantity: z.number().nullish(),
    discountMinor: z.number().nullish(),
    taxMinor: z.number().nullish(),
    currency: z.string().nullish(),
    priceId: id.nullish(),
    contractedPriceId: id.nullish(),
    unit: z.string().nullish(),
    bookingId: id.nullish(),
  }),
  // updateInvoiceDraft — src/money/invoices.mjs:26
  "/api/money/invoices/update": z.object({
    invoiceId: id.nullish(),
    expectedUpdatedAt: z.string().nullish(),
    title: z.string().nullish(),
    message: z.string().nullish(),
    dueAt: z.string().nullish(),
    payerUserId: id.nullish(),
    reminderDays: z.array(z.number()).nullish(),
    customFields: z.unknown().optional(),
    collectionMethod: z.string().nullish(),
    paymentMethodTypes: z.unknown().optional(),
    statementDescriptor: z.string().nullish(),
    footer: z.unknown().optional(),
    rendering_page_size: z.unknown().optional(),
    rendering_template_id: z.unknown().optional(),
    remindersEnabled: z.boolean().nullish(),
  }),
  // updateLineItem — src/money/writes.mjs
  "/api/money/line-items/update": z.object({
    lineItemId: id.nullish(),
    invoiceId: id.nullish(),
    nameSnapshot: z.string().nullish(),
    unitAmountMinor: z.number().nullish(),
    quantity: z.number().nullish(),
    discountMinor: z.number().nullish(),
    taxMinor: z.number().nullish(),
  }),
  // voidLineItem — src/money/writes.mjs
  "/api/money/line-items/void": z.object({
    lineItemId: id.nullish(),
    invoiceId: id.nullish(),
  }),
  // setLinePositions — src/money/invoices.mjs:146
  "/api/money/invoices/lines/order": z.object({
    invoiceId: id.nullish(),
    orderedLineIds: z.array(id).nullish(),
  }),
  // recomputeDraftTotals — src/money/invoices.mjs:165
  "/api/money/invoices/recompute": z.object({
    invoiceId: id.nullish(),
  }),
  // sendInvoice — src/money/invoiceSend.mjs:35
  "/api/money/invoices/send": z.object({
    invoiceId: id.nullish(),
  }),
  // voidInvoice — src/money/invoices.mjs:229
  "/api/money/invoices/void": z.object({
    invoiceId: id.nullish(),
    reason: z.string().nullish(),
  }),
  // toggleInvoiceReminders — src/money/reminders.mjs:130
  "/api/money/invoices/reminders/toggle": z.object({
    invoiceId: id.nullish(),
    enabled: z.boolean().nullish(),
  }),
  // markPaidInvoice — src/money/invoiceActions.mjs:39
  "/api/money/invoices/mark-paid": z.object({
    invoiceId: id.nullish(),
    method: z.string().nullish(),
    note: z.string().nullish(),
  }),
  // markUncollectibleInvoice — src/money/invoiceActions.mjs:142
  "/api/money/invoices/mark-uncollectible": z.object({
    invoiceId: id.nullish(),
    reason: z.string().nullish(),
  }),
  // duplicateInvoice — src/money/invoiceActions.mjs:235
  "/api/money/invoices/duplicate": z.object({
    invoiceId: id.nullish(),
  }),
  // deleteDraftInvoice — src/money/invoiceActions.mjs:466
  "/api/money/invoices/delete-draft": z.object({
    invoiceId: id.nullish(),
  }),
});
