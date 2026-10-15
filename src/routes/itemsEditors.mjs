// Stage 14 task 14.21 — THE EDITORS, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `EDITOR_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly — the SAME
// shape `src/routes/itemsCatalogue.mjs` (14.16) and `src/routes/itemsImages.mjs` (14.19) already
// built tonight; this file follows their idiom exactly rather than inventing a new one.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.21's
//     file list. `registerEditorReads` below is inert until 14.41 calls it, and `EDITOR_WRITES` is
//     inert until 14.41 spreads it into `ROUTES`. Reported in the task summary, not silently left
//     unwired.

import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import {
  updateService, updatePackage, updatePlan, updateDiscount, duplicateService,
  editorRead, itemDefaults,
} from "../items/editors.mjs";

// ★ Same guard, same regex, `src/routes/index.mjs:134` / `src/routes/itemsImages.mjs:27` — a
//   malformed `:id` fails the shape check here instead of reaching Postgres as an invalid uuid
//   literal (SQLSTATE 22P02, which `toAppError` does not map, so it would otherwise surface as a raw 500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★★★ `EDITOR_WRITES` — a frozen array of `{ path, section, fn, object, action, subject }` rows,
 *     exactly `src/routes/writes.mjs:157-...`'s shape. `subject: null` on every row: `item`/`discount`
 *     are both ownerless (`src/permissions/ownership.mjs:78,181`), the same reasoning as every other
 *     `/api/items/*` row already in `writes.mjs`'s `ROUTES` table (F690's note there). Each update
 *     route's `section` matches the SAME per-type nav section its sibling `create` route already uses
 *     (`writes.mjs:324-344`) — never the polymorphic `/items/services` catch-all those rows use only
 *     because they cannot know the item type ahead of time from the body; these routes always can.
 */
export const EDITOR_WRITES = Object.freeze([
  { path: "/api/items/services/update",   section: "/items/services",  fn: updateService,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/packages/update",   section: "/items/packages",  fn: updatePackage,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/plans/update",      section: "/items/plans",     fn: updatePlan,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/coupons/update",    section: "/items/coupons",    fn: updateDiscount,
    object: "discount", action: "edit", subject: null },
  // ★ Same {object:"item",action:"edit"} as `createService`'s own row (`writes.mjs:324-325`) — a
  //   duplicate is a create, permission-wise.
  { path: "/api/items/services/duplicate", section: "/items/services", fn: duplicateService,
    object: "item", action: "edit", subject: null },
]);

/**
 * ★ `editorRead`'s CT-F36 gate needs the VIEWER's id, which `route.fn` (the generic `EDITOR_WRITES`
 *   shape above) never receives — so the editor GETs are wired here directly, `tasks.mjs:20-60`'s
 *   authorise-then-act shape, the same as `registerCatalogueReads`/`registerImageReads`.
 */
const EDITOR_SUBJECT_SECTIONS = Object.freeze({
  service:  { section: "/items/services",  object: "item" },
  package:  { section: "/items/packages",  object: "item" },
  plan:     { section: "/items/plans",     object: "item" },
  coupon:   { section: "/items/coupons",   object: "discount" },
});

function registerOneEditorRead(app, subjectType, { runTenantScoped, tenantIsPlatform }) {
  const { section, object } = EDITOR_SUBJECT_SECTIONS[subjectType];
  const path = `/api/items/${subjectType === "service" ? "services"
    : subjectType === "package" ? "packages"
    : subjectType === "plan" ? "plans"
    : subjectType === "coupon" ? "coupons" : "discounts"}/:id/editor`;

  app.get(path, (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      const e = invalid(`${subjectType} id must be a UUID`, { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    return runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, section, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object, action: "view" });

      return editorRead(db, { tenantId, subjectType, id, viewerId: principal?.appUserId ?? null });
    }, { bucket: "records" }).then((r) => c.json(r));
  });
}

/** GET routes — `src/routes/tasks.mjs:20-60`'s authorise-then-act shape, returning the read directly. */
export function registerEditorReads(app, { runTenantScoped, tenantIsPlatform }) {
  for (const subjectType of Object.keys(EDITOR_SUBJECT_SECTIONS)) {
    registerOneEditorRead(app, subjectType, { runTenantScoped, tenantIsPlatform });
  }

  // ★ `GET /api/items/defaults` — the nav read path for `/items/defaults` (field 4; no dedicated nav
  //   row exists yet for that path, `src/nav/sections.mjs`, M — so this uses the SAME polymorphic
  //   `/items/services` catch-all `itemsImages.mjs`'s own reads use for the identical reason: "there
  //   is no per-item-type nav path").
  app.get("/api/items/defaults", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, "/items/services", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      return itemDefaults(db, { tenantId });
    }, { bucket: "records" }).then((r) => c.json(r)));
}
