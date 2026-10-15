// Stage 14 task 14.37 — AI DRAFT AND CHECK, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `AI_WRITES` is spread into `src/routes/writes.mjs`'s
// `ROUTES` array (via `src/routes/itemsAndDocuments.mjs`'s `STAGE14_WRITES`) and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs`, `src/routes/itemsAndDocuments.mjs` and
//     `src/http/app.mjs` are not in 14.37's file list. `AI_WRITES` is inert until 14.41 spreads it
//     into `ROUTES` — reported in the task summary, not silently left unwired.
//
// ★ No `subject` field on either row: `action: "template.author"` is a `NAMED_ACTIONS` entry
//   (`src/permissions/assertMay.mjs:43`), and `assertVerbRoutesDeclareASubject`
//   (`src/routes/writes.mjs:691-722`) throws at module load if a NAMED_ACTIONS row declares one —
//   the same shape as every other `template.author` row already in `writes.mjs`'s `ROUTES` table
//   (`/api/documents/contracts/templates`, `/api/documents/templates/version`,
//   `/api/documents/templates/body`, `writes.mjs:443-454`).

import { aiDraft, aiCheck } from "../documents/ai.mjs";

const SECTION = "/documents";

/**
 * ★★★ `AI_WRITES` — a frozen array of `{ path, section, fn, object, action }` rows, exactly
 *     `src/routes/writes.mjs:157-…`'s shape. CT-F51: a row spread into `writes.mjs`'s `ROUTES`
 *     answers **201** via `registerWriteRoutes`'s own `WRITE_STATUS` (`writes.mjs:726,1014`) — not
 *     200, and not the 503 an earlier draft of this plan named for the unconfigured case (the
 *     established `dependency(...)` pattern maps to **502**, `src/http/errors.mjs:22,35`).
 */
export const AI_WRITES = Object.freeze([
  { path: "/api/documents/ai/draft", section: SECTION, fn: aiDraft, object: "document", action: "template.author" },
  { path: "/api/documents/ai/check", section: SECTION, fn: aiCheck, object: "document", action: "template.author" },
]);
