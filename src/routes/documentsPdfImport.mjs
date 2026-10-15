// Stage 14 task 14.38 — PDF IMPORT, THE ROUTE ROW.
//
// §0.4 B: writes are table rows, not `app.post` — `PDF_IMPORT_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41 (`registerItemsAndDocumentsRoutes`),
// which is what actually calls `registerWriteRoutes` over the combined table. This task adds NO read
// routes — `src/documents/pdfImport.mjs` exposes only the two writes below.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.38's
//     file list. `PDF_IMPORT_WRITES` is inert until 14.41 spreads it into `ROUTES`. Reported in the
//     task summary, not silently left unwired — see `src/routes/itemsCatalogue.mjs`'s own header for
//     the same shape (14.16, this task's reference idiom).

import { recordImport, confirmImport } from "../documents/pdfImport.mjs";

const SECTION = "/documents";

/**
 * ★★★ `PDF_IMPORT_WRITES` — a frozen array of `{ path, section, fn, object, action }` rows, exactly
 *     `src/routes/writes.mjs:410-459`'s document-route shape. `action: "template.author"` — the SAME
 *     grant `/api/documents/contracts/templates`, `/api/documents/templates/version` and
 *     `/api/documents/templates/body` already require (`writes.mjs:443-454`, M): a PDF import ends in
 *     `createTemplate`, so it is authoring, gated the same way authoring already is. No `subject` key
 *     on either row — `template.author` is a NAMED_ACTIONS entry, a flat role question with no owner
 *     to resolve, so `subject` is not declared at all (`newTemplateVersion`/`updateTemplateBody` at
 *     `writes.mjs:465,467` are the measured match: they omit `subject` too, not `subject: null` as
 *     this file's header previously and wrongly claimed).
 */
export const PDF_IMPORT_WRITES = Object.freeze([
  { path: "/api/documents/pdf-imports",         section: SECTION, fn: recordImport,
    object: "document", action: "template.author" },
  { path: "/api/documents/pdf-imports/confirm", section: SECTION, fn: confirmImport,
    object: "document", action: "template.author" },
]);
