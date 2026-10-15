// FINAL PUSH STAGE 6 (FP-K) — A WORKSPACE'S OWN WORDING FOR ITS DOCUMENT EMAILS, OVER HTTP (signed-in). Anyone who may author a template may edit the wording; "send me a test" goes only to the person asking.
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listMessages, saveMessage, resetMessage } from "../documents/emailMessages.mjs";
import { previewMessage, sendTestMessage } from "../documents/emailPreview.mjs";
import { listWorkspaceAudit, auditCsv } from "../documents/auditExport.mjs";
import { listEmails, guardState, ratesFor, resume } from "../documents/emailLog.mjs";

const SECTION = "/documents";
const kindOf = (a) => { if (typeof a.kind !== "string") throw invalid("kind is required", { field: "kind" }); return a.kind; };
const draftOf = (a) => ({ subject: a.subject, preview: a.preview, body: a.body, buttonLabel: a.buttonLabel, footer: a.footer });

export const EMAIL_WRITES = Object.freeze([
  // Run 8 (roles matrix): the workspace's email wording is a workspace setting (it lives under Settings, which a member cannot open) — saving or resetting it is an owner's or an
  // admin's, like every other setting. It used to take "template.author", so a member could rewrite every signer's email through the API.
  { path: "/api/documents/email/messages/save", section: SECTION, object: "setting", action: "edit", subject: null,
    fn: (tx, a) => saveMessage(tx, { tenantId: a.tenantId, kind: kindOf(a), locale: a.locale ?? "en", draft: draftOf(a), userId: a.actorUserId ?? null }) },
  { path: "/api/documents/email/messages/reset", section: SECTION, object: "setting", action: "edit", subject: null, fn: (tx, a) => resetMessage(tx, { tenantId: a.tenantId, kind: kindOf(a), locale: a.locale ?? "en" }) },
  { path: "/api/documents/email/messages/preview", section: SECTION, object: "document", action: "template.author",
    fn: (tx, a) => previewMessage(tx, { tenantId: a.tenantId, kind: kindOf(a), locale: a.locale ?? "en", draft: a.draft ?? null }) },
  { path: "/api/documents/email/messages/test", section: SECTION, object: "document", action: "template.author",
    fn: (tx, a) => sendTestMessage(tx, { tenantId: a.tenantId, kind: kindOf(a), locale: a.locale ?? "en", draft: a.draft ?? null, actorUserId: a.actorUserId ?? null }) },
  // the owner resumes sending after a pause (FP-K6)
  { path: "/api/documents/email/resume", section: SECTION, object: "setting", action: "edit", subject: null, fn: async (tx, a) => ({ guard: await resume(tx, { tenantId: a.tenantId, userId: a.actorUserId ?? null }) }) },
]);

export function registerEmailReads(app, { runTenantScoped, tenantIsPlatform }) {
  const guard = async ({ db, principal, tenantId }) => {
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    await assertMay(db, principal, { object: "document", action: "template.author" });
  };
  const read = (path, fn) => app.get(path, (c) => runTenantScoped(c, async (rc) => { await guard(rc); return { data: await fn({ ...rc, c }) }; }, { bucket: "documents" }).then((r) => c.json(r)));
  read("/api/documents/email/log", async ({ db, c }) => { const q = c.req.query(); return listEmails(db, { limit: q.limit, cursor: q.cursor ?? null, documentId: q.documentId ?? null, to: q.to ?? null, status: q.status ?? null, kind: q.kind ?? null }); });
  read("/api/documents/email/guard", async ({ db }) => ({ guard: await guardState(db), rates: await ratesFor(db) }));
  app.get("/api/documents/email/messages", (c) => runTenantScoped(c, async (rc) => { await guard(rc); return { data: { messages: await listMessages(rc.db, { locale: c.req.query("locale") ?? "en" }) } }; }, { bucket: "documents" }).then((r) => c.json(r)));
  app.get("/api/documents/audit", (c) => runTenantScoped(c, async (rc) => {
    await guard(rc);
    const q = c.req.query();
    return { rows: await listWorkspaceAudit(rc.db, { tenantId: rc.tenantId, from: q.from, to: q.to, kind: q.kind, limit: q.limit }), csv: q.format === "csv" };
  }, { bucket: "documents" }).then((r) => r.csv
    ? c.body(auditCsv(r.rows), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-log.csv"' })
    : c.json({ data: { events: r.rows } })));
}
