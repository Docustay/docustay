// src/routes/schemas/platform.mjs — L1.5.platform (RECONCILE de-code, 27 Sep 2026): body schemas for the
// platform write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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
// keystone_meta.job_failure.id is a bigint, never a GUID: a give-up's ledger id travels as a number or a digit string.
// (Using the GUID schema refused every Retry now / Give up from the Platform Jobs screen with "Invalid GUID".)
const failureLedgerId = z.union([z.number().int().positive(), z.string().regex(/^[1-9][0-9]{0,17}$/)]);

export const PLATFORM_SCHEMAS = Object.freeze({
  // advanceProvisioningRun — src/provisioning/advance.mjs:290
  "/api/platform/provisioning/advance": z.object({
    runId: id.nullish(),
  }),
  // retryJobNow — src/platform/jobActions.mjs:186
  "/api/jobs/retry": z.object({
    failureId: failureLedgerId.nullish(),
    repeatCount: z.number().nullish(),
    lastSeenAt: z.string().nullish(),
  }),
  // giveUpJobFailure — src/platform/jobActions.mjs:285
  "/api/jobs/give-up": z.object({
    failureId: failureLedgerId.nullish(),
    reason: z.string().nullish(),
    repeatCount: z.number().nullish(),
    lastSeenAt: z.string().nullish(),
  }),
  // recordCompetitorWatchForTenant — src/run/competitorWatch.mjs:98
  "/api/platform/run/competitor-watch": z.object({
    competitorName: z.string().nullish(),
    kind: z.string().nullish(),
    note: z.string().nullish(),
    enteredBy: z.string().nullish(),
  }),
});
