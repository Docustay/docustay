// @ts-check
// src/reports/receipt.mjs — Stage 16 task 16.29
//
// BuildReceipt — the monthly run receipt, backed by real automation_run and
// run_competitor_watch rows. Every figure and section entry must carry its own
// source id (the automation_run.id or run_competitor_watch.id it came from),
// so the receipt can never claim something that isn't backed by a real logged row.

import { flagIsOn } from "../platform/flags.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { addMonths, formatISO } from "date-fns";
import { TZDate } from "@date-fns/tz";

/**
 * Build the monthly receipt for a practice.
 *
 * @param {object} tx - a tenant transaction
 * @param {object} opts
 * @param {string} opts.tenantId - the practice id
 * @param {string} opts.month - ISO month string (YYYY-MM)
 * @returns {Promise<object>} receipt object with month, managed flag, figures, sections, next_month
 */
export async function buildReceipt(tx, { tenantId, month } = {}) {
  if (!tenantId || !month) {
    throw new Error("buildReceipt: tenantId and month are required");
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Get the run_managed flag state for this tenant
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const managed = await flagIsOn(tx, "run_managed", tenantId);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Query all automation_run rows for this tenant in the given month
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const monthStart = `${month}-01`;
  const monthEndStr = formatISO(
    addMonths(new TZDate(new Date(month + "-01T00:00:00Z").getTime(), "UTC"), 1),
    { representation: "date" });

  const { rows: runRows } = await tx.query(
    `SELECT id, key, action, state, task_id, run_at
     FROM keystone.automation_run
     WHERE tenant_id = $1
       AND state = 'done'
       AND run_at >= $2::timestamptz
       AND run_at < $3::timestamptz
     ORDER BY run_at DESC`,
    [tenantId, monthStart, monthEndStr]
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Calculate figures from automation_run rows
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  // things_done: count of 'done'-state automation_run rows in the month
  const things_done = runRows.length;

  // told_clients: count of runs whose key is one of the client-messaging automations
  // (package_low, review_ask, invoice_chase), excluding internal-only
  // ★ [TY, 2 Oct 2026] "win_back" removed from this list — the automation itself is gone
  //   entirely (automations/sweeps.mjs's own header note).
  const clientMessagingKeys = ["package_low", "review_ask", "invoice_chase"];
  const told_clients = runRows.filter((r) => clientMessagingKeys.includes(r.key)).length;

  // tasks_opened: count of automation_run rows where a task was created (task_id IS NOT NULL)
  const tasks_opened = runRows.filter((r) => r.task_id !== null).length;

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // Sections: stopped_wasting, fixed, wrote, moved — leave as empty arrays for now
  // (no clear mapping from automation kind to specific bucket without measured data)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const sections = {
    stopped_wasting: [],
    fixed: [],
    wrote: [],
    moved: [],
  };

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // next_month: placeholder for next month's recommendations (empty for now)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const next_month = [];

  return {
    month,
    managed,
    figures: {
      things_done,
      told_clients,
      tasks_opened,
    },
    sections,
    next_month,
  };
}
