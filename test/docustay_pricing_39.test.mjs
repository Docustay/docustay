// The 6 Oct 2026 pricing decision, pinned: Cloud Pro $39 flat per workspace, founders $25 for as long as the subscription stays active, annual billing OFF by default, seats never priced by default.
// Run: node test/docustay_pricing_39.test.mjs
import assert from "node:assert/strict";
import { docustayPlan, foundersUntil, currentPriceVersion, foundersPriceVersion, priceLookupKey, foundersOpen, checkoutPricing, foundersFlagFor, annualEnabled, seatSettings, DISPLAY_PRICES } from "../src/product/docustayPlans.mjs";
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok", name); };
const env = { KEYSTONE_DOCUSTAY_PRO_PRICE_MINOR: "3900", KEYSTONE_DOCUSTAY_FOUNDERS_PRICE_MINOR: "2500", KEYSTONE_DOCUSTAY_PRO_PRICE_YEARLY_MINOR: "39000", KEYSTONE_DOCUSTAY_FOUNDERS_PRICE_YEARLY_MINOR: "25000" };
const PT = (iso) => new Date(iso);   // instants are given in UTC; Pacific standard time is UTC-8 in winter

t("display defaults are $39 list and $25 founders (annual $390 and $250), numbers only", () => assert.deepEqual({ ...DISPLAY_PRICES }, { listMonthlyMinor: 3900, foundersMonthlyMinor: 2500, listYearlyMinor: 39000, foundersYearlyMinor: 25000 }));
t("the code sells nothing by itself: with no price setting Pro has no price (production is not priced until the maintainer sets it)", () => { const p = docustayPlan("docustay_pro", {}); assert.equal(p.priceMinor, null); assert.equal(p.foundersPriceMinor, null); });
t("with the settings, Pro lists at 3900 and founders at 2500; yearly figures are carried but separate", () => { const p = docustayPlan("docustay_pro", env); assert.equal(p.priceMinor, 3900); assert.equal(p.foundersPriceMinor, 2500); assert.equal(p.yearlyPriceMinor, 39000); assert.equal(p.foundersYearlyPriceMinor, 25000); });
t("Pro stays unlimited documents and has no user limit field", () => { const p = docustayPlan("docustay_pro", env); assert.equal(p.docsPerMonth, null); assert.equal("userLimit" in p, false); assert.equal("seatPriceMinor" in p, false); });
t("price versions: founders v2, current list v3, each overridable; v1 is the retired $16 test price", () => { assert.equal(foundersPriceVersion({}), "v2"); assert.equal(currentPriceVersion({}), "v3"); assert.equal(foundersPriceVersion({ KEYSTONE_DOCUSTAY_FOUNDERS_VERSION: "v9" }), "v9"); assert.equal(priceLookupKey("month", "v3"), "docustay_pro_monthly_v3"); assert.equal(priceLookupKey("year", "v2"), "docustay_pro_yearly_v2"); });
t("the window closes at the first instant of 28 Jan 2027 Pacific (the end of 27 Jan) (08:00:00Z): 23:59 on 27 Jan is open, 00:01 on 28 Jan is closed, the exact instant is closed", () => {
  assert.equal(foundersUntil({}).toISOString(), "2027-01-28T08:00:00.000Z");
  assert.equal(foundersOpen({}, PT("2027-01-28T07:59:00Z")), true);    // 23:59 Pacific
  assert.equal(foundersOpen({}, PT("2027-01-28T07:59:59.999Z")), true);
  assert.equal(foundersOpen({}, PT("2027-01-28T08:00:00Z")), false);   // exactly midnight
  assert.equal(foundersOpen({}, PT("2027-01-28T08:01:00Z")), false);   // 00:01 Pacific
  assert.equal(foundersOpen({}, PT("2026-10-06T00:00:00Z")), true);
});
t("checkout chooses the price at the moment checkout starts: founders version before the cut-off, current version after, and a founders flag alone never wins after it", () => {
  assert.deepEqual(checkoutPricing({}, PT("2027-01-28T07:59:00Z")), { founders: true, version: "v2" });
  assert.deepEqual(checkoutPricing({}, PT("2027-01-28T08:01:00Z")), { founders: false, version: "v3" });
  assert.deepEqual(checkoutPricing({ KEYSTONE_DOCUSTAY_FOUNDERS_UNTIL: "2026-01-01T00:00:00Z" }, PT("2026-06-01T00:00:00Z")), { founders: false, version: "v3" });
});
t("founders flag from a subscription event: a stamped founders subscription that is active keeps it; the stamp is the truth, not the event date", () => {
  assert.equal(foundersFlagFor({ status: "active", metadata: { founders_price: "true" }, created: Date.parse("2027-01-28T08:02:00Z") / 1000 }, {}), true);   // paid 00:02 after starting at 23:59: still a founder
  assert.equal(foundersFlagFor({ status: "trialing", metadata: { founders_price: "true" } }, {}), true);
  assert.equal(foundersFlagFor({ status: "active", metadata: { founders_price: "false" }, created: Date.parse("2026-12-01T00:00:00Z") / 1000 }, {}), false);   // the stamp says list price even if the date is early
});
t("founders flag is never set before the first payment: incomplete, past_due-from-start and unpaid give null (no change), never true", () => { for (const s of ["incomplete", "incomplete_expired", "unpaid"]) assert.equal(foundersFlagFor({ status: s, metadata: { founders_price: "true" } }, {}), null); });
t("a past_due or paused subscription changes nothing about the flag (null): a rescued card keeps the price", () => { assert.equal(foundersFlagFor({ status: "past_due", metadata: { founders_price: "true" } }, {}), null); assert.equal(foundersFlagFor({ status: "paused", metadata: { founders_price: "true" } }, {}), null); });
t("a deleted subscription clears the flag", () => assert.equal(foundersFlagFor({ status: "canceled", metadata: { founders_price: "true" }, deleted: true }, {}), false));
t("a subscription with no stamp (made before this change) falls back to its creation date against the cut-off", () => { assert.equal(foundersFlagFor({ status: "active", metadata: {}, created: Date.parse("2027-01-20T00:00:00Z") / 1000 }, {}), true); assert.equal(foundersFlagFor({ status: "active", metadata: {}, created: Date.parse("2027-01-29T00:00:00Z") / 1000 }, {}), false); });
t("annual billing is OFF unless the setting is exactly 'true'", () => { for (const v of [undefined, "", "false", "1", "on", "TRUE ", "yes"]) assert.equal(annualEnabled({ KEYSTONE_DOCUSTAY_ANNUAL_ENABLED: v }), false); assert.equal(annualEnabled({ KEYSTONE_DOCUSTAY_ANNUAL_ENABLED: "true" }), true); });
t("seat settings are OFF by default: unlimited included seats, no extra-seat price; ON only with whole-number settings", () => {
  assert.deepEqual(seatSettings({}), { includedSeats: null, extraSeatPriceMinor: null, on: false });
  assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_INCLUDED_SEATS: "3" }), { includedSeats: 3, extraSeatPriceMinor: null, on: true });
  assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_INCLUDED_SEATS: "3", KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR: "800" }), { includedSeats: 3, extraSeatPriceMinor: 800, on: true });
  for (const bad of ["", "0x3", "-1", "2.5", "abc", "0"]) assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_INCLUDED_SEATS: bad }), { includedSeats: null, extraSeatPriceMinor: null, on: false });
  assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR: "800" }), { includedSeats: null, extraSeatPriceMinor: null, on: false });   // a price with no included count is meaningless: still off
});
console.log(`ok — ${n} groups`);
