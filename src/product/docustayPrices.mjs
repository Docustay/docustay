// src/product/docustayPrices.mjs — THE ONE DOCUSTAY PRICE LIST: the JavaScript face of the facts file (src/product/docustay.facts.json). Pure: no environment.
// Every price, allowance and fee the product, the API (`GET /api/v1/usage`, `/api/product/docustay/plans`) and the website show or charge is read from the facts file; the site gets a
// generated JSON copy (scripts/build-prices.mjs). Money is whole cents (USD). A number changes in the facts file and nowhere else: `plumb change <fact> <value>`.
import FACTS from "./docustay.facts.json" with { type: "json" };
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
// the lines the maintainer set (tagline) carry {pro} and {person} where a price belongs; they are filled from the price list here so no price is typed twice
{ const usd = (m) => (m % 100 === 0 ? `$${m / 100}` : `$${(m / 100).toFixed(2)}`);
  for (const [k, v] of Object.entries(FACTS.tagline)) FACTS.tagline[k] = v.replaceAll("{pro}", usd(FACTS.pricing.pro.monthlyMinor)).replaceAll("{person}", usd(FACTS.pricing.payg.personMonthlyMinor)); }
// the places that repeat the about line (GitHub About, image labels) say {about} in the facts file
FACTS.positioning = FACTS.tagline.headline;
FACTS.github.description = FACTS.github.description.replaceAll("{about}", FACTS.tagline.about);
for (const k of Object.keys(FACTS.imageLabels)) FACTS.imageLabels[k].description = FACTS.imageLabels[k].description.replaceAll("{about}", FACTS.tagline.about);
export { FACTS };
export const PRICES = deepFreeze(structuredClone(FACTS.pricing));
export const PLAN_ORDER = Object.freeze(["docustay_free", "docustay_payg", "docustay_pro", "docustay_lifetime"]);
export const priceFor = (planKey) => Object.values(PRICES).find((p) => p && p.key === planKey) ?? null;
