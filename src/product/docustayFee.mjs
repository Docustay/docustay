// src/product/docustayFee.mjs — DOCUSTAY'S PLATFORM FEE ON A PAYMENT FIELD (the maintainer, 4 Oct 2026): 2% of each payment on the Free plan, nothing on Pro, on top of Stripe's own fees (which Stripe charges to the
// workspace's own Stripe account as usual). Decided HERE, on the server, at the moment a Checkout Session is created, from the plan the workspace is really on at that instant (grace and lapse applied) —
// never from anything the browser sent — and stored with the payment (basis points, cents, plan key) so a later plan change never rewrites history.
// ★ The shape of "who pays a fee": a Docustay workspace on Free → 200 bps; on Pro → 0; a self-hosted install (no plan row: the money is not Docustay's) → 0; a the platform practice keeps the platform's existing fee
//   (APPLICATION_FEE_BPS); a practice on the platform's OWN Stripe account (Docustay) is charged directly and pays no fee (a platform cannot charge itself — F889).
import { effectivePlan } from "./docustayPlans.mjs";
import { APPLICATION_FEE_BPS } from "../money/stripeConnected.mjs";
import { getConnectAccountState } from "../money/connect.mjs";

export const FREE_FEE_BPS = 200;
export const FEE_SENTENCE = "Docustay fee: 2% on Free, 0% on Pro, plus Stripe's fees.";

/** The fee in cents: bps of the amount, to the nearest cent (half up). Integers only. */
export function feeMinorOf(amountMinor, bps) {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) throw new Error(`feeMinorOf: amount must be a whole number of cents, got ${amountMinor}`);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error(`feeMinorOf: bad basis points ${bps}`);
  return Math.floor((amountMinor * bps + 5000) / 10000);
}

/** The fee decision as a pure function of the facts (so every branch can be tested without a database). → { bps, planKey, product }. */
export function feeDecision({ product, isDirectAccount, sub, env = process.env }) {
  if (isDirectAccount) return { bps: 0, planKey: null, product: product ?? null };
  if (product !== "docustay") return { bps: APPLICATION_FEE_BPS, planKey: null, product: product ?? null };
  const plan = effectivePlan(sub ?? null, env);
  if (!plan) return { bps: 0, planKey: null, product: "docustay" };
  return { bps: plan.paid ? 0 : FREE_FEE_BPS, planKey: plan.key, product: "docustay" };
}

/** → { bps, planKey, product } for this workspace right now. */
export async function feePolicy(tx, { tenantId, env = process.env }) {
  const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const conn = await getConnectAccountState(tx, tenantId);
  let sub = null;
  if (!conn.isDirectAccount && t?.product === "docustay") ({ rows: [sub] } = await tx.query(`SELECT plan_key, status, past_due_since, updated_at, current_period_end FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]));
  return feeDecision({ product: t?.product, isDirectAccount: conn.isDirectAccount, sub, env });
}
