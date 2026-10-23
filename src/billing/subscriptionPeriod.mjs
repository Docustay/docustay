// src/billing/subscriptionPeriod.mjs — the billing period and the scheduled cancellation of a Stripe subscription object, whichever API shape it arrives in. Pure: no imports.
// Older API versions carry current_period_start/end on the subscription; newer ones carry them on each subscription ITEM, and a cancellation made in the customer portal is a `cancel_at` date. (D-032, 6 Oct 2026.)
/** @returns {{start: number|undefined, end: number|undefined, cancelAt: number|null}} epoch seconds */
export function periodOf(d) {
  const it = d?.items?.data?.[0];
  const start = d?.current_period_start ?? it?.current_period_start ?? undefined;
  const end = d?.current_period_end ?? it?.current_period_end ?? undefined;
  const cancelAt = d?.cancel_at ? d.cancel_at : (d?.cancel_at_period_end && end ? end : null);
  return { start, end, cancelAt };
}

/** The subscription's plan line (R13-D211): the licensed item (Pro's price, or Pay as you go's per-person price), never a metered one. A Pay as you go
 *  subscription also carries metered document and AI-draft prices, and Stripe does not promise their order, so items[0] could be the $0.30 draft price. */
export function planItem(d) {
  const items = d?.items?.data ?? [];
  return items.find((i) => i?.price?.recurring?.usage_type !== "metered") ?? items[0];
}
/** What the next renewal charges for the plan itself, in minor units: every licensed item's unit amount × quantity (metered usage is added by Stripe on top). */
export function licensedTotalMinor(d) {
  return (d?.items?.data ?? []).filter((i) => i?.price?.recurring?.usage_type !== "metered").reduce((n, i) => n + (i?.price?.unit_amount ?? 0) * (i?.quantity ?? 1), 0);
}
