// Stage 14 task 14.19 — THE IMAGE LIBRARY, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `IMAGE_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly — same
// shape `src/routes/itemsCatalogue.mjs` (task 14.16) already built.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.19's
//     file list. `registerImageReads` below is inert until 14.41 calls it, and `IMAGE_WRITES` is
//     inert until 14.41 spreads it into `ROUTES`. Reported in the task summary, not silently left
//     unwired.

import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { uploadImage, deleteImage, listImages, fetchImageBytes } from "../items/images.mjs";

// ★ The SAME polymorphic catch-all every other `/api/items/*` row already uses
//   (`src/routes/itemsCatalogue.mjs:21`, `src/routes/writes.mjs:324-336`) — a single static
//   `section` since there is no per-item-type nav path.
const SECTION = "/items/services";

// ★ Same guard, same regex, `src/routes/index.mjs:134` — a malformed `:id` fails the shape check
//   here instead of reaching Postgres as an invalid uuid literal (SQLSTATE 22P02, which
//   `src/http/errors.mjs`'s `toAppError` does not map, so it would otherwise surface as a raw 500).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★★★ `IMAGE_WRITES` — a frozen array of `{ path, section, fn, object, action, subject }` rows,
 *     exactly `src/routes/writes.mjs:157-...`'s shape. `subject: null` on both rows: `item` is
 *     ownerless (`src/permissions/ownership.mjs`), same reasoning as every other `/api/items/*` row
 *     already in `writes.mjs`'s `ROUTES` table (F690's note there) and as `CATALOGUE_WRITES`
 *     (task 14.16) uses for its own delete row. `action: "edit"` on both — including the delete —
 *     matching `CATALOGUE_WRITES`'s `deleteCategory` row rather than introducing a `"delete"` action
 *     this catch-all has never used.
 */
export const IMAGE_WRITES = Object.freeze([
  { path: "/api/items/images",         section: SECTION, fn: uploadImage,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/images/delete",  section: SECTION, fn: deleteImage,
    object: "item", action: "edit", subject: null },
]);

/** GET routes — `src/routes/tasks.mjs:20-60`'s authorise-then-act shape. */
export function registerImageReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/items/images", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await listImages(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  // ★ Streams raw bytes, so this uses `runTenantScoped` directly (`c.body`, not `c.json`) —
  //   the same shape `src/routes/index.mjs`'s `GET /api/documents/:id/pdf` (task 18.9) already uses.
  app.get("/api/items/images/:id/raw", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) {
      const e = invalid("image id must be a UUID", { field: "id" });
      return c.json(e.toResponse().body, e.statusCode);
    }
    const out = await runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      return fetchImageBytes(db, { tenantId, id });
    }, { bucket: "records" });
    return c.body(out.body, 200, {
      "content-type": out.contentType,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    });
  });
}
