// Task 20.13 — STRIPE BILLING METERS REPORTING
//
// ★★★ THE FOUR METERED METRICS REPORT TO STRIPE METERS; READS PREFER THE METER.
// `reportUsage` fire-and-forget posts meter events to Stripe Billing Meters API (platform account).
// `readMeterSummary` reads meter event summaries from Stripe for the subscription's current period.
// Local counters keep counting in parallel; retirement is a later stage after cutover proof.
//
// ★ PLATFORM BILLING ACCOUNT (NOT CONNECTED): uses KEYSTONE_PLATFORM_STRIPE_SECRET_KEY, not a
//   tenant's own connected account. This is the platform's own meter reporting to Stripe.

import { callOutside } from "../http/outside.mjs";

function getPlatformStripeKey(env = process.env) {
  return env.KEYSTONE_PLATFORM_STRIPE_SECRET_KEY ?? null;
}

/**
 * ★ Report a metered usage occurrence to Stripe Billing Meters (fire-and-forget).
 *
 * @param {object} opts
 * @param {string} opts.metric - one of: 'ai_draft', 'text', 'esign', 'marketing_email'
 * @param {integer} opts.units - units consumed (default 1); must be > 0
 * @param {Date|string} opts.occurredAt - when this occurrence happened (ISO string or Date)
 * @param {uuid} opts.tenantId - the tenant (used as meter customer identifier)
 * @param {object} opts.env - environment (default process.env)
 * @returns {promise} - resolves on successful send; rejects on network error or config missing
 *
 * ★★★ FAILURE HANDLING: caller (recordUsage) catches and logs failures; meter is fire-and-forget
 *     and never blocks the ledger write. If Stripe is unreachable, the local ledger is the recovery
 *     source. Logging happens at the call site.
 */
export async function reportUsage({
  metric,
  units = 1,
  occurredAt = new Date(),
  tenantId,
  stripeCustomerId = null,
  env = process.env,
} = {}) {
  const secretKey = getPlatformStripeKey(env);
  if (!secretKey) {
    // ★ No Stripe configured — return silently. Fire-and-forget never blocks.
    return { configured: false };
  }

  // ★ T1.3 (RECONCILE) — Stripe attributes a meter event by payload[stripe_customer_id]: the practice's PLATFORM
  //   customer, read by the caller on its own tenant transaction. None → nothing to report against.
  if (!stripeCustomerId) return { configured: true, skipped: "no_platform_customer" };

  // Convert Date to ISO string if needed, then to epoch seconds for Stripe
  const occurredAtStr = occurredAt instanceof Date
    ? occurredAt.toISOString()
    : String(occurredAt);
  const occurredAtDate = new Date(occurredAtStr);
  const timestampSeconds = Math.floor(occurredAtDate.getTime() / 1000);

  // ★ Meter name follows `workbench_<metric>` convention per spec
  const meterName = `workbench_${metric}`;

  const body = new URLSearchParams({
    event_name: meterName,
    timestamp: String(timestampSeconds),
    "payload[stripe_customer_id]": stripeCustomerId,
    "payload[value]": String(units),
    // the identifier makes a replayed report a no-op at Stripe
    identifier: `${tenantId}:${metric}:${timestampSeconds}`,
  }).toString();

  try {
    const response = await callOutside(
      "stripe_meter_events",
      "https://api.stripe.com/v1/billing/meter_events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${secretKey}`,
        },
        body,
      }
    );

    return { success: response.ok, response };
  } catch (error) {
    // ★ Fire-and-forget: catch and don't rethrow. Caller will log if needed.
    return { success: false, error };
  }
}

/**
 * ★ Read meter event summaries for a subscription's current billing period from Stripe.
 *
 * @param {uuid} tenantId - the tenant to read meters for
 * @param {object} period - { start: Date, end: Date } as returned from periodWindow()
 * @param {object} opts
 * @param {object} opts.env - environment (default process.env)
 * @returns {object} - { by_metric: { metric_name: { units: N }, ... } } on success,
 *                     or null if Stripe is not configured or the request fails
 *
 * ★★★ R4 RULE: period bounds MUST come from subscription's mirrored `current_period_start`
 *     and `current_period_end` columns, NEVER computed or derived. If subscription has no
 *     mirrored period columns (null), return null — caller falls back to local basis and says so.
 */
export async function readMeterSummary(
  tenantId,
  period = {},
  { env = process.env, stripeCustomerId = null, metrics = [] } = {}
) {
  const secretKey = getPlatformStripeKey(env);
  if (!secretKey || !period?.start || !period?.end || !stripeCustomerId) {
    // No config, no valid period bounds, or no platform customer — null → the caller falls back to local
    return null;
  }

  const startSeconds = Math.floor(
    (period.start instanceof Date ? period.start : new Date(period.start)).getTime() / 1000
  );
  const endSeconds = Math.floor(
    (period.end instanceof Date ? period.end : new Date(period.end)).getTime() / 1000
  );

  try {
    // ★ T1.3 (RECONCILE) — Stripe's summaries are PER METER: find each metric's meter id (workbench_<metric>),
    //   then read that meter's event_summaries for this customer and period.
    const meterIds = await meterIdsByEventName(secretKey);
    const summaries = {};
    for (const metric of metrics) {
      const meterId = meterIds.get(`workbench_${metric}`);
      if (!meterId) continue;
      const query = new URLSearchParams({
        customer: stripeCustomerId,
        start_time: String(startSeconds),
        end_time: String(endSeconds),
        limit: "100",
      }).toString();
      const response = await callOutside(
        "stripe_meter_summaries",
        `https://api.stripe.com/v1/billing/meters/${meterId}/event_summaries?${query}`,
        { method: "GET", headers: { Authorization: `Bearer ${secretKey}` } }
      );
      if (!response.ok) return null;
      const data = Array.isArray(response.body?.data) ? response.body.data : [];
      summaries[metric] = { units: data.reduce((n, s) => n + Number(s.aggregated_value ?? 0), 0) };
    }
    return { by_metric: summaries };
  } catch (error) {
    // Network error or parsing failure — return null to fall back to local
    return null;
  }
}

/** ★ T1.3 — event_name → meter id for the platform account's ACTIVE meters, read once per process. */
const METER_IDS = new Map();
async function meterIdsByEventName(secretKey) {
  if (METER_IDS.size > 0) return METER_IDS;
  const response = await callOutside(
    "stripe_meter_summaries",
    "https://api.stripe.com/v1/billing/meters?status=active&limit=100",
    { method: "GET", headers: { Authorization: `Bearer ${secretKey}` } }
  );
  if (response.ok && Array.isArray(response.body?.data)) {
    for (const m of response.body.data) if (m?.event_name && m?.id) METER_IDS.set(m.event_name, m.id);
  }
  return METER_IDS;
}
