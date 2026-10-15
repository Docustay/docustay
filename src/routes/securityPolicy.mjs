// Part 30 item 5 — the workspace's sign-in rules a Docustay owner or admin can change: "require two-step sign-in for everyone". One setting today (`security.require_two_step`); the guard that enforces it is src/auth/requireTwoStep.mjs.
// ★ Turning it ON is refused for an admin who has not set up two-step themselves (they would lock themselves out of the screen that turns it off).
import { atLeastRank } from "../nav/authorise.mjs";
import { invalid, forbidden } from "../http/errors.mjs";
import { setSetting, getSetting } from "../settings/writes.mjs";
import { hasConfirmedFactor } from "../auth/totp.mjs";
import { forgetTwoStepSetting, workspaceSecurityRules } from "../auth/requireTwoStep.mjs";

export function registerSecurityPolicyRoutes(app, { runTenantScoped }) {
  const admin = (ctx) => atLeastRank(ctx.principal.user, "admin");
  const self = async (ctx) => (await ctx.db.query(`SELECT firebase_uid FROM keystone.app_user WHERE id = $1`, [ctx.principal.appUserId])).rows[0]?.firebase_uid ?? null;

  app.get("/api/settings/security", (c) =>
    runTenantScoped(c, async (ctx) => {
      // Run 7: any staff member may read the rules that apply to them (why two-step is required); only an owner or admin may change them (canChange, and the POST below)
      if (ctx.principal.user?.role !== "staff") throw forbidden("This is for the team that runs the workspace.");
      let canChange = true; try { admin(ctx); } catch { canChange = false; }
      const uid = await self(ctx);
      forgetTwoStepSetting(ctx.tenantId);
      const rules = await workspaceSecurityRules(ctx.db, ctx.tenantId);
      // what this workspace enforces: two-step only when an owner requires it for everyone (HOTFIX 11 Oct 2026); idle sign-out is the workspace's own optional setting
      return { requireTwoStep: (await getSetting(ctx.db, "security.require_two_step", false)) === true, youHaveTwoStep: uid ? await hasConfirmedFactor(uid) : false,
        canChange, youMustUseTwoStep: rules.everyone, idleMinutes: Number(await getSetting(ctx.db, "security.idle_minutes", 0)) || 0, idleMinutesInForce: rules.idleMinutes };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // Is this practice writing documents through the shared engine? (host setting authoring.shared_engine, default off.) A read-only fact any signed-in staff screen may ask; the writer's doors hide behind it.
  app.get("/api/settings/authoring", (c) =>
    runTenantScoped(c, async (ctx) => ({ sharedEngine: (await getSetting(ctx.db, "authoring.shared_engine", false)) === true }), { bucket: "api" }).then((r) => c.json(r, 200)));

  app.post("/api/settings/security", (c) =>
    runTenantScoped(c, async (ctx) => {
      admin(ctx);
      if (ctx.body?.idleMinutes !== undefined) {   // Run 7 part 6: sign people out after this many minutes without activity (0 = never)
        const m = ctx.body.idleMinutes;
        if (!Number.isInteger(m) || m < 0 || m > 1440) throw invalid("idleMinutes must be a whole number of minutes from 0 to 1440", { field: "idleMinutes" });
        await setSetting(ctx.db, { tenantId: ctx.tenantId, key: "security.idle_minutes", value: m, updatedBy: ctx.principal.appUserId });
        forgetTwoStepSetting(ctx.tenantId);
        if (ctx.body.requireTwoStep === undefined) return { idleMinutes: m };
      }
      const value = ctx.body?.requireTwoStep;
      if (typeof value !== "boolean") throw invalid("requireTwoStep must be true or false", { field: "requireTwoStep" });
      if (value) {
        const uid = await self(ctx);
        if (!uid || !(await hasConfirmedFactor(uid))) throw forbidden("Set up two-step sign-in for yourself first — otherwise you would be locked out of the screen that turns this off.");
      }
      await setSetting(ctx.db, { tenantId: ctx.tenantId, key: "security.require_two_step", value, updatedBy: ctx.principal.appUserId });
      forgetTwoStepSetting(ctx.tenantId);
      return { requireTwoStep: value };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
}
