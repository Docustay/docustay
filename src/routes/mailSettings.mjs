// Batch A — Settings → Email, "Use your own domain": the organisation's ONE sending identity over HTTP (the mail module's front door). Writes are ROWS spread into writes.mjs (via itemsAndDocuments.mjs); the status is a read register function.
// Same permission as any other Email setting (admin and owner). The Documents settings screen shows the SAME panel against the SAME identity — there is no second one.
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import * as mail from "../mail/index.mjs";
import { withTenant } from "../db/index.mjs";

const SECTION = "/settings/email";
const need = (v, name) => { if (typeof v !== "string" || !v.trim()) throw invalid(`${name} is required`, { field: name }); return v; };
const status = (tx, tenantId) => mail.mailStatus(tx, { tenantId }).then(async (st) => ({ ...st, settings: await mail.identitySettings(tx) }));

export const MAIL_SETTINGS_WRITES = Object.freeze([
  { path: "/api/email/identity", section: SECTION, fn: async (tx, a) => { await mail.saveIdentity(tx, { tenantId: a.tenantId, fields: a.fields ?? {}, updatedBy: a.actorUserId ?? null }); return status(tx, a.tenantId); }, object: "setting", action: "edit", subject: null },
  { path: "/api/email/domain", section: SECTION, fn: async (tx, a) => { await mail.startDomain(tx, { tenantId: a.tenantId, domain: need(a.domain, "domain") }); return status(tx, a.tenantId); }, object: "setting", action: "edit", subject: null },
  { path: "/api/email/domain/verify", section: SECTION, fn: async (tx, a) => { await mail.verifyDomainNow(tx, { tenantId: a.tenantId }); return status(tx, a.tenantId); }, object: "setting", action: "edit", subject: null },
  { path: "/api/email/domain/remove", section: SECTION, fn: async (tx, a) => { await mail.removeDomain(tx, { tenantId: a.tenantId }); return status(tx, a.tenantId); }, object: "setting", action: "edit", subject: null },
  { path: "/api/email/smtp-password", section: SECTION, fn: async (tx, a) => { await mail.saveSmtpPassword(tx, { tenantId: a.tenantId, password: a.password ?? null, updatedBy: a.actorUserId ?? null }); return status(tx, a.tenantId); }, object: "setting", action: "edit", subject: null },
  { path: "/api/email/mailbox/connect", section: SECTION, fn: (tx, a) => mail.startMailboxConnect(tx, { tenantId: a.tenantId, userId: a.actorUserId ?? null, provider: need(a.provider, "provider") }), object: "setting", action: "edit", subject: null },
  { path: "/api/email/mailbox/disconnect", section: SECTION, fn: (tx, a) => mail.removeMailbox(tx, { tenantId: a.tenantId, updatedBy: a.actorUserId ?? null }), object: "setting", action: "edit", subject: null },
  { path: "/api/email/test", section: SECTION, fn: (tx, a) => mail.sendTestEmail(tx, { tenantId: a.tenantId, to: need(a.to, "to"), subject: a.subject ?? null }), object: "setting", action: "edit", subject: null },
]);

/** The provider sends the person's browser back here after consent. No session is read: the signed `state` (made when they pressed Connect, ten minutes of life, bound to the organisation) is the proof, and the write runs inside that organisation only. */
export function registerMailboxCallback(app) {
  app.get("/api/public/mailbox/callback", async (c) => {
    const q = c.req.query(), back = (flag) => c.redirect(`/settings?tab=email&mailbox=${encodeURIComponent(flag)}`, 302);
    if (q.error) return back("declined");
    try {
      const { tenantId, userId } = mail.verifyMailboxState(q.state);
      await withTenant(tenantId, (tx) => mail.finishMailboxConnect(tx, { state: q.state, code: q.code }), { userId });
      return back("connected");
    } catch (e) { return back(e?.kind === "validation" ? "expired" : "failed"); }
  });
}

export function registerMailSettingsReads(app, { runTenantScoped, tenantIsPlatform }) {
  registerMailboxCallback(app);
  app.get("/api/email/identity", (c) =>
    runTenantScoped(c, async ({ db, principal, tenantId }) => {
      const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
      if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
      return status(db, tenantId);
    }, { bucket: "settings" }).then((r) => c.json(r)));
}
