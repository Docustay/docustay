// ★ Stage 17 Task 17.15 — nightly reconciliation of live usage counts against provider truth.
// Each metric's live count is compared with the provider's truth, reconciled_count is written,
// and every divergence is logged as an event.

import { assertTenantTx } from "../db/index.mjs";
import { PROVIDERS } from "./usageProviders.mjs";
import { periodWindow } from "./usage.mjs";

/**
 * ★★★ THE RECONCILIATION LOGIC.
 *
 * For each metric (esign, ai_draft, text, marketing_email):
 * 1. Read this period's and last period's ledger rows.
 * 2. Call the provider adapter to get its truth count.
 * 3. If live count ≠ provider count or provider unavailable:
 *    - Update reconciled_count (or set to null if unavailable).
 *    - Emit settings.usage.reconciled event.
 * 4. Mark ledger rows as confirmed, missing, or pending.
 *
 * @param {Object} tx - the branded handle from withTenant, NOT a pool.
 * @param {Object} options - { tenantId, periodStart, providers = PROVIDERS, fetchImpl }
 * @returns {Promise<void>}
 */
export async function reconcileTenant(
  tx,
  {
    tenantId,
    periodStart,
    providers = PROVIDERS,
    fetchImpl = globalThis.fetch,
  } = {}
) {
  // ★★★ THE BRANDED HANDLE CHECK. Calling with a pool throws immediately.
  assertTenantTx(tx, "reconcileTenant()");

  const METRICS = ["esign", "ai_draft", "text", "marketing_email"];

  // ★ Reconcile the current period and the previous period (so the closed month is final).
  const periods = [periodStart];
  const prevPeriod = new Date(periodStart);
  prevPeriod.setMonth(prevPeriod.getMonth() - 1);
  periods.push(prevPeriod);

  for (const period of periods) {
    // ★ R4 (the maintainer, 25 Sep 2026): the window is computed ONCE, here, by the shared helper — never
    //   re-derived per adapter. `end` is exclusive.
    const { end: periodEnd } = periodWindow(period);

    for (const metric of METRICS) {
      // ★ Read the ledger rows for this metric in this period.
      const { rows: events } = await tx.query(
        `SELECT id, provider_ref, reconcile_state
         FROM keystone.workbench_usage_event
         WHERE tenant_id = $1
           AND metric = $2
           AND occurred_at >= $3
           AND occurred_at < $4
         ORDER BY occurred_at`,
        [tenantId, metric, period, periodEnd]
      );

      // ★ Get the live count (before reconciliation).
      const { rows: counters } = await tx.query(
        `SELECT id, count
         FROM keystone.workbench_usage_counter
         WHERE tenant_id = $1
           AND metric = $2
           AND period_start = $3`,
        [tenantId, metric, period]
      );

      const counter = counters[0];
      if (!counter) {
        // No counter row for this metric/period; skip.
        continue;
      }

      const liveCount = parseInt(counter.count ?? 0, 10);

      // ★ Call the provider adapter to get truth.
      const provider = providers[metric];
      if (!provider) {
        // No provider for this metric; skip.
        continue;
      }

      const result = await provider({
        tx,
        tenantId,
        periodStart: period,
        periodEnd,
        events,
        fetchImpl,
      });

      let reconciledCount = null;
      let reason = null;

      if (result.unavailable) {
        // ★ Provider is unavailable; reconciled_count stays null.
        reason = "provider_unavailable";
      } else {
        reconciledCount = result.count;

        // ★ Check if there's a divergence.
        if (reconciledCount !== liveCount) {
          reason = "count_mismatch";
        }

        // ★ Update ledger rows with confirmed/missing status.
        for (const ref of result.confirmedRefs) {
          await tx.query(
            `UPDATE keystone.workbench_usage_event
             SET reconcile_state = 'confirmed'
             WHERE tenant_id = $1 AND provider_ref = $2`,
            [tenantId, ref]
          );
        }
        for (const ref of result.missingRefs) {
          await tx.query(
            `UPDATE keystone.workbench_usage_event
             SET reconcile_state = 'missing'
             WHERE tenant_id = $1 AND provider_ref = $2`,
            [tenantId, ref]
          );
        }
      }

      // ★ Update the counter with reconciled_count and timestamp.
      await tx.query(
        `UPDATE keystone.workbench_usage_counter
         SET reconciled_count = $1, reconciled_at = now()
         WHERE id = $2`,
        [reconciledCount, counter.id]
      );

      // A divergence or an unavailable count is LOGGED, never emailed and never a bell notice: the "Usage was reconciled for this billing period" owner notice was removed for good (the maintainer, 15 Oct 2026, G1). The nightly reconcile itself still runs and still writes reconciled_count above.
      if (reason) console.warn(`[usage-reconcile] ${metric} ${period}: live ${liveCount}, reconciled ${reconciledCount}, ${reason}`);
    }
  }
}
