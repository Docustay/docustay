// Stage 14 task 14.24 — LOYALTY, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `LOYALTY_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly — same
// shape `src/routes/itemsCatalogue.mjs` (14.16) already uses.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.24's
//     file list. `registerLoyaltyReads` below is inert until 14.41 calls it, and `LOYALTY_WRITES` is
//     inert until 14.41 spreads it into `ROUTES`. Reported here, not silently left unwired.
//
// ★ UPDATE, same build session: `assertMay`'s `NAMED_ACTIONS` list
//   (`src/permissions/assertMay.mjs:41-46`) did NOT include `loyalty.manage` when this file was
//   first written [MEASURED, grep for "loyalty" across `src/`: 0 hits outside `settings/keys.mjs`] —
//   task 14.15 landed it concurrently, in both `NAMED_ACTIONS` and `src/permissions/defaults.mjs`'s
//   `OWNER_ACTIONS`/`ADMIN_ACTIONS` (Coach's own `COACH_ACTIONS` was NOT given it, so a Coach is
//   still refused). Re-measured after 14.15 landed: both files now carry it. No code change needed
//   here; noted so a stale claim does not outlive the gap it described.

import { assertMay } from "../permissions/assertMay.mjs";
import {
  loyaltySummary, setRule, createReward, updateReward, tellPerson, tellAllClaimable,
} from "../items/loyalty.mjs";

// ★ Reuses `/items/services` — see `src/items/loyalty.mjs`'s own header for why: `/items/loyalty`
//   has no nav row in `src/nav/sections.mjs` yet, and that file is not in this task's list.
const SECTION = "/items/services";

/**
 * ★★★ `LOYALTY_WRITES` — a frozen array of `{ path, section, fn, object, action }` rows, exactly
 *     `src/routes/writes.mjs:157-...`'s shape (same as `CATALOGUE_WRITES`,
 *     `src/routes/itemsCatalogue.mjs:29`). No `subject` key on any row: `loyalty.manage` is a
 *     NAMED_ACTIONS entry — a flat role question with no owner to resolve, so `subject` is not
 *     declared at all (`writes.mjs`'s `assertVerbRoutesDeclareASubject` forbids naming one there).
 *     Only a view/edit/delete route resolves an owner and needs a `subject`.
 */
export const LOYALTY_WRITES = Object.freeze([
  { path: "/api/items/loyalty/rules",          section: SECTION, fn: setRule,
    object: "item", action: "loyalty.manage" },
  { path: "/api/items/loyalty/rewards",        section: SECTION, fn: createReward,
    object: "item", action: "loyalty.manage" },
  { path: "/api/items/loyalty/rewards/update", section: SECTION, fn: updateReward,
    object: "item", action: "loyalty.manage" },
  { path: "/api/items/loyalty/tell",           section: SECTION, fn: tellPerson,
    object: "item", action: "loyalty.manage" },
  { path: "/api/items/loyalty/tell-all",       section: SECTION, fn: tellAllClaimable,
    object: "item", action: "loyalty.manage" },
]);

/**
 * GET /api/items/loyalty — field 4's own shape: `assertMay` only, no `authoriseSection` call (unlike
 * `registerCatalogueReads`, which this task`s own field 4 does not ask for here). A Coach is refused`
 * — F06 §1.5 "render NOTHING" — once the `NAMED_ACTIONS` gap above is closed.
 */
export function registerLoyaltyReads(app, { runTenantScoped }) {
  app.get("/api/items/loyalty", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await assertMay(db, principal, { object: "item", action: "loyalty.manage" });

      const data = await loyaltySummary(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
