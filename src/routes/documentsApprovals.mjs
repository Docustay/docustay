// src/routes/documentsApprovals.mjs — FP-G1: the sends a draft-only API key asked for, waiting for a person (Settings → Developers → Approvals).
import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection } from "../nav/authorise.mjs";
import { assertMay } from "../permissions/assertMay.mjs";
import { listApprovals, decideApproval } from "../documents/frontDoor.mjs";

const SECTION = "/documents";
const idOf = (a) => { if (typeof a.id !== "string" || !a.id) throw invalid("id is required", { field: "id" }); return a.id; };

export const APPROVAL_WRITES = Object.freeze([
  { path: "/api/documents/approvals/decide", section: SECTION, object: "document", action: "edit", subject: null,
    fn: (tx, a) => decideApproval(tx, { tenantId: a.tenantId, id: idOf(a), approve: a.approve === true, userId: a.actorUserId ?? null, note: a.note ?? null }) },
]);

export function registerApprovalReads(app, { runTenantScoped, tenantIsPlatform }) {
  app.get("/api/documents/approvals", (c) => runTenantScoped(c, async ({ db, principal, tenantId }) => {
    const decision = authoriseSection(principal.user, SECTION, { tenantIsPlatform: await tenantIsPlatform(db, tenantId) });
    if (!decision.allowed) throw forbidden(`refused: ${decision.reason}`);
    await assertMay(db, principal, { object: "document", action: "edit" });
    const status = c.req.query("status");
    return { data: { approvals: await listApprovals(db, { status: ["pending", "approved", "declined", "failed"].includes(status) ? status : null }) } };
  }, { bucket: "documents" }).then((r) => c.json(r)));
}
