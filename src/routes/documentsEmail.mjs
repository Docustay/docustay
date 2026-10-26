// The email log, the sending guard and the audit log, over HTTP (signed-in). (The editable email wording was removed in Docustay v1.)
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listWorkspaceAudit, auditCsv } from "../documents/auditExport.mjs";
import { listEmails, guardState, ratesFor, resume } from "../documents/emailLog.mjs";

const SECTION = "/documents";

export const EMAIL_WRITES = Object.freeze([
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
  app.get("/api/documents/audit", (c) => runTenantScoped(c, async (rc) => {
    await guard(rc);
    const q = c.req.query();
    return { rows: await listWorkspaceAudit(rc.db, { tenantId: rc.tenantId, from: q.from, to: q.to, kind: q.kind, limit: q.limit }), csv: q.format === "csv" };
  }, { bucket: "documents" }).then((r) => r.csv
    ? c.body(auditCsv(r.rows), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-log.csv"' })
    : c.json({ data: { events: r.rows } })));
}
