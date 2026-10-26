// src/routes/developerActivity.mjs — FP-G2: the agent action log. What each API key did and who approved it. Lives with the Developers routes (it reads the API-call log); the approvals come through Documents' front door.
import { forbidden } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listApprovals, listEmails, emailRates, emailGuardState } from "../documents/frontDoor.mjs";
import { listApiCalls } from "../developer/callLog.mjs";

const SECTION = "/documents";

export function registerAgentActivity(app, { runTenantScoped, tenantIsPlatform }) {
  // Calls are method, path and status only (the log never stores a request body, so no prompt text); approvals carry who decided.
  app.get("/api/documents/agent-activity", (c) => runTenantScoped(c, async ({ db, principal, tenantId }) => {
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    await assertMay(db, principal, { object: "document", action: "edit" });
    const keyId = c.req.query("keyId") || null;
    const [{ calls }, approvals] = await Promise.all([listApiCalls(db, { limit: 100, tokenId: keyId }), listApprovals(db, { limit: 100 })]);
    const entries = [
      ...calls.map((x) => ({ id: `call:${x.id}`, at: x.at, kind: "call", key: x.keyName, summary: `${x.method} ${x.path}`, status: x.status })),
      ...approvals.filter((a) => a.keyName && (!keyId || a.keyId === keyId)).flatMap((a) => [
        { id: `asked:${a.id}`, at: a.requestedAt, kind: "asked", key: a.keyName, summary: `asked to send ${a.title ?? "a document"}`, documentId: a.documentId },
        ...(a.decidedAt ? [{ id: `${a.status}:${a.id}`, at: a.decidedAt, kind: a.status, key: a.keyName, summary: `${a.status} ${a.title ?? "a document"}`, by: a.decidedBy?.name ?? null, documentId: a.documentId }] : []),
      ]),
    ].filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 150);
    return { data: { entries } };
  }, { bucket: "documents" }).then((r) => c.json(r)));

  const gate = async ({ db, principal, tenantId }) => {
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    await assertMay(db, principal, { object: "document", action: "edit" });
  };
  // FP-K9: Developers → Email events (the log of email about this workspace's documents) and Platform → Domains and email (the health: rates and whether sending is paused)
  app.get("/api/documents/email-events", (c) => runTenantScoped(c, async (x) => {
    await gate(x); const q = c.req.query();
    return { data: await listEmails(x.db, { limit: q.limit, cursor: q.cursor || null, status: q.status || null, documentId: q.documentId || null, to: q.to || null, kind: q.kind || null }) };
  }, { bucket: "documents" }).then((r) => c.json(r)));
  app.get("/api/documents/email-health", (c) => runTenantScoped(c, async (x) => {
    await gate(x);
    return { data: { rates: await emailRates(x.db), guard: await emailGuardState(x.db) } };
  }, { bucket: "documents" }).then((r) => c.json(r)));
}
