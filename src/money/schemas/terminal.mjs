// src/money/schemas/terminal.mjs — L1.3 (RECONCILE de-code, 27 Sep 2026): body schemas for the
// terminal, tap-to-pay, device and Stripe component-session write routes, keyed by the ROUTES row's
// `path` in src/routes/writes.mjs. readerId / paymentIntentId / chargeId / locationId are STRIPE ids
// (tmr_…, pi_…, ch_…, tml_…) — strings, not our uuids.
//
// ★ THE L1 RULE (respec/L1-money.md): a schema is the handler's destructured parameter list with a
//   TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules stay
//   in the handler); unknown keys are stripped (Zod's default); `tenantId`, `actorUserId`, `principal`
//   are never listed (the runner stamps them after the parse); a key the handler only passes through
//   is `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const TERMINAL_SCHEMAS = Object.freeze({
  // createTerminalIntent — src/money/terminal.mjs:39
  "/api/money/terminal/intent": z.object({
    payerUserId: id.nullish(),
    invoiceId: id.nullish(),
    amountMinor: z.number().nullish(),
    description: z.string().nullish(),
    saveCard: z.boolean().nullish(),
    saveCardConsent: z.boolean().nullish(),
    requestKey: z.string().nullish(),
  }),
  // processPaymentIntent — src/money/terminal.mjs:112
  "/api/money/terminal/process": z.object({
    readerId: z.string().nullish(),
    paymentIntentId: z.string().nullish(),
    amountMinor: z.number().nullish(),
    requestKey: z.string().nullish(),
  }),
  // cancelAction — src/money/terminal.mjs:161
  "/api/money/terminal/cancel": z.object({
    readerId: z.string().nullish(),
    requestKey: z.string().nullish(),
  }),
  // setReaderDisplay — src/money/terminal.mjs:208
  "/api/money/terminal/display": z.object({
    readerId: z.string().nullish(),
    displayType: z.string().nullish(),
    displayText: z.string().nullish(),
    requestKey: z.string().nullish(),
  }),
  // refundPayment — src/money/terminal.mjs:263
  "/api/money/terminal/refund": z.object({
    chargeId: z.string().nullish(),
    amountMinor: z.number().nullish(),
    reason: z.string().nullish(),
    requestKey: z.string().nullish(),
  }),
  // activateTapToPay — src/money/tapToPay.mjs:37
  "/api/money/tap/activate": z.object({
    deviceName: z.string().nullish(),
  }),
  // createConnectionToken — src/money/tapToPay.mjs:82 (reads tenantId only)
  "/api/money/tap/connection-token": z.object({}),
  // createTapIntent — src/money/tapToPay.mjs:118
  "/api/money/tap/intent": z.object({
    invoiceId: id.nullish(),
    amountMinor: z.number().nullish(),
  }),
  // registerReader — src/money/devices.mjs:107
  "/api/money/devices/register": z.object({
    registrationCode: z.string().nullish(),
    name: z.string().nullish(),
    locationId: z.string().nullish(),
  }),
  // deactivateDevice — src/money/devices.mjs:193
  "/api/money/devices/deactivate": z.object({
    deviceId: id.nullish(),
  }),
  // renameDevice — src/money/devices.mjs:244
  "/api/money/devices/rename": z.object({
    deviceId: id.nullish(),
    name: z.string().nullish(),
  }),
  // createComponentSession — src/money/stripeComponents.mjs:48
  "/api/money/stripe/component-session": z.object({
    surface: z.string().nullish(),
  }),
});
