// src/routes/schemas/accounts.mjs — L1.5.accounts (RECONCILE de-code, 27 Sep 2026): body schemas for the
// accounts write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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

export const ACCOUNT_SCHEMAS = Object.freeze({
  // createAccount — src/accounts/writes.mjs:44
  "/api/accounts": z.object({
    name: z.string().nullish(),
    status: z.string().nullish(),
    customerTenantId: id.nullish(),
    accountNumber: z.string().nullish(),
    parentAccountId: id.nullish(),
    accountType: z.string().nullish(),
    industry: z.string().nullish(),
    primaryContactId: id.nullish(),
    phone: z.string().nullish(),
    email: z.string().nullish(),
    website: z.string().nullish(),
    billingLine1: z.string().nullish(),
    billingLine2: z.string().nullish(),
    billingCity: z.string().nullish(),
    billingStateRegion: z.string().nullish(),
    billingPostcode: z.string().nullish(),
    billingCountry: z.string().nullish(),
    employeeCount: z.number().nullish(),
    description: z.string().nullish(),
    source: z.string().nullish(),
    tags: z.unknown().optional(),
    ownerUserId: id.nullish(),
  }),
  // updateAccount — src/accounts/writes.mjs:189
  "/api/accounts/update": z.object({
    accountId: id.nullish(),
    name: z.string().nullish(),
    status: z.string().nullish(),
  }),
  // createAccountPipeline — src/accounts/writes.mjs:232
  "/api/accounts/pipeline": z.object({
    accountId: id.nullish(),
    kind: z.string().nullish(),
    stage: z.string().nullish(),
    cadence: z.string().nullish(),
    provisioningRunId: id.nullish(),
    state: z.string().nullish(),
  }),
  // advanceStage — src/accounts/writes.mjs:308
  "/api/accounts/pipeline/advance": z.object({
    pipelineId: id.nullish(),
    stage: z.string().nullish(),
  }),
  // pauseScheduleItems — src/run/schedule.mjs:199
  "/api/accounts/run/pause": z.object({
    accountId: id.nullish(),
    service: z.string().nullish(),
  }),
  // resumeScheduleItems — src/run/schedule.mjs:225
  "/api/accounts/run/resume": z.object({
    accountId: id.nullish(),
    service: z.string().nullish(),
  }),
});
