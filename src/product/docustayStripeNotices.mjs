// src/product/docustayStripeNotices.mjs — THE OWNER EMAILS AND ACTIVITY ENTRIES FOR A WORKSPACE'S STRIPE ACCOUNT (21 Oct 2026, STRIPE-PAYMENTS-SPEC.md section 4).
// Stripe asked for more information · 7, 3 and 1 day before a Stripe deadline · a payout failed · a payment was disputed. Plain words, one email each (keystone.docustay_event_once is the once-marker),
// sent to the workspace's Owners. Every one also lands in the screen's Activity list (an audit entry on object money.connect). Nothing here holds a database connection while it waits on Stripe.
import { createHash } from "node:crypto";
import * as mail from "../mail/index.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { withCredentialLookup, withTenant } from "../db/index.mjs";
import { getConnectAccountState, fetchConnectAccountDetail } from "../money/connect.mjs";
import { plainRequirements } from "./docustayStripeAccount.mjs";

const appBase = () => String(process.env.KEYSTONE_DOCUSTAY_APP_URL || process.env.KEYSTONE_PUBLIC_URL || "https://app.docustay.app").replace(/\/+$/, "");
const where = () => `${appBase()}/billing?tab=payments`;
const money = (minor, cur = "usd") => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: String(cur).toUpperCase() }).format((minor ?? 0) / 100); } catch { return `${((minor ?? 0) / 100).toFixed(2)}`; } };

async function owners(tx, tenantId) {
  const { rows } = await tx.query(`SELECT id, email, coalesce(display_name, email) AS name FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND staff_role = 'owner' AND archived_at IS NULL AND lifecycle_status <> 'former' AND email IS NOT NULL AND email NOT LIKE '%@deleted.invalid' ORDER BY created_at`, [tenantId]);
  return rows;
}
/** Once per key per workspace. → true when this call is the first. */
export const once = async (tx, tenantId, key) => (await tx.query(`INSERT INTO keystone.docustay_event_once (tenant_id, event_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [tenantId, key])).rowCount > 0;

export async function tellOwners(tx, { tenantId, subject, lines, link = null }) {
  const to = await owners(tx, tenantId); let sent = 0;
  const open = link ?? { text: "Open Billing, Payments", url: where() };
  const text = `${lines.join("\n\n")}\n\n${open.text}: ${open.url}\n`;
  const html = `${lines.map((l) => `<p>${String(l).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("")}<p><a href="${open.url}">${open.text}</a></p>`;
  for (const o of to) { try { const r = await mail.sendMail(tx, { tenantId, to: o.email, subject, text, html, purpose: "platform", product: "docustay" }); if (r?.status !== "failed") sent += 1; } catch { /* one failed email never blocks the rest, or the webhook */ } }
  return sent;
}
const note = async (tx, { tenantId, key, value }) => { const [o] = await owners(tx, tenantId); if (o) await writeAudit(tx, { tenantId, action: "settings.changed", object: "money.connect", after: { key, value: String(value).slice(0, 120) }, actorUserId: o.id }); };

/** Stripe asked for more information (account.updated found new requirements). */
export async function onRequirementsChanged(tx, { tenantId, dueKeys = [], deadline = null }) {
  if (!dueKeys.length) return { sent: 0 };
  const sig = createHash("sha256").update([...dueKeys].sort().join("|")).digest("hex").slice(0, 16);
  if (!(await once(tx, tenantId, `stripe_req:${sig}`))) return { sent: 0 };
  await note(tx, { tenantId, key: "requirements_added", value: plainRequirements(dueKeys).length });
  const items = plainRequirements(dueKeys);
  const by = deadline ? ` Stripe needs it by ${new Date(deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}, or payouts will pause.` : "";
  return { sent: await tellOwners(tx, { tenantId, subject: "Stripe needs more information from you", lines: ["Stripe has asked for more information before it can keep paying you.", `What it needs: ${items.join("; ")}.${by}`, "Continue on Stripe to send it. Docustay never sees these details; Stripe collects them."] }) };
}

/** A payout to the bank paid or failed (Connect event payout.paid / payout.failed). A failure emails the Owners. */
export async function onPayoutEvent(tx, { tenantId, type, payout }) {
  if (!payout?.id) return { applied: false };
  const failed = type === "payout.failed";
  if (!(await once(tx, tenantId, `stripe_payout:${type}:${payout.id}`))) return { applied: false, reason: "already_seen" };
  await note(tx, { tenantId, key: failed ? "payout_failed" : "payout_paid", value: money(payout.amount, payout.currency) });
  if (!failed) return { applied: true, sent: 0 };
  return { applied: true, sent: await tellOwners(tx, { tenantId, subject: "A Stripe payout to your bank failed", lines: [`A payout of ${money(payout.amount, payout.currency)} did not reach your bank.${payout.failure_message ? ` Stripe says: ${String(payout.failure_message).slice(0, 200)}` : ""}`, "Check your bank details at Stripe. Stripe will try again once they are right. Your payments are safe in your Stripe balance."] }) };
}

/** A payment on one of this workspace's documents was disputed. */
export async function onDisputeOpened(tx, { tenantId, dispute }) {
  if (!dispute?.id || !(await once(tx, tenantId, `stripe_dispute:${dispute.id}`))) return { sent: 0 };
  await note(tx, { tenantId, key: "dispute_opened", value: money(dispute.amount, dispute.currency) });
  return { sent: await tellOwners(tx, { tenantId, subject: "A payment was disputed", lines: [`A customer disputed a payment of ${money(dispute.amount, dispute.currency)}.`, "Disputes are answered in your Stripe account, and there is a deadline to send your evidence. Open your Stripe account from Billing, Payments to respond."] }) };
}

/** The daily check: a Stripe deadline is 7, 3 or 1 day away and the information is still due. Each threshold sends once per deadline. */
export async function sendDeadlineNotices({ now = new Date(), log = () => {}, fetchImpl = fetch } = {}) {
  const tenants = await withCredentialLookup(async (db) => (await db.query(`SELECT tenant_id FROM keystone_auth.list_connect_tenants(500)`)).rows);
  let sent = 0;
  for (const { tenant_id: tenantId } of tenants) {
    try {
      const acct = await withTenant(tenantId, async (tx) => { const { rows: [t] } = await tx.query(`SELECT product FROM keystone.tenant WHERE id = $1`, [tenantId]); if (t?.product !== "docustay") return null; const s = await getConnectAccountState(tx, tenantId); return s.state === "not_connected" ? null : s.stripeAccountId; }, { userId: null });
      if (!acct) continue;
      const detail = await fetchConnectAccountDetail({ stripeAccountId: acct, fetchImpl, product: "docustay" });   // Stripe is asked OUTSIDE any transaction
      const r = detail.requirements, due = [...r.pastDue, ...r.currentlyDue];
      if (!due.length || !r.deadline) continue;
      const days = Math.ceil((Date.parse(r.deadline) - now.getTime()) / 86_400_000);
      const bucket = [1, 3, 7].find((d) => days <= d && days >= 0);
      if (!bucket) continue;
      await withTenant(tenantId, async (tx) => {
        if (!(await once(tx, tenantId, `stripe_deadline:${r.deadline}:${bucket}`))) return;
        const items = plainRequirements(due);
        sent += await tellOwners(tx, { tenantId, subject: bucket === 1 ? "Tomorrow: Stripe needs your information or payouts pause" : `${bucket} days left: Stripe needs your information`, lines: [`Stripe still needs information from you, and the deadline is ${new Date(r.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. After that, payouts to your bank pause.`, `What it needs: ${items.join("; ")}.`, "Continue on Stripe to send it. It usually takes a few minutes."] });
      }, { userId: null });
    } catch (e) { log(`stripe deadline notice: ${tenantId} failed: ${e?.message ?? e}`); }
  }
  return { workspaces: tenants.length, sent };
}
