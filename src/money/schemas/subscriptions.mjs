// src/money/schemas/subscriptions.mjs — L1.1 (RECONCILE de-code, 27 Sep 2026): body schemas for the
// subscription write routes, keyed by the ROUTES row's `path` in src/routes/writes.mjs.
//
// ★ THE L1 RULE (respec/L1-money.md): a schema is the handler's destructured parameter list with a
//   TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules stay
//   in the handler); unknown keys are stripped (Zod's default); `tenantId`, `actorUserId`, `principal`
//   are never listed (the runner stamps them after the parse); a key the handler only passes through
//   is `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const SUBSCRIPTION_SCHEMAS = Object.freeze({
  // startClientSubscription — src/money/subscriptions.mjs:107
  "/api/money/subscriptions/start": z.object({
    planId: id.nullish(),
    appUserId: id.nullish(),
    contractId: id.nullish(),
    createdByDocumentId: id.nullish(),
    priceMinorOverride: z.number().nullish(),
    staffNote: z.string().nullish(),
  }),
  // pushSubscriptionToStripe — src/money/subscriptions.mjs:148
  "/api/money/subscriptions/stripe": z.object({
    subscriptionId: id.nullish(),
  }),
  // cancelClientSubscription — src/money/subscriptions.mjs:252
  "/api/money/subscriptions/stop": z.object({
    subscriptionId: id.nullish(),
    when: z.string().nullish(),
    reason: z.string().nullish(),
    feedback: z.string().nullish(),
    resumeOn: z.string().nullish(),
  }),
  // pauseClientSubscription — src/money/subscriptions.mjs:357 (the route forces byClient:false, so it is not read)
  "/api/money/subscriptions/pause": z.object({
    subscriptionId: id.nullish(),
    resumeOn: z.string().nullish(),
  }),
  // resumeClientSubscription — src/money/subscriptions.mjs:425
  "/api/money/subscriptions/resume": z.object({
    subscriptionId: id.nullish(),
  }),
  // requestCardUpdate — src/money/cardUpdate.mjs:32
  "/api/money/subscriptions/update-card": z.object({
    appUserId: id.nullish(),
    subscriptionId: id.nullish(),
    channel: z.string().nullish(),
    message: z.string().nullish(),
  }),
  // removeSubscriptionDiscount — src/money/subscriptions.mjs:559
  "/api/money/subscriptions/remove-discount": z.object({
    subscriptionId: id.nullish(),
  }),
});
