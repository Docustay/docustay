// src/product/docustayDisputes.mjs — A LOST DISPUTE ON A DOCUSTAY PLAN PAYMENT PAUSES THE WORKSPACE (the maintainer, 21 Oct 2026, decision 8).
// A person who pays for Pay as you go, Pro or Lifetime and then wins a chargeback has taken the product and the money. When Stripe says a dispute on a payment for the PLATFORM account (a plan payment, never a customer's document payment: that
// goes through the Connect handler) was LOST, the workspace's sending and AI drafting stop and the Owners are told in plain words. Documents are never deleted. Our side sees it on the internal review list and lifts the pause by resolving it there
// once the matter is settled (a dispute_cleared line in the billing record).
import { tellOwners, once } from "./docustayStripeNotices.mjs";
import { flagForReview } from "./docustayIntegrity.mjs";

export const HOLD_MESSAGE = "A payment for this workspace's plan was disputed with the card issuer and the dispute was not decided in your favour, so sending and AI drafting are paused. Nothing is deleted. Email support and we will sort it out with you.";
const appBase = () => String(process.env.KEYSTONE_DOCUSTAY_APP_URL || process.env.KEYSTONE_PUBLIC_URL || "https://app.docustay.app").replace(/\/+$/, "");

/** A dispute event for a platform-account payment (the route has already found the workspace). Only a LOST dispute does anything. Once per dispute. */
export async function onPlanPaymentDispute(tx, { tenantId, type, dispute }) {
  if (type !== "charge.dispute.closed" || !dispute?.id || dispute.status !== "lost") return { applied: false, reason: "not_a_lost_dispute" };
  if (!(await once(tx, tenantId, `plan_dispute_lost:${dispute.id}`))) return { applied: false, reason: "already_seen" };
  await tx.query(`INSERT INTO keystone.docustay_billing_record (tenant_id, kind, detail) VALUES ($1, 'dispute_lost', $2::jsonb)`, [tenantId, JSON.stringify({ dispute: dispute.id, amount: dispute.amount ?? null, currency: dispute.currency ?? null, reason: dispute.reason ?? null })]);
  await flagForReview((sql, p) => tx.query(sql, p), { kind: "dispute_lost", subject: String(dispute.id), workspaceId: tenantId, detail: { amount: dispute.amount ?? null, reason: dispute.reason ?? null } });
  const sent = await tellOwners(tx, { tenantId, link: { text: "Open Billing", url: `${appBase()}/billing` }, subject: "Your workspace is paused: a payment was disputed", lines: [HOLD_MESSAGE, "Your documents are safe and your signers can still open and sign what you already sent."] });
  return { applied: true, paused: true, sent };
}

/** Is this workspace held because of a lost dispute? The latest of the two facts wins. → { held, since } */
export async function disputeHold(tx, { tenantId }) {
  const { rows: [r] } = await tx.query(`SELECT kind, at FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND kind IN ('dispute_lost', 'dispute_cleared') ORDER BY at DESC, id DESC LIMIT 1`, [tenantId]);
  return r?.kind === "dispute_lost" ? { held: true, since: r.at } : { held: false, since: null };
}
