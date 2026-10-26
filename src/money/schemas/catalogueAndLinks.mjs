// src/money/schemas/catalogueAndLinks.mjs — L1.4 (RECONCILE de-code, 27 Sep 2026): body schemas for
// the payment-link, coupon, estimate, payment-plan, dispute and fraud write routes, keyed by the
// ROUTES row's `path` in src/routes/writes.mjs. reviewId is Stripe's prv_… id — a string.
//
// ★ THE L1 RULE (respec/L1-money.md): a schema is the handler's destructured parameter list with a
//   TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules stay
//   in the handler); unknown keys are stripped (Zod's default); `tenantId`, `actorUserId`, `principal`
//   are never listed (the runner stamps them after the parse); a key the handler only passes through
//   is `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const CATALOGUE_AND_LINK_SCHEMAS = Object.freeze({
  // createPaymentLink — src/money/paymentLinks.mjs:81
  "/api/money/payment-links": z.object({
    title: z.string().nullish(),
    variant: z.string().nullish(),
    amountMinor: z.number().nullish(),
    minAmountMinor: z.number().nullish(),
    documentTemplateId: id.nullish(),
    serviceId: id.nullish(),
  }),
  // deactivatePaymentLink — src/money/paymentLinks.mjs:270
  "/api/money/payment-links/deactivate": z.object({
    paymentLinkId: id.nullish(),
  }),
  // applyPersonCoupon — src/money/discountApply.mjs:22 (couponId: see BUILD-FINDINGS 27 Sep — the
  // client sends it only in the path, which the runner does not copy; this schema neither adds nor hides that)
  "/api/money/coupons/:couponId/apply-to-person": z.object({
    userId: id.nullish(),
    couponId: id.nullish(),
  }),
  // removePersonCoupon — src/money/discountApply.mjs:48
  "/api/money/coupons/:couponId/remove-from-person": z.object({
    userId: id.nullish(),
  }),
  // createEstimate — src/money/estimates.mjs:85
  "/api/money/estimates": z.object({
    recipientUserId: id.nullish(),
    title: z.string().nullish(),
    message: z.string().nullish(),
    goodForDays: z.number().nullish(),
    onAcceptInvoice: z.boolean().nullish(),
    onAcceptRecord: z.boolean().nullish(),
    documentTemplateId: id.nullish(),
  }),
  // updateEstimateDraft — src/money/estimates.mjs:120
  "/api/money/estimates/update": z.object({
    estimateId: id.nullish(),
    expectedUpdatedAt: z.string().nullish(),
    title: z.string().nullish(),
    message: z.string().nullish(),
    goodForDays: z.number().nullish(),
    onAcceptInvoice: z.boolean().nullish(),
    onAcceptRecord: z.boolean().nullish(),
    documentTemplateId: id.nullish(),
  }),
  // sendEstimate — src/money/estimates.mjs:228
  "/api/money/estimates/send": z.object({
    estimateId: id.nullish(),
  }),
  // cancelEstimate — src/money/estimates.mjs:807
  "/api/money/estimates/cancel": z.object({
    estimateId: id.nullish(),
  }),
  // offerPaymentPlan — src/money/paymentPlans.mjs:116 (firstDueOn is YYYY-MM-DD, :69)
  "/api/money/payment-plans/offer": z.object({
    invoiceId: id.nullish(),
    installments: z.number().nullish(),
    frequency: z.string().nullish(),
    firstDueOn: z.string().nullish(),
  }),
  // agreePaymentPlan — src/money/paymentPlans.mjs:208
  "/api/money/payment-plans/agree": z.object({
    planId: id.nullish(),
    agreementDocumentId: id.nullish(),
  }),
  // cancelPaymentPlan — src/money/paymentPlans.mjs:536
  "/api/money/payment-plans/cancel": z.object({
    planId: id.nullish(),
  }),
  // stageDisputeEvidence — src/money/disputes.mjs:318
  "/api/money/disputes/evidence": z.object({
    disputeId: id.nullish(),
    extraText: z.string().nullish(),
  }),
  // acceptDispute — src/money/disputes.mjs:405
  "/api/money/disputes/accept": z.object({
    disputeId: id.nullish(),
  }),
  // closeDispute — src/money/disputes.mjs:494
  "/api/money/disputes/close": z.object({
    disputeId: id.nullish(),
    confirmationText: z.string().nullish(),
  }),
  // approveFraudReview — src/money/fraud.mjs:28
  "/api/money/fraud/approve": z.object({
    reviewId: z.string().nullish(),
  }),
});
