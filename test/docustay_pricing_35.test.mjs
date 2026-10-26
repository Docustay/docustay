// The 25 Oct 2026 pricing decision, pinned: Pro is $35 a month flat for the whole workspace, one price for everyone, no founders price. Annual billing OFF by default, seats never priced by default.
// Run: node test/docustay_pricing_35.test.mjs
import assert from "node:assert/strict";
import { docustayPlan, currentPriceVersion, priceLookupKey, checkoutPricing, annualEnabled, seatSettings, DISPLAY_PRICES } from "../src/product/docustayPlans.mjs";
import { PRICES } from "../src/product/docustayPrices.mjs";
let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ok", name); };

t("the price list says Pro is 3500 a month and has no founders fields", () => { assert.equal(PRICES.pro.monthlyMinor, 3500); for (const k of ["foundersMonthlyMinor", "listMonthlyMinor"]) assert.equal(k in PRICES.pro, false); assert.equal("foundersUntil" in PRICES, false); });
t("display defaults are the same single price", () => assert.deepEqual({ ...DISPLAY_PRICES }, { monthlyMinor: 3500 }));
t("enforcement reads the price list: Pro is 3500 whatever the environment says", () => { for (const env of [{}, { KEYSTONE_DOCUSTAY_PRO_PRICE_MINOR: "3900" }]) { const p = docustayPlan("docustay_pro", env); assert.equal(p.priceMinor, 3500); assert.equal("foundersPriceMinor" in p, false); } });
t("Pro stays unlimited documents and has no user limit field", () => { const p = docustayPlan("docustay_pro", {}); assert.equal(p.docsPerMonth, null); assert.equal("userLimit" in p, false); assert.equal("seatPriceMinor" in p, false); });
t("the Stripe price version is v4 and no environment setting changes it; lookup keys follow it", () => { assert.equal(currentPriceVersion({}), "v4"); assert.equal(currentPriceVersion({ KEYSTONE_DOCUSTAY_PRICE_VERSION: "v3" }), "v4"); assert.equal(priceLookupKey("month", "v4"), "docustay_pro_monthly_v4"); });
t("checkout always picks the current version; the compatibility flag is always false, whatever the date", () => { for (const at of ["2026-10-06T00:00:00Z", "2027-01-28T07:59:00Z", "2027-02-01T00:00:00Z"]) { assert.deepEqual(checkoutPricing({}, new Date(at)), { founders: false, version: "v4" }); } });
t("annual billing is OFF unless the setting is exactly 'true'", () => { for (const v of [undefined, "", "false", "1", "on", "TRUE ", "yes"]) assert.equal(annualEnabled({ KEYSTONE_DOCUSTAY_ANNUAL_ENABLED: v }), false); assert.equal(annualEnabled({ KEYSTONE_DOCUSTAY_ANNUAL_ENABLED: "true" }), true); });
t("seat settings are OFF by default: unlimited included seats, no extra-seat price; ON only with whole-number settings", () => {
  assert.deepEqual(seatSettings({}), { includedSeats: null, extraSeatPriceMinor: null, on: false });
  assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_INCLUDED_SEATS: "3" }), { includedSeats: 3, extraSeatPriceMinor: null, on: true });
  assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_INCLUDED_SEATS: "3", KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR: "800" }), { includedSeats: 3, extraSeatPriceMinor: 800, on: true });
  for (const bad of ["", "0x3", "-1", "2.5", "abc", "0"]) assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_INCLUDED_SEATS: bad }), { includedSeats: null, extraSeatPriceMinor: null, on: false });
  assert.deepEqual(seatSettings({ KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR: "800" }), { includedSeats: null, extraSeatPriceMinor: null, on: false });   // a price with no included count is meaningless: still off
});
console.log(`ok — ${n} groups`);
