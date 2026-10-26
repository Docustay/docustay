// src/product/docustayUsage.mjs — USAGE BILLING (v1 items 20, 21, 24, 25). A document sent past the plan's included amount, and an AI draft past it, are BILLABLE UNITS. Each is written once to the
// workspace's own ledger (keystone.docustay_usage_event, identifier = the document or the AI request) and then reported to Stripe as a meter event with that same identifier, so a retry never bills twice.
// Only the units past the allowance reach Stripe; the allowances themselves (15 documents, 10/100/50 drafts) are ours. A failed or empty draft is never recorded. Test mode, resends, reminders never count.
// The monthly BUDGET (default $50, alerts at 50/80/100%, pause at 100%) is measured on this ledger: unbilled usage this month against the budget. Money is whole cents.
import { PRICES } from "./docustayPrices.mjs";
import { periodFor } from "./docustayPeriod.mjs";
import { forbidden } from "../http/errors.mjs";
import { emit } from "../events/outbox.mjs";
import { callOutside } from "../http/outside.mjs";
import { stripeSecretFor } from "./stripeFor.mjs";
import { withCredentialLookup, withTenant } from "../db/index.mjs";

export const METER_EVENT = Object.freeze({ document: "docustay_document", ai_draft: "docustay_ai_draft" });
const winFor = async (tx, tenantId, now) => { const { start, end } = await periodFor(tx, tenantId, now); return { start, end }; };   // the allowance period (docustayPeriod.mjs): Stripe's billing period for paid plans
export const dollars = (minor) => `$${(minor / 100).toFixed(2)}`;

/** What one more unit of this kind costs on this plan, in cents; null when the plan has no per-unit price (Free stops instead). Pure. */
export const unitMinorFor = (kind, plan) => (kind === "document" ? plan?.docOverMinor : plan?.draftOverMinor) ?? null;

/** The cost of sending `n` more documents when `usedNow` have been sent this month. Pure; the Review-and-send screen and the bulk confirm use it. */
export function estimateDocuments(plan, usedNow, n) {
  const per = unitMinorFor("document", plan);
  if (per == null || plan.docsPerMonth == null) return { billableUnits: 0, amountMinor: 0 };
  const billable = Math.max(0, usedNow + n - Math.max(plan.docsPerMonth, usedNow));
  return { billableUnits: billable, amountMinor: billable * per };
}

/** Write one billable unit to the ledger (once per identifier). → { recorded, amountMinor }. A plan with no unit price records nothing. */
export async function recordBillableUnit(tx, { tenantId, kind, identifier, plan, units = 1, now = new Date() }) {
  const per = unitMinorFor(kind, plan);
  if (per == null) return { recorded: false, amountMinor: 0 };
  const { rowCount } = await tx.query(`INSERT INTO keystone.docustay_usage_event (tenant_id, kind, identifier, units, unit_minor, occurred_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, identifier) DO NOTHING`, [tenantId, kind, String(identifier).slice(0, 100), units, per, now]);
  return { recorded: rowCount > 0, amountMinor: rowCount > 0 ? per * units : 0 };
}

/** This month's billable usage from the ledger. */
export async function monthUsage(tx, { tenantId, now = new Date(), window = null }) {
  const { start, end } = window ?? await winFor(tx, tenantId, now);
  const { rows } = await tx.query(`SELECT kind, COALESCE(sum(units), 0)::int AS units, COALESCE(sum(units * unit_minor), 0)::int AS minor FROM keystone.docustay_usage_event WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3 GROUP BY kind`, [tenantId, start, end]);
  const by = Object.fromEntries(rows.map((r) => [r.kind, r]));
  const documents = { units: by.document?.units ?? 0, amountMinor: by.document?.minor ?? 0 }, drafts = { units: by.ai_draft?.units ?? 0, amountMinor: by.ai_draft?.minor ?? 0 };
  return { period: { start: start.toISOString(), end: end.toISOString() }, documents, drafts, amountMinor: documents.amountMinor + drafts.amountMinor };
}

/** The workspace's budget and where usage stands against it. */
export async function budgetState(tx, { tenantId, now = new Date() }) {
  const { rows: [b] } = await tx.query(`SELECT budget_minor, period_start, alerts_sent, paused_at FROM keystone.docustay_budget WHERE tenant_id = $1`, [tenantId]);
  const { start, end } = await winFor(tx, tenantId, now);
  const sameMonth = b?.period_start && new Date(b.period_start).getTime() === start.getTime();
  const budgetMinor = b?.budget_minor ?? PRICES.budget.defaultMinor;
  const used = await monthUsage(tx, { tenantId, now, window: { start, end } });
  const percent = budgetMinor > 0 ? Math.min(999, Math.floor((used.amountMinor * 100) / budgetMinor)) : (used.amountMinor > 0 ? 100 : 0);
  return { budgetMinor, defaultMinor: PRICES.budget.defaultMinor, usedMinor: used.amountMinor, percent, paused: Boolean(sameMonth && b?.paused_at), alertsSent: sameMonth ? (b?.alerts_sent ?? []) : [], usage: used, period: { start: start.toISOString(), end: end.toISOString() }, alertPercents: PRICES.budget.alertPercents, earlyInvoiceMinor: PRICES.budget.earlyInvoiceMinor };
}

export async function setBudget(tx, { tenantId, budgetMinor, now = new Date() }) {
  if (!Number.isInteger(budgetMinor) || budgetMinor < 0 || budgetMinor > 10_000_000) throw forbidden("Choose a monthly budget between $0 and $100,000.");
  const { start } = await winFor(tx, tenantId, now);
  await tx.query(`INSERT INTO keystone.docustay_budget (tenant_id, budget_minor, period_start) VALUES ($1, $2, $3) ON CONFLICT (tenant_id) DO UPDATE SET budget_minor = $2, updated_at = now()`, [tenantId, budgetMinor, start]);
  // raising the budget above what has been used lifts the pause, and the alerts above the new level may fire again
  const used = (await monthUsage(tx, { tenantId, now })).amountMinor;
  if (used < budgetMinor) {
    const percent = budgetMinor > 0 ? Math.floor((used * 100) / budgetMinor) : 0;
    await tx.query(`UPDATE keystone.docustay_budget SET paused_at = NULL, alerts_sent = (SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) FROM jsonb_array_elements(alerts_sent) v WHERE (v #>> '{}')::int <= $2) WHERE tenant_id = $1`, [tenantId, percent]);
  }
  return budgetState(tx, { tenantId, now });
}

/** Sending and drafting pause when usage has reached the budget. `addMinor` is what the action would add; an action that would pass the budget is refused with the plain sentence. */
export async function assertWithinBudget(tx, { tenantId, plan, kind, addMinor = null, now = new Date() }) {
  const per = unitMinorFor(kind, plan);
  if (per == null) return { billable: false };
  const st = await budgetState(tx, { tenantId, now });
  const add = addMinor ?? per;
  if (st.paused || st.usedMinor >= st.budgetMinor || st.usedMinor + add > st.budgetMinor) {
    throw forbidden(`Your monthly budget of ${dollars(st.budgetMinor)} is reached, so ${kind === "document" ? "sending" : "AI drafting"} is paused. Raise the budget in Billing to go on. Nothing is deleted.`, { code: "budget_reached", budgetMinor: st.budgetMinor, usedMinor: st.usedMinor });
  }
  return { billable: true, amountMinor: add, budget: st };
}

/** After a unit is recorded: announce 50 / 80 / 100 percent once each per month (the event becomes the owner's email) and pause at 100. → the percents announced now. */
export async function checkBudgetAlerts(tx, { tenantId, now = new Date(), emitEvent = emit }) {
  const st = await budgetState(tx, { tenantId, now });
  const { start, end } = await winFor(tx, tenantId, now);
  const fresh = PRICES.budget.alertPercents.filter((p) => st.percent >= p && !st.alertsSent.includes(p));
  if (!fresh.length && !(st.percent >= 100 && !st.paused)) return [];
  const sent = [...st.alertsSent, ...fresh];
  await tx.query(`INSERT INTO keystone.docustay_budget (tenant_id, period_start, alerts_sent, paused_at) VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT (tenant_id) DO UPDATE SET period_start = $2, alerts_sent = $3::jsonb, paused_at = $4, updated_at = now()`, [tenantId, start, JSON.stringify(sent), st.percent >= 100 ? now : null]);
  for (const percent of fresh) await emitEvent(tx, { tenantId, topic: "documents.usage.threshold", emittedBy: "documents", subjectType: "usage_period", subjectId: tenantId, actor: "system",
    payload: { kind: "budget", percent, used_minor: st.usedMinor, limit_minor: st.budgetMinor, period_start: start.toISOString(), period_end: end.toISOString() } });
  return fresh;
}

/** The time a unit is reported to Stripe: when it happened, except that a unit that reaches Stripe AFTER its billing period closed (a late flush) is stamped at the start of the current period, so it is billed on the next invoice instead of being left off the finalized one.
 *  (Stripe also refuses timestamps older than 35 days.) The identifier never changes, so a retry still bills once. */
export const meterTimestamp = (occurredAt, periodStart) => { const t = new Date(occurredAt).getTime(), p = periodStart ? new Date(periodStart).getTime() : null; return p != null && Number.isFinite(p) && t < p ? p : t; };

/** Report pending ledger rows to Stripe as meter events. Never throws into a caller; failures stay pending and are retried by the worker. → { sent, failed } */
/**
 * Before a subscription is ended early (a plan switch), send every waiting unit and wait for Stripe to count them: an invoice finalized
 * before Stripe has aggregated the meter events leaves those units off it for good. Waits at most `waitMs`; when Stripe has not caught up
 * by then the shortfall is logged as an ALERT (the units are not lost from the app's tally) and the switch goes ahead.
 */
export async function settleUsageAtStripe(tx, { tenantId, subscriptionId, priceIds, now = new Date(), waitMs = 40_000, apiKey = stripeSecretFor("docustay") }) {
  const flushed = await flushUsageEvents(tx, { tenantId, apiKey });
  const { rows: [sub] } = await tx.query(`SELECT stripe_customer_id FROM keystone.mainstay_subscription WHERE tenant_id = $1`, [tenantId]);
  const expected = (await budgetState(tx, { tenantId, now })).usedMinor;
  if (!(expected > 0) || !sub?.stripe_customer_id) return { ...flushed, expected, seen: null };
  const t0 = Date.now(); let seen = 0;
  for (;;) {
    const res = await callOutside("stripe", "https://api.stripe.com/v1/invoices/create_preview", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ customer: sub.stripe_customer_id, subscription: subscriptionId }).toString() }, { timeoutMs: 15_000 }).catch(() => null);
    seen = (res?.body?.lines?.data ?? []).filter((l) => priceIds.includes(l.pricing?.price_details?.price ?? l.price?.id)).reduce((a, l) => a + (l.amount ?? 0), 0);
    if (seen >= expected || Date.now() - t0 > waitMs) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (seen < expected) console.error(`ALERT docustay: tenant ${tenantId} is switching plans with ${expected} cents of usage but Stripe counts ${seen}; the rest may be missing from the old plan's final invoice`);
  return { ...flushed, expected, seen };
}

export async function flushUsageEvents(tx, { tenantId, apiKey = stripeSecretFor("docustay"), limit = 100, fetchImpl = null }) {
  const { rows: [sub] } = await tx.query(`SELECT stripe_customer_id, current_period_start FROM keystone.mainstay_subscription WHERE tenant_id = $1`, [tenantId]);
  const out = { sent: 0, failed: 0 };
  if (!sub?.stripe_customer_id || !apiKey) return out;
  await ensureLifetimeDraftsSubscription(tx, { tenantId, apiKey, fetchImpl }).catch(() => null);   // Lifetime has no subscription until its first billable draft
  const { rows } = await tx.query(`SELECT id, kind, identifier, units, occurred_at FROM keystone.docustay_usage_event WHERE tenant_id = $1 AND status <> 'sent' ORDER BY occurred_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [tenantId, limit]);
  for (const r of rows) {
    try {
      const body = new URLSearchParams({ event_name: METER_EVENT[r.kind], identifier: `${tenantId}:${r.identifier}`.slice(0, 100), timestamp: String(Math.floor(meterTimestamp(r.occurred_at, sub.current_period_start) / 1000)), "payload[stripe_customer_id]": sub.stripe_customer_id, "payload[value]": String(r.units) });
      const init = { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body };
      const res = fetchImpl ? await fetchImpl("https://api.stripe.com/v1/billing/meter_events", init) : await callOutside("stripe", "https://api.stripe.com/v1/billing/meter_events", init, { timeoutMs: 15_000 });
      const ok = res.ok === true;
      const dup = !ok && /already|identifier/i.test(String(res.body?.error?.message ?? ""));   // Stripe saw this identifier already: it is billed once
      if (ok || dup) { await tx.query(`UPDATE keystone.docustay_usage_event SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [r.id]); out.sent += 1; }
      else {
        const { rows: [u] } = await tx.query(`UPDATE keystone.docustay_usage_event SET attempts = attempts + 1, last_error = $2, status = CASE WHEN attempts >= 20 THEN 'failed' ELSE 'pending' END WHERE id = $1 RETURNING status, attempts`, [r.id, String(res.body?.error?.message ?? `Stripe answered ${res.status}`).slice(0, 200)]);
        out.failed += 1;
        if (u?.status === "failed" && u.attempts === 21) await alertMeterFailed(tx, { tenantId, row: r, error: res.body?.error?.message ?? res.status });   // once, when it gives up: that unit would be lost revenue
      }
    } catch (e) { await tx.query(`UPDATE keystone.docustay_usage_event SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [r.id, String(e?.message ?? e).slice(0, 200)]); out.failed += 1; }
  }
  return out;
}

/** A usage event Stripe would not take after 21 tries is revenue Docustay will not collect unless someone looks. One loud log line (the platform alert reads it) and one PostHog moment; never throws. */
async function alertMeterFailed(tx, { tenantId, row, error }) {
  console.error(`docustay usage: ALERT meter event ${row.kind} ${row.identifier} for workspace ${tenantId} failed permanently after 21 attempts (${String(error).slice(0, 160)}); this unit is NOT billed until it is fixed by hand`);
  try { const { docustayMoment } = await import("./posthogListener.mjs"); await docustayMoment(tx, tenantId, "usage_meter_failed", { kind: row.kind, is_internal: true }); } catch {}
}

/** The worker's tick: every workspace with unsent usage, one at a time. */
export async function flushAllPendingUsage({ limit = 200, log = () => {} } = {}) {
  const tenants = await withCredentialLookup(async (db) => (await db.query(`SELECT tenant_id FROM keystone_auth.list_docustay_usage_pending($1)`, [limit])).rows);
  const total = { workspaces: tenants.length, sent: 0, failed: 0 };
  for (const { tenant_id: tenantId } of tenants) {
    try { const r = await withTenant(tenantId, (tx) => flushUsageEvents(tx, { tenantId }), { userId: null }); total.sent += r.sent; total.failed += r.failed; }
    catch (e) { total.failed += 1; log(`docustay usage flush: ${tenantId} failed: ${e?.message ?? e}`); }
  }
  return total;
}

// ── STRIPE SIDE: seats and the Lifetime drafts subscription ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const stripeJson = async (apiKey, method, path, params = null, fetchImpl = null) => {
  const url = `https://api.stripe.com/v1${path}${method === "GET" && params ? `?${new URLSearchParams(params)}` : ""}`;
  const init = { method, headers: { Authorization: `Bearer ${apiKey}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(method === "POST" ? { body: new URLSearchParams(params ?? {}) } : {}) };
  return fetchImpl ? fetchImpl(url, init) : callOutside("stripe", url, init, { timeoutMs: 20_000 });
};

/** Pay as you go bills $5 per team member per month: keep the subscription's quantity equal to the team members in the workspace. Stripe prorates a change (a mid-month join pays for the rest of the month).
 *  → { changed, from, to } or { changed: false }. Never throws into the caller's job. */
export async function syncPaygSeats(tx, { tenantId, staffCount, apiKey = stripeSecretFor("docustay"), fetchImpl = null }) {
  const { rows: [sub] } = await tx.query(`SELECT plan_key, stripe_subscription_id, status FROM keystone.mainstay_subscription WHERE tenant_id = $1`, [tenantId]);
  if (!apiKey || sub?.plan_key !== "docustay_payg" || !sub.stripe_subscription_id || sub.status === "canceled") return { changed: false };
  const r = await stripeJson(apiKey, "GET", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, null, fetchImpl);
  if (!r.ok) return { changed: false };
  const item = (r.body?.items?.data ?? []).find((i) => i.price?.lookup_key === "docustay_payg_person_monthly_v1");
  const want = Math.max(1, staffCount);
  if (!item || item.quantity === want) return { changed: false };
  const u = await stripeJson(apiKey, "POST", `/subscription_items/${item.id}`, { quantity: String(want), proration_behavior: "create_prorations" }, fetchImpl);
  return u.ok ? { changed: true, from: item.quantity, to: want } : { changed: false };
}

/** Lifetime is one payment, but its AI drafts past the monthly 50 are billed at $0.30. Stripe bills metered usage through a subscription, so the first overage creates a subscription that holds ONLY the drafts price
 *  (no base fee), charged to the card used for the Lifetime payment. Idempotent: an existing drafts subscription is reused. → the subscription id or null. */
export async function ensureLifetimeDraftsSubscription(tx, { tenantId, apiKey = stripeSecretFor("docustay"), fetchImpl = null }) {
  const { rows: [sub] } = await tx.query(`SELECT plan_key, stripe_customer_id FROM keystone.mainstay_subscription WHERE tenant_id = $1`, [tenantId]);
  if (!apiKey || sub?.plan_key !== "docustay_lifetime" || !sub.stripe_customer_id) return null;
  const have = await stripeJson(apiKey, "GET", "/subscriptions", { customer: sub.stripe_customer_id, status: "all", limit: "20" }, fetchImpl);
  const existing = (have.body?.data ?? []).find((s) => s.metadata?.docustay_kind === "lifetime_drafts" && s.status !== "canceled");
  if (existing) return existing.id;
  const price = await stripeJson(apiKey, "GET", "/prices", { "lookup_keys[]": "docustay_ai_draft_v1", active: "true" }, fetchImpl);
  const priceId = price.body?.data?.[0]?.id;
  const pms = await stripeJson(apiKey, "GET", `/customers/${encodeURIComponent(sub.stripe_customer_id)}/payment_methods`, { type: "card", limit: "1" }, fetchImpl);
  const pm = pms.body?.data?.[0]?.id;
  if (!priceId || !pm) return null;
  const made = await stripeJson(apiKey, "POST", "/subscriptions", { customer: sub.stripe_customer_id, "items[0][price]": priceId, default_payment_method: pm, "metadata[docustay_kind]": "lifetime_drafts", "metadata[workbench_tenant_id]": tenantId }, fetchImpl);
  return made.ok ? made.body.id : null;
}

/** Usage can pile up between invoices: a subscription gets an early invoice once about $50 is unbilled (Stripe billing threshold; the billing date itself does not move). Idempotent: set only when it differs. */
export async function ensureEarlyInvoiceThreshold({ subscription, apiKey = stripeSecretFor("docustay"), fetchImpl = null }) {
  const want = PRICES.budget.earlyInvoiceMinor;
  if (!apiKey || !subscription?.id || !["docustay_pro", "docustay_payg"].includes(subscription.metadata?.plan_key) || subscription.status === "canceled") return false;
  if (subscription.billing_thresholds?.amount_gte === want) return false;
  const r = await stripeJson(apiKey, "POST", `/subscriptions/${encodeURIComponent(subscription.id)}`, { "billing_thresholds[amount_gte]": String(want), "billing_thresholds[reset_billing_cycle_anchor]": "false" }, fetchImpl);
  return r.ok;
}

/** The owner's summary of the period that just ended (the billing period for a paid plan, the calendar month for Free): what it cost, once per workspace per period (the once-marker is the record, keyed by the period's start).
 *  The email is the owner notice for `documents.usage.threshold` with kind "summary". Checked every few hours by the worker; a workspace whose period has not ended yet has nothing to send. */
export async function sendPeriodSummaries({ now = new Date(), log = () => {}, emitEvent = emit, tenantIds = null } = {}) {
  const tenants = tenantIds ? tenantIds.map((tenant_id) => ({ tenant_id })) : await withCredentialLookup(async (db) => (await db.query(`SELECT tenant_id FROM keystone_auth.list_docustay_usage_tenants($1, $2, 500)`, [new Date(now.getTime() - 40 * 86_400_000), now])).rows);
  let sent = 0;
  for (const { tenant_id: tenantId } of tenants) {
    try {
      await withTenant(tenantId, async (tx) => {
        const cur = await periodFor(tx, tenantId, now);
        const prev = await periodFor(tx, tenantId, new Date(cur.start.getTime() - 1));
        const key = `usage_summary:${prev.start.toISOString()}`;
        const { rowCount } = await tx.query(`INSERT INTO keystone.docustay_event_once (tenant_id, event_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [tenantId, key]);
        if (!rowCount) return;
        const u = await monthUsage(tx, { tenantId, window: { start: prev.start, end: prev.end } });
        if (u.amountMinor <= 0) return;
        await emitEvent(tx, { tenantId, topic: "documents.usage.threshold", emittedBy: "documents", subjectType: "usage_period", subjectId: tenantId, actor: "system",
          payload: { kind: "summary", percent: 100, documents: u.documents.units, drafts: u.drafts.units, amount_minor: u.amountMinor, period_start: prev.start.toISOString(), period_end: prev.end.toISOString() } });
        sent += 1;
      }, { userId: null });
    } catch (e) { log(`docustay usage summary: ${tenantId} failed: ${e?.message ?? e}`); }
  }
  return { workspaces: tenants.length, sent };
}
export const sendMonthlySummaries = sendPeriodSummaries;   // the old name
