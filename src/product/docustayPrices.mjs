// src/product/docustayPrices.mjs — THE ONE DOCUSTAY PRICE LIST (v1 item 22). Pure: no imports, no environment. Every price, allowance and fee the product, the API
// (`GET /api/v1/usage`, `/api/product/docustay/plans`) and the website show or charge is read from here; the site gets a generated JSON copy (scripts/build-prices.mjs).
// Money is whole cents (USD). A number changes here and nowhere else. (SIGNWITH 5.1 / 5.17, the maintainer 17 Oct 2026.)
export const PRICES = Object.freeze({
  currency: "usd",
  free: Object.freeze({ key: "docustay_free", name: "Free", personMonthlyMinor: 0, docsIncluded: 15, docOverMinor: null, draftsIncluded: 10, draftOverMinor: null, feeBps: 200, people: 1, signersPerMonth: 15, templatesPerMonth: 5, uploadMb: 25, bulkCap: 15 }),
  payg: Object.freeze({ key: "docustay_payg", name: "Pay as you go", personMonthlyMinor: 500, docsIncluded: 15, docOverMinor: 50, draftsIncluded: 10, draftOverMinor: 30, feeBps: 200, people: null, templatesPerMonth: 25, uploadMb: 25, bulkCap: null }),
  pro: Object.freeze({ key: "docustay_pro", name: "Pro", foundersMonthlyMinor: 2500, listMonthlyMinor: 3900, docsIncluded: null, docOverMinor: null, draftsIncluded: 100, draftOverMinor: 30, feeBps: 0, people: null, templatesPerMonth: null, uploadMb: 100, bulkCap: null }),
  lifetime: Object.freeze({ key: "docustay_lifetime", name: "Lifetime", oneTimeMinor: 29900, firstWorkspaces: 200, docsIncluded: null, docOverMinor: null, draftsIncluded: 50, draftOverMinor: 30, feeBps: 0, people: null, templatesPerMonth: null, uploadMb: 100, bulkCap: null }),
  // The two allowances added 21 Oct 2026 (the maintainer): Free signers (distinct email addresses a workspace sends to in a month) and Pay as you go new templates. Both start on this date so a workspace already over them is not stopped mid-period (the notice says so).
  newLimitsFrom: "2026-11-01T00:00:00Z",
  foundersUntil: "2027-01-28T08:00:00Z",
  budget: Object.freeze({ defaultMinor: 5000, alertPercents: Object.freeze([50, 80, 100]), confirmOverMinor: 500, earlyInvoiceMinor: 5000, failedPaymentPauseDays: 7 }),
});
export const PLAN_ORDER = Object.freeze(["docustay_free", "docustay_payg", "docustay_pro", "docustay_lifetime"]);
export const priceFor = (planKey) => Object.values(PRICES).find((p) => p && p.key === planKey) ?? null;
