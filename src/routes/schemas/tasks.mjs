// src/routes/schemas/tasks.mjs — L1.5.tasks (RECONCILE de-code, 27 Sep 2026): body schemas for the
// tasks write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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

export const TASK_SCHEMAS = Object.freeze({
  // completeTask — src/tasks/writes.mjs:240
  "/api/tasks/complete": z.object({
    taskId: id.nullish(),
  }),
  // reassignTask — src/tasks/writes.mjs:276
  "/api/tasks/reassign": z.object({
    taskId: id.nullish(),
    assigneeId: id.nullish(),
  }),
});
