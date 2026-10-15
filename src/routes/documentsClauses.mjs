// Stage 14 task 14.35 — CLAUSES, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `CLAUSE_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41, which is what actually calls
// `registerWriteRoutes` over the combined table (the same idiom `src/routes/itemsCatalogue.mjs`
// (task 14.16) already uses — matched here, not reinvented). Reads are a register function this
// file owns and 14.41 mounts directly.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.35's
//     file list. `registerClauseReads` below is inert until 14.41 calls it, and `CLAUSE_WRITES` is
//     inert until 14.41 spreads it into `ROUTES`. Reported in the task summary, not silently left
//     unwired.
//
// ★ CT-F51 — rows spread into `writes.mjs`'s `ROUTES` answer 201 (`registerWriteRoutes`'s
//   `WRITE_STATUS`, `writes.mjs:726,1014`); `registerClauseReads` below is called directly (never
//   through that table), so its `GET` answers Hono's default 200.

import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listClauses, createClause, updateClause, insertClause } from "../documents/clauses.mjs";

// ★ Nav section for clause authoring — clauses attach only to CONTRACT templates
//   (`src/documents/clauses.mjs`'s `applyTemplateBodyChange` refuses a form template), so this
//   reuses the same section `/api/documents/contracts/templates` already authorises under
//   (`src/nav/sections.mjs:97-99`), rather than the bare `/documents` catch-all.
const SECTION = "/documents/contracts";

/**
 * ★★★ `CLAUSE_WRITES` — exactly `writes.mjs:157-...`'s row shape. Field 4: all three routes are
 *     `object:"document", action:"template.author"` — the existing author NAMED_ACTION
 *     (`src/permissions/assertMay.mjs:34`, `defaults.mjs`'s `COACH_ACTIONS` includes it). No
 *     `subject` key, same as the template create/version/body rows immediately above these in
 *     `writes.mjs` (443-454, M — field 4 cites 423-434, which is stale by ~20 lines; see report).
 */
export const CLAUSE_WRITES = Object.freeze([
  { path: "/api/documents/clauses",        section: SECTION, fn: createClause,
    object: "document", action: "template.author" },
  { path: "/api/documents/clauses/update", section: SECTION, fn: updateClause,
    object: "document", action: "template.author" },
  { path: "/api/documents/clauses/insert", section: SECTION, fn: insertClause,
    object: "document", action: "template.author" },
]);

/** GET /api/documents/clauses — `src/routes/itemsCatalogue.mjs:43-53`'s authorise-then-act shape. */
export function registerClauseReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/documents/clauses", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      // ★ Field 4: the GET carries the SAME object/action as the three writes — `template.author`,
      //   a NAMED_ACTION (`assertMay.mjs`'s flat `keystone.role_action` branch), not the VERB
      //   `"view"`. A verb check would resolve `document`'s owner through `document_instance`
      //   (`ownership.mjs:56-62`), which has nothing to do with a clause library read.
      await assertMay(db, principal, { object: "document", action: "template.author" });

      const data = await listClauses(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
