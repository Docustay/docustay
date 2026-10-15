// Stage 14 task 14.16 — CATEGORIES AND UNITS, THE WIRE.
//
// §0.4 B: writes are table rows, not `app.post` — `CATALOGUE_WRITES` is spread into
// `src/routes/writes.mjs`'s `ROUTES` table and mounted by task 14.41
// (`registerItemsAndDocumentsRoutes`), which is what actually calls `registerWriteRoutes` over the
// combined table. Reads are a register function this file owns and 14.41 mounts directly.
//
// ★★★ NOT MOUNTED BY THIS TASK. `src/routes/writes.mjs` and `src/http/app.mjs` are not in 14.16's
//     file list. `registerCatalogueReads` below is inert until 14.41 calls it, and
//     `CATALOGUE_WRITES` is inert until 14.41 spreads it into `ROUTES`. Reported in the task summary,
//     not silently left unwired.

import { forbidden } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import {
  listCategories, createCategory, updateCategory, deleteCategory,
  listUnits, setUnitActive, createUnit,
  listPrograms, getProgram, createProgram, updateProgram, deleteProgram, reorderPrograms, setPersonPrograms, personPrograms,
} from "../items/catalogue.mjs";

const SECTION = "/items/services";

/**
 * ★★★ `<NAME>_WRITES` — a frozen array of `{ path, section, fn, object, action, subject }` rows,
 *     exactly `src/routes/writes.mjs:157-...`'s shape. `subject: null` on every row: `item` is
 *     ownerless (`src/permissions/ownership.mjs`), same reasoning as every other `/api/items/*`
 *     row already in `writes.mjs`'s `ROUTES` table (F690's note there).
 */
export const CATALOGUE_WRITES = Object.freeze([
  { path: "/api/items/categories",         section: SECTION, fn: createCategory,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/categories/update",  section: SECTION, fn: updateCategory,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/categories/delete",  section: SECTION, fn: deleteCategory,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/units",              section: SECTION, fn: createUnit,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/units/active",       section: SECTION, fn: setUnitActive,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/programs",           section: SECTION, fn: createProgram,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/programs/update",    section: SECTION, fn: updateProgram,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/programs/delete",    section: SECTION, fn: deleteProgram,
    object: "item", action: "edit", subject: null },
  { path: "/api/items/programs/reorder",   section: SECTION, fn: reorderPrograms,
    object: "item", action: "edit", subject: null },
  // ★ A person's programs (client OR team member) — gated like any other edit of that person.
  { path: "/api/people/programs",          section: "/people", fn: setPersonPrograms,
    object: "person", action: "edit", subject: "personId" },
]);

/** GET routes — `src/routes/tasks.mjs:20-60`'s authorise-then-act shape, returning `{ data }`. */
export function registerCatalogueReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/items/categories", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await listCategories(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  app.get("/api/items/units", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await listUnits(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  app.get("/api/items/programs", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await listPrograms(db, { tenantId });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));

  // ★ QUEUE §4 — the website enquiry form's interests (each may carry the program a new lead is put in); written through setSetting.
  app.get("/api/items/lead-interests", (c) =>
    runTenantScoped(c, async ({ db, principal }) => {
      await assertMay(db, principal, { object: "item", action: "view" });
      return { data: await getSetting(db, "growth.lead_interests", []) };
    }, { bucket: "records" }).then((r) => c.json(r)));

  app.get("/api/people/programs", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      await assertMay(db, principal, { object: "person", action: "view" });
      const personId = c.req.query("personId");
      return { data: await personPrograms(db, { tenantId, personId }) };
    }, { bucket: "records" }).then((r) => c.json(r)));

  app.get("/api/items/programs/:id", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const isPlatform = await tenantIsPlatform(db, tenantId);
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      await assertMay(db, principal, { object: "item", action: "view" });

      const data = await getProgram(db, { tenantId, id: c.req.param("id") });
      return { data };
    }, { bucket: "records" }).then((r) => c.json(r)));
}
