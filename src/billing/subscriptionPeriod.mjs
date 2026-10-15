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
