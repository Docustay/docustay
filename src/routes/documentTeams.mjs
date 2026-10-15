// Part 30 item 8 — managing teams (owner or admin only): list, create, rename, delete, set members, and put a document or template in a team. The rules live in the Documents island (src/documents/teams.mjs);
// this file is the host's door: who may ask, and the person doing it.
import { atLeastRank } from "../nav/authorise.mjs";
import { invalid, forbidden } from "../http/errors.mjs";
import { listTeams, createTeam, renameTeam, deleteTeam, setTeamMembers, assignTeam } from "../documents/frontDoor.mjs";

export function registerDocumentTeamRoutes(app, { runTenantScoped }) {
  const admin = (ctx) => atLeastRank(ctx.principal.user, "admin");
  const staff = (ctx) => { if (ctx.principal.user?.role !== "staff") throw forbidden("This is for the team that runs the workspace."); };
  const need = (v, what) => { if (typeof v !== "string" || !v) throw invalid(`${what} is required`, { field: what }); return v; };
  // anyone on staff may SEE the team list (the picker on a document needs it); only admins change it
  app.get("/api/documents/teams", (c) => runTenantScoped(c, async (ctx) => { staff(ctx); return { teams: await listTeams(ctx.db) }; }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.post("/api/documents/teams", (c) => runTenantScoped(c, async (ctx) => { admin(ctx); return createTeam(ctx.db, { tenantId: ctx.tenantId, name: ctx.body?.name, actorUserId: ctx.principal.appUserId }); }, { bucket: "api" }).then((r) => c.json(r, 201)));
  app.post("/api/documents/teams/rename", (c) => runTenantScoped(c, async (ctx) => { admin(ctx); return renameTeam(ctx.db, { tenantId: ctx.tenantId, teamId: need(ctx.body?.teamId, "teamId"), name: ctx.body?.name, actorUserId: ctx.principal.appUserId }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.post("/api/documents/teams/delete", (c) => runTenantScoped(c, async (ctx) => { admin(ctx); return deleteTeam(ctx.db, { tenantId: ctx.tenantId, teamId: need(ctx.body?.teamId, "teamId"), actorUserId: ctx.principal.appUserId }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.post("/api/documents/teams/members", (c) => runTenantScoped(c, async (ctx) => { admin(ctx); return setTeamMembers(ctx.db, { tenantId: ctx.tenantId, teamId: need(ctx.body?.teamId, "teamId"), userRefs: ctx.body?.userRefs, actorUserId: ctx.principal.appUserId }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
  // putting work in a team: whoever can edit it (the island refuses what they cannot see)
  app.post("/api/documents/teams/assign", (c) => runTenantScoped(c, async (ctx) => { staff(ctx); return assignTeam(ctx.db, { tenantId: ctx.tenantId, kind: ctx.body?.kind, id: need(ctx.body?.id, "id"), teamId: ctx.body?.teamId ?? null, actorUserId: ctx.principal.appUserId }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
}

// Reports (Part 30 item 8): any staff member may read them; the island applies the same team rule as the lists, so a report never shows a document the list would hide.
import { documentReport, documentReportCsv } from "../documents/frontDoor.mjs";
export function registerDocumentReportRoutes(app, { runTenantScoped }) {
  const q = (c, k) => c.req.query(k) || null;
  const staff = (ctx) => { if (ctx.principal.user?.role !== "staff") throw forbidden("This is for the team that runs the workspace."); };
  app.get("/api/documents/reports", (c) => runTenantScoped(c, (ctx) => { staff(ctx); return documentReport(ctx.db, { tenantId: ctx.tenantId, from: q(c, "from"), to: q(c, "to"), teamId: q(c, "team") }); }, { bucket: "api" }).then((r) => c.json(r, 200)));
  app.get("/api/documents/reports.csv", async (c) => {
    const out = await runTenantScoped(c, (ctx) => { staff(ctx); return documentReportCsv(ctx.db, { tenantId: ctx.tenantId, from: q(c, "from"), to: q(c, "to"), teamId: q(c, "team") }); }, { bucket: "api" });
    return c.body(out.csv, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="documents-${out.window.from}-to-${out.window.to}.csv"`, "cache-control": "private, no-store" });
  });
}
