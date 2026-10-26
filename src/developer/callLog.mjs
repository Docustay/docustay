// src/developer/callLog.mjs — THE API-CALL LOG (FP-C2, 7 Oct 2026): one row per authenticated developer API call, written after the call is answered, read back by the Developers screen.
// ★ Never a body, a header or a secret: time, which key (id and name), method, route, status, duration, the request id and the caller's address. Kept 30 days.
// ★ The write is best-effort and AFTER the answer: a log failure must never turn a good API call into an error. It runs in its own transaction because the call's own may have rolled back.
import { withTenant } from "../db/index.mjs";

const RETENTION_DAYS = 30;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Record one call. Returns true when a row was written, false when the call was not loggable (unknown method) or the write failed. */
export async function recordApiCall({ tenantId, tokenId = null, method, path, status, durationMs, requestId = null, ip = null, reason = null }) {
  if (!tenantId || !METHODS.has(method)) return false;
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO keystone.api_call_log (tenant_id, token_id, key_name, method, path, status, duration_ms, request_id, ip, reason)
         VALUES ($1, $2, CASE WHEN $2::text IS NULL THEN NULL ELSE keystone.api_key_name($2::text) END, $3, $4, $5, $6, $7, $8, $9)`,
        [tenantId, tokenId, method, String(path).slice(0, 300), status, Math.max(0, Math.round(durationMs)), requestId, ip, reason ? String(reason).slice(0, 40) : null]);
      // retention: roughly one write in fifty also sweeps this workspace's rows older than the window
      if (Math.random() < 0.02) await tx.query(`DELETE FROM keystone.api_call_log WHERE tenant_id = $1 AND at < now() - make_interval(days => $2)`, [tenantId, RETENTION_DAYS]);
    });
    return true;
  } catch { return false; }
}

/** A page of calls, newest first, with optional filters. `cursor` is the (at, id) of the last row seen. */
export async function listApiCalls(tx, { limit = 50, cursor = null, status = null, method = null, path = null, requestId = null, tokenId = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200), where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (requestId) add("request_id = ?", String(requestId));
  if (tokenId) add("token_id = ?", String(tokenId));
  if (method && METHODS.has(String(method).toUpperCase())) add("method = ?", String(method).toUpperCase());
  if (path) add("path ILIKE ?", `%${String(path).replace(/[%_\\]/g, "\\$&")}%`);
  if (status === "errors") where.push("status >= 400");
  else if (/^[2345]xx$/.test(String(status ?? ""))) { params.push(Number(String(status)[0]) * 100); where.push(`status BETWEEN $${params.length}::int AND $${params.length}::int + 99`); }
  else if (/^\d{3}$/.test(String(status ?? ""))) add("status = ?", Number(status));
  if (cursor) { const [at, id] = String(cursor).split("|"); if (at && id) { params.push(at, id); where.push(`(at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); } }
  const { rows } = await tx.query(
    `SELECT id, at, token_id, key_name, method, path, status, duration_ms, request_id, ip, reason FROM keystone.api_call_log${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY at DESC, id DESC LIMIT ${lim + 1}`, params);
  const page = rows.slice(0, lim);
  const last = page[page.length - 1];
  return {
    calls: page.map((r) => ({ id: r.id, at: r.at instanceof Date ? r.at.toISOString() : r.at, keyId: r.token_id, keyName: r.key_name, method: r.method, path: r.path, status: r.status, durationMs: r.duration_ms, requestId: r.request_id, ip: r.ip, reason: r.reason ?? null })),
    nextCursor: rows.length > lim && last ? `${last.at instanceof Date ? last.at.toISOString() : last.at}|${last.id}` : null,
    retentionDays: RETENTION_DAYS,
  };
}

/** FP-F9 — the usage screen: totals, errors, the slow end, calls per day, per key and the busiest routes over the last `days` (capped at the retention window). */
export async function usageSummary(tx, { days = 7 } = {}) {
  const d = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), RETENTION_DAYS);
  const since = `now() - make_interval(days => ${d})`;
  const { rows: [tot] } = await tx.query(`SELECT count(*)::int AS calls, count(*) FILTER (WHERE status >= 400)::int AS errors, count(*) FILTER (WHERE status >= 500)::int AS failures,
      coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p50, coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95 FROM keystone.api_call_log WHERE at >= ${since}`);
  const { rows: byDay } = await tx.query(`SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, count(*)::int AS calls, count(*) FILTER (WHERE status >= 400)::int AS errors FROM keystone.api_call_log WHERE at >= ${since} GROUP BY 1 ORDER BY 1`);
  const { rows: byKey } = await tx.query(`SELECT token_id, max(key_name) AS name, count(*)::int AS calls, count(*) FILTER (WHERE status >= 400)::int AS errors, max(at) AS last_at FROM keystone.api_call_log WHERE at >= ${since} GROUP BY token_id ORDER BY calls DESC LIMIT 20`);
  const { rows: byRoute } = await tx.query(`SELECT method, path, count(*)::int AS calls, count(*) FILTER (WHERE status >= 400)::int AS errors FROM keystone.api_call_log WHERE at >= ${since} GROUP BY method, path ORDER BY calls DESC LIMIT 10`);
  return { days: d, calls: tot.calls, errors: tot.errors, failures: tot.failures, p50Ms: tot.p50, p95Ms: tot.p95, byDay,
    byKey: byKey.map((r) => ({ keyId: r.token_id, name: r.name, calls: r.calls, errors: r.errors, lastAt: r.last_at instanceof Date ? r.last_at.toISOString() : r.last_at })), byRoute };
}
