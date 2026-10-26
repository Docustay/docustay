// specs/STRIPE-MIRROR.md §4 stage (f) — THE NIGHTLY MIRROR RECONCILIATION (replaces the old
// `money_divergence_sweep`, which compared the platform's own duplicated columns against Stripe live and
// overwrote the duplicates; with every reader on the mirror there is nothing left to overwrite — the
// only thing that can be wrong now is the MIRROR, and this is the thing that proves it isn't).
//
// ★★★ WHAT IT DOES, IN ORDER:
//   1 · SNAPSHOT the mirror's status/amount fields for every object type we mirror;
//   2 · FULL BACKFILL from Stripe (`syncBackfill({object:'all'})`, plus payouts and invoice payments —
//       the two things the sync engine does not do itself);
//   3 · SNAPSHOT AGAIN and diff. A row that CHANGED (or APPEARED) during the reconcile is a row the
//       webhooks did not deliver to us — that is DRIFT, and drift is the signal: the reconcile just
//       healed it, but a webhook was missed and a human should know why;
//   4 · FAILED DELIVERIES — Stripe's own list of events whose webhook delivery failed in the last 24h
//       (the exact thing that was silently wrong from 28 Sep to 2 Oct 2026);
//   5 · RECORD the verdict in keystone_meta.stripe_mirror_health, which `stripe_webhooks` in
//       src/health/watch.mjs reads and which alerts alerts@ (KEYSTONE_ALERT_EMAIL) through the
//       existing immediate-alert path.
// ★ Read-only against Stripe. Never throws past the report: a reconcile that cannot run is itself
//   the verdict (`ok: false`, `error`), recorded, so the check goes red instead of staying silent.

import { getStripeSync, recordMirrorHealth, upsertRawStripeObject } from "./stripeMirror.mjs";
import { backfillChargeBalances } from "./payoutLinks.mjs";

/** The object types `syncBackfill` knows, in its own "all" order (parents before children). */
const BACKFILL_OBJECTS = Object.freeze([
  "product", "price", "plan", "customer", "subscription", "subscription_schedules", "invoice", "charge",
  "setup_intent", "payment_method", "payment_intent", "tax_id", "credit_note", "dispute",
  "early_fraud_warning", "refund", "checkout_sessions",
]);

/** table → the SQL expression whose change means "this object's state moved". */
const WATCHED = Object.freeze({
  invoices:        "status::text || '|' || coalesce(total,0) || '|' || coalesce(amount_paid,0) || '|' || coalesce(amount_remaining,0)",
  charges:         "status || '|' || coalesce(amount,0) || '|' || coalesce(amount_refunded,0)",
  subscriptions:   "status::text || '|' || coalesce(cancel_at_period_end::text,'') || '|' || coalesce(current_period_end,0)",
  refunds:         "status || '|' || coalesce(amount,0)",
  disputes:        "status || '|' || coalesce(amount,0)",
  credit_notes:    "status || '|' || coalesce(total,0)",
  payment_methods: "coalesce(card->>'last4','') || '|' || coalesce(card->>'exp_month','') || '|' || coalesce(card->>'exp_year','')",
  payouts:         "status || '|' || coalesce(amount,0) || '|' || coalesce(arrival_date,'')",
  customers:       "coalesce(invoice_settings->>'default_payment_method','') || '|' || coalesce(email,'')",
});

async function snapshot(query) {
  const out = new Map();
  for (const [table, expr] of Object.entries(WATCHED)) {
    const { rows } = await query(`SELECT id, (${expr}) AS v FROM stripe."${table}"`);
    for (const r of rows) out.set(`${table}:${r.id}`, r.v);
  }
  return out;
}

export function diffSnapshots(before, after) {
  const drift = [];
  for (const [key, v] of after) {
    const [table, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (!before.has(key)) drift.push({ table, id, change: "missing_from_mirror", stripe: v });
    else if (before.get(key) !== v) drift.push({ table, id, change: "stale_in_mirror", mirror: before.get(key), stripe: v });
  }
  return drift;
}

/**
 * ★ A customer deleted in Stripe never comes back from `customers.list`, so the mirror keeps its old
 *   row forever — and the engine's per-customer `payment_methods.list` then dies on it ("No such
 *   customer"), which would fail every nightly reconcile. After the customer backfill, any mirror
 *   customer the backfill did NOT touch is asked about directly; Stripe's answer ("deleted" / "No
 *   such customer") marks the mirror row deleted, which the engine and the views both honour.
 */
async function healDeletedCustomers(sync, startedAt) {
  const { rows } = await sync.postgresClient.query(
    `SELECT id FROM stripe.customers WHERE deleted IS NOT TRUE AND (last_synced_at IS NULL OR last_synced_at < $1)`, [startedAt]);
  let healed = 0;
  for (const { id } of rows) {
    let gone = false;
    try { const c = await sync.stripe.customers.retrieve(id); gone = Boolean(c?.deleted); }
    catch (err) { gone = /No such customer|resource_missing/i.test(err?.message ?? "") || err?.code === "resource_missing"; if (!gone) throw err; }
    if (gone) { await sync.postgresClient.query(`UPDATE stripe.customers SET deleted = true, last_synced_at = now() WHERE id = $1`, [id]); healed += 1; }
  }
  return healed;
}

async function backfillPayouts(sync) {
  let n = 0;
  for await (const po of sync.stripe.payouts.list({ limit: 100 })) {
    await upsertRawStripeObject("payouts", po);
    n += 1;
  }
  return n;
}

/** Charge → invoice linkage: the engine only fills invoice_payments from an event or an explicit fetch. */
async function backfillInvoicePayments(sync) {
  const { rows } = await sync.postgresClient.query(
    `SELECT i.id FROM stripe.invoices i
      WHERE i.status::text IN ('open','paid','uncollectible')
        AND NOT EXISTS (SELECT 1 FROM stripe.invoice_payments ip WHERE ip.invoice = i.id)`);
  let n = 0;
  for (const { id } of rows) {
    const items = [];
    for await (const ip of sync.stripe.invoicePayments.list({ invoice: id, limit: 100 })) items.push(ip);
    if (items.length) { await sync.upsertInvoicePayments(items); n += items.length; }
  }
  return n;
}

/** ★ The live endpoint (stripe_id_EXAMPLE, "the platform — live (v2)") was created at this unix time.
 *   Stripe's failed-delivery list is per EVENT, not per endpoint, so events from before it existed can
 *   only have failed on the OLD, now-disabled endpoint (the 28 Sep – 2 Oct outage) — a fact already
 *   known and fixed, not a current webhook failure. They are ignored; they'd age out of the 24h window
 *   on their own, but not before emailing alerts@ about a resolved incident. */
const LIVE_ENDPOINT_CREATED_UNIX = 1790950015;

async function failedDeliveries(sync, now) {
  const since = Math.max(Math.floor((now.getTime() - 24 * 3600 * 1000) / 1000), LIVE_ENDPOINT_CREATED_UNIX);
  const ids = [];
  for await (const ev of sync.stripe.events.list({ delivery_success: false, created: { gte: since }, limit: 100 })) {
    ids.push({ id: ev.id, type: ev.type });
    if (ids.length >= 100) break;
  }
  return ids;
}

/**
 * @param {{ now?: Date, sync?: any, record?: boolean }} opts `sync` is injectable for tests.
 * @returns {Promise<{ok:boolean, driftCount:number, drift:any[], failedDeliveries:number, failedEvents:any[], payouts:number, invoicePayments:number, error?:string}>}
 */
/** Stripe answers a burst of list calls with "Request rate limit exceeded" (found on beta, 23 Oct: one object type failed and the whole nightly run was marked not-ok).
 *  That is a wait, not a failure: try again after 2 s, 6 s, 20 s and 45 s. Any other error is thrown at once. */
export async function withRateLimitBackoff(fn, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), delays = [2000, 6000, 20000, 45000] } = {}) {
  for (let i = 0; ; i += 1) {
    try { return await fn(); }
    catch (err) {
      const limited = err?.statusCode === 429 || err?.status === 429 || /rate limit/i.test(String(err?.message ?? err));
      if (!limited || i >= delays.length) throw err;
      await sleep(delays[i]);
    }
  }
}

export async function reconcileStripeMirror({ now = new Date(), sync = getStripeSync(), record = true, sleep = undefined } = {}) {
  const report = { ok: true, driftCount: 0, drift: [], failedDeliveries: 0, failedEvents: [], payouts: 0, invoicePayments: 0 };
  try {
    const q = (text, params) => sync.postgresClient.query(text, params);
    const startedAt = new Date();
    const before = await snapshot(q);
    // ★ ONE OBJECT TYPE AT A TIME, with related-entity backfill OFF. [MEASURED 2 Oct 2026, first
    //   production reconcile] `syncBackfill({object:'all'})` with the engine's default related-entity
    //   fetch died on "No such customer: 'cus_…'" — a customer deleted in Stripe (test cleanup) that an
    //   old invoice/payment method still names — and one failure aborted every object type after it.
    //   Every type is backfilled in its own right here, so there is nothing to chase by relation; and
    //   a type that does fail is recorded by name without hiding the rest.
    report.objectErrors = [];
    for (const object of BACKFILL_OBJECTS) {
      try {
        await withRateLimitBackoff(() => sync.syncBackfill({ object, backfillRelatedEntities: false }), { sleep });
        if (object === "customer") report.deletedCustomersHealed = await healDeletedCustomers(sync, startedAt);
      } catch (err) { report.objectErrors.push({ object, error: err?.message ?? String(err) }); }
    }
    report.payouts = await backfillPayouts(sync);
    report.invoicePayments = await backfillInvoicePayments(sync);
    try { report.chargeBalances = await backfillChargeBalances({ sync }); }
    catch (err) { report.objectErrors.push({ object: "balance_transactions", error: err?.message ?? String(err) }); }
    const after = await snapshot(q);
    report.drift = diffSnapshots(before, after);
    report.driftCount = report.drift.length;
    report.failedEvents = await failedDeliveries(sync, now);
    report.failedDeliveries = report.failedEvents.length;
    // Drift on the FIRST ever run (empty/new mirror) is a backfill, not a missed webhook.
    if (before.size === 0) { report.drift = []; report.driftCount = 0; report.firstRun = true; }
    report.ok = report.driftCount === 0 && report.failedDeliveries === 0 && report.objectErrors.length === 0;
    if (report.objectErrors.length) report.error = `could not back-fill: ${report.objectErrors.map((e) => `${e.object} (${e.error})`).join("; ")}`;
  } catch (err) {
    report.ok = false;
    report.error = err?.message ?? String(err);
  }
  if (record) {
    await recordMirrorHealth({ reconcile: {
      ok: report.ok, driftCount: report.driftCount, failedDeliveries: report.failedDeliveries,
      error: report.error ?? null,
      report: { at: now.toISOString(), drift: report.drift.slice(0, 50), failedEvents: report.failedEvents.slice(0, 50),
                payouts: report.payouts, invoicePayments: report.invoicePayments } } });
  }
  return report;
}
