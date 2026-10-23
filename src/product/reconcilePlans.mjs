// THE DAILY RECONCILE OF DOCUSTAY PLANS (billing audit, 13 Oct 2026). Stripe is the truth about a subscription; Docustay's row is a mirror of it, kept by webhooks. A webhook can be late, lost or out of order
// (the live endpoint was dead for days once), so every few hours the worker asks Stripe about each workspace's subscription and mirrors the answer through the SAME path a webhook takes. A row that already agrees changes
// nothing and says nothing; a row that drifted is corrected and logged by name. One workspace's failure never stops the rest.
import { withCredentialLookup, withTenant } from "../db/index.mjs";
import { callOutside } from "../http/outside.mjs";
import { stripeSecretFor } from "./stripeFor.mjs";
import { planItem } from "../billing/subscriptionPeriod.mjs";

/** Every paid Docustay workspace, walked a page at a time (after a tenant id), so the 201st is read as well as the first. `limit` is the page size; `maxPages` is only a runaway guard. */
async function listDocustaySubscriptions({ limit = 200, maxPages = 50 } = {}) {
  const all = []; let after = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await withCredentialLookup(async (db) => (await db.query(`SELECT tenant_id, stripe_subscription_id FROM keystone_auth.list_docustay_subscriptions_after($1, $2)`, [after, limit])).rows);
    all.push(...page); if (page.length < limit) break; after = page.at(-1).tenant_id;
  }
  return all;
}

/** → { checked, corrected: [{tenantId, from, to}], failed: [{tenantId, error}] } */
export async function reconcileDocustaySubscriptions({ now = new Date(), apiKey = stripeSecretFor("docustay"), fetchSubscription = null, limit = 200, log = () => {} } = {}) {
  const out = { checked: 0, corrected: [], failed: [] };
  const rows = await listDocustaySubscriptions({ limit: Math.min(limit, 200) });
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  for (const { tenant_id: tenantId, stripe_subscription_id: id } of rows) {
    try {
      const sub = fetchSubscription ? await fetchSubscription(id) : await stripeGet(apiKey, `/subscriptions/${encodeURIComponent(id)}`);
      if (!sub?.id) throw new Error("Stripe did not return the subscription");
      await (await import("./docustayUsage.mjs")).ensureEarlyInvoiceThreshold({ subscription: sub, apiKey }).catch(() => false);   // v1 item 21: an early invoice at about $50 unbilled
      await withTenant(tenantId, async (tx) => {
        const { rows: [before] } = await tx.query(`SELECT status, cancel_at, plan_key FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]);
        const r = await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: sub, why: "reconcile" });
        out.reminded = (out.reminded ?? 0) + (await maybeRemindRenewal(tx, { tenantId, now }));
        out.checked += 1;
        if (r.applied && !r.unchanged) { out.corrected.push({ tenantId, from: before?.status ?? null, to: sub.status }); log(`docustay reconcile: ${tenantId} corrected ${before?.status} → ${sub.status}`); }
      }, { userId: null });
    } catch (e) { out.failed.push({ tenantId, error: String(e?.message ?? e).slice(0, 200) }); log(`docustay reconcile: ${tenantId} failed: ${e?.message ?? e}`); }
  }
  return out;
}

async function stripeGet(apiKey, path) {
  if (!apiKey) throw new Error("no Stripe key on this worker");
  const r = await callOutside("stripe", `https://api.stripe.com/v1${path}`, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Stripe answered ${r.status}`);
  return r.body;
}

/** AB 2863: a YEARLY plan that renews on its own gets one reminder 15 to 45 days before (30 is the aim: the first run inside the window sends it), with the price, the date and how to cancel. Recorded in the billing record
 *  (kept three years); never sent twice for one renewal, never for a plan that is already cancelled. → 1 when sent */
async function maybeRemindRenewal(tx, { tenantId, now = new Date() }) {
  const { rows: [s] } = await tx.query(`SELECT plan_key, status, billing_interval, current_period_end, cancel_at, stripe_subscription_id, founders_price, stripe_price_id FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId]);
  if (!s || s.plan_key !== "docustay_pro" || s.status !== "active" || s.billing_interval !== "year" || s.cancel_at || !s.current_period_end) return 0;
  const days = (new Date(s.current_period_end).getTime() - now.getTime()) / 86400000;
  if (days < 15 || days > 45) return 0;
  const { rows: [had] } = await tx.query(`SELECT 1 FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND kind = 'renewal_reminder_sent' AND detail->>'renewsAt' = $2`, [tenantId, new Date(s.current_period_end).toISOString()]);
  if (had) return 0;
  const { billingEmail } = await import("../email/docustayBilling.mjs"); const mail = await import("../mail/index.mjs");
  const { rows: owners } = await tx.query(`SELECT DISTINCT id, email, display_name FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND staff_role IN ('owner','admin') AND archived_at IS NULL AND email IS NOT NULL`, [tenantId]);
  const { languageOfUser } = await import("./docustayLanguage.mjs");
  let amountMinor = null, currency = "usd";
  try { const apiKey = stripeSecretFor("docustay"); const sub = apiKey ? await stripeGet(apiKey, `/subscriptions/${encodeURIComponent(s.stripe_subscription_id)}`) : null; const price = planItem(sub)?.price; if (price) { amountMinor = price.unit_amount; currency = price.currency; } } catch { /* the email is sent without the amount rather than not at all */ }
  for (const o of owners) {
    const built = billingEmail("renewal_reminder", { lang: await languageOfUser(tx, { tenantId, userId: o.id }), name: o.display_name, facts: { amountMinor, currency, interval: "year", periodEnd: new Date(s.current_period_end).toISOString() } });
    await mail.sendMail(tx, { tenantId, to: o.email, purpose: "platform", product: "docustay", subject: built.subject, text: built.text, html: built.html, idempotencyKey: `docustay-renewal:${tenantId}:${new Date(s.current_period_end).toISOString()}:${o.email}` });
  }
  await tx.query(`INSERT INTO keystone.docustay_billing_record (tenant_id, kind, stripe_subscription_id, detail) VALUES ($1,'renewal_reminder_sent',$2,$3::jsonb)`, [tenantId, s.stripe_subscription_id, JSON.stringify({ renewsAt: new Date(s.current_period_end).toISOString(), to: owners.length })]);
  return 1;
}
