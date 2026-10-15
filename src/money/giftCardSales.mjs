// T1.5 — A PAID GIFT-CARD SALE ISSUES THE GIFT CARD (F788 — the handler was never written).
//
// The public gift-card sale route (`src/routes/publicMoney.mjs`) creates a Checkout Session /
// PaymentIntent carrying `metadata.keystone_gift_card_amount` (the minor-unit amount) and
// `metadata.keystone_gift_card_sale` (`src/money/metadata.mjs`'s one-writer list). This module is
// the OTHER end: the webhook handler that fires when that object is paid, turning the sale into a
// real `keystone.gift_card` row via `issueGiftCard` (`src/items/giftCards.mjs:129`), and, when an
// email address is on the paid object, resending the code to it so the buyer actually receives it
// (`resendGiftCard`, same file). Replays of the same Stripe event are absorbed upstream, by the
// webhook's `external_event_id` uniqueness (p8_webhook_idempotency) — this function does not need
// its own idempotency guard.
//
// ★ `holderEmail` prefers the expanded charge's billing details over the object's own
//   `receipt_email` — when Stripe's event has the charge expanded, the billing details are the
//   card/payment-method holder's own address, a better match for "who gets the code" than whatever
//   receipt email the buyer typed. Falls back to `null` when neither is present (the sale route
//   still allows an email-less card — see `src/items/giftCards.mjs`'s own `issueGiftCard`, which
//   accepts `holderEmail: null`).

import { issueGiftCard, resendGiftCard } from "../items/giftCards.mjs";

export async function handleGiftCardSalePaid(tx, event, { tenantId }) {
  const d = event.data.object;
  const amountMinor = Number(d.metadata.keystone_gift_card_amount);
  const currency = d.currency.toUpperCase();
  const holderEmail = d.latest_charge?.billing_details?.email ?? d.receipt_email ?? null;

  const { id } = await issueGiftCard(tx, {
    tenantId, amountMinor, currency, holderEmail, buyerUserId: null, actorUserId: null,
  });

  if (holderEmail) {
    await resendGiftCard(tx, { tenantId, id });
  }

  return { issued: id };
}
