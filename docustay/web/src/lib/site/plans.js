// The prices the public pages show. Live values come from the billing system when it answers; when it does not, these defaults keep the page whole (the pricing page must never say "loading").
// Pro is one price for everyone: flat per workspace with unlimited team members (the number is in the price list). Yearly billing is a setting that is OFF, so no yearly figure is shown unless the billing system sends one.
import PRICES from "./prices.json" with { type: "json" };   // generated from src/product/docustayPrices.mjs, the one price list (scripts/build-prices.mjs); never edit by hand
/** The shared pricing words (glossary, compare table, footnote, cost example), generated from src/product/docustayWords.mjs into prices.json. */
export const WORDS = PRICES.words;
export const DEFAULT_PLANS = {
  free: { docsPerMonth: PRICES.free.docsIncluded, templatesPerMonth: PRICES.free.templatesPerMonth, signersPerMonth: PRICES.free.signersPerMonth, draftsPerMonth: PRICES.free.draftsIncluded, feeBps: PRICES.free.feeBps, bulkCap: PRICES.free.bulkCap, people: PRICES.free.people },
  payg: { personMonthlyMinor: PRICES.payg.personMonthlyMinor, templatesPerMonth: PRICES.payg.templatesPerMonth, docsIncluded: PRICES.payg.docsIncluded, docOverMinor: PRICES.payg.docOverMinor, draftsIncluded: PRICES.payg.draftsIncluded, draftOverMinor: PRICES.payg.draftOverMinor, feeBps: PRICES.payg.feeBps },
  pro: { monthlyMinor: PRICES.pro.monthlyMinor, draftsIncluded: PRICES.pro.draftsIncluded, draftOverMinor: PRICES.pro.draftOverMinor, feeBps: PRICES.pro.feeBps, items: ["unlimited documents", "unlimited templates", "unlimited team members", "unlimited signers", "your own plays and playbooks", "the Plays API", "100 MB uploads"] },
  lifetime: { oneTimeMinor: PRICES.lifetime.oneTimeMinor, draftsIncluded: PRICES.lifetime.draftsIncluded, draftOverMinor: PRICES.lifetime.draftOverMinor, feeBps: PRICES.lifetime.feeBps },
  budget: { defaultMinor: PRICES.budget.defaultMinor, alertPercents: PRICES.budget.alertPercents, earlyInvoiceMinor: PRICES.budget.earlyInvoiceMinor, confirmOverMinor: PRICES.budget.confirmOverMinor, failedPaymentPauseDays: PRICES.budget.failedPaymentPauseDays },
  live: false };
// The other prices, fixed by decision (the maintainer, 5 Oct 2026): Self-host Pro is $390 a year per install, for the buyer's own business; a commercial licence (embedding, white-label, resale, a private fork) is quoted from about $3,000 a year.
export const SELFHOST_PRO_YEARLY_MINOR = PRICES.selfhost.proYearlyMinor;
export const COMMERCIAL_FROM_MINOR = PRICES.selfhost.commercialFromMinor;
// Run 8 (the maintainer, 11 Oct 2026): Free makes 5 new templates a month (documents and forms together, however they are made); Pro and self-hosted installs have no template limit. The server's number is
// docustayPlans.mjs `templatesPerMonth`; the claims gate binds this copy to it.
// Scribe AI credits a month by plan. The claims gate checks both numbers against the server (src/product/docustayPlans.mjs).
export const AI_CREDITS = { free: PRICES.free.draftsIncluded, payg: PRICES.payg.draftsIncluded, pro: PRICES.pro.draftsIncluded, lifetime: PRICES.lifetime.draftsIncluded };   // AI drafts a month included in each plan (a "credit" is one draft)
// Limits the /facts page states. The claims gate binds each number to the server's own value (docustayPlans.mjs, rateLimit.mjs).
export const LIMITS = { freeUploadMb: PRICES.free.uploadMb, proUploadMb: PRICES.pro.uploadMb, freeEmailsPerDay: PRICES.limits.freeEmailsPerDay, proEmailsPerDay: PRICES.limits.paidEmailsPerDay, apiRequestsPerMinute: PRICES.limits.apiRequestsPerMinute };   // from prices.json, which plumb writes from the facts file
/** The day the /facts page was last checked against the code (the claims gate runs on every build; this is the date a person last read the page). */
export const FACTS_CHECKED = "12 October 2026";
/** The numbers on the public pages come from prices.json (generated from the one price list), never from the live payload: prices are fixed by decision, and a spread of live values over the defaults once put Pro's numbers on the Pay as you go card (17 Oct 2026).
 *  The live payload is only CHECKED against them; on any disagreement the defaults are used and the disagreement is logged. */
const NAMES = { free: "Free", payg: "Pay as you go", pro: "Pro", lifetime: "Lifetime" };
const KEYS = { free: "docustay_free", payg: "docustay_payg", pro: "docustay_pro", lifetime: "docustay_lifetime" };
export function livePlanProblems(live, D = DEFAULT_PLANS) {
  const bad = [];
  if (!live || typeof live !== "object") return ["no payload"];
  for (const k of Object.keys(NAMES)) {
    const e = live[k];
    if (!e || typeof e !== "object") { bad.push(`${k} missing`); continue; }
    if (e.name !== NAMES[k]) bad.push(`${k}.name is ${JSON.stringify(e.name)}`);
    if (e.key !== undefined && e.key !== KEYS[k]) bad.push(`${k}.key is ${JSON.stringify(e.key)}`);
    for (const f of Object.keys(D[k])) { if (typeof D[k][f] === "number" && e[f] !== undefined && e[f] !== D[k][f]) bad.push(`${k}.${f} is ${JSON.stringify(e[f])}, expected ${D[k][f]}`); }
  }
  return bad;
}
export function viewPlans(live) {
  if (!live) return DEFAULT_PLANS;
  const problems = livePlanProblems(live);
  if (problems.length) { console.error(`pricing: live plans disagree with prices.json (${problems.join("; ")}); using prices.json`); return DEFAULT_PLANS; }
  return { ...DEFAULT_PLANS, live: true };
}
/** The "Which plan fits you?" calculator, one pure function (SIGNWITH 5.19): what each plan would cost a month for this many team members who send, documents sent, AI drafts and different signers. Free fits only for one team member inside its limits (documents, AI drafts and different signers).
 *  Pay as you go = team members x team member price + documents over the included amount x document price + drafts over the included amount x draft price. Pro = its flat price + drafts over 100. Money in whole cents. */
export function planCosts(p, { people, docs, drafts, signers = 0 }) {
  const pro = proShown(p);
  const over = (n, incl) => Math.max(0, n - incl);
  const freeFits = people <= 1 && docs <= p.free.docsPerMonth && drafts <= p.free.draftsPerMonth && signers <= p.free.signersPerMonth;
  const payg = { people: people * p.payg.personMonthlyMinor, docs: over(docs, p.payg.docsIncluded) * p.payg.docOverMinor, drafts: over(drafts, p.payg.draftsIncluded) * p.payg.draftOverMinor };
  payg.total = payg.people + payg.docs + payg.drafts;
  const proCost = { base: pro.monthlyMinor, drafts: over(drafts, p.pro.draftsIncluded) * p.pro.draftOverMinor }; proCost.total = proCost.base + proCost.drafts;
  const options = [...(freeFits ? [["free", 0]] : []), ["payg", payg.total], ["pro", proCost.total]];
  const best = options.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  return { free: { fits: freeFits, total: freeFits ? 0 : null }, payg, pro: proCost, best };
}
export const dollars = (minor) => `$${(minor / 100) % 1 === 0 ? (minor / 100).toLocaleString("en-US") : (minor / 100).toFixed(2)}`;

/** What the Pro card shows: the one monthly price; a yearly figure only when the billing system sent one. */
export function proShown(p) {
  return { monthlyMinor: p.pro.monthlyMinor, yearlyMinor: Number.isFinite(p.pro.yearlyMinor) ? p.pro.yearlyMinor : null };
}
