// src/routes/schemas/items.mjs — L1.5.items (RECONCILE de-code, 27 Sep 2026): body schemas for the
// items write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs, and the Stage 14 rows spread into it).
//
// ★ THE L1 RULE (specs/de-code/build/respec/L1-money.md): a schema is the handler's destructured parameter
//   list with a TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules
//   stay in the handler — frozen test/c_required_fields asserts the handler's own 422s); unknown keys are
//   stripped (Zod's default) EXCEPT on a row whose handler takes `...rest` (z.looseObject — they pass
//   through, as today); `tenantId`, `actorUserId`, `principal` are never listed (the runner stamps them
//   after the parse); a key the handler only passes through, or wraps in String(), is
//   `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const ITEM_SCHEMAS = Object.freeze({
  // createService — src/items/writes.mjs:229
  "/api/items/services": z.object({
    name: z.string().nullish(),
    durationMinutes: z.number().nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    bookable: z.boolean().nullish(),
    categoryId: id.nullish(),
    programId: id.nullish(),
    imageId: id.nullish(),
    colour: z.string().nullish(),
    sku: z.string().nullish(),
    invoiceWording: z.string().nullish(),
    addonOnly: z.boolean().nullish(),
    intakeFormId: id.nullish(),
    description: z.string().nullish(),
    internalNotes: z.string().nullish(),
    taxCode: z.string().nullish(),
    deliveryModes: z.array(z.string()).nullish(),
    capacity: z.number().nullish(),
    unitId: id.nullish(),
    hostIds: z.array(id).nullish(),
  }),
  // createPackage — src/items/writes.mjs:359
  "/api/items/packages": z.object({
    name: z.string().nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    installmentsAllowed: z.boolean().nullish(),
    lines: z.unknown().optional(),
    description: z.string().nullish(),
    imageId: id.nullish(),
    expiryMonths: z.number().nullish(),
    warnAtRemaining: z.number().nullish(),
    portalSellable: z.boolean().nullish(),
    publicSellable: z.boolean().nullish(),
    programId: id.nullish(),
    categoryId: id.nullish(),
  }),
  // createPlan — src/items/writes.mjs:466
  "/api/items/plans": z.object({
    name: z.string().nullish(),
    interval: z.string().nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    lines: z.unknown().optional(),
    rolloverMode: z.string().nullish(),
    rolloverCap: z.number().nullish(),
    description: z.string().nullish(),
    billingDay: z.number().nullish(),
    allowClientPause: z.boolean().nullish(),
    maxPausesPerYear: z.number().nullish(),
    maxPauseMonths: z.number().nullish(),
    dunningRetries: z.number().nullish(),
    dunningDays: z.number().nullish(),
    dunningPauseAfter: z.number().nullish(),
    programId: id.nullish(),
    categoryId: id.nullish(),
  }),
  // createPrice — src/items/writes.mjs:89
  "/api/items/prices": z.object({
    subjectType: z.string().nullish(),
    subjectId: id.nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    effectiveFrom: z.string().nullish(),
    tellRegulars: z.boolean().nullish(),
    locationId: id.nullish(),
    deliveryMode: z.string().nullish(),
  }),
  // setContractedPrice — src/items/writes.mjs:604
  "/api/items/contracted-prices": z.object({
    accountId: id.nullish(),
    appUserId: id.nullish(),
    subjectType: z.string().nullish(),
    subjectId: id.nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
  }),
  // createDiscount — src/items/writes.mjs:775
  "/api/items/coupons": z.object({
    name: z.string().nullish(),
    code: z.string().nullish(),
    kind: z.string().nullish(),
    percentBp: z.number().nullish(),
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    appliesTo: z.string().nullish(),
    coachMayApply: z.boolean().nullish(),
    maxRedemptions: z.number().nullish(),
    validFrom: z.string().nullish(),
    validTo: z.string().nullish(),
    descriptionClient: z.string().nullish(),
    maxDiscountMinor: z.number().nullish(),
    firstPurchaseOnly: z.boolean().nullish(),
    perPersonLimit: z.number().nullish(),
    targetIds: z.array(id).nullish(),
  }),
  // setDiscountActive — src/items/writes.mjs:892
  "/api/items/coupons/active": z.object({
    discountId: id.nullish(),
    active: z.boolean().nullish(),
  }),
  // addPromotionCode — src/items/writes.mjs:928
  "/api/items/promotion-codes": z.object({
    couponId: id.nullish(),
    code: z.string().nullish(),
  }),
  // deactivatePromotionCode — src/items/writes.mjs:975
  "/api/items/promotion-codes/deactivate": z.object({
    promotionCodeId: id.nullish(),
  }),
  // attachAgreementRequirement — src/items/writes.mjs:1011
  "/api/items/agreements": z.object({
    itemType: z.string().nullish(),
    itemId: id.nullish(),
    templateId: id.nullish(),
    firstBookingOnly: z.boolean().nullish(),
    holdUntilSigned: z.boolean().nullish(),
    teenTemplateId: id.nullish(),
  }),
  // detachAgreementRequirement — src/items/writes.mjs:1082
  "/api/items/agreements/detach": z.object({
    id: id.nullish(),
  }),
  // setItemActive — src/items/writes.mjs:1127
  "/api/items/active": z.object({
    itemType: z.string().nullish(),
    itemId: id.nullish(),
    active: z.boolean().nullish(),
  }),
  // createCategory — src/items/catalogue.mjs:83
  "/api/items/categories": z.object({
    name: z.string().nullish(),
    visibility: z.string().nullish(),
  }),
  // updateCategory — src/items/catalogue.mjs:124
  "/api/items/categories/update": z.object({
    id: id.nullish(),
    name: z.string().nullish(),
    visibility: z.string().nullish(),
    position: z.number().nullish(),
  }),
  // deleteCategory — src/items/catalogue.mjs:171
  "/api/items/categories/delete": z.object({
    id: id.nullish(),
  }),
  // createUnit — src/items/catalogue.mjs:246
  "/api/items/units": z.object({
    name: z.string().nullish(),
    plural: z.string().nullish(),
  }),
  // setUnitActive — src/items/catalogue.mjs:214
  "/api/items/units/active": z.object({
    id: id.nullish(),
    active: z.boolean().nullish(),
  }),
  // createModifier — src/items/modifiers.mjs:81
  "/api/items/modifiers": z.object({
    name: z.string().nullish(),
    priceDeltaMinor: z.number().nullish(),
    minutesDelta: z.number().nullish(),
    applies: z.unknown().optional(),
    serviceIds: z.array(id).nullish(),
    afterTime: z.string().nullish(),
  }),
  // updateModifier — src/items/modifiers.mjs:151
  "/api/items/modifiers/update": z.object({
    id: id.nullish(),
    name: z.string().nullish(),
    priceDeltaMinor: z.number().nullish(),
    minutesDelta: z.number().nullish(),
    applies: z.unknown().optional(),
    serviceIds: z.array(id).nullish(),
    afterTime: z.string().nullish(),
  }),
  // setModifierActive — src/items/modifiers.mjs:250
  "/api/items/modifiers/active": z.object({
    id: id.nullish(),
    active: z.boolean().nullish(),
  }),
  // quoteModifiers — src/items/modifiers.mjs:315
  "/api/items/modifiers/quote": z.object({
    serviceId: id.nullish(),
    modifierIds: z.array(id).nullish(),
    at: z.string().nullish(),
  }),
  // createOption — src/items/options.mjs:133
  "/api/items/options": z.object({
    question: z.string().nullish(),
    kind: z.string().nullish(),
    choices: z.unknown().optional(),
    required: z.boolean().nullish(),
    serviceIds: z.array(id).nullish(),
    showIf: z.unknown().optional(),
    feedsReports: z.boolean().nullish(),
  }),
  // updateOption — src/items/options.mjs:211
  "/api/items/options/update": z.object({
    id: id.nullish(),
    question: z.string().nullish(),
    kind: z.string().nullish(),
    choices: z.unknown().optional(),
    required: z.boolean().nullish(),
    serviceIds: z.array(id).nullish(),
    showIf: z.unknown().optional(),
    feedsReports: z.boolean().nullish(),
  }),
  // setOptionActive — src/items/options.mjs:276
  "/api/items/options/active": z.object({
    id: id.nullish(),
    active: z.boolean().nullish(),
  }),
  // uploadImage — src/items/images.mjs:54
  "/api/items/images": z.object({
    name: z.string().nullish(),
    dataBase64: z.string().nullish(),
    contentType: z.string().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
  }),
  // deleteImage — src/items/images.mjs:171
  "/api/items/images/delete": z.object({
    id: id.nullish(),
  }),
  // updateService — src/items/editors.mjs:241 (takes `...rest`: unknown keys PASS THROUGH — z.looseObject)
  "/api/items/services/update": z.looseObject({
    id: id.nullish(),
    expectedUpdatedAt: z.string().nullish(),
  }),
  // updatePackage — src/items/editors.mjs:250 (takes `...rest`: unknown keys PASS THROUGH — z.looseObject)
  "/api/items/packages/update": z.looseObject({
    id: id.nullish(),
    expectedUpdatedAt: z.string().nullish(),
  }),
  // updatePlan — src/items/editors.mjs:259 (takes `...rest`: unknown keys PASS THROUGH — z.looseObject)
  "/api/items/plans/update": z.looseObject({
    id: id.nullish(),
    expectedUpdatedAt: z.string().nullish(),
  }),
  // updateDiscount — src/items/editors.mjs:268 (takes `...rest`: unknown keys PASS THROUGH — z.looseObject)
  "/api/items/coupons/update": z.looseObject({
    id: id.nullish(),
    expectedUpdatedAt: z.string().nullish(),
  }),
  // duplicateService — src/items/editors.mjs:282
  "/api/items/services/duplicate": z.object({
    id: id.nullish(),
  }),
  // setRule — src/items/loyalty.mjs:212
  "/api/items/loyalty/rules": z.object({
    kind: z.string().nullish(),
    points: z.number().nullish(),
    active: z.boolean().nullish(),
  }),
  // createReward — src/items/loyalty.mjs:239
  "/api/items/loyalty/rewards": z.object({
    name: z.string().nullish(),
    pointsCost: z.number().nullish(),
  }),
  // updateReward — src/items/loyalty.mjs:259
  "/api/items/loyalty/rewards/update": z.object({
    id: id.nullish(),
    name: z.string().nullish(),
    pointsCost: z.number().nullish(),
    active: z.boolean().nullish(),
  }),
  // tellPerson — src/items/loyalty.mjs:362
  "/api/items/loyalty/tell": z.object({
    appUserId: id.nullish(),
  }),
  // tellAllClaimable — src/items/loyalty.mjs:423
  "/api/items/loyalty/tell-all": z.object({}),
  // issueGiftCard — src/items/giftCards.mjs:132
  "/api/items/gift-cards": z.object({
    amountMinor: z.number().nullish(),
    currency: z.string().nullish(),
    holderEmail: z.string().nullish(),
    buyerUserId: id.nullish(),
  }),
  // voidGiftCard — src/items/giftCards.mjs:213
  "/api/items/gift-cards/void": z.object({
    id: id.nullish(),
  }),
  // resendGiftCard — src/items/giftCards.mjs:298
  "/api/items/gift-cards/resend": z.object({
    id: id.nullish(),
  }),
  // nudgeGiftCard — src/items/giftCards.mjs:332
  "/api/items/gift-cards/nudge": z.object({
    id: id.nullish(),
  }),
});
