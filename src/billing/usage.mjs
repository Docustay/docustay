// Task 17.12 (CT-F12 core) — USAGE COUNTING: record metered sends, read the monthly counter and
// reconciled state, compute staff count from app_user.
//
// ★★★ THE FOUR METRICS AND THEIR ALLOWANCES AND OVERAGE PRICES are from spec 07 §0.2 and are
//     hardcoded here, the same shape `src/billing/plans.mjs` follows for price — a code deploy to
//     change them, not a migration. The STAFF allowance is the maximum active staff a plan includes
//     before extra-seat charges apply; it is not a metered metric (no sender, no event), but it is
//     returned by `usageForPeriod` alongside the four metered ones, as a live count of active
//     `app_user` rows (role 'staff', not archived).
//
// ★ `recordUsage` deliberately DOES NOT EMIT per send. One `workbench_usage_event` row per send
//   would flood the outbox and every webhook subscriber with a delivery receipt for internal
//   bookkeeping. The domain occurrence (document sent, draft created, email dispatched) was already
//   emitted by the sender, and this row is a METER of that occurrence, not a second one (see the
//   write-census entry in db/gates/write-census.mjs).
//
// ★ Task 20.13 — STRIPE METERS: recordUsage also reports to Stripe Billing Meters (fire-and-forget);
//   reads prefer meter summaries when available, falling back to local counters for trials.

import { reportUsage } from "./meters.mjs";
import { addMonths } from "date-fns";
import { TZDate } from "@date-fns/tz";

export const METRICS = ['ai_draft', 'text', 'esign', 'marketing_email'];

/** Included units per metric per plan (spec 07 §0.2). */
export const ALLOWANCES = Object.freeze({
  ai_draft: 500,
  text: 400,
  esign: 100,
  staff: 5,  // active staff included; extra seats are charged per month.
});

/** Price per unit over the allowance (spec 07 §0.2, minor units = cents). */
export const OVERAGE_MINOR = Object.freeze({
  ai_draft: 2,
  text: 3,
  esign: 15,
  staff: 1200,  // per extra seat per month.
});

/**
 * ★★★ INSERT one ledger row and UPSERT the monthly counter. Both in the SAME transaction,
 *     with no emit — the domain event was emitted by the writer that caused the send.
 *
 * @param {object} tx - the database transaction (must be a branded handle from withTenant())
 * @param {object} opts
 * @param {uuid} opts.tenantId - tenant this usage belongs to
 * @param {string} opts.metric - one of METRICS: 'ai_draft', 'text', 'esign', or 'marketing_email'
 * @param {integer} opts.units - units consumed (default 1); must be > 0
 * @param {string} opts.provider - where this was sent: 'anthropic', 'twilio', 'resend', 'internal'
 * @param {string} opts.providerRef - the remote system's reference (optional, ≤200 chars)
 * @param {Date|string} opts.occurredAt - when this send happened (default now); MUST be in UTC
 */
export async function recordUsage(
  tx,
  {
    tenantId,
    metric,
    units = 1,
    provider,
    providerRef = null,
    occurredAt = new Date(),
  }
) {
  // Convert Date to ISO string if needed
  const occurredAtStr = occurredAt instanceof Date
    ? occurredAt.toISOString()
    : String(occurredAt);

  // Get the tenant's timezone to compute period_start
  const { rows: tenantRows } = await tx.query(
    `SELECT timezone FROM keystone.tenant WHERE id = $1`,
    [tenantId]
  );

  if (tenantRows.length === 0) {
    throw new Error(`Tenant ${tenantId} not found`);
  }

  const tenantTz = tenantRows[0].timezone;

  // 1. Insert the event row
  await tx.query(
    `INSERT INTO keystone.workbench_usage_event
       (tenant_id, metric, units, occurred_at, provider, provider_ref)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tenantId, metric, units, occurredAtStr, provider, providerRef]
  );

  // 2. Upsert the counter: compute period_start in the tenant's timezone, then increment count
  await tx.query(
    `INSERT INTO keystone.workbench_usage_counter
       (tenant_id, period_start, metric, count)
     VALUES (
       $1,
       date_trunc('month', $2::timestamptz AT TIME ZONE $3)::date,
       $4,
       $5
     )
     ON CONFLICT (tenant_id, period_start, metric)
     DO UPDATE SET count = keystone.workbench_usage_counter.count + EXCLUDED.count`,
    [tenantId, occurredAtStr, tenantTz, metric, units]
  );

  // 3. ★ Report to Stripe Billing Meters (fire-and-forget). Failure logs but never blocks
  //    the local ledger write — the ledger row is the recovery source.
  // ★ T1.3 (RECONCILE ruling) — the platform customer is read on THIS transaction, before the fire-and-forget below:
  //   there is no platform pool, and the report outlives this transaction.
  const { rows: customerRows } = await tx.query(
    `SELECT stripe_customer_id FROM keystone.workbench_subscription WHERE tenant_id = $1`,
    [tenantId]
  );
  const stripeCustomerId = customerRows[0]?.stripe_customer_id ?? null;

  reportUsage({
    metric,
    units,
    occurredAt: occurredAtStr,
    tenantId,
    stripeCustomerId,
  }).catch((err) => {
    // Log the failure but don't rethrow — the local ledger is already written
    console.error(
      `[recordUsage] Stripe meter report failed for tenant ${tenantId} metric ${metric}:`,
      err.message
    );
  });
}

/**
 * ★ The practice's usage this month for all four metered metrics and staff headcount.
 *
 * @param {object} tx - database transaction
 * @param {uuid} tenantId - tenant to read usage for
 * @param {Date|string} periodStart - the first of a month (YYYY-MM-01); default this month
 * @param {object} opts - options
 * @param {string} opts.basis - 'live' (count) or 'invoice' (reconciled_count ?? count); default 'live'
 * @returns {object} - {metric: {used, included, overageMinor, reconciled, basis}, ...}
 *
 * ★★★ R4 RULE: Reads prefer Stripe meter summaries when the subscription has mirrored
 *     `current_period_start`/`_end` columns (indicating a Stripe billing period). Fall back
 *     to local counters if Stripe is not available or period bounds are null.
 *     The `basis` field ('meter'|'local') indicates which source was used.
 */
export async function usageForPeriod(
  tx,
  tenantId,
  periodStart = firstOfThisMonth(),
  { basis = 'live' } = {}
) {
  // Determine the period window from the calendar month (local counters are keyed this way)
  const window = periodWindow(periodStart);

  // Check if the subscription has Stripe period bounds (R4 rule)
  const { rows: subRows } = await tx.query(
    `SELECT current_period_start, current_period_end, stripe_subscription_id, stripe_customer_id
       FROM keystone.workbench_subscription
      WHERE tenant_id = $1`,
    [tenantId]
  );

  const subscription = subRows[0];
  const hasStripePeriod = subscription?.current_period_start && subscription?.current_period_end;
  const stripePeriod = hasStripePeriod
    ? {
        start: subscription.current_period_start,
        end: subscription.current_period_end,
      }
    : null;

  // ★ Try to read from Stripe meters if the subscription has valid period bounds
  let useMeter = false;
  let meterData = null;

  if (stripePeriod) {
    const { readMeterSummary } = await import("./meters.mjs");
    meterData = await readMeterSummary(tenantId, stripePeriod, { stripeCustomerId: subscription?.stripe_customer_id ?? null, metrics: METRICS }).catch(() => null);
    useMeter = meterData !== null;
  }

  // Get the local counter rows as fallback or for all-metric verification
  const { rows: counterRows } = await tx.query(
    `SELECT metric, count, reconciled_count, reconciled_at
       FROM keystone.workbench_usage_counter
      WHERE tenant_id = $1 AND period_start = $2`,
    [tenantId, periodStart]
  );

  const byMetric = {};

  // Build result from either Stripe or local counters
  for (const metric of METRICS) {
    let used;

    if (useMeter && meterData?.by_metric?.[metric]) {
      // Use Stripe meter data
      used = meterData.by_metric[metric].units ?? 0;
    } else {
      // Use local counter
      const counterRow = counterRows.find((r) => r.metric === metric);
      if (!counterRow) {
        used = 0;
      } else if (basis === 'invoice') {
        used = counterRow.reconciled_count ?? counterRow.count;
      } else {
        used = counterRow.count;
      }
    }

    const counterRow = counterRows.find((r) => r.metric === metric);
    byMetric[metric] = {
      used,
      included: ALLOWANCES[metric],
      overageMinor: OVERAGE_MINOR[metric],
      reconciled: counterRow?.reconciled_at ? true : false,
      basis: useMeter ? "meter" : "local",
    };
  }

  // Add staff count (active staff, role='staff', not archived)
  const { rows: staffRows } = await tx.query(
    `SELECT count(*)::int AS active_count
       FROM keystone.app_user
      WHERE tenant_id = $1 AND role = 'staff' AND archived_at IS NULL`,
    [tenantId]
  );

  byMetric.staff = {
    used: staffRows[0]?.active_count ?? 0,
    included: ALLOWANCES.staff,
    overageMinor: OVERAGE_MINOR.staff,
    reconciled: true,  // staff is always "live", never reconciled
    basis: "local",     // staff is never metered
  };

  return byMetric;
}

/**
 * ★ Shorthand: `usageForPeriod` with `basis:'invoice'` (uses reconciled_count if set).
 */
export async function usageForInvoice(tx, tenantId, periodStart = firstOfThisMonth()) {
  return usageForPeriod(tx, tenantId, periodStart, { basis: 'invoice' });
}

function firstOfThisMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * ★★★ R4 (the maintainer, 25 Sep 2026) — THE ONE PLACE A USAGE WINDOW IS COMPUTED. Four adapters and the
 *     reconcile loop each hand-derived "periodStart + 1 month" (and one of them subtracted a
 *     millisecond, silently excluding the last instant of every month). Nothing derives a window
 *     any more: callers take it from here and pass it down.
 *
 * ★★ WHY THIS IS STILL A CALENDAR MONTH AND NOT STRIPE'S BILLING PERIOD: the counter rows are
 *    keyed by `date_trunc('month', occurred_at AT TIME ZONE tenant_tz)` at WRITE time
 *    (`recordUsage`, above), so a reconcile window that ended at Stripe's
 *    `current_period_end` would no longer describe the row it reconciles. The renewal DATE — the
 *    thing a person sees and the thing that drifts against a real charge — now reads the mirror's
 *    `current_period_end` (migration 0475, `src/billing/webhook.mjs`, `src/routes/settings.mjs`).
 *    The metering windows move onto Stripe's billing periods when Stage 20's Meters retire this
 *    local metering subsystem entirely; until then a computed month here describes our own
 *    counter keys, not a promise about a charge.
 *
 * @param {Date|string} periodStart - the period's first instant
 * @returns {{start: Date, end: Date}} - end is EXCLUSIVE (compare with `<`)
 */
export function periodWindow(periodStart) {
  const start = periodStart instanceof Date ? new Date(periodStart) : new Date(periodStart);
  // ★ L8.3 — wrap in TZDate("UTC") BEFORE calling addMonths: date-fns's own calendar functions read
  //   a plain Date's LOCAL (process) fields, exactly like native setMonth (measured, L8.md's own
  //   ruling) — addMonths(start, 1) on a bare Date gave the WRONG month whenever process TZ ≠ UTC.
  const end = new Date(addMonths(new TZDate(start.getTime(), "UTC"), 1).getTime());
  return { start, end };
}
