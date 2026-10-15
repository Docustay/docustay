// src/routes/teamBookingAdmin.mjs — staff screens' routes for TEAM booking (6 Oct 2026). Specs: specs/BOOKING-TEAM-PLAN-6OCT.md.
// Floor: admin or owner (atLeastRank), the same floor as the rest of Booking settings. The website KEY is shown to an OWNER only.
// The practice is always the signed-in session's — never a value in the body.
import { atLeastRank } from "../nav/authorise.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid } from "../http/errors.mjs";
import { APP_DOMAIN_VAR } from "../auth/tenantFromHost.mjs";
import { teamBookingOverview, setServiceTeam, rotateWebsiteKey, reassignBooking, addStaffAttendee } from "../booking/teamAdmin.mjs";

const appDomain = () => process.env[APP_DOMAIN_VAR] || "example.com";
const isOwner = (user) => { try { atLeastRank(user, "owner"); return true; } catch { return false; } };

export function registerTeamBookingAdminRoutes(app, { runTenantScoped }) {
  app.get("/api/booking/team", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "admin");
      return teamBookingOverview(ctx.db, { tenantId: ctx.tenantId, appDomain: appDomain(), canSeeKey: isOwner(ctx.principal.user) });
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  app.post("/api/booking/team/service", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "admin");
      const b = ctx.body;
      if (!b || typeof b !== "object" || typeof b.serviceId !== "string") throw invalid("serviceId is required");
      const out = await setServiceTeam(ctx.db, { tenantId: ctx.tenantId, serviceId: b.serviceId, hosts: b.hosts ?? [], rule: b.rule });
      await writeAudit(ctx.db, { tenantId: ctx.tenantId, action: "settings.changed", object: "booking.team_service", subjectId: b.serviceId, actorUserId: ctx.principal.appUserId, reason: null });
      return out;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  app.post("/api/booking/team/rotate-key", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "owner");
      const out = await rotateWebsiteKey(ctx.db, { tenantId: ctx.tenantId, actorUserId: ctx.principal.appUserId });
      await writeAudit(ctx.db, { tenantId: ctx.tenantId, action: "api_key.minted", object: "booking.website_key", subjectId: ctx.tenantId, actorUserId: ctx.principal.appUserId, reason: "rotated" });
      return out;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  app.post("/api/bookings/:id/reassign", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "admin");
      const b = ctx.body;
      if (!b || typeof b.hostId !== "string") throw invalid("hostId is required");
      const out = await reassignBooking(ctx.db, { tenantId: ctx.tenantId, bookingId: c.req.param("id"), hostId: b.hostId, override: b.override === true, actorUserId: ctx.principal.appUserId });
      await writeAudit(ctx.db, { tenantId: ctx.tenantId, action: "settings.changed", object: "booking.reassignment", subjectId: c.req.param("id"), actorUserId: ctx.principal.appUserId, reason: b.override === true ? "override" : null });
      return out;
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  app.post("/api/bookings/:id/attendees", (c) =>
    runTenantScoped(c, async (ctx) => {
      atLeastRank(ctx.principal.user, "admin");
      const b = ctx.body;
      if (!b || typeof b.appUserId !== "string") throw invalid("appUserId is required");
      return addStaffAttendee(ctx.db, { tenantId: ctx.tenantId, bookingId: c.req.param("id"), appUserId: b.appUserId, actorUserId: ctx.principal.appUserId });
    }, { bucket: "write" }).then((r) => c.json(r, 200)));
}
