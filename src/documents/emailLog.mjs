// src/documents/emailLog.mjs — THE LOG OF EMAIL ABOUT DOCUMENTS, AND THE GUARD THAT PAUSES A WORKSPACE BEFORE IT HARMS EVERYONE ELSE (FP-K4/K6, 7 Oct 2026).
// Every email Docustay sends about a document is one row: who it went to (a person named on that document), the subject, what happened. No body, no link, no code. Delivery news from the mail provider updates the row
// and tells the workspace's webhooks (`documents.email.delivered|bounced|complained`, carrying ids only — never an address).
// ★ The guard watches the last 30 days. A workspace whose emails bounce at 2% or draw spam complaints at 0.05% (the provider's own limits for the WHOLE account are 4% and 0.08%) is paused automatically; its owner resumes
//   it after cleaning the list. A paused workspace's mail is refused with a plain sentence — it is never silently dropped.
import { emit } from "../events/outbox.mjs";
import { invalid, forbidden } from "../http/errors.mjs";
import { ports } from "./ports.mjs";

const GUARD = Object.freeze({ bounceRate: 0.02, complaintRate: 0.0005, minSample: 50, windowDays: 30 });
// 21 Oct 2026 (the maintainer, pricing integrity, decision 6): in a workspace's first 7 days spam reports are judged on a smaller sample and a stricter line, because that is when a bad sender shows itself
const GUARD_NEW = Object.freeze({ days: 7, minSample: 20, complaintRate: 0.001 });
export const KINDS = ["invitation", "reminder", "completed", "declined", "voided", "expired", "code", "receipt", "hold_lapsed", "other"];
const STATUS_OF = { sent: "sent", skipped: "skipped", failed: "failed", limit_reached: "limit_reached" };

/** Record one send. Never throws: a log that cannot be written must not stop the email or the action that caused it. */
export async function logEmail(tx, { tenantId, instanceId = null, partyId = null, seat = null, kind = "other", to, subject = "", outcome, isTest = false }) {
  try {
    if (!to) return null;
    const { rows: [r] } = await tx.query(
      `INSERT INTO keystone.document_email_log (tenant_id, instance_id, party_id, seat, kind, to_email, subject, status, provider_message_id, error, is_test)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tenantId, instanceId, partyId, seat, KINDS.includes(kind) ? kind : "other", String(to).slice(0, 254), String(subject ?? "").slice(0, 300), STATUS_OF[outcome?.status] ?? (outcome?.status === "paused" ? "paused" : "sent"),
       outcome?.providerMessageId ?? null, outcome?.error ? String(outcome.error).slice(0, 300) : null, isTest === true]);
    return r?.id ?? null;
  } catch { return null; }
}

/** Has this kind of email already gone to this address about this document? (A failed or skipped attempt does not count, so it can be tried again.) The signed-copy job uses it to send once however many times it runs. */
export async function alreadyEmailed(tx, { instanceId, kind, to }) {
  if (!instanceId || !kind || !to) return false;
  const { rows } = await tx.query(
    `SELECT 1 FROM keystone.document_email_log WHERE instance_id = $1 AND kind = $2 AND lower(to_email) = lower($3) AND status IN ('sent','delivered') LIMIT 1`,
    [instanceId, kind, String(to)]);
  return rows.length > 0;
}

const shape = (r) => ({ id: r.id, documentId: r.instance_id, seat: r.seat, kind: r.kind, to: r.to_email, subject: r.subject, status: r.status, error: r.error, test: r.is_test, createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at });

/** A page of the log, newest first. Filters: document, recipient, status, kind. */
export async function listEmails(tx, { limit = 50, cursor = null, documentId = null, to = null, status = null, kind = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200), where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (documentId) add("instance_id = ?", documentId);
  if (to) add("lower(to_email) = lower(?)", String(to));
  if (status && ["sent", "delivered", "bounced", "complained", "failed", "skipped", "paused", "limit_reached"].includes(status)) add("status = ?", status);
  if (kind && KINDS.includes(kind)) add("kind = ?", kind);
  if (cursor) { const [at, id] = String(cursor).split("|"); if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid("That cursor is not valid. Use the nextCursor from the previous page.", { field: "cursor" }); {  params.push(at, id); where.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); } }
  const { rows } = await tx.query(`SELECT * FROM keystone.document_email_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ${lim + 1}`, params);
  const page = rows.slice(0, lim), last = page[page.length - 1];
  return { emails: page.map(shape), nextCursor: rows.length > lim && last ? `${last.created_at instanceof Date ? last.created_at.toISOString() : last.created_at}|${last.id}` : null };
}

/** What the mail provider told us about one message: update its row, tell the workspace's webhooks, and check the guard. Returns { applied }. */
export async function noteDelivery(tx, { tenantId, providerMessageId, kind }) {
  if (!providerMessageId || !["delivered", "bounced", "complained"].includes(kind)) return { applied: false };
  const { rows: [row] } = await tx.query(
    `UPDATE keystone.document_email_log SET status = CASE WHEN status IN ('bounced','complained') THEN status ELSE $3 END, updated_at = now()
      WHERE tenant_id = $1 AND provider_message_id = $2 RETURNING id, instance_id, seat, kind AS email_kind`, [tenantId, providerMessageId, kind]);
  if (!row) return { applied: false };
  await emit(tx, { tenantId, topic: `documents.email.${kind}`, emittedBy: "documents", subjectType: "document", subjectId: row.instance_id ?? row.id, actor: "system", payload: { email_id: row.id, kind: row.email_kind, seat: row.seat } });
  if (kind !== "delivered") await checkGuard(tx, { tenantId });
  return { applied: true };
}

/** The rates over the window, and whether they are past the line. */
export async function ratesFor(tx, { tenantId = null } = {}) {   // with a tenant named, only that workspace's mail counts, even for a caller that is not under row-level security (one workspace's bounces must never pause another's sending)
  const { rows: [r] } = await tx.query(
    `SELECT count(*) FILTER (WHERE status <> 'paused' AND status <> 'skipped' AND status <> 'limit_reached' AND status <> 'failed')::int AS sent, count(*) FILTER (WHERE status = 'bounced')::int AS bounced, count(*) FILTER (WHERE status = 'complained')::int AS complained
       FROM keystone.document_email_log WHERE created_at > now() - make_interval(days => $1) AND NOT is_test AND ($2::uuid IS NULL OR tenant_id = $2::uuid)`, [GUARD.windowDays, tenantId]);
  const bounceRate = r.sent ? r.bounced / r.sent : 0, complaintRate = r.sent ? r.complained / r.sent : 0;
  let young = false;
  if (tenantId) { const { rows: [t] } = await tx.query(`SELECT created_at FROM keystone.tenant WHERE id = $1`, [tenantId]); young = Boolean(t?.created_at) && Date.now() - new Date(t.created_at).getTime() < GUARD_NEW.days * 86_400_000; }
  const over = (r.sent >= GUARD.minSample && (bounceRate >= GUARD.bounceRate || complaintRate >= GUARD.complaintRate))
    || (young && r.sent >= GUARD_NEW.minSample && complaintRate >= GUARD_NEW.complaintRate);
  return { sent: r.sent, bounced: r.bounced, complained: r.complained, bounceRate, complaintRate, over, limits: GUARD };
}

async function checkGuard(tx, { tenantId }) {
  const rates = await ratesFor(tx, { tenantId });
  if (!rates.over) return { paused: false, rates };
  const { rows: [was] } = await tx.query(`SELECT paused_at FROM keystone.document_email_guard WHERE tenant_id = $1`, [tenantId]);
  const reason = rates.bounceRate >= GUARD.bounceRate ? `${(rates.bounceRate * 100).toFixed(1)}% of the last ${rates.sent} emails bounced` : `${(rates.complaintRate * 100).toFixed(2)}% of the last ${rates.sent} emails were reported as spam`;
  const { rows: [g] } = await tx.query(
    `INSERT INTO keystone.document_email_guard (tenant_id, paused_at, paused_reason) VALUES ($1, now(), $2)
     ON CONFLICT (tenant_id) DO UPDATE SET paused_at = COALESCE(keystone.document_email_guard.paused_at, now()), paused_reason = COALESCE(keystone.document_email_guard.paused_reason, EXCLUDED.paused_reason), updated_at = now()
     RETURNING (xmax = 0) AS first`, [tenantId, reason]);
  await emit(tx, { tenantId, topic: "documents.email.paused", emittedBy: "documents", actor: "system", payload: { cause: rates.bounceRate >= GUARD.bounceRate ? "bounced" : "spam_reports", sent: rates.sent, bounced: rates.bounced, complained: rates.complained } });   // FIX PASS 3 (the payload may hold only ids, numbers and enum-like words, so the sentence stays in the guard row): it named a subject type ("workspace") that does not exist, so emit() threw and the bounce webhook that should pause sending failed instead
  if (!was?.paused_at) { try { await (await ports()).entitlements?.noteEmailPaused?.(tx, { tenantId, cause: rates.bounceRate >= GUARD.bounceRate ? "bounced" : "spam_reports", reason }); } catch (e) { console.error(`email pause notice: ${e?.message ?? e}`); } }   // the host tells the Owners and flags it for review
  return { paused: true, reason, rates };
}

/** Is this workspace paused? → { paused, reason, since } */
export async function guardState(tx, { tenantId = null } = {}) {   // with a tenant named, only that workspace's pause counts, even for a caller that is not under row-level security
  const { rows: [g] } = await tx.query(`SELECT paused_at, paused_reason FROM keystone.document_email_guard WHERE paused_at IS NOT NULL AND ($1::uuid IS NULL OR tenant_id = $1::uuid)`, [tenantId]);
  return g ? { paused: true, reason: g.paused_reason, since: g.paused_at instanceof Date ? g.paused_at.toISOString() : g.paused_at } : { paused: false, reason: null, since: null };
}

/** The owner resumes sending after cleaning the list. The 30-day window still counts what happened, so a list that is still bad pauses again at the next bounce. */
export async function resume(tx, { tenantId, userId = null }) {
  // 21 Oct 2026: a pause for SPAM REPORTS is lifted by us, not by the sender: people said they did not want this mail, and a button would let the same list be sent again
  const g0 = await guardState(tx, { tenantId });
  if (g0.paused && /reported as spam/i.test(String(g0.reason))) throw forbidden("Sending was paused because recipients reported your emails as spam. Email support and we will look at it with you.", { code: "email_paused_for_spam" });
  await tx.query(`UPDATE keystone.document_email_guard SET paused_at = NULL, paused_reason = NULL, resumed_at = now(), resumed_by = $2, updated_at = now() WHERE tenant_id = $1`, [tenantId, userId]);
  return guardState(tx, { tenantId });
}

/** Refuse to send while paused, with a sentence a person can act on. Returns null when sending is allowed. */
export async function pausedRefusal(tx, { tenantId = null } = {}) {
  const g = await guardState(tx, { tenantId });
  return g.paused ? `Sending is paused for this workspace: ${g.reason}. Clean up the addresses that bounced, then resume sending in Settings → Email.` : null;
}
