// 12.2 — LOCATION ROUTES. GET /api/locations · POST /api/locations · POST /api/locations/:id.
//
// ★ Same guard idiom as `src/routes/payerGroups.mjs:18-29`, but the checks differ per route: the
//   LIST is a read gated on the `/people` section (staff who can see people can see where they
//   work); the WRITES are gated on `assertMay(..., { object: 'setting', action: 'edit' })` —
//   `setting` is ownerless, Owner/Admin only (`src/permissions/defaults.mjs:83-90`).
// ★ Not in `src/routes/writes.mjs`'s `ROUTES` table, so CT-F51's `WRITE_STATUS = 201` does not
//   apply here — these answer the ordinary 200 `runTenantScoped` already defaults to.

import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listLocations, createLocation, updateLocation } from "../settings/locations.mjs";

export function registerLocationRoutes(app, { runTenantScoped, tenantIsPlatform }) {
  /**
   * ★ Wrapper matching payerGroups.mjs:18-29's shape — runs `fn` inside the tenant transaction and
   *   answers JSON. The staff check is common to every route below; the finer-grained authorisation
   *   (section vs assertMay) is supplied by each handler.
   */
  const guarded = (fn) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.user?.role || ctx.principal.user.role !== "staff") {
        throw forbidden("locations are for staff only");
      }
      return fn(ctx);
    }).then((r) => c.json(r));

  // ───────────────────────────────────────────────────────────────────────────
  // GET /api/locations — staff with access to the /people section.
  // ───────────────────────────────────────────────────────────────────────────
  app.get("/api/locations", guarded(async (ctx) => {
    const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
    const decision = authoriseSection(ctx.principal.user, "/people", { tenantIsPlatform: isPlatform });
    if (!decision.allowed) {
      throw forbidden(`access to locations requires access to the people section`);
    }
    const locations = await listLocations(ctx.db);
    return { locations };
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/locations — Owner/Admin only (`setting` is ownerless — edit is all-or-nothing).
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/locations", guarded(async (ctx) => {
    await assertMay(ctx.db, ctx.principal, { object: "setting", action: "edit" });

    const body = ctx.body || {};
    const result = await createLocation(ctx.db, {
      tenantId: ctx.tenantId,
      name: body.name,
      timezone: body.timezone,
      addressLine1: body.address_line1 ?? null,
      addressLine2: body.address_line2 ?? null,
      city: body.city ?? null,
      stateRegion: body.state_region ?? null,
      postcode: body.postcode ?? null,
      country: body.country ?? null,
      actorUserId: ctx.principal.appUserId,
    });
    return result;
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // POST /api/locations/:id — Owner/Admin only.
  // ───────────────────────────────────────────────────────────────────────────
  app.post("/api/locations/:id", guarded(async (ctx) => {
    await assertMay(ctx.db, ctx.principal, { object: "setting", action: "edit" });

    const locationId = ctx.c.req.param("id");
    const body = ctx.body || {};
    const patch = { tenantId: ctx.tenantId, locationId, actorUserId: ctx.principal.appUserId };
    if ("name" in body) patch.name = body.name;
    if ("timezone" in body) patch.timezone = body.timezone;
    if ("address_line1" in body) patch.addressLine1 = body.address_line1;
    if ("address_line2" in body) patch.addressLine2 = body.address_line2;
    if ("city" in body) patch.city = body.city;
    if ("state_region" in body) patch.stateRegion = body.state_region;
    if ("postcode" in body) patch.postcode = body.postcode;
    if ("country" in body) patch.country = body.country;
    if ("archived" in body) patch.archived = body.archived;

    const result = await updateLocation(ctx.db, patch);
    return result;
  }));
}
