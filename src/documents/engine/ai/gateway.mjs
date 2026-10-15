// THE AI GATEWAY (AI-COST-AND-USAGE-SPEC §3–§6): every model call in the product goes admit() → (the call) → finish(). admit() chooses the model at ONE place, applies the limits and the platform pause, and records a
// refusal in the ledger; finish() records what the call really used and cost. No call site names a model, a price or a limit.
// The plan's policy comes from the host through the `entitlements.aiPolicy` port (null = a self-host or an organisation on no Docustay plan: no hosted allowance, only the workspace's own AI settings and the abuse limits).
import { randomUUID } from "node:crypto";
import { emit } from "../../../events/outbox.mjs";
import { conflict } from "../../../http/errors.mjs";
import { ports } from "../../ports.mjs";
import { decide, MSG, fractionUsed, stateOf } from "./limits.mjs";
import { modelFor } from "./modelPolicy.mjs";
import { usageFor, recordEvent, platformSpendSince, platformState, monthWindow, breakdownFor } from "./ledger.mjs";

/** The test provider exists only where the environment says so, and never in production (a startup check refuses the combination as well: assertAiEnvironment). */
export function fakeAllowed(env = process.env) {
  return env.KEYSTONE_AI_ALLOW_FAKE === "1" && env.KEYSTONE_ENVIRONMENT !== "production";
}
export function assertAiEnvironment(env = process.env) {
  if (env.KEYSTONE_AI_ALLOW_FAKE === "1" && env.KEYSTONE_ENVIRONMENT === "production") throw new Error("KEYSTONE_AI_ALLOW_FAKE=1 is set in production: the test AI provider must never be enabled there. Unset it and restart.");
}

const fmtDay = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** The host's AI policy for this workspace, with the window it is counted over. null when the host has none. */
export async function loadPolicy(db, { tenantId, now = new Date() }) {
  let P; try { P = await ports(); } catch { return null; }
  const p = P?.entitlements?.aiPolicy ? await P.entitlements.aiPolicy(db, { tenantId, now }) : null;
  if (!p) return null;
  const window = p.window?.start && p.window?.end ? { start: new Date(p.window.start), end: new Date(p.window.end) } : monthWindow(now);
  return { ...p, window };
}
const ownKeyPresent = async (db, tenantId) => (await db.query(`SELECT 1 FROM keystone.document_ai_secret WHERE tenant_id = $1 LIMIT 1`, [tenantId])).rowCount > 0;

/** Month-to-date and today's spend on the platform's own key against the ceiling (the Docustay owner's bill). */
export async function platformStatus(db, { policy, now = new Date(), env = process.env }) {
  const st = await platformState(db).catch(() => ({ monthlyUsd: null, paused: true, platformTenantId: null }));   // the platform's own cost guard fails CLOSED: if its state cannot be read, the platform key is treated as paused
  const ceilingUsd = st.monthlyUsd ?? policy?.platformMonthlyUsd ?? null;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let monthMicro = 0, dayMicro = 0, spendUnreadable = false;
  if (ceilingUsd != null) { monthMicro = await platformSpendSince(db, monthStart).catch(() => { spendUnreadable = true; return 0; }); dayMicro = await platformSpendSince(db, dayStart).catch(() => { spendUnreadable = true; return 0; }); }
  const ceilingMicro = ceilingUsd == null ? null : ceilingUsd * 1_000_000;
  const ceilingReached = ceilingMicro != null && (spendUnreadable || monthMicro >= ceilingMicro || dayMicro >= ceilingMicro / 20);   // spend that cannot be read is not zero spend
  return { paused: st.paused, ceilingUsd, ceilingMicro, monthMicro, dayMicro, ceilingReached, platformTenantId: st.platformTenantId };
}

/** A refusal is thrown out of the caller's transaction, which then rolls back, so the ledger row is written in a transaction of its own (the host's `queue.runAs`); without one (a test, a bare island) it goes into the caller's. */
async function recordDurably(db, tenantId, userId, event) {
  let P = null; try { P = await ports(); } catch { /* no host */ }
  if (P?.queue?.runAs) { try { await P.queue.runAs({ tenantId, userId }, (t) => recordEvent(t, event)); return; } catch (e) { console.error(`ai usage ledger: refusal not written separately: ${e?.message ?? e}`); } }
  await recordEvent(db, event);
}
const refusal = (r) => conflict(r.message, { code: r.code, ...(r.retryAfterSeconds ? { retryAfterSeconds: r.retryAfterSeconds } : {}) });

/**
 * Ask to make a model call. Returns the context finish() needs, or throws a plain-words refusal (and records it in the ledger).
 * @param {object} a  { tenantId, userId, feature, cfg (readAiConfig), thinkHarder, weight (override), record (default true: write the refusal), requestId, now, env }
 */
export async function admit(db, { tenantId, userId = null, feature, cfg, thinkHarder = false, weight = null, recordRefusal = true, requestId = null, now = new Date(), env = process.env, selfHost = env.KEYSTONE_SELF_HOST === "1" }) {
  const own = await ownKeyPresent(db, tenantId);
  if (cfg?.provider === "fake" && !fakeAllowed(env)) throw conflict("The test provider is not available here. Pick another provider in Settings → AI writer.", { code: "ai_fake_refused" });
  const policy = selfHost ? null : await loadPolicy(db, { tenantId, now });
  const effFeature = thinkHarder ? "think_harder" : feature;
  const choice = modelFor({ feature, cfgModel: cfg?.model, own, selfHost, thinkHarder, env });
  const w = weight ?? (policy?.weights?.[effFeature] ?? 0);
  let verdict = { ok: true };
  if (!selfHost || own || policy) {
    const usage = await usageFor(db, { tenantId, userId, window: policy?.window, now });
    const plat = policy && !own ? await platformStatus(db, { policy, now, env }) : { paused: false, ceilingReached: false };
    verdict = decide({ policy, usage, weight: w, own, thinkHarder, platform: plat, now: now.getTime(), resetsOnText: policy?.window ? fmtDay(policy.window.end) : null, teamSize: Math.max(usage.users, 1) });
  }
  const ctx = { tenantId, userId, feature: effFeature, provider: cfg?.provider ?? "anthropic", model: choice.model, effort: choice.effort, fallback: choice.fallback, own, policy, weight: w, planKey: policy?.planKey ?? null, requestId: requestId ?? randomUUID(), startedAt: Date.now() };
  if (!verdict.ok) {
    if (recordRefusal) await recordDurably(db, tenantId, userId, { ...ctx, status: verdict.event ?? "refused_limit", code: verdict.code, usage: {}, durationMs: 0 });
    throw refusal(verdict);
  }
  return ctx;
}

/**
 * Record what a call used. `usage` = { input, output, cacheRead, cacheWrite }. status: ok | error. `credits` overrides the admitted weight (a chat turn knows at its end whether it edited something).
 * Returns { costMicro }.
 */
export async function finish(db, ctx, { status = "ok", usage = {}, code = null, credits = null, model = null, feature = null }) {
  const out = await recordEvent(db, { ...ctx, feature: feature ?? ctx.feature, model: model || ctx.model, status, usage, code, credits: credits ?? ctx.weight, durationMs: Date.now() - ctx.startedAt });
  if (status === "ok" && ctx.policy && !ctx.own) await announceLow(db, ctx).catch((e) => console.error(`ai allowance_low: ${e?.message ?? e}`));
  return out;
}

/** Once per period, when the credits used first reach 80% of the allowance: the webhook event `documents.ai.allowance_low` (and the activity feed). */
async function announceLow(db, ctx) {
  const usage = await usageFor(db, { tenantId: ctx.tenantId, userId: null, window: ctx.policy.window });
  const f = fractionUsed(ctx.policy, usage.creditsUsed, usage.usdMicroUsed);
  if (f == null || f < 0.8) return;
  const { rowCount } = await db.query(`SELECT 1 FROM keystone.event WHERE tenant_id = $1 AND topic = 'documents.ai.allowance_low' AND created_at >= $2 LIMIT 1`, [ctx.tenantId, ctx.policy.window.start]);
  if (rowCount) return;
  const ev = { tenantId: ctx.tenantId, topic: "documents.ai.allowance_low", emittedBy: "documents", actor: "system", payload: { plan: ctx.policy.plan ?? null, used: Math.round(usage.creditsUsed * 1000) / 1000, allowance: ctx.policy.creditsPerMonth, percent: Math.round(f * 100), resets_at: ctx.policy.window.end.toISOString() } };
  // the outbox only accepts a tenant transaction; a job's handle may not be one, so the event goes through the host's own (MEASURED on the localhost stack: emit() refused the job's handle)
  let P = null; try { P = await ports(); } catch { /* no host */ }
  if (P?.queue?.runAs) await P.queue.runAs({ tenantId: ctx.tenantId, userId: ctx.userId }, (t) => emit(t, ev)); else await emit(db, ev);
}

/** May one more piece of work of this kind (a suggestion, a draft made inside a chat turn) still be paid for? Checks the allowance and the dollar cap, not the request rates (those were checked when the turn was admitted). */
export async function allowanceAllows(db, ctx, feature, { now = new Date() } = {}) {
  if (!ctx?.policy || ctx.own) return true;
  const usage = await usageFor(db, { tenantId: ctx.tenantId, userId: ctx.userId, window: ctx.policy.window, now });
  const v = decide({ policy: { ...ctx.policy, perMinute: 0, perHour: 0, perDay: 0 }, usage, weight: ctx.policy.weights?.[feature] ?? 0, teamSize: Math.max(usage.users, 1), now: now.getTime() });
  return v.ok;
}

/** What GET /api/documents/ai/usage returns (and the settings card, the Scribe footer and the API show): the allowance, what is used, when it resets, by kind of work. */
export async function usageView(db, { tenantId, userId = null, cfg = null, now = new Date(), env = process.env, selfHost = env.KEYSTONE_SELF_HOST === "1" }) {
  const own = await ownKeyPresent(db, tenantId);
  const policy = selfHost ? null : await loadPolicy(db, { tenantId, now });
  if (own) return { mode: "own_key", plan: policy?.plan ?? null, allowance: null, used: null, remaining: null, percent: null, state: "none", resetsAt: null, byFeature: await breakdownFor(db, { tenantId, window: policy?.window, now }), thinkHarder: { available: policy ? policy.thinkHarder === true : true, credits: policy?.weights?.think_harder ?? null }, paused: false };   // Run 8: Think harder is Pro WHATEVER the key (limits.mjs refuses it on Free) — the screen reads this, so it must say the same
  if (!policy) return { mode: "unmetered", plan: null, allowance: null, used: null, remaining: null, percent: null, state: "none", resetsAt: null, byFeature: await breakdownFor(db, { tenantId, now }), thinkHarder: { available: true, credits: null }, paused: false };
  const usage = await usageFor(db, { tenantId, userId, window: policy.window, now });
  const used = Math.round(usage.creditsUsed * 1000) / 1000;
  const fraction = fractionUsed(policy, usage.creditsUsed, usage.usdMicroUsed);
  const plat = await platformStatus(db, { policy, now, env });
  return {
    mode: "hosted", plan: policy.plan, allowance: policy.creditsPerMonth, used, remaining: Math.max(0, Math.round((policy.creditsPerMonth - usage.creditsUsed) * 1000) / 1000),
    percent: fraction == null ? null : Math.min(100, Math.round(fraction * 100)), state: plat.paused || plat.ceilingReached ? "paused" : stateOf(fraction), resetsAt: policy.window.end.toISOString(),
    byFeature: await breakdownFor(db, { tenantId, window: policy.window, now }),
    thinkHarder: { available: policy.thinkHarder === true, credits: policy.weights?.think_harder ?? null, perMonth: policy.thinkPerMonth ?? 0, usedThisMonth: usage.thinkMonth, perDay: policy.thinkPerDay ?? 0, usedToday: usage.thinkDay },
    paused: plat.paused || plat.ceilingReached, models: { default: modelFor({ feature: "draft", cfgModel: cfg?.model, own, selfHost, env }).model },
  };
}

