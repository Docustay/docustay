// Task 6.5 (spec 06 §9) — PLATFORM'S OWN PLAN CATALOGUE. MOCKUPS §16:481-486, exact.
//
// ★★★ PRICE LIVES IN CODE, NOT THE DATABASE — migration 0334's own comment says so
//     (`db/migrations/0334_a_subscription_is_one_row_per_practice.sql:9`): "Price points live in
//     application code (src/billing/plans.mjs), not the CHECK — a price change is a code deploy,
//     not a migration." This file is that code.
// ★★ `plan_key` vocabulary matches `mainstay_subscription_plan_key_check` exactly: 'solo' |
//    'practice' | 'group' | 'enterprise' | 'founder'. `founder` is Docustay's own free internal plan
//    (MOCKUPS §16:493) and is deliberately NOT one of the four rows `SetPlans` offers for sale —
//    nobody chooses their way onto it, so it carries no price and is not in `PLANS` below.
// ★ Money amounts are MINOR UNITS (cents), matching every other money column in this codebase
//   (never a float). "Yearly = 2 months free (×10 the monthly price, not a separate negotiated
//   number)" (§9) — computed here, once, rather than hand-typed at each of four rows.
export const PLANS = Object.freeze([
  { key: "solo", name: "Solo", seats: 1, aiDrafts: 20, marketingEmails: 1000, monthlyPriceMinor: 3900 },
  { key: "practice", name: "Practice", seats: 5, aiDrafts: 100, marketingEmails: 5000, monthlyPriceMinor: 9900 },
  { key: "group", name: "Group", seats: 15, aiDrafts: 300, marketingEmails: 15000, monthlyPriceMinor: 19900 },
  // ★ Enterprise has no fixed price or seat ceiling — "custom", "16+ staff" (MOCKUPS §16:486).
  //   `seats: null` reads as "no ceiling" wherever this catalogue is consulted, same convention
  //   `mainstay_subscription.seat_limit IS NULL` already uses (§9's own "unlimited" case).
  { key: "enterprise", name: "Enterprise", seats: null, aiDrafts: null, marketingEmails: null, monthlyPriceMinor: null },
].map((p) => Object.freeze({
  ...p,
  // ★ "Yearly = 2 months free (×10 the monthly price)" — null stays null (Enterprise has no number
  //   to derive from; its yearly price is "custom" too, same as its monthly one).
  yearlyPriceMinor: p.monthlyPriceMinor == null ? null : p.monthlyPriceMinor * 10,
})));

/** ★ $25/mo per extra seat beyond a plan's included count (§9, MOCKUPS §16:488). Minor units. */
export const EXTRA_SEAT_PRICE_MINOR = 2500;

export const PLAN_KEYS = Object.freeze(PLANS.map((p) => p.key));

export function planByKey(key) {
  return PLANS.find((p) => p.key === key) ?? null;
}
