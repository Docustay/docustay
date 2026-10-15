// src/documents/auditExport.mjs — the workspace-wide audit trail (every document's events), as rows or as CSV (FP-E6).
import { db as kdb, run } from "../db/kysely.mjs";

const MAX = 5000;

export async function listWorkspaceAudit(tx, { tenantId, from = null, to = null, kind = null, limit = 500 }) {
  const n = Math.min(Math.max(Number.parseInt(limit, 10) || 500, 1), MAX);
  let q = kdb.selectFrom("keystone.document_audit_event")
    .select(["instance_id", "kind", "actor_role", "occurred_at", "detail"])
    .where("tenant_id", "=", tenantId);
  if (from) q = q.where("occurred_at", ">=", new Date(from));
  if (to) q = q.where("occurred_at", "<", new Date(to));
  if (kind) q = q.where("kind", "=", kind);
  const { rows } = await run(tx, q.orderBy("occurred_at", "desc").limit(n));
  return rows;
}

const cell = (v) => {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function auditCsv(rows) {
  const head = ["occurred_at", "document_id", "event", "actor_role", "detail"];
  return [head.join(","), ...rows.map((r) => [r.occurred_at, r.instance_id, r.kind, r.actor_role, r.detail].map(cell).join(","))].join("\r\n") + "\r\n";
}
