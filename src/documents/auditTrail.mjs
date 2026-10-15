// src/documents/auditTrail.mjs — records and reads the events that populate the audit-trail page.
import { db, run } from "../db/kysely.mjs";

export async function recordAuditEvent(tx, { tenantId, instanceId, kind, actorRole = null, occurredAt = null, detail = null }) {
  await run(tx, db.insertInto("keystone.document_audit_event").values({
    tenant_id: tenantId, instance_id: instanceId, kind, actor_role: actorRole,
    ...(occurredAt ? { occurred_at: occurredAt } : {}),
    // facts that are not personal data (a hash, a page count, a reminder number) — never a name, an email or an IP
    ...(detail ? { detail: JSON.stringify(detail) } : {}),
  }));
}

/**
 * ★ QUEUE §23.2.7 — a person OPENED the document from the client portal. The emailed-link path already wrote `document_open` (ip, device) and an `opened` event; the portal path wrote neither,
 *   so a portal-signed document had no "viewed" time on its certificate. First open per person per document only (a reload is not a new open).
 */
export async function recordPortalOpen(tx, { tenantId, instanceId, openedBy, ip = null, userAgent = null, role = null }) {
  const { rowCount } = await tx.query(
    `INSERT INTO keystone.document_open (tenant_id, instance_id, opened_by, ip, user_agent)
     SELECT $1, $2, $3, $4, $5
      WHERE NOT EXISTS (SELECT 1 FROM keystone.document_open WHERE instance_id = $2 AND opened_by = $3)`,
    [tenantId, instanceId, openedBy, ip, userAgent]);
  if (rowCount > 0) await recordAuditEvent(tx, { tenantId, instanceId, kind: "opened", actorRole: role });
  return rowCount > 0;
}

export async function auditTrailFor(tx, { tenantId, instanceId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.document_audit_event")
    .select(["kind", "actor_role", "occurred_at", "detail"])
    .where("tenant_id", "=", tenantId)
    .where("instance_id", "=", instanceId)
    .orderBy("occurred_at", "asc"));
  // Events written in one transaction share a timestamp; keep the order a person would tell them in (signed before completed).
  const RANK = { uploaded: 0, saved: 1, sent: 2, embed_session: 3, opened: 4, reminded: 5, consented: 6, signed: 7, executed: 8, voided: 9 };
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (Math.floor(new Date(a.r.occurred_at) / 1000) - Math.floor(new Date(b.r.occurred_at) / 1000)) || ((RANK[a.r.kind] ?? 5) - (RANK[b.r.kind] ?? 5)) || (new Date(a.r.occurred_at) - new Date(b.r.occurred_at)) || (a.i - b.i)).map((x) => x.r);
}
