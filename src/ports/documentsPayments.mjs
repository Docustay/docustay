// src/ports/documentsPayments.mjs — THE HOST'S SIDE OF THE DOCUMENTS ISLAND'S `payments` PORT: paying while signing, through Stripe's HOSTED CHECKOUT (Part 30 item 11).
// The island never imports Stripe. It asks this port for: the fee that applies right now (`feeFor`), what a Stripe price or payment link costs (`priceInfo`, `linkInfo`), a Checkout Session (`checkout`), what Stripe now says about
// one (`checkoutStatus`), and a refund (`refund`). Every call goes through `stripeConnectedRequest`, so every lock the rest of the product has applies: the workspace's stripe_enabled flag, a LIVE connected account, the
// charge-path switch (OFF unless a person turned it on) and the movesMoney event. The charge is a DIRECT charge on the workspace's own Stripe account (the Stripe-Account header); a workspace on the platform's own account
// (Docustay) is charged directly with no header and no fee.
// ★ Stripe stays the source of truth: `checkoutStatus` reads the Session and its PaymentIntent from Stripe; nothing here guesses. NO card data ever reaches this code — the card is typed on Stripe's page.
// ★ NO LIVE CARD CHARGES WITHOUT TY IN SESSION: the charge path is closed by default (ChargePathDisabled) and the sandbox runs Stripe TEST keys; this file adds no way around either.
import { stripeConnectedRequest } from "../money/stripeConnected.mjs";
import { metadataFor } from "../money/metadata.mjs";
import { feePolicy, feeMinorOf } from "../product/docustayFee.mjs";
import { invalid, conflict } from "../http/errors.mjs";
import { getConnectAccountState } from "../money/connect.mjs";
import { stripePublishableFor, hasDedicatedDocustayStripe, productOfTenant } from "../product/stripeFor.mjs";

const publishable = (product = "workbench") => stripePublishableFor(product);

/** "Take payments" switched off for this workspace (connect_account.paused_at). */
export async function isPaused(tx, tenantId) {
  const { rows: [r] } = await tx.query(`SELECT paused_at FROM keystone.connect_account WHERE tenant_id = $1 ORDER BY (state = 'not_connected'), updated_at DESC LIMIT 1`, [tenantId]);
  return Boolean(r?.paused_at);
}

export const payments = {
  /** Can this install take a payment at all? */
  configured: () => Boolean(publishable()) || Boolean(process.env.KEYSTONE_STRIPE_SECRET_KEY) || hasDedicatedDocustayStripe(),

  /** Is THIS workspace's Stripe ready to take a payment right now? → { status: "connected" | "needs_attention" | "not_connected" } (live = details submitted, charges enabled, nothing due; kept current from account.updated). */
  async ready(tx, { tenantId }) {
    const s = await getConnectAccountState(tx, tenantId);
    if (s.state === "live" && await isPaused(tx, tenantId)) return { status: "paused" };   // an Admin or Owner switched "Take payments" off (Billing > Payments)
    return { status: s.state === "live" ? "connected" : s.state === "not_connected" ? "not_connected" : "needs_attention" };
  },

  /** The platform fee on this amount, decided now from the plan the workspace is really on. → { bps, feeMinor, planKey } */
  async feeFor(tx, { tenantId, amountMinor }) {
    const p = await feePolicy(tx, { tenantId });
    return { bps: p.bps, feeMinor: feeMinorOf(amountMinor, p.bps), planKey: p.planKey };
  },

  /** A Stripe price on the workspace's own account → { amountMinor, currency, name, priceId }. One-time, active, fixed-amount prices only. */
  async priceInfo(tx, { tenantId, priceId }) {
    let p; try { p = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/prices/${encodeURIComponent(priceId)}`, query: { "expand[]": "product" }, sdk: (s, o) => s.prices.retrieve(priceId, { expand: ["product"] }, o), movesMoney: false, purpose: "document_payment_price" })).body; }
    catch { throw invalid("That Stripe price could not be found on your Stripe account. Check the price id.", { code: "price_not_found" }); }
    if (p?.error) throw invalid("That Stripe price could not be found on your Stripe account. Check the price id.", { code: "price_not_found" });
    if (!p.active) throw conflict("That Stripe price is archived, so it cannot be charged.");
    if (p.type !== "one_time" || p.recurring) throw conflict("That Stripe price repeats (a subscription). A payment field takes a one-time price.");
    if (!Number.isInteger(p.unit_amount) || p.unit_amount < 50) throw conflict("That Stripe price has no fixed amount (or it is below 0.50), so it cannot be charged here.");
    return { priceId: p.id, amountMinor: p.unit_amount, currency: p.currency, name: p.product?.name ?? null };
  },

  /** A pasted Stripe payment link → its line items on the workspace's own account → { lineItems:[{price, quantity}], amountMinor, currency, name }. */
  async linkInfo(tx, { tenantId, url }) {
    let hit = null, after = null;
    for (let page = 0; page < 10 && !hit; page += 1) {   // a payment link's public URL is not its id: find it by URL among the account's own links
      const q = { limit: 100, active: true, ...(after ? { starting_after: after } : {}) };
      const list = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: "/payment_links", query: q, sdk: (s, o) => s.paymentLinks.list(q, o), movesMoney: false, purpose: "document_payment_link_find" })).body;
      hit = (list.data ?? []).find((l) => l.url === url) ?? null;
      if (!list.has_more || !list.data?.length) break;
      after = list.data[list.data.length - 1].id;
    }
    if (!hit) throw invalid("That payment link was not found on your connected Stripe account (or it is switched off). Paste a link made on the same Stripe account you connected.", { code: "link_not_found" });
    const items = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/payment_links/${encodeURIComponent(hit.id)}/line_items`, query: { limit: 20, "expand[]": "data.price.product" }, sdk: (s, o) => s.paymentLinks.listLineItems(hit.id, { limit: 20, expand: ["data.price.product"] }, o), movesMoney: false, purpose: "document_payment_link_items" })).body;
    const rows = items.data ?? [];
    if (!rows.length) throw conflict("That payment link has no items.");
    if (rows.some((r) => r.price?.recurring || r.price?.type !== "one_time")) throw conflict("That payment link repeats (a subscription). A payment field takes a one-time payment link.");
    if (rows.some((r) => !Number.isInteger(r.price?.unit_amount))) throw conflict("That payment link lets the payer choose the amount, so Docustay cannot check what was paid. Use a link with a fixed price.");
    const cur = new Set(rows.map((r) => r.price.currency)); if (cur.size !== 1) throw conflict("That payment link mixes currencies.");
    const amountMinor = rows.reduce((n, r) => n + r.price.unit_amount * (r.quantity ?? 1), 0);
    return { lineItems: rows.map((r) => ({ price: r.price.id, quantity: r.quantity ?? 1 })), amountMinor, currency: [...cur][0], name: rows[0].price.product?.name ?? null };
  },

  /** Create the hosted Checkout Session — a DIRECT charge on the workspace's account — idempotent on `idempotencyKey`. → { sessionId, url, expiresAt } */
  async checkout(tx, { tenantId, amountMinor, currency, lineItems = null, name, instanceId, partyId, fieldId, successUrl, cancelUrl, idempotencyKey, feeMinor = 0, feeBps = 0, recurring = null, actorUserId = null, embedded = false, returnUrl = null }) {
    const meta = metadataFor("payment_intent", { keystone_tenant_id: tenantId, instanceId, docustay_party: partyId, docustay_field: fieldId, docustay_source: "docustay" });   // v1 item 26: every payment Docustay creates is tagged, so it can be told apart in the owner's own Stripe account
    const flatMeta = (prefix) => Object.fromEntries(Object.entries(meta).map(([k, v]) => [`${prefix}[${k}]`, v]));
    const items = lineItems
      ? Object.fromEntries(lineItems.flatMap((li, i) => [[`line_items[${i}][price]`, li.price], [`line_items[${i}][quantity]`, li.quantity]]))
      : { "line_items[0][quantity]": 1, ...(recurring ? { "line_items[0][price_data][recurring][interval]": recurring.every } : {}), "line_items[0][price_data][currency]": currency, "line_items[0][price_data][unit_amount]": amountMinor, "line_items[0][price_data][product_data][name]": String(name || "Payment").slice(0, 120) };
    // a repeating plan is a Stripe SUBSCRIPTION (Stripe owns the schedule, the retries and the emails); the platform fee becomes a percentage of every invoice
    // Run 9 Part 3.7 (R9-l): EMBEDDED Checkout — Stripe's own frame inside the signing page (card, Apple Pay, Google Pay); the page learns of completion itself, a redirect happens only for a
    // payment method that needs one (`if_required`), back to the same signing page
    const where = embedded ? { ui_mode: "embedded_page", redirect_on_completion: "if_required", return_url: returnUrl } : { success_url: successUrl, cancel_url: cancelUrl };
    const form = recurring ? {
      mode: "subscription", ...items, ...where, client_reference_id: String(instanceId).slice(0, 200),
      ...(feeBps > 0 ? { "subscription_data[application_fee_percent]": feeBps / 100 } : {}),
      "subscription_data[description]": String(name || "Payment").slice(0, 200),
      ...flatMeta("metadata"), ...flatMeta("subscription_data[metadata]"),
    } : {
      mode: "payment", ...items, ...where, client_reference_id: String(instanceId).slice(0, 200),
      "payment_intent_data[description]": String(name || "Payment").slice(0, 200),
      ...(feeMinor > 0 ? { "payment_intent_data[application_fee_amount]": feeMinor } : {}),
      ...flatMeta("metadata"), ...flatMeta("payment_intent_data[metadata]"),
    };
    const create = (f, key) => stripeConnectedRequest(tx, {
      tenantId, method: "POST", path: "/checkout/sessions", sdk: (s, o, ff) => s.checkout.sessions.create(ff, o),
      form: f, idempotencyKey: key, movesMoney: true, purpose: "document_payment_checkout", actorUserId,
    });
    let body;
    try { ({ body } = await create(form, idempotencyKey)); }
    catch (e) {
      // R10-57: an account where Stripe turned Managed Payments (Stripe as the seller of record) on by default refuses a line item with no product tax code. Docustay's own deposits are
      // the workspace's own sale, never Stripe's: Stripe's error names the switch, so the same Session is made once more with it off (a new key, because the parameters differ).
      if (!/managed_payments\[enabled\]=false/.test(String(e?.message ?? e))) throw e;
      ({ body } = await create({ ...form, "managed_payments[enabled]": "false" }, `${idempotencyKey}:mp-off`));
    }
    return { sessionId: body.id, url: body.url ?? null, clientSecret: body.client_secret ?? null, expiresAt: body.expires_at ?? null };
  },

  /** What the signing page needs to draw Stripe's embedded Checkout for this workspace: the platform's publishable key, and the connected account the charge is made on (none for a workspace on the
   *  platform's own account). Never a secret. → { publishableKey, stripeAccount } | null when payments are not set up here */
  async clientConfig(tx, { tenantId }) {
    const pk = publishable(await productOfTenant(tx, tenantId)); if (!pk) return null;   // a Docustay workspace is shown Docustay's own publishable key
    const s = await getConnectAccountState(tx, tenantId);
    return { publishableKey: pk, stripeAccount: s.isDirectAccount ? null : s.stripeAccountId ?? null };
  },

  /** Close an open Session (its amount is no longer the right one, or the payer asked to start again). Best effort: an already-finished Session is left alone. */
  async expire(tx, { tenantId, sessionId }) {
    try { await stripeConnectedRequest(tx, { tenantId, method: "POST", path: `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, sdk: (s, o) => s.checkout.sessions.expire(sessionId, {}, o), form: {}, movesMoney: false, purpose: "document_payment_expire" }); } catch { /* already complete or expired */ }
  },

  /** What Stripe says about the Session now (and its PaymentIntent and charge). → { sessionStatus, url, paymentStatus, paid, intentId, amountMinor, currency, receiptUrl, refundedMinor, applicationFeeMinor, reference } */
  async checkoutStatus(tx, { tenantId, sessionId }) {
    const s = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/checkout/sessions/${encodeURIComponent(sessionId)}`, query: { "expand[]": "payment_intent.latest_charge.balance_transaction" },
      sdk: (st, o) => st.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge.balance_transaction"] }, o), movesMoney: false, purpose: "document_payment_status" })).body;
    const pi = typeof s.payment_intent === "object" && s.payment_intent ? s.payment_intent : null;
    const ch = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    return {
      sessionStatus: s.status, url: s.url ?? null, uiMode: s.ui_mode ?? "hosted", clientSecret: s.client_secret ?? null, paymentStatus: s.payment_status, paid: s.payment_status === "paid" && (pi ? pi.status === "succeeded" : true),
      // Stripe's own processing fee on this charge, as Stripe's balance transaction says it (read, never worked out)
      stripeFeeMinor: ch && typeof ch.balance_transaction === "object" && Number.isInteger(ch.balance_transaction?.fee) ? ch.balance_transaction.fee : null,
      intentId: pi?.id ?? (typeof s.payment_intent === "string" ? s.payment_intent : null),
      subscriptionId: typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null,
      amountMinor: s.amount_total ?? null, currency: s.currency ?? null,
      receiptUrl: ch?.receipt_url ?? null, refundedMinor: ch?.amount_refunded ?? 0, applicationFeeMinor: pi?.application_fee_amount ?? 0,
      reference: { instanceId: s.metadata?.instanceId ?? pi?.metadata?.instanceId ?? null, tenantId: s.metadata?.keystone_tenant_id ?? null, partyId: s.metadata?.docustay_party ?? null, fieldId: s.metadata?.docustay_field ?? null },
    };
  },

  /** An installment plan is a subscription that ends by itself: cancel_at is set just after the LAST payment's date (payments are at start, start+1 period, … start+(count-1) periods). */
  async limitSubscription(tx, { tenantId, subscriptionId, every, count }) {
    const sub = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/subscriptions/${encodeURIComponent(subscriptionId)}`, sdk: (s, o) => s.subscriptions.retrieve(subscriptionId, {}, o), movesMoney: false, purpose: "document_payment_subscription_read" })).body;
    const start = new Date((sub.start_date ?? sub.created) * 1000);
    const last = new Date(start); const n = count - 1;
    if (every === "week") last.setUTCDate(last.getUTCDate() + 7 * n); else if (every === "year") last.setUTCFullYear(last.getUTCFullYear() + n); else last.setUTCMonth(last.getUTCMonth() + n);
    const cancelAt = Math.floor(last.getTime() / 1000) + 86400;   // a day after the last payment, long before the next one
    await stripeConnectedRequest(tx, { tenantId, method: "POST", path: `/subscriptions/${encodeURIComponent(subscriptionId)}`, sdk: (s, o, f) => s.subscriptions.update(subscriptionId, f, o), form: { cancel_at: cancelAt }, idempotencyKey: `docsubcap:${subscriptionId}`, movesMoney: false, purpose: "document_payment_subscription_cap" });
    return { cancelAt };
  },

  /** What Stripe says about a subscription now: its status and how many invoices were really paid. Read, never computed. */
  async subscriptionState(tx, { tenantId, subscriptionId }) {
    const sub = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/subscriptions/${encodeURIComponent(subscriptionId)}`, sdk: (s, o) => s.subscriptions.retrieve(subscriptionId, {}, o), movesMoney: false, purpose: "document_payment_subscription_read" })).body;
    const q = { subscription: subscriptionId, status: "paid", limit: 100 };
    const inv = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: "/invoices", query: q, sdk: (s, o) => s.invoices.list(q, o), movesMoney: false, purpose: "document_payment_subscription_invoices" })).body;
    return { status: sub.status, cancelAt: sub.cancel_at ?? null, canceledAt: sub.canceled_at ?? null, paidInvoices: (inv.data ?? []).filter((i) => (i.amount_paid ?? 0) > 0).length };
  },

  /** What Stripe says about a dispute now (Run 9 Part 3.7: disputes stay in Stripe — Docustay only shows them). → { disputeId, status, paymentIntentId, amountMinor, currency, reason } */
  async disputeState(tx, { tenantId, disputeId }) {
    const d = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/disputes/${encodeURIComponent(disputeId)}`, sdk: (s, o) => s.disputes.retrieve(disputeId, {}, o), movesMoney: false, purpose: "document_payment_dispute_read" })).body;
    return { disputeId: d.id, status: d.status ?? null, paymentIntentId: typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id ?? null, amountMinor: d.amount ?? null, currency: d.currency ?? null, reason: d.reason ?? null };
  },

  /** Refund all or part of it — and the platform fee with it (refund_application_fee). Idempotent on `idempotencyKey`. → { refundId, refundedMinor, feeRefundedMinor } (totals so far, from Stripe). */
  async refund(tx, { tenantId, intentId, amountMinor, reason, idempotencyKey, actorUserId = null }) {
    const form = { payment_intent: intentId, amount: amountMinor, refund_application_fee: "true", "metadata[reason]": String(reason ?? "").slice(0, 200) };
    const { body } = await stripeConnectedRequest(tx, {
      tenantId, method: "POST", path: "/refunds", sdk: (s, o, f) => s.refunds.create(f, o),
      form, idempotencyKey, movesMoney: true, purpose: "document_payment_refund", actorUserId,
    });
    const pi = (await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/payment_intents/${encodeURIComponent(intentId)}`, query: { "expand[]": "latest_charge" }, sdk: (s, o) => s.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, o), movesMoney: false, purpose: "document_payment_refund_read" })).body;
    const ch = typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    // the platform's fee lives on the PLATFORM account (an application_fee object): read how much of it has been returned, from Stripe
    let feeRefundedMinor = 0;
    const feeId = typeof ch?.application_fee === "string" ? ch.application_fee : ch?.application_fee?.id ?? null;
    if (feeId) {
      const f = await stripeConnectedRequest(tx, { tenantId, method: "GET", path: `/application_fees/${encodeURIComponent(feeId)}`, sdk: (s, o) => s.applicationFees.retrieve(feeId, {}, o), onAccount: false, movesMoney: false, purpose: "document_payment_fee_read" });
      feeRefundedMinor = f.body.amount_refunded ?? 0;
    }
    return { refundId: body.id, refundedMinor: ch?.amount_refunded ?? amountMinor, feeRefundedMinor };
  },
};
