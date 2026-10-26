// Stage 14 task 14.17 — MODIFIERS, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `MODIFIER_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.17's
//     file list (MEASURED: neither file names `itemsModifiers`/`MODIFIER_WRITES` today).
//     `registerModifierReads` below is inert until 14.41 calls it, and `MODIFIER_WRITES` is inert
//     until 14.41 spreads it into `ROUTES`. Reported in the task summary, not silently left unwired.
//
// ★ CT-F51 (measured, `src/routes/writes.mjs:726,1014`): every route in `writes.mjs`'s `ROUTES`
//   table answers 201 via `WRITE_STATUS`, UNCONDITIONALLY — including `/quote` below, even though
//   its `action` is `"view"` and it writes nothing. 14.17 field 8 states `Coach quote → 200`; that
//   is wrong once this route is actually mounted through `registerWriteRoutes` as §0.4 B requires,
//   and is reported as a plan/wiring contradiction rather than silently building a second, bespoke
//   `app.post` outside the table just to make the stated 200 true.

import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import {
  listModifiers, createModifier, updateModifier, setModifierActive, quoteModifiers,
} from "../items/modifiers.mjs";

const SECTION = "/items/services";

/**
 * `MODIFIER_WRITES` — a frozen array of `{ path, section, fn, object, action, subject }` rows,
 * exactly `src/routes/writes.mjs`'s `ROUTES` shape. `subject: null` on every row: `item` is
 * ownerless (`src/permissions/ownership.mjs`), same reasoning as every other `/api/items/*` row
 * already in `writes.mjs`'s `ROUTES` table (F690's note there, and `CATALOGUE_WRITES`'s own rows).
 * `/api/items/modifiers/quote` is `action: "view"` — 14.17 field 4: "a quote writes nothing; it is
 * POST because it carries an array" (an array of modifier ids in the body, which a GET query string
 * cannot carry cleanly).
 */
export const MODIFIER_WRITES = Object.freeze([
  { path: "/api/items/modifiers",           section: SECTION, fn: createModifier,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/modifiers/update",    section: SECTION, fn: updateModifier,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/modifiers/active",    section: SECTION, fn: setModifierActive,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/modifiers/quote",     section: SECTION, fn: quoteModifiers,
    object: "item", action: "view", subject: null },
]);

/** GET routes — `src/routes/tasks.mjs:20-60`'s authorise-then-act shape, returning `{ data }`. */
export function registerModifierReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/items/modifiers", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await listModifiers(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
