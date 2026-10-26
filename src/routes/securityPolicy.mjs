// Part 30 item 5 — the workspace's sign-in rules a Docustay owner or admin can change: "require two-step sign-in for everyone". The guard that enforces it is src/auth/requireTwoStep.mjs.
// 0766 (20 Oct 2026): three modes instead of a switch. Off; a grace period (a number of days to set it up, during which nobody is blocked and the web shows a calm notice with the days left); required now.
//   Stored in two settings and no migration: `security.require_two_step` (true = required now) and `security.two_step_grace_until` (an ISO date). A grace period that has ended counts as required now.
// ★ Asking for it (grace or now) is refused for an admin who has not set up two-step themselves (they would lock themselves out of the screen that turns it off).
import { atLeastRank } from "../nav/authorise.mjs";
import { invalid, forbidden, notFound } from "../http/errors.mjs";
import { setSetting, getSetting } from "../settings/writes.mjs";
import { forgetTwoStepSetting, workspaceSecurityRules } from "../auth/requireTwoStep.mjs";
import * as ts from "../auth/twoStep.mjs";
import { sendAuthEmail } from "../email/authEmail.mjs";
import { emit, userActor } from "../events/outbox.mjs";

const DAYS_MAX = 30;
const SECURITY_URL = () => `${(process.env.KEYSTONE_DOCUSTAY_APP_URL || "").replace(/\/+$/, "")}/settings?tab=security`;

export function registerSecurityPolicyRoutes(app, { runTenantScoped }) {
  const admin = (ctx) => atLeastRank(ctx.principal.user, "admin");
  const owner = (ctx) => atLeastRank(ctx.principal.user, "owner");
  const isOwner = (ctx) => { try { owner(ctx); return true; } catch { return false; } };
  const selfRow = async (ctx) => (await ctx.db.query(`SELECT firebase_uid, email, staff_role FROM keystone.app_user WHERE id = $1`, [ctx.principal.appUserId])).rows[0] ?? null;
  const daysLeft = (iso) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400_000)) : null);

  app.get("/api/settings/security", (c) =>
    runTenantScoped(c, async (ctx) => {
      // Run 7: any staff member may read the rules that apply to them (why two-step is required); only an owner or admin may change them (canChange, and the POST below)
      if (ctx.principal.user?.role !== "staff") throw forbidden("This is for the team that runs the workspace.");
      let canChange = true; try { admin(ctx); } catch { canChange = false; }
      const me = await selfRow(ctx);
      forgetTwoStepSetting(ctx.tenantId);
      const rules = await workspaceSecurityRules(ctx.db, ctx.tenantId);
      const have = me?.firebase_uid ? (await ts.summary(me.firebase_uid)).on : false;
      // an owner reset this person's two-step and they have not set it up again since: the app asks them, calmly, on every page until they do (20 Oct 2026; nothing here locks anyone out)
      let askedToSetUp = false;
      if (!have && me?.firebase_uid) {
        const ev = await ts.listEvents(me.firebase_uid, 50).catch(() => []);
        const reset = ev.find((e) => e.kind === "reset_by_owner");
        askedToSetUp = Boolean(reset) && !ev.some((e) => Date.parse(e.at) > Date.parse(reset.at) && ["two_step_on", "authenticator_added", "passkey_added", "security_key_added"].includes(e.kind));
      }
      const mode = rules.requiredNow ? "now" : rules.graceUntil ? "grace" : rules.everyone ? "now" : "off";
      // what this workspace enforces: two-step only when an owner requires it for everyone (HOTFIX 11 Oct 2026); idle sign-out is the workspace's own optional setting
      return { requireTwoStep: rules.requiredNow || rules.everyone, mode, graceUntil: rules.graceUntil, graceDaysLeft: daysLeft(rules.graceUntil), youHaveTwoStep: have,
        canChange, canReset: isOwner(ctx), askedToSetUp, youMustUseTwoStep: rules.everyone, youWillNeedTwoStep: Boolean(rules.graceUntil) && !have, idleMinutes: Number(await getSetting(ctx.db, "security.idle_minutes", 0)) || 0, idleMinutesInForce: rules.idleMinutes };
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
        if (ctx.body.requireTwoStep === undefined && ctx.body.mode === undefined) return { idleMinutes: m };
      }
      // the three modes; the older boolean still works (true = required now, false = off)
      let mode = ctx.body?.mode;
      if (mode === undefined) { const value = ctx.body?.requireTwoStep; if (typeof value !== "boolean") throw invalid("mode must be off, grace or now", { field: "mode" }); mode = value ? "now" : "off"; }
      if (!["off", "grace", "now"].includes(mode)) throw invalid("mode must be off, grace or now", { field: "mode" });
      if (mode !== "off") {
        const me = await selfRow(ctx);
        if (!me?.firebase_uid || !(await ts.summary(me.firebase_uid)).on) throw forbidden("Set up two-step sign-in for yourself first — otherwise you would be locked out of the screen that turns this off.");
      }
      let graceUntil = "";
      if (mode === "grace") {
        const days = Number(ctx.body?.days ?? 7);
        if (!Number.isInteger(days) || days < 1 || days > DAYS_MAX) throw invalid(`days must be a whole number from 1 to ${DAYS_MAX}`, { field: "days" });
        graceUntil = new Date(Date.now() + days * 86400_000).toISOString();
      }
      await setSetting(ctx.db, { tenantId: ctx.tenantId, key: "security.require_two_step", value: mode === "now", updatedBy: ctx.principal.appUserId });
      await setSetting(ctx.db, { tenantId: ctx.tenantId, key: "security.two_step_grace_until", value: graceUntil, updatedBy: ctx.principal.appUserId });
      forgetTwoStepSetting(ctx.tenantId);
      return { requireTwoStep: mode === "now", mode, graceUntil: graceUntil || null, graceDaysLeft: daysLeft(graceUntil || null) };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // Who has set it up (owners and admins): every active staff member and whether they have any second step.
  app.get("/api/settings/security/people", (c) =>
    runTenantScoped(c, async (ctx) => {
      admin(ctx);
      const { rows } = await ctx.db.query(`SELECT id, display_name, email, staff_role, firebase_uid FROM keystone.app_user WHERE role = 'staff' AND archived_at IS NULL AND COALESCE(lifecycle_status, 'active') NOT IN ('paused', 'former') ORDER BY created_at`);
      const set = await ts.secondFactorUids(rows.map((r) => r.firebase_uid).filter(Boolean));
      return { people: rows.map((r) => ({ id: r.id, name: r.display_name, email: r.email, role: r.staff_role, hasTwoStep: r.firebase_uid ? set.has(r.firebase_uid) : false, you: r.id === ctx.principal.appUserId })) };
    }, { bucket: "api" }).then((r) => c.json(r, 200)));

  // Remind one person (an email; at most one a day for the same person).
  app.post("/api/settings/security/remind", (c) =>
    runTenantScoped(c, async (ctx) => {
      admin(ctx);
      const { rows: [t] } = await ctx.db.query(`SELECT id, email, firebase_uid FROM keystone.app_user WHERE id = $1 AND role = 'staff' AND archived_at IS NULL`, [String(ctx.body?.id ?? "")]);
      if (!t?.firebase_uid || !t.email) throw notFound("No such team member.");
      if ((await ts.summary(t.firebase_uid)).on) throw invalid("That person has already set it up.");
      const recent = (await ts.listEvents(t.firebase_uid, 20)).find((e) => e.kind === "reminder_sent" && Date.now() - Date.parse(e.at) < 86400_000);
      if (recent) throw invalid("They were reminded in the last day.");
      const me = await selfRow(ctx);
      const rules = await workspaceSecurityRules(ctx.db, ctx.tenantId);
      const deadline = rules.everyone ? "It is required now." : rules.graceUntil ? `You have until ${new Date(rules.graceUntil).toUTCString().slice(0, 16)}.` : "";
      await ts.recordEvent(t.firebase_uid, "reminder_sent", { by: me?.email ?? null });
      return { reminded: true, mail: { to: t.email, templateKey: "auth.two_step_reminder", vars: { requestedBy: me?.email ?? "A workspace owner", deadline, link: SECURITY_URL() } } };
    }, { bucket: "api" }).then(async ({ mail, ...r }) => { await sendAuthEmail({ ...mail, product: "docustay" }).catch(() => null); return c.json(r, 200); }));   // the email goes after the database work, never while it holds a connection

  // An owner (or an admin, for a member) removes a teammate's two-step so they can set it up again, for example when they lost their phone.
  app.post("/api/settings/security/reset", (c) =>
    runTenantScoped(c, async (ctx) => {
      owner(ctx);   // only a workspace OWNER resets a teammate's two-step (TWO-STEP-SPEC section 2, screen 9); an admin can remind but not reset
      const me = await selfRow(ctx);
      const { rows: [t] } = await ctx.db.query(`SELECT id, email, firebase_uid, staff_role FROM keystone.app_user WHERE id = $1 AND role = 'staff' AND archived_at IS NULL`, [String(ctx.body?.id ?? "")]);
      if (!t?.firebase_uid) throw notFound("No such team member.");
      if (t.id === ctx.principal.appUserId) throw invalid("Turn off your own two-step from Security, where it asks for a code.");
      const had = await ts.clearAll(t.firebase_uid);
      await ts.recordEvent(t.firebase_uid, "reset_by_owner", { by: me?.email ?? null });
      // the workspace audit log (Settings, Audit log): who reset whose two-step. The payload carries the setting-style key only; the person is the subject, named by the log.
      await emit(ctx.db, { tenantId: ctx.tenantId, topic: "documents.setting.changed", emittedBy: "documents", actor: userActor(ctx.principal.appUserId), subjectType: "person", subjectId: t.id, payload: { key: "security.two_step_reset" } });
      return { reset: had, mail: t.email ? { to: t.email, templateKey: "auth.two_step_reset", vars: { by: me?.email ?? "A workspace owner", when: new Date().toUTCString(), link: SECURITY_URL() } } : null };
    }, { bucket: "api" }).then(async ({ mail, ...r }) => { if (mail) await sendAuthEmail({ ...mail, product: "docustay" }).catch(() => null); return c.json(r, 200); }));
}
