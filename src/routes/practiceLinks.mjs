// src/routes/practiceLinks.mjs — Stage 20 §4 (0496): CRUD for the practice's SCOPED booking links.
//
// ★★★ ADMIN WORK, `atLeastRank('admin')` — which pages exist and what each offers is practice
//     configuration, not a coach's own surface (contrast `bookingLinks.mjs`'s coach floor). Same
//     standalone-floor pattern as that file: reached from the booking-settings surface, not a nav
//     row, so not `guarded()`/`authoriseSection`-mounted.
// ★ Every write audited (CT-041/042, the "every settings-shaped write is audited" discipline).

import { atLeastRank } from "../nav/authorise.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid } from "../http/errors.mjs";
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";
import { listLinks, createLink, updateLink, archiveLink } from "../booking/practiceLinks.mjs";

const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";

async function tenantSlugOf(db, tenantId) {
  const { rows } = await db.query(`SELECT slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
  return rows[0]?.slug ?? null;
}

// ★ Same route-layer URL construction split `bookingLinks.mjs` keeps: the module never builds URLs.
//   A scoped link lives at `/book/l/:slug` — the `l/` segment keeps it out of the coach-slug
//   namespace (`/book/:coachSlug`, 0312) so the two can never collide.
const withUrl = (v, tenantSlug) => ({
  ...v,
  url: tenantSlug ? `https://${tenantSlug}.${appDomain()}/book/l/${v.slug}` : null,
});

export function registerPracticeLinksRoutes(app, { runTenantScoped }) {
  const requireAdmin = (ctx) => atLeastRank(ctx.principal.user, "admin");

  app.get("/api/engagements/links", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      const links = await listLinks(ctx.db, { tenantId: ctx.tenantId });
      const tenantSlug = await tenantSlugOf(ctx.db, ctx.tenantId);
      // ★ The sheet's three pick-lists travel with the read, under the same admin floor — one
      //   round trip, and no second permission question for data this screen alone needs.
      const { rows: categories } = await ctx.db.query(
        `SELECT c.id, c.name, count(s.id)::int AS "serviceCount"
           FROM keystone.service_category c
           LEFT JOIN keystone.service s ON s.tenant_id = c.tenant_id AND s.category_id = c.id
                                       AND s.active AND s.public_bookable
          WHERE c.tenant_id = $1 GROUP BY c.id, c.name, c.position ORDER BY c.position, c.name`,
        [ctx.tenantId]);
      const { rows: staff } = await ctx.db.query(
        `SELECT id, display_name AS "displayName" FROM keystone.app_user
          WHERE tenant_id = $1 AND role = 'staff' AND coalesce(lifecycle_status, '') <> 'former'
          ORDER BY display_name`, [ctx.tenantId]);
      const { rows: locations } = await ctx.db.query(
        `SELECT id, name FROM keystone.location WHERE tenant_id = $1 AND archived_at IS NULL ORDER BY name`,
        [ctx.tenantId]);
      const { rows: pageDefault } = await ctx.db.query(
        `SELECT value FROM keystone.tenant_setting WHERE tenant_id = $1 AND key = 'booking.public_page_categories'`,
        [ctx.tenantId]);
      const practicePageCategoryIds = Array.isArray(pageDefault[0]?.value) ? pageDefault[0].value : [];
      return {
        links: links.map((v) => withUrl(v, tenantSlug)),
        practicePage: {
          url: tenantSlug ? `https://${tenantSlug}.${appDomain()}/book` : null,
          categoryIds: practicePageCategoryIds,
        },
        options: { categories, staff, locations },
      };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  app.post("/api/engagements/links", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      const { slug, name, categoryIds, staffIds, locationIds } = ctx.body;
      const created = await createLink(ctx.db, {
        tenantId: ctx.tenantId, createdBy: ctx.principal.appUserId,
        slug, name, categoryIds, staffIds, locationIds,
      });
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: "engagement.practice_link",
        subjectId: created.id, actorUserId: ctx.principal.appUserId, reason: null,
      });
      const tenantSlug = await tenantSlugOf(ctx.db, ctx.tenantId);
      return withUrl(created, tenantSlug);
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  app.post("/api/engagements/links/:id", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      const { slug, name, active, categoryIds, staffIds, locationIds } = ctx.body;
      const updated = await updateLink(ctx.db, {
        tenantId: ctx.tenantId, linkId: c.req.param("id"),
        slug, name, active, categoryIds, staffIds, locationIds,
      });
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: "engagement.practice_link",
        subjectId: updated.id, actorUserId: ctx.principal.appUserId, reason: null,
      });
      const tenantSlug = await tenantSlugOf(ctx.db, ctx.tenantId);
      return withUrl(updated, tenantSlug);
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  app.post("/api/engagements/links/:id/archive", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      const result = await archiveLink(ctx.db, { tenantId: ctx.tenantId, linkId: c.req.param("id") });
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: "engagement.practice_link",
        subjectId: c.req.param("id"), actorUserId: ctx.principal.appUserId, reason: "archived",
      });
      return result;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
