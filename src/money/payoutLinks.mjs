// migration 0579 — keystone_meta.stripe_charge_balance: the charge → payout link, Stripe's real fee/net and
// available_on, from Stripe's balance_transactions API (the sync engine mirrors no balance transactions).
// Read by keystone.payment_effective / payout_effective. Filled by the payout.* webhooks (one payout) and
// the nightly mirror reconcile (everything). Read-only against Stripe.
import { getStripeSync } from "./stripeMirror.mjs";

const dateOf = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

/** A fee Stripe takes at PAYOUT level (e.g. the 0.4% Billing fee on an invoice payment) — it has no charge of
 *  its own but is part of why gross − charge fees ≠ the payout. Stored keyed by its own balance-txn id so the
 *  payout's fee total (payout_effective.fee_minor) and its reconciliation add up. Never matches a charge. */
const isPayoutLevelFee = (bt) => typeof bt?.type === "string" && (bt.type.endsWith("_fee") || bt.type === "network_cost") && (bt.amount ?? 0) < 0;

async function upsertBalanceTxn(sync, bt, payoutStripeId) {
  if (payoutStripeId && isPayoutLevelFee(bt)) {
    await sync.postgresClient.query(
      `INSERT INTO keystone_meta.stripe_charge_balance (charge_id, payout_stripe_id, fee_minor, net_minor, available_on, balance_txn_id)
       VALUES ($1, $2, $3, $4, $5, $1)
       ON CONFLICT (charge_id) DO UPDATE SET payout_stripe_id = EXCLUDED.payout_stripe_id, fee_minor = EXCLUDED.fee_minor,
         net_minor = EXCLUDED.net_minor, available_on = EXCLUDED.available_on, updated_at = now()`,
      [bt.id, payoutStripeId, -bt.amount, bt.net ?? null, dateOf(bt.available_on)]);
    return 0;
  }
  if (!bt?.source || typeof bt.source !== "string" || !bt.source.startsWith("ch_")) return 0;
  await sync.postgresClient.query(
    `INSERT INTO keystone_meta.stripe_charge_balance (charge_id, payout_stripe_id, fee_minor, net_minor, available_on, balance_txn_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (charge_id) DO UPDATE SET
       payout_stripe_id = COALESCE(EXCLUDED.payout_stripe_id, keystone_meta.stripe_charge_balance.payout_stripe_id),
       fee_minor = EXCLUDED.fee_minor, net_minor = EXCLUDED.net_minor, available_on = EXCLUDED.available_on,
       balance_txn_id = EXCLUDED.balance_txn_id, updated_at = now()`,
    [bt.source, payoutStripeId ?? null, bt.fee ?? 0, bt.net ?? null, dateOf(bt.available_on), bt.id]);
  return 1;
}

/** Which bank a payout went to — the payout carries only a destination id; its bank name and last4 need the
 *  expanded destination. Best effort (a failure leaves the bank blank, never fails the link). */
async function fillPayoutBank(sync, payoutStripeId) {
  try {
    const po = await sync.stripe.payouts.retrieve(payoutStripeId, { expand: ["destination"] });
    const d = po?.destination;
    if (d && typeof d === "object" && (d.bank_name || d.last4)) {
      await sync.postgresClient.query(
        `UPDATE stripe.payouts SET bank_account = $2::jsonb WHERE id = $1`,
        [payoutStripeId, JSON.stringify({ bank_name: d.bank_name ?? null, last4: d.last4 ?? null })]);
    }
  } catch (err) { console.error("stripe mirror: payout bank lookup failed, continuing:", err?.message ?? err); }
}

/** The charges inside ONE payout (Stripe's `balance_transactions?payout=`). */
export async function linkPayoutCharges(payoutStripeId, { sync = getStripeSync() } = {}) {
  let n = 0;
  for await (const bt of sync.stripe.balanceTransactions.list({ payout: payoutStripeId, limit: 100 })) {
    n += await upsertBalanceTxn(sync, bt, payoutStripeId);
  }
  await fillPayoutBank(sync, payoutStripeId);
  return n;
}

/** Every charge-sourced balance transaction (fee/net/available_on, even before it is paid out), then every payout's contents. */
export async function backfillChargeBalances({ sync = getStripeSync() } = {}) {
  let charges = 0;
  // no type filter: Stripe calls a charge's balance transaction "charge" OR "payment"
  for await (const bt of sync.stripe.balanceTransactions.list({ limit: 100 })) {
    charges += await upsertBalanceTxn(sync, bt, null);
  }
  const { rows } = await sync.postgresClient.query(`SELECT id FROM stripe.payouts`);
  let linked = 0;
  for (const { id } of rows) linked += await linkPayoutCharges(id, { sync });
  return { charges, linked };
}
