// THE PLATFORM'S VIEW OF AI SPEND (AI-COST-AND-USAGE-SPEC §4–§5): what the hosted service has spent on the platform's own AI key against the ceiling, by plan, by kind of work and by model, the busiest
// workspaces, errors, a day-by-day series, and a CSV of the ledger. Every query goes through the definer functions of migration 0690, which answer only for the platform viewers (docustay_may_view()).
import { platformSpendSince, platformState } from "./ledger.mjs";

const day = (d) => new Date(d).toISOString().slice(0, 10);
const usd = (micro) => Math.round(Number(micro ?? 0)) / 1_000_000;

export async function platformSummary(db, { now = new Date(), ceilingUsdDefault = 150 } = {}) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const st = await platformState(db);
  const ceilingUsd = st.monthlyUsd ?? ceilingUsdDefault;
  const [monthMicro, dayMicro] = await Promise.all([platformSpendSince(db, monthStart), platformSpendSince(db, dayStart)]);
  const { rows } = await db.query(`SELECT * FROM keystone.document_ai_platform_report($1::timestamptz, $2::timestamptz)`, [monthStart, monthEnd]);
  const sum = (key, pick) => { const m = new Map(); for (const r of rows) { const k = r[key] ?? "(none)"; const o = m.get(k) ?? { key: k, calls: 0, credits: 0, usd: 0, errors: 0 }; if (r.status === "ok" || r.status === "error") o.usd += usd(r.cost_micro_usd); if (r.status === "ok") { o.calls += r.calls; o.credits += Number(r.credits); } if (r.status === "error") o.errors += r.calls; m.set(k, o); } return [...m.values()].sort((a, b) => b.usd - a.usd).map((o) => ({ ...o, usd: Math.round(o.usd * 10000) / 10000, credits: Math.round(o.credits * 1000) / 1000 })); };
  const series = new Map(); for (const r of rows) { if (r.status === "ok" || r.status === "error") series.set(day(r.day), (series.get(day(r.day)) ?? 0) + usd(r.cost_micro_usd)); }
  const { rows: top } = await db.query(`SELECT * FROM keystone.document_ai_platform_top($1::timestamptz, $2::timestamptz, 10)`, [monthStart, monthEnd]);
  const ceilingMicro = ceilingUsd * 1_000_000;
  return {
    month: monthStart.toISOString().slice(0, 7), ceilingUsd, ceilingFromSetting: st.monthlyUsd != null, dailyCeilingUsd: Math.round((ceilingUsd / 20) * 100) / 100, paused: st.paused,
    spentMonthUsd: usd(monthMicro), spentTodayUsd: usd(dayMicro), percentOfCeiling: ceilingMicro > 0 ? Math.round((monthMicro / ceilingMicro) * 1000) / 10 : null,
    ceilingReached: monthMicro >= ceilingMicro || dayMicro >= ceilingMicro / 20,
    byPlan: sum("plan_key"), byFeature: sum("feature"), byModel: sum("model"),
    errors: rows.filter((r) => r.status === "error").reduce((a, r) => a + r.calls, 0), refused: rows.filter((r) => r.status.startsWith("refused")).reduce((a, r) => a + r.calls, 0),
    daily: [...series.entries()].sort().map(([d, u]) => ({ day: d, usd: Math.round(u * 10000) / 10000 })),
    top: top.map((t) => ({ tenantId: t.tenant_id, workspace: t.workspace, plan: t.plan_key, calls: t.calls, credits: Number(t.credits), usd: usd(t.cost_micro_usd), errors: t.errors, ownKey: t.own_key === true })),
  };
}

const csvCell = (v) => { const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** The ledger for a period as CSV (no prompt, no document, no person: ids of workspaces, features, models, tokens, cost). */
export async function platformEventsCsv(db, { from, to }) {
  const { rows } = await db.query(`SELECT * FROM keystone.document_ai_platform_events($1::timestamptz, $2::timestamptz, 20000)`, [from, to]);
  const head = ["created_at", "workspace_id", "plan", "feature", "provider", "model", "effort", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd", "credits", "status", "own_key", "duration_ms", "code"];
  const lines = rows.map((r) => [r.created_at, r.tenant_id, r.plan_key, r.feature, r.provider, r.model, r.effort, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, usd(r.cost_micro_usd).toFixed(6), Number(r.credits), r.status, r.own_key, r.duration_ms, r.code].map(csvCell).join(","));
  return `${head.join(",")}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

/** Which alert levels (50, 80, 100 percent of the monthly ceiling) the spend has reached. */
export const levelsReached = (spentMicro, ceilingMicro, levels = [50, 80, 100]) => (ceilingMicro > 0 ? levels.filter((l) => spentMicro >= (ceilingMicro * l) / 100) : []);
