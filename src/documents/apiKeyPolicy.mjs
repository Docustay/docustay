// src/documents/apiKeyPolicy.mjs — FP-G1: draft-only keys and per-key daily limits for the Documents API.
// A DRAFT-ONLY key may make and edit drafts. Asking it to send does not send: it files an approval request that a person decides in the app (the document stays a draft until then).
// A key with no policy row behaves as before. Limits are exact: the counter is bumped in the same transaction as the work, so a refused call counts nothing.
import { invalid, notFound, conflict, rateLimited } from "../http/errors.mjs";
import { apiSendDraft } from "./pdfApiV2.mjs";
import { emit, apiKeyActor, userActor } from "../events/outbox.mjs";
import { ports } from "./ports.mjs";

const COLS = "draft_only, max_drafts_per_day, max_sends_per_day";
const shape = (r) => (r ? { draftOnly: r.draft_only, maxDraftsPerDay: r.max_drafts_per_day, maxSendsPerDay: r.max_sends_per_day } : { draftOnly: false, maxDraftsPerDay: null, maxSendsPerDay: null });

/** The key making this request (set by the token path for the whole transaction), or null when there is none (a browser session). */
export async function currentKeyId(tx) {
  const { rows: [r] } = await tx.query(`SELECT nullif(current_setting('keystone.actor_api_key', true), '') AS k`);
  return r?.k ?? null;
}

export async function policyFor(tx, tokenId) {
  if (!tokenId) return shape(null);
  const { rows: [r] } = await tx.query(`SELECT ${COLS} FROM keystone.document_key_policy WHERE token_id = $1`, [tokenId]);
  return shape(r);
}

/** Every key's policy as a map tokenId → policy (for the key list). */
export async function policiesByKey(tx) {
  const { rows } = await tx.query(`SELECT token_id, ${COLS} FROM keystone.document_key_policy`);
  return Object.fromEntries(rows.map((r) => [r.token_id, shape(r)]));
}

const limitOf = (v, field) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw invalid(`${field} must be a whole number from 1 to 100000, or left empty for no limit`, { field });
  return n;
};

export async function savePolicy(tx, { tenantId, tokenId, draftOnly = false, maxDraftsPerDay = null, maxSendsPerDay = null }) {
  if (typeof tokenId !== "string" || !tokenId) throw invalid("a key is required", { field: "tokenId" });
  if (typeof draftOnly !== "boolean") throw invalid("draftOnly is true or false", { field: "draftOnly" });
  const d = limitOf(maxDraftsPerDay, "maxDraftsPerDay"), s = limitOf(maxSendsPerDay, "maxSendsPerDay");
  await tx.query(
    `INSERT INTO keystone.document_key_policy (tenant_id, token_id, draft_only, max_drafts_per_day, max_sends_per_day) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, token_id) DO UPDATE SET draft_only = EXCLUDED.draft_only, max_drafts_per_day = EXCLUDED.max_drafts_per_day, max_sends_per_day = EXCLUDED.max_sends_per_day, updated_at = now()`,
    [tenantId, tokenId, draftOnly, d, s]);
  return { draftOnly, maxDraftsPerDay: d, maxSendsPerDay: s };
}

/** Count one draft or one send against the key's day and refuse (429) past its limit. No key (a browser session) or no limit: nothing counted, nothing refused. */
export async function countAgainstLimit(tx, { tenantId, kind }) {
  const tokenId = await currentKeyId(tx);
  if (!tokenId) return;
  const p = await policyFor(tx, tokenId);
  const limit = kind === "draft" ? p.maxDraftsPerDay : p.maxSendsPerDay;
  const col = kind === "draft" ? "drafts" : "sends";
  const { rows: [r] } = await tx.query(
    `INSERT INTO keystone.document_key_usage_day (tenant_id, token_id, day, ${col}) VALUES ($1,$2,(now() AT TIME ZONE 'UTC')::date,1)
     ON CONFLICT (tenant_id, token_id, day) DO UPDATE SET ${col} = keystone.document_key_usage_day.${col} + 1 RETURNING ${col} AS n`, [tenantId, tokenId]);
  if (limit != null && r.n > limit) throw rateLimited(`this key has reached its limit of ${limit} ${kind === "draft" ? "drafts" : "sends"} for today (UTC); it starts again at midnight UTC`, { limit, kind });
}

/** A draft-only key asked to send: file (or find) the request. Returns the approval. */
export async function requestSendApproval(tx, { tenantId, instanceId, test = false }) {
  const tokenId = await currentKeyId(tx);
  const { rows: [open] } = await tx.query(`SELECT id, status FROM keystone.document_send_approval WHERE instance_id = $1 AND status = 'pending'`, [instanceId]);
  if (open) return { id: open.id, status: "pending", instanceId };
  const { rows: [r] } = await tx.query(
    `INSERT INTO keystone.document_send_approval (tenant_id, instance_id, token_id, key_name, test)
     VALUES ($1,$2,$3, CASE WHEN $3::text IS NULL THEN NULL ELSE keystone.api_key_name($3::text) END, $4) RETURNING id`, [tenantId, instanceId, tokenId, test]);
  await emit(tx, { tenantId, topic: "documents.approval.requested", emittedBy: "documents", subjectType: "document", subjectId: instanceId, actor: tokenId ? apiKeyActor(tokenId) : "system", payload: { approvalId: r.id } });
  return { id: r.id, status: "pending", instanceId };
}

export async function listApprovals(tx, { status = null, limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await tx.query(
    `SELECT a.id, a.instance_id, a.token_id, a.key_name, a.test, a.status, a.requested_at, a.decided_at, a.decided_by, a.note, i.title
       FROM keystone.document_send_approval a LEFT JOIN keystone.document_instance i ON i.id = a.instance_id
      WHERE ($1::text IS NULL OR a.status = $1) ORDER BY a.requested_at DESC LIMIT $2`, [status, lim]);
  const ids = [...new Set(rows.map((r) => r.decided_by).filter(Boolean))];
  const names = new Map(ids.length ? (await (await ports()).people.byIds(tx, ids)).map((p) => [p.id, p.display_name]) : []);
  const iso = (v) => v?.toISOString?.() ?? v ?? null;
  return rows.map((r) => ({ id: r.id, documentId: r.instance_id, title: r.title ?? null, keyId: r.token_id, keyName: r.key_name, test: r.test, status: r.status, requestedAt: iso(r.requested_at), decidedAt: iso(r.decided_at), decidedBy: r.decided_by ? { id: r.decided_by, name: names.get(r.decided_by) ?? null } : null, note: r.note }));
}

/** A person decides. Approving sends the draft now, as that person; declining leaves it a draft. */
export async function decideApproval(tx, { tenantId, id, approve, userId, note = null }) {
  const { rows: [a] } = await tx.query(`SELECT id, instance_id, test, status FROM keystone.document_send_approval WHERE id = $1 FOR UPDATE`, [id]);
  if (!a) throw notFound("that request does not exist");
  if (a.status !== "pending") throw conflict(`that request was already ${a.status}`);
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null;
  if (!approve) {
    await tx.query(`UPDATE keystone.document_send_approval SET status='declined', decided_at=now(), decided_by=$2, note=$3 WHERE id=$1`, [id, userId, cleanNote]);
    await emit(tx, { tenantId, topic: "documents.approval.decided", emittedBy: "documents", subjectType: "document", subjectId: a.instance_id, actor: userId ? userActor(userId) : "system", payload: { approvalId: id, decision: "declined" } });
    return { id, status: "declined" };
  }
  const sent = await apiSendDraft(tx, { tenantId, ownerId: userId, instanceId: a.instance_id, test: a.test });
  await tx.query(`UPDATE keystone.document_send_approval SET status='approved', decided_at=now(), decided_by=$2, note=$3 WHERE id=$1`, [id, userId, cleanNote]);
  await emit(tx, { tenantId, topic: "documents.approval.decided", emittedBy: "documents", subjectType: "document", subjectId: a.instance_id, actor: userId ? userActor(userId) : "system", payload: { approvalId: id, decision: "approved" } });
  return { id, status: "approved", emailed: sent.emailed, notEmailed: sent.notEmailed };
}
