// @ts-check
/**
 * OUTCOMES — 30-day attribution of automation effectiveness.
 *
 * For runs older than 30 days with no outcome, marks them 'nothing_yet'.
 * For runs within 30 days, checks for purchase/subscription and sets outcome accordingly.
 */

/**
 * ATTRIBUTE OUTCOMES for automation runs.
 *
 * For automation_run rows with state='done' and outcome IS NULL, where run_at is within the
 * last 30 days: if the run's associated person has a new paid entitlement/line-item purchase
 * since run_at → set outcome='bought_again', outcome_detail={amount_minor: <amount>}, outcome_at=now;
 * if a new subscription was created since run_at → outcome='moved_to_plan';
 * for runs older than 30 days with neither → outcome='nothing_yet'.
 *
 * @param {Object} tx - database transaction
 * @param {Object} opts
 * @param {string} opts.tenantId - tenant id
 * @param {Date} opts.now - current timestamp (for outcome_at and 30-day window)
 */

import { db, run as runQuery } from "../db/kysely.mjs";
import { sql } from "kysely";
import { asPracticeOwner } from "../money/asPracticeOwner.mjs";

export async function attributeOutcomes(tx, { tenantId, now }) {
  if (!tenantId || !now) throw new Error("attributeOutcomes needs tenantId and now");

  // ★ All runs with no outcome, within the attribution window.
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Check for new entitlements/line-items (purchases) since the run
  // ─────────────────────────────────────────────────────────────────────────────
  const { rows: purchaseRuns } = await tx.query(
    // ★ a purchase = an entitlement this person OWNS, created after the run, priced by its line
    //   item (line_item has no person_id / amount_minor / entitlement_id — this never ran)
    `SELECT ar.id, ar.person_id, COALESCE(MAX(li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0)), 0) AS max_amount
     FROM keystone.automation_run ar
     LEFT JOIN keystone.entitlement e
       ON e.owner_user_id = ar.person_id
       AND e.tenant_id = ar.tenant_id
       AND e.created_at >= ar.run_at
       AND e.created_at <= $2
     LEFT JOIN keystone.line_item li ON li.id = e.line_item_id
     WHERE ar.tenant_id = $1
       AND ar.outcome IS NULL
       AND ar.state = 'done'
       AND ar.run_at >= $3
       AND ar.run_at <= $2
       AND ar.person_id IS NOT NULL
     GROUP BY ar.id, ar.person_id
     HAVING COALESCE(MAX(li.unit_amount_minor * li.quantity - COALESCE(li.discount_minor, 0)), 0) > 0`,
    [tenantId, now.toISOString(), windowStart.toISOString()]);

  // Update runs with purchase outcome.
  for (const run of purchaseRuns) {
    await runQuery(tx, db
      .updateTable("keystone.automation_run")
      .set({
        outcome: "bought_again",
        outcome_detail: { amount_minor: run.max_amount ?? null },
        outcome_at: now.toISOString() ?? null,
      })
      .where("id", "=", run.id)
      .where("tenant_id", "=", tenantId));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Check for new subscriptions since the run
  // ★★★ FOUND LIVE, a systematic RLS sweep, 2 Oct 2026 — `keystone.subscription`'s own RLS (same
  //     F854 class) gates SELECT behind `user_may(current_user_id(), 'invoice', 'view', owner) OR
  //     app_user_id = current_user_id()`. `sweepAutomationsTask` (automations/sweeps.mjs) calls
  //     this inside a plain `withTenant(tenantId, tx => ...)` with no viewer set — `current_user_id()`
  //     is NULL, both halves false, the JOIN matched zero rows regardless of real data. Every
  //     automation run that genuinely led to a new subscription was falling through to
  //     `outcome='nothing_yet'` after 30 days instead of `'moved_to_plan'`, silently, every night,
  //     per tenant. Fixed the same way F854 fixed the other four money-table reads: `asPracticeOwner`.
  // ★ STRIPE-MIRROR REPOINT (2 Oct 2026) — reads `subscription_effective`: Stripe holds subscriptions
  //   the platform never recorded (MEASURED: 10 vs 0), and a person's new subscription is a Stripe fact.
  //   `s.created_at` there is Stripe's own creation time for mirrored rows.
  // ─────────────────────────────────────────────────────────────────────────────
  const { rows: subscriptionRuns } = await asPracticeOwner(tx, tenantId, () => tx.query(
    `SELECT DISTINCT ar.id
     FROM keystone.automation_run ar
     INNER JOIN keystone.subscription_effective s
       ON s.app_user_id = ar.person_id
       AND s.tenant_id = ar.tenant_id
       AND s.created_at >= ar.run_at
       AND s.created_at <= $2
     WHERE ar.tenant_id = $1
       AND ar.outcome IS NULL
       AND ar.state = 'done'
       AND ar.run_at >= $3
       AND ar.run_at <= $2
       AND ar.person_id IS NOT NULL`,
    [tenantId, now.toISOString(), windowStart.toISOString()]));

  // Update runs with subscription outcome.
  for (const run of subscriptionRuns) {
    await runQuery(tx, db
      .updateTable("keystone.automation_run")
      .set({
        outcome: "moved_to_plan",
        outcome_detail: null,
        outcome_at: now.toISOString() ?? null,
      })
      .where("id", "=", run.id)
      .where("tenant_id", "=", tenantId));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Mark runs older than 30 days with no outcome as 'nothing_yet'
  // ─────────────────────────────────────────────────────────────────────────────
  await runQuery(tx, db
    .updateTable("keystone.automation_run")
    .set({
      outcome: "nothing_yet",
      outcome_detail: null,
      outcome_at: now.toISOString() ?? null,
    })
    .where("tenant_id", "=", tenantId)
    .where("outcome", "is", null)
    .where("state", "=", "done")
    .where("run_at", "<", windowStart.toISOString() ?? null));
}
