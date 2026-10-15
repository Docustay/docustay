// src/routes/locationAssignments.mjs — Stage 20 §5 (0497): the ONE writer for service-to-location
// and staff-to-location. Without a writer these tables would be BUILT-AND-WIRED-TO-NOTHING
// (failure №1) — this file is what makes 0497 real.
//
// ★ Replace-all semantics per subject: POST sends the subject's COMPLETE location list; an empty
//   list clears the restriction (= works/offered everywhere, 0497's back-compat rule). Same
//   "explicit [] clears, absence untouched" split `practiceLinks.mjs` documents.
// ★ Admin work (`atLeastRank('admin')`) — where things are offered and who works where is practice
//   configuration. Reached from the location-management surface, not a nav row: the same
//   standalone-floor mounting as `bookingLinks.mjs`/`practiceLinks.mjs`.

import { atLeastRank } from "../nav/authorise.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid, notFound } from "../http/errors.mjs";

const KINDS = Object.freeze({
  service: {
    table: "service_location", subjectCol: "service_id",
    exists: `SELECT 1 FROM keystone.service WHERE tenant_id = $1 AND id = $2`,
    what: "service",
  },
  staff: {
    table: "staff_location", subjectCol: "app_user_id",
    exists: `SELECT 1 FROM keystone.app_user WHERE tenant_id = $1 AND id = $2 AND role = 'staff'`,
    what: "staff member",
  },
});

export function registerLocationAssignmentRoutes(app, { runTenantScoped }) {
  const requireAdmin = (ctx) => atLeastRank(ctx.principal.user, "admin");

  // The whole map in one read: every restricted subject and its locations. A subject absent here
  // is unrestricted — the payload mirrors the tables' own semantics rather than inventing a flag.
  app.get("/api/settings/locations/assignments", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      const out = {};
      for (const [kind, def] of Object.entries(KINDS)) {
        const { rows } = await ctx.db.query(
          `SELECT ${def.subjectCol} AS subject_id, array_agg(location_id ORDER BY location_id) AS location_ids
             FROM keystone.${def.table} WHERE tenant_id = $1 GROUP BY ${def.subjectCol}`,
          [ctx.tenantId]);
        out[kind] = rows.map((r) => ({ id: r.subject_id, locationIds: r.location_ids }));
      }
      return out;
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // POST {kind: 'service'|'staff', id, locationIds: [...]} — replace-all for that subject.
  app.post("/api/settings/locations/assignments", (c) =>
    runTenantScoped(c, async (ctx) => {
      requireAdmin(ctx);
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");
      const { kind, id, locationIds } = ctx.body;
      const def = KINDS[kind];
      if (!def) throw invalid("kind must be 'service' or 'staff'");
      const subjectId = String(id ?? "").trim();
      if (!subjectId) throw invalid("id is required");
      if (!Array.isArray(locationIds)) throw invalid("locationIds must be a list (empty clears the restriction)");

      const { rows: subject } = await ctx.db.query(def.exists, [ctx.tenantId, subjectId])
        .catch((e) => { if (e.code === "22P02") throw notFound(`no such ${def.what}`); throw e; });
      if (subject.length === 0) throw notFound(`no such ${def.what}`);

      await ctx.db.query(
        `DELETE FROM keystone.${def.table} WHERE tenant_id = $1 AND ${def.subjectCol} = $2`,
        [ctx.tenantId, subjectId]);
      const clean = [...new Set(locationIds.map((v) => String(v ?? "").trim()).filter(Boolean))];
      for (const locationId of clean) {
        try {
          await ctx.db.query(
            `INSERT INTO keystone.${def.table} (tenant_id, ${def.subjectCol}, location_id) VALUES ($1, $2, $3)`,
            [ctx.tenantId, subjectId, locationId]);
        } catch (e) {
          if (e.code === "23503" || e.code === "22P02") throw invalid("that location does not exist in this practice");
          throw e;
        }
      }
      await writeAudit(ctx.db, {
        tenantId: ctx.tenantId, action: "settings.changed", object: `location.assignment.${kind}`,
        subjectId, actorUserId: ctx.principal.appUserId, reason: null,
      });
      return { id: subjectId, kind, locationIds: clean };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
