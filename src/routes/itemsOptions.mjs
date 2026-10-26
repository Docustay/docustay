// Stage 14 task 14.18 — BOOKING OPTIONS, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `OPTION_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly. Same shape
// as `src/routes/itemsCatalogue.mjs` (task 14.16), which this file was built to match.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.18's
//     file list. `registerOptionReads` below is inert until 14.41 calls it, and `OPTION_WRITES` is
//     inert until 14.41 spreads it into `ROUTES`. Reported in the task summary, not silently left
//     unwired.
//
// ★★★ "REQUIRED" IS NOT ENFORCED HERE, EITHER. These routes create/update/list the QUESTION
//     (`custom_field` row); refusing a booking that skips a required answer is task 14.79's booking
//     write route, which is not in this task's file list. See `src/items/options.mjs`'s header.

import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listOptions, createOption, updateOption, setOptionActive } from "../items/options.mjs";

const SECTION = "/items/services";

/**
 * ★★★ `OPTION_WRITES` — a frozen array of `{ path, section, fn, object, action, subject }` rows,
 *     exactly `src/routes/writes.mjs:157-...`'s shape. `subject: null` on every row: `item` is
 *     ownerless (`src/permissions/ownership.mjs`), same reasoning `src/routes/itemsCatalogue.mjs`
 *     (F690's note there) already gives for every other `/api/items/*` row.
 */
export const OPTION_WRITES = Object.freeze([
  { path: "/api/items/options",         section: SECTION, fn: createOption,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/options/update",  section: SECTION, fn: updateOption,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/options/active",  section: SECTION, fn: setOptionActive,
    object: "item", action: "edit", subject: null },
]);

/** GET route — `src/routes/tasks.mjs:20-60`'s authorise-then-act shape, returning `{ data }`. */
export function registerOptionReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/items/options", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await listOptions(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
