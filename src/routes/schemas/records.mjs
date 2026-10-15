// src/routes/schemas/records.mjs — L1.5.records (RECONCILE de-code, 27 Sep 2026): body schemas for the
// records write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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

export const RECORD_SCHEMAS = Object.freeze({
  // archiveRecord — src/records/archive.mjs:174
  "/api/records/archive": z.object({
    object: z.string().nullish(),
    id: id.nullish(),
    reason: z.string().nullish(),
  }),
  // restoreRecord — src/records/archive.mjs:330
  "/api/records/restore": z.object({
    object: z.string().nullish(),
    id: id.nullish(),
  }),
  // deleteRecord — src/records/delete.mjs (the shared Delete; `confirm:false` returns the plan the dialog shows)
  "/api/records/delete": z.object({
    object: z.string().nullish(),
    id: id.nullish(),
    confirm: z.boolean().nullish(),
    reason: z.string().nullish(),
    options: z.object({ deleteStripeCustomer: z.boolean().nullish() }).nullish(),
  }),
  // bulkRecords — src/records/bulk.mjs (§13.3: one request, each id independent; delete without `confirm` returns the aggregated plan)
  "/api/records/bulk": z.object({
    action: z.enum(["delete", "archive", "restore"]).nullish(),
    object: z.string().nullish(),
    ids: z.array(id).nullish(),
    confirm: z.boolean().nullish(),
    reason: z.string().nullish(),
    options: z.object({ deleteStripeCustomer: z.boolean().nullish() }).nullish(),
  }),
  // setCustomFieldValue — src/fields/custom.mjs:128
  "/api/records/custom-field-value": z.object({
    fieldId: id.nullish(),
    recordId: id.nullish(),
    value: z.unknown().optional(),
    actorId: id.nullish(),
  }),
});
