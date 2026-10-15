// src/money/schemas/payments.mjs — L1.2 (RECONCILE de-code, 27 Sep 2026): body schemas for the
// payment, refund, credit, credit-note, payment-method and tax-id write routes, keyed by the ROUTES
// row's `path` in src/routes/writes.mjs.
//
// ★ THE L1 RULE (respec/L1-money.md): a schema is the handler's destructured parameter list with a
//   TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules stay
//   in the handler); unknown keys are stripped (Zod's default); `tenantId`, `actorUserId`, `principal`
//   are never listed (the runner stamps them after the parse); a key the handler only passes through
//   is `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const PAYMENT_SCHEMAS = Object.freeze({
  // createPaymentMethod — src/money/writes.mjs:336 (providerPaymentMethodId is Stripe's pm_… id, not ours)
  "/api/money/payment-methods": z.object({
    appUserId: id.nullish(),
    providerPaymentMethodId: z.string().nullish(),
    lastFour: z.string().nullish(),
    brand: z.string().nullish(),
    isDefault: z.boolean().nullish(),
  }),
  // createEntitlement — src/money/writes.mjs:395
  "/api/money/entitlements": z.object({
    ownerUserId: id.nullish(),
    serviceId: id.nullish(),
    totalCredits: z.number().nullish(),
    lineItemId: id.nullish(),
    expiresAt: z.string().nullish(),
    packageId: id.nullish(),
  }),
  // inline: body.invoiceId ? markPaidInvoice (src/money/invoiceActions.mjs:39)
  //                        : recordManualPayment (src/money/payments.mjs:296) — both handlers' keys
  "/api/money/payments/record": z.object({
    invoiceId: id.nullish(),
    method: z.string().nullish(),
    note: z.string().nullish(),
    payerUserId: id.nullish(),
    amountMinor: z.number().nullish(),
    receivedAt: z.string().nullish(),
    sendReceipt: z.boolean().nullish(),
  }),
  // attachPaymentToInvoice — src/money/invoiceActions.mjs:373 (stripePaymentIntentId is Stripe's pi_… id)
  "/api/money/payments/attach": z.object({
    invoiceId: id.nullish(),
    stripePaymentIntentId: z.string().nullish(),
  }),
  // requestRefund — src/money/refunds.mjs:84 (amount is minor units, compared as a number at :114)
  "/api/money/refund": z.object({
    paymentId: id.nullish(),
    amount: z.number().nullish(),
    reason: z.string().nullish(),
    receiptLine: z.string().nullish(),
    returnCredit: z.boolean().nullish(),
  }),
  // approveRefundRequest — src/money/refunds.mjs:352
  "/api/money/refund/approve": z.object({
    requestId: id.nullish(),
  }),
  // declineRefundRequest — src/money/refunds.mjs:429
  "/api/money/refund/decline": z.object({
    requestId: id.nullish(),
  }),
  // cancelRefund — src/money/refunds.mjs:477
  "/api/money/refunds/cancel": z.object({
    refundId: id.nullish(),
  }),
  // detachPaymentMethod — src/money/cardUpdate.mjs:307 ("the payment_method row id", :301)
  "/api/money/payment-methods/detach": z.object({
    paymentMethodId: id.nullish(),
  }),
  // createFinancialConnectionsSession — src/money/financialConnections.mjs:19
  "/api/money/bank-verify-session": z.object({
    personId: id.nullish(),
  }),
  // adjustCredit — src/money/customerCredit.mjs:29
  "/api/money/credits/adjust": z.object({
    subjectType: z.string().nullish(),
    subjectId: id.nullish(),
    amountMinor: z.number().nullish(),
    note: z.string().nullish(),
  }),
  // issueCreditNote — src/money/creditNotes.mjs:49 (each line is checked by the handler, :142-:201)
  "/api/money/credit-notes/issue": z.object({
    invoiceId: id.nullish(),
    lines: z.array(z.unknown()).nullish(),
    reason: z.string().nullish(),
    destination: z.string().nullish(),
    memo: z.string().nullish(),
  }),
  // voidCreditNote — src/money/creditNotes.mjs:350
  "/api/money/credit-notes/void": z.object({
    creditNoteId: id.nullish(),
  }),
  // createTaxId — src/money/taxIds.mjs:107
  "/api/tax-ids": z.object({
    subjectType: z.string().nullish(),
    subjectId: id.nullish(),
    type: z.string().nullish(),
    value: z.string().nullish(),
  }),
  // updateTaxId — src/money/taxIds.mjs:234
  "/api/tax-ids/update": z.object({
    taxIdId: id.nullish(),
    type: z.string().nullish(),
    value: z.string().nullish(),
  }),
  // deleteTaxId — src/money/taxIds.mjs:343
  "/api/tax-ids/delete": z.object({
    taxIdId: id.nullish(),
  }),
});
