// THE COST LEDGER (AI-COST-AND-USAGE-SPEC §5): one row in keystone.document_ai_usage_event for every model call and every refusal. This file reads and writes it; gateway.mjs decides.
// A failed or refused call is recorded and charges nothing (credits 0, cost 0). Everything the usage bar, the limits and the platform screen show comes from here.
import { costOf } from "./prices.mjs";

const num = (v) => Number(v ?? 0) || 0;

/** The window a usage count is taken over: [start, end). The host's plan decides it (Free: the calendar month in UTC; Pro: its billing anniversary); without one, the calendar month. */
export function monthWindow(now = new Date()) {
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/** Everything limits.decide() needs for one workspace and one person, in ONE query. `window` is {start, end}; `now` a Date. */
export async function usageFor(db, { tenantId, userId = null, window, now = new Date() }) {
  const w = window ?? monthWindow(now);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { rows: [r] } = await db.query(
    `SELECT
       COALESCE(sum(credits) FILTER (WHERE status = 'ok' AND NOT own_key AND created_at >= $2 AND created_at < $3), 0)::float8                      AS credits_used,   -- R13-D530: a draft made on the workspace's own key is free of the allowance
       COALESCE(sum(cost_micro_usd) FILTER (WHERE status IN ('ok','error') AND NOT own_key AND created_at >= $2 AND created_at < $3), 0)::float8 AS usd_micro,
       COALESCE(sum(credits) FILTER (WHERE status = 'ok' AND NOT own_key AND user_id = $5 AND created_at >= $2 AND created_at < $3), 0)::float8    AS user_credits,
       count(DISTINCT user_id) FILTER (WHERE status = 'ok' AND created_at >= $2 AND created_at < $3)::int                                      AS users,
       count(*) FILTER (WHERE status IN ('ok','error') AND created_at > $4::timestamptz - interval '1 minute')::int                              AS per_minute,
       count(*) FILTER (WHERE status IN ('ok','error') AND created_at > $4::timestamptz - interval '1 hour')::int                                AS per_hour,
       count(*) FILTER (WHERE status IN ('ok','error') AND created_at >= $6)::int                                                               AS per_day,
       count(*) FILTER (WHERE status <> 'ok' AND created_at > $4::timestamptz - interval '10 minutes')::int                                      AS failures,
       extract(epoch FROM max(created_at) FILTER (WHERE status <> 'ok' AND created_at > $4::timestamptz - interval '10 minutes')) * 1000        AS last_failure_ms
     FROM keystone.document_ai_usage_event
    WHERE tenant_id = $1 AND created_at >= LEAST($2::timestamptz, $6::timestamptz, $4::timestamptz - interval '1 hour')`,
    [tenantId, w.start, w.end, now, userId, dayStart]);
  return {
    creditsUsed: num(r.credits_used), usdMicroUsed: num(r.usd_micro), userCreditsUsed: num(r.user_credits), users: num(r.users),
    perMinute: num(r.per_minute), perHour: num(r.per_hour), perDay: num(r.per_day),
    failuresInWindow: num(r.failures), lastFailureAt: r.last_failure_ms == null ? null : Math.round(Number(r.last_failure_ms)),
  };
}

/** What the usage card shows: the credits used by kind of work, in the window. */
export async function breakdownFor(db, { tenantId, window, now = new Date() }) {
  const w = window ?? monthWindow(now);
  const { rows } = await db.query(
    `SELECT feature, count(*)::int AS calls, COALESCE(sum(credits), 0)::float8 AS credits FROM keystone.document_ai_usage_event
      WHERE tenant_id = $1 AND status = 'ok' AND created_at >= $2 AND created_at < $3 GROUP BY feature`, [tenantId, w.start, w.end]);
  const by = Object.fromEntries(rows.map((x) => [x.feature, { calls: x.calls, credits: Math.round(x.credits * 1000) / 1000 }]));
  const sum = (...ks) => ks.reduce((a, k) => ({ calls: a.calls + (by[k]?.calls ?? 0), credits: a.credits + (by[k]?.credits ?? 0) }), { calls: 0, credits: 0 });
  const round = (o) => ({ calls: o.calls, credits: Math.round(o.credits * 1000) / 1000 });
  return { drafts: round(sum("draft")), edits: round(sum("edit")), file_reading: round(sum("file_read", "detect", "vision_check")), other: round(sum("chat", "play", "check", "review", "summary")) };
}

/** Write one ledger row. A call that failed after the provider read the request still cost real dollars (they count toward the caps), but it charges the person no credits; a refusal costs nothing. Never throws into the caller's work: a ledger that cannot be written is logged, and the call it describes has already happened. */
export async function recordEvent(db, e) {
  const usage = e.usage ?? {};
  const ok = e.status === "ok";
  const cost = (ok || e.status === "error") ? costOf({ model: e.model, input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite }).micro : 0;
  try {
    await db.query(
      `INSERT INTO keystone.document_ai_usage_event (tenant_id, user_id, feature, provider, model, effort, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, credits, status, own_key, plan_key, duration_ms, request_id, code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [e.tenantId, e.userId ?? null, e.feature, e.provider ?? null, e.model ?? null, e.effort ?? null, Math.max(0, Math.round(num(usage.input))), Math.max(0, Math.round(num(usage.output))),
       Math.max(0, Math.round(num(usage.cacheRead))), Math.max(0, Math.round(num(usage.cacheWrite))), cost, ok ? Math.max(0, num(e.credits)) : 0, e.status, Boolean(e.own), e.planKey ?? null,
       e.durationMs == null ? null : Math.round(e.durationMs), e.requestId ?? null, e.code ? String(e.code).slice(0, 60) : null]);
    return { costMicro: cost };
  } catch (err) {
    console.error(`ai usage ledger: could not record ${e.feature}/${e.status}: ${err?.message ?? err}`);
    return { costMicro: cost, failed: true };
  }
}

/** One number: dollars (in micro) the platform's own key has cost since `from`, across every workspace (no workspace, no person: the definer function returns only the sum). */
export async function platformSpendSince(db, from) {
  const { rows: [r] } = await db.query(`SELECT keystone.document_ai_platform_spend($1::timestamptz)::float8 AS micro`, [from]);
  return num(r?.micro);
}
/** The platform's own ceiling and pause (null ceiling = the environment default applies). */
export async function platformState(db) {
  const { rows: [r] } = await db.query(`SELECT platform_tenant_id, monthly_usd::float8 AS monthly_usd, paused FROM keystone.document_ai_platform_state()`);
  return { platformTenantId: r?.platform_tenant_id ?? null, monthlyUsd: r?.monthly_usd == null ? null : Number(r.monthly_usd), paused: r?.paused === true };
}
