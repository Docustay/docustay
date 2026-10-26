// @ts-check
// Stage 15 Task 15.29 — PAYOUT LISTS, DETAILS, AND ITEMISATION

import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { asPracticeOwner } from "./asPracticeOwner.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same ORDER BY, same parameterization). `sql` is
//   the escape hatch for what the builder itself does not express — correlated-subquery casts,
//   `make_interval`, `CASE … END` in ORDER BY, `NULLS LAST`, `DATE_TRUNC` — per the L3 per-file
//   ruling: "SQL that calls plpgsql or uses features the builder lacks stays as sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * List payouts for a practice within the last N months.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   months: number of months to look back (default 6)
 * @returns {Promise<{landedMinor, count, failedCount, rows}>}
 */
export async function listPayouts(tx, { tenantId, months = 6 }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.payout_effective as p")
    .select((eb) => [
      "p.id",
      "p.arrival_date",
      "p.amount_minor",
      "p.state",
      "p.bank_name",
      "p.bank_last4",
      "p.fee_minor",
      eb
        .selectFrom("keystone.payment_effective")
        .select(sql`count(*)::int`.as("payments"))
        .whereRef("payout_id", "=", "p.id")
        .as("payments"),
    ])
    .where("p.tenant_id", "=", tenantId)
    .where(sql`p.created_at >= now() - make_interval(months => ${sql.val(months)})`)
    .orderBy(sql`p.arrival_date DESC NULLS LAST`)
    .orderBy("p.created_at", "desc"));

  let landedMinor = 0;
  let failedCount = 0;

  for (const row of rows) {
    if (row.state === "paid" && row.arrival_date) {
      landedMinor += row.amount_minor;
    } else if (row.state === "failed") {
      failedCount += 1;
    }
  }

  return {
    landedMinor,
    count: rows.length,
    failedCount,
    rows: rows.map((r) => ({
      id: r.id,
      arrivalDate: r.arrival_date,
      amountMinor: r.amount_minor,
      payments: r.payments,
      feesMinor: r.fee_minor ?? 0,
      state: r.state,
      bank: {
        name: r.bank_name ?? "Unknown",
        last4: r.bank_last4 ?? "",
      },
    })),
  };
}

/**
 * Get detailed reconciliation for a specific payout.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   payoutId: the payout id
 * @returns {Promise<{statement, payments, reconciliation}>}
 */
export async function payoutDetail(tx, { tenantId, payoutId }) {
  const { rows: payoutRows } = await run(tx, db
    .selectFrom("keystone.payout_effective")
    .select(["amount_minor", "fee_minor", "statement_descriptor", "bank_name", "bank_last4"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", payoutId));

  if (payoutRows.length === 0) {
    throw new Error(`Payout ${payoutId} not found`);
  }

  const payout = payoutRows[0];

  const statementDesc = payout.statement_descriptor
    || `On your bank statement it reads STRIPE PAYOUT`;

  const { rows: paymentRows } = await run(tx, db
    .selectFrom("keystone.payment_effective")
    .select(["id", "amount_minor", "refunded_minor", "stripe_fee_minor", "application_fee_minor"])
    .where("tenant_id", "=", tenantId)
    .where("payout_id", "=", payoutId)
    .orderBy("created_at", "desc"));

  let grossMinor = 0;
  let refundsMinor = 0;

  for (const payment of paymentRows) {
    grossMinor += payment.amount_minor;
    refundsMinor += payment.refunded_minor || 0;
  }

  // ★ Disputes are linked via payment rows in this payout
  const { rows: disputeRows } = await run(tx, db
    .selectFrom("keystone.dispute_effective as d")
    .innerJoin("keystone.payment_effective as p", (join) => join
      .onRef("d.tenant_id", "=", "p.tenant_id")
      .onRef("d.payment_id", "=", "p.id"))
    .select(sql`COALESCE(SUM(d.amount_minor), 0)::int`.as("total"))
    .where("d.tenant_id", "=", tenantId)
    .where("p.payout_id", "=", payoutId));

  const disputesMinor = disputeRows[0]?.total || 0;
  const feesMinor = payout.fee_minor || 0;
  const payoutMinor = payout.amount_minor;

  const balances = (grossMinor - feesMinor - refundsMinor - disputesMinor) === payoutMinor;

  return {
    statement: statementDesc,
    payments: paymentRows.map((p) => ({
      id: p.id,
      amountMinor: p.amount_minor,
      refundedMinor: p.refunded_minor || 0,
      stripeFeeMinor: p.stripe_fee_minor || 0,
      applicationFeeMinor: p.application_fee_minor || 0,
    })),
    reconciliation: {
      grossMinor,
      feesMinor,
      refundsMinor,
      disputesMinor,
      payoutMinor,
      balances,
    },
  };
}

/**
 * Get itemized reconciliation rows for accountant review.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 *   payoutId: the payout id
 * @returns {Promise<Array>}
 */
export async function payoutReconcile(tx, { tenantId, payoutId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.payment_effective")
    .select([
      "id",
      "amount_minor",
      "stripe_fee_minor",
      "refunded_minor",
      sql`(amount_minor - stripe_fee_minor - refunded_minor)::int`.as("net_minor"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("payout_id", "=", payoutId)
    .orderBy("created_at", "desc"));

  return rows.map((r) => ({
    paymentId: r.id,
    grossMinor: r.amount_minor,
    stripeFeeMinor: r.stripe_fee_minor || 0,
    refundedMinor: r.refunded_minor || 0,
    netMinor: r.net_minor,
  }));
}

/**
 * ★★★ specs/STRIPE-MIRROR.md stage (e) — THE PAYOUT LIST READS THE MIRROR, NOT STRIPE LIVE.
 *     (The 28 Sep 2026 "read Stripe live" ruling existed only because the mirror was empty; the mirror
 *     is now filled by the payout.* webhooks, `payout.*` upserts in src/routes/webhooks.mjs, and the
 *     nightly reconciliation.) Same name and shape the route already calls.
 */
export async function listPayoutsLive(tx, { tenantId }) {
  return listPayouts(tx, { tenantId, months: 24 });
}

/**
 * Get balances model: ready, clearing, and held amounts by date.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 * @returns {Promise<{readyMinor, clearingMinor, heldMinor, months}>}
 */
export async function balancesModel(tx, { tenantId }) {
  // Ready: available_on <= today and not yet paid out
  const { rows: readyRows } = await run(tx, db
    .selectFrom("keystone.payment_effective")
    .select(sql`COALESCE(SUM(amount_minor), 0)::int`.as("total"))
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", "stripe")
    .where("available_on", "is not", null)
    .where(sql`available_on <= now()::date`)
    .where("payout_id", "is", null));

  const readyMinor = readyRows[0]?.total || 0;

  // Clearing: available_on in the future
  const { rows: clearingRows } = await run(tx, db
    .selectFrom("keystone.payment_effective")
    .select(sql`COALESCE(SUM(amount_minor), 0)::int`.as("total"))
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", "stripe")
    .where("available_on", "is not", null)
    .where(sql`available_on > now()::date`)
    .where("payout_id", "is", null));

  const clearingMinor = clearingRows[0]?.total || 0;

  // Held: amounts in open disputes
  const { rows: heldRows } = await run(tx, db
    .selectFrom("keystone.dispute_effective")
    .select(sql`COALESCE(SUM(amount_minor), 0)::int`.as("total"))
    .where("tenant_id", "=", tenantId)
    .where("state", "in", ["warning_under_review", "under_review", "evidence_submitted"]));

  const heldMinor = heldRows[0]?.total || 0;

  // Months: group payments by their available_on date
  const { rows: monthRows } = await run(tx, db
    .selectFrom("keystone.payment_effective")
    .select([
      sql`DATE_TRUNC('month', available_on)::date`.as("month"),
      sql`COALESCE(SUM(amount_minor), 0)::int`.as("total"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("provider", "=", "stripe")
    .where("available_on", "is not", null)
    .groupBy(sql`DATE_TRUNC('month', available_on)`)
    .orderBy(sql`month DESC`));

  const months = monthRows.map((r) => ({
    month: r.month,
    amountMinor: r.total,
  }));

  return {
    readyMinor,
    clearingMinor,
    heldMinor,
    months,
  };
}

/**
 * Balance, live from Stripe (GET /v1/balance) plus real bank/payout-schedule facts — no
 * dependency on our webhook mirror. `months` is built from real payout history, not guessed.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId
 * @returns {Promise<{readyMinor, clearingMinor, heldMinor, months, bank, payoutSchedule}>}
 */
export async function balancesLive(tx, { tenantId }) {
  // ★ Stripe's BALANCE and the account's payout schedule are not objects the mirror can hold (they are
  //   computed live by Stripe, not stored rows), so those two stay live. Payout history and open
  //   disputes — which used to be live calls here too — now come from the mirror.
  const [balanceRes, accountRes] = await Promise.all([
    stripeConnectedRequest(tx, { tenantId, method: "GET", path: "/balance", movesMoney: false, purpose: "balance_live" }),
    stripeConnectedRequest(tx, { tenantId, method: "GET", path: "/account", movesMoney: false, purpose: "balance_live_account" }),
  ]);

  const available = balanceRes.body.available ?? [];
  const pending = balanceRes.body.pending ?? [];
  const readyMinor = available.reduce((s, b) => s + b.amount, 0);
  const clearingMinor = pending.reduce((s, b) => s + b.amount, 0);

  // ★ Held: the amount of open disputes, from the mirror.
  const { rows: heldRows } = await run(tx, db
    .selectFrom("keystone.dispute_effective")
    .select(sql`COALESCE(SUM(amount_minor), 0)::int`.as("total"))
    .where("tenant_id", "=", tenantId)
    .where("state", "in", ["warning_under_review", "under_review"]));
  const heldMinor = heldRows[0]?.total || 0;

  // ★ Months, from real payout history in the mirror — group the paid payouts.
  const { rows: payoutRows } = await run(tx, db
    .selectFrom("keystone.payout_effective")
    .select(["arrival_date", "amount_minor", "state", "bank_name", "bank_last4"])
    .where("tenant_id", "=", tenantId)
    .orderBy(sql`arrival_date DESC NULLS LAST`)
    .limit(12));
  const byMonth = new Map();
  for (const p of payoutRows) {
    if (p.state !== "paid" || !p.arrival_date) continue;
    const d = new Date(p.arrival_date);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + p.amount_minor);
  }
  const months = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, amountMinor]) => ({ month, amountMinor }));

  const latestPayout = payoutRows[0];
  const bank = latestPayout?.bank_last4
    ? { name: latestPayout.bank_name ?? "Unknown", last4: latestPayout.bank_last4 ?? "" }
    : null;
  const schedule = accountRes.body.settings?.payouts?.schedule ?? null;

  return { readyMinor, clearingMinor, heldMinor, months, bank, payoutSchedule: schedule };
}

/**
 * List disputes: open, answered-by date, won, and lost.
 *
 * @param {object} tx a tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 * @returns {Promise<{open, answerBy, wonThisYear, lostThisYear, rows}>}
 */
export async function listDisputes(tx, { tenantId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.dispute_effective as d")
    .select(["d.id", "d.amount_minor", "d.state", "d.stripe_status", "d.reason", "d.evidence_due_by", "d.created_at"])
    .where("d.tenant_id", "=", tenantId)
    .orderBy(sql`CASE
                 WHEN d.state IN ('warning_under_review', 'under_review', 'evidence_submitted') THEN 1
                 ELSE 2
               END`)
    .orderBy(sql`d.evidence_due_by ASC NULLS LAST`)
    .orderBy("d.created_at", "desc"));

  let openCount = 0;
  let answerByCount = 0;
  let wonCount = 0;
  let lostCount = 0;

  for (const row of rows) {
    if (row.state === "warning_under_review" || row.state === "under_review" || row.state === "evidence_submitted") {
      openCount += 1;
      if (row.evidence_due_by && row.evidence_due_by <= new Date()) {
        answerByCount += 1;
      }
    } else if (row.state === "won") {
      const thisYear = new Date(row.created_at).getFullYear() === new Date().getFullYear();
      if (thisYear) wonCount += 1;
    } else if (row.state === "lost") {
      const thisYear = new Date(row.created_at).getFullYear() === new Date().getFullYear();
      if (thisYear) lostCount += 1;
    }
  }

  return {
    open: openCount,
    answerBy: answerByCount,
    wonThisYear: wonCount,
    lostThisYear: lostCount,
    rows: rows.map((r) => ({
      id: r.id,
      amountMinor: r.amount_minor,
      // ★ Stripe's own status word where the mirror has it (what the screen showed when this read live).
      state: r.stripe_status ?? r.state,
      reason: r.reason ?? null,
      evidenceDueBy: r.evidence_due_by,
      isOpen: ["warning_under_review", "under_review", "evidence_submitted"].includes(r.state),
    })),
  };
}

/** ★ stage (e): disputes read the mirror (listDisputes above); same name the route already calls. */
export async function listDisputesLive(tx, { tenantId }) {
  return listDisputes(tx, { tenantId });
}

/**
 * The payout itemisation fact module.
 * Finds paid payouts without itemisation and fetches their balance transactions from Stripe,
 * linking payments and extracting fees and bank details.
 *
 * ★★★ IDEMPOTENT BY CONSTRUCTION: find excludes rows where itemised_at IS NOT NULL, so a
 *     second run on the same payout makes ZERO fetch calls.
 */
export const PAYOUT_ITEMISE_FACT = Object.freeze({
  key: "payout_itemise",
  why: "payouts are paid but not yet broken down into their component transactions",

  find: (tx, { tenantId }) => run(tx, db
    .selectFrom("keystone.payout")
    .select(["id", "stripe_id"])
    .where("tenant_id", "=", tenantId)
    .where("state", "=", "paid")
    .where("itemised_at", "is", null)
    // D-038: a practice whose Connect account is not live cannot be asked for balance transactions (ConnectNotLive); without this the same
    // paid payout was found every sweep, threw, and the sweep job died after six attempts.
    .where(sql`EXISTS (SELECT 1 FROM keystone.connect_account c WHERE c.tenant_id = keystone.payout.tenant_id AND c.state = 'live')`)
    .orderBy("created_at", "asc")
    .limit(5)),

  act: async (tx, { tenantId, row }) => {
    // ★ Run as Owner so stripeConnectedRequest passes its permission checks
    return asPracticeOwner(tx, tenantId, async () => {
      const payoutId = row.id;
      const stripeId = row.stripe_id;

      // ─── STEP 1: Fetch balance transactions for this payout ───────────────────────────────────
      // ★★ PAGINATION HANDLING: follow has_more until exhausted
      let allTransactions = [];
      let startingAfter = null;

      while (true) {
        const query = { payout: stripeId, limit: 100 };
        if (startingAfter) {
          query.starting_after = startingAfter;
        }

        const { body } = await stripeConnectedRequest(tx, {
          tenantId,
          method: "GET",
          path: "/balance_transactions",
          sdk: (s, o, form, query) => s.balanceTransactions.list(query, o),
          query,
          movesMoney: false,
          purpose: "payout_itemise",
          actorUserId: null,
        });

        const transactions = body.data || [];
        allTransactions.push(...transactions);

        if (!body.has_more) {
          break;
        }

        // Next page uses the last item's id as starting_after
        if (transactions.length > 0) {
          startingAfter = transactions[transactions.length - 1].id;
        } else {
          break;
        }
      }

      // ─── STEP 2: Link transactions to payments and update fees ───────────────────────────────
      for (const txn of allTransactions) {
        if (txn.source) {
          // Find the payment row with this charge id
          const chargeId = txn.source;

          // Sum up the fee components
          let feesMinor = 0;
          if (txn.fee) {
            feesMinor += txn.fee;
          }

          // Update the payment row
          await run(tx, db
            .updateTable("keystone.payment")
            .set({ payout_id: payoutId, stripe_fee_minor: feesMinor })
            .where("tenant_id", "=", tenantId)
            .where("stripe_charge_id", "=", chargeId));
        }
      }

      // ─── STEP 3: Fetch payout details for bank info ────────────────────────────────────────
      const { body: payoutDetails } = await stripeConnectedRequest(tx, {
        tenantId,
        method: "GET",
        path: `/payouts/${stripeId}`,
        sdk: (s, o, form, query) => s.payouts.retrieve(stripeId, query, o),
        query: { "expand[]": "destination" },
        movesMoney: false,
        purpose: "payout_itemise",
        actorUserId: null,
      });

      let bankName = null;
      let bankLast4 = null;

      if (payoutDetails.destination) {
        const dest = payoutDetails.destination;
        if (dest.bank_name) {
          bankName = dest.bank_name;
        }
        if (dest.last4) {
          bankLast4 = dest.last4;
        }
      }

      // ─── STEP 4: Mark payout as itemised ───────────────────────────────────────────────────
      await run(tx, db
        .updateTable("keystone.payout")
        .set({
          itemised_at: sql`now()`,
          bank_name: sql`COALESCE(${sql.val(bankName)}, bank_name)`,
          bank_last4: sql`COALESCE(${sql.val(bankLast4)}, bank_last4)`,
        })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", payoutId));

      return `payout ${payoutId} itemised (${allTransactions.length} transactions)`;
    });
  },
});
