// @ts-check
// the maintainer's ruling, 28 Sep 2026 — "no embedded Stripe screens, build in React on the Stripe API."
// Payment Links, real, on Stripe's own Payment Links API. Named differently from the pre-existing
// paymentLinks.mjs (webhook-side helpers for a completed payment-link checkout) to avoid confusion.

import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { invalid, notFound } from "../http/errors.mjs";

/**
 * List payment links, live from Stripe.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId
 */
export async function paymentLinksList(tx, { tenantId }) {
  const { body } = await stripeConnectedRequest(tx, {
    tenantId, method: "GET", path: "/payment_links", query: { limit: 100, active: true },
    movesMoney: false, purpose: "payment_links_list",
  });
  const rows = await Promise.all((body.data ?? []).map(async (link) => {
    const lineItems = await stripeConnectedRequest(tx, {
      tenantId, method: "GET", path: `/payment_links/${link.id}/line_items`, query: { limit: 1 },
      movesMoney: false, purpose: "payment_links_line_items",
    });
    const first = lineItems.body.data?.[0];
    return {
      id: link.id,
      url: link.url,
      active: link.active,
      title: first?.price?.product?.name ?? first?.description ?? "Payment link",
      amountMinor: first?.price?.unit_amount ?? first?.amount_total ?? null,
      createdAt: new Date(link.created * 1000).toISOString(),
    };
  }));
  return { rows };
}

/**
 * Create a payment link. "plain" = fixed amount, inline price_data (no separate Price object
 * needed). "pick_amount" = the customer chooses, which Stripe only supports via a real Price's
 * own custom_unit_amount config — so a Price is created first, then referenced.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId, title, variant, amountMinor, minAmountMinor
 */
export async function paymentLinksCreate(tx, { tenantId, title, variant, amountMinor, minAmountMinor }) {
  if (!title?.trim()) throw invalid("Give this payment link a title.");

  let priceRef;
  if (variant === "pick_amount") {
    if (!minAmountMinor || minAmountMinor < 100) throw invalid("Set a minimum amount of at least $1.");
    const priceRes = await stripeConnectedRequest(tx, {
      tenantId, method: "POST", path: "/prices",
      form: {
        currency: "usd",
        "product_data[name]": title.trim(),
        "custom_unit_amount[enabled]": true,
        "custom_unit_amount[minimum]": minAmountMinor,
      },
      movesMoney: false, purpose: "payment_links_create_price",
    });
    priceRef = { price: priceRes.body.id };
  } else {
    if (!amountMinor || amountMinor < 50) throw invalid("Set an amount of at least $0.50.");
    priceRef = {
      "price_data[currency]": "usd",
      "price_data[product_data][name]": title.trim(),
      "price_data[unit_amount]": amountMinor,
    };
  }

  const form = variant === "pick_amount"
    ? { "line_items[0][price]": priceRef.price, "line_items[0][quantity]": 1 }
    : {
        "line_items[0][price_data][currency]": priceRef["price_data[currency]"],
        "line_items[0][price_data][product_data][name]": priceRef["price_data[product_data][name]"],
        "line_items[0][price_data][unit_amount]": priceRef["price_data[unit_amount]"],
        "line_items[0][quantity]": 1,
      };

  const { body } = await stripeConnectedRequest(tx, {
    tenantId, method: "POST", path: "/payment_links", form,
    movesMoney: false, purpose: "payment_links_create",
  });
  return { id: body.id, url: body.url };
}

/**
 * Deactivate a payment link — Stripe payment links are never deleted, only deactivated.
 * @param {object} tx a tenant transaction
 * @param {object} options tenantId, paymentLinkId
 */
export async function paymentLinksDeactivate(tx, { tenantId, paymentLinkId }) {
  if (!paymentLinkId) throw invalid("paymentLinkId is required.");
  try {
    await stripeConnectedRequest(tx, {
      tenantId, method: "POST", path: `/payment_links/${paymentLinkId}`,
      form: { active: false },
      movesMoney: false, purpose: "payment_links_deactivate",
    });
  } catch (err) {
    if (err?.statusCode === 404 || /No such payment link/i.test(err?.message ?? "")) {
      throw notFound(`Payment link ${paymentLinkId} not found`);
    }
    throw err;
  }
  return { deactivated: true };
}
