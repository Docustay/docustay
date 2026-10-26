import { PRICES, FACTS } from "./docustayPrices.mjs";
// src/product/docustayPlans.mjs — THE DOCUSTAY HOSTED PLANS (Batch B). Pure: no imports, environment injectable.
// ★ the maintainer ruled (3 Oct) that NO price and NO Pro feature list is decided: every number below is a SETTING read from the environment at call time, with a working placeholder
//   that is marked as one. Pro has NO price until KEYSTONE_DOCUSTAY_PRO_PRICE_MINOR is set — until then checkout refuses ("not priced yet") and nothing can be bought.
// ★ Core signing is never paywalled: the Free plan can create, send, sign and seal. What the plans change is VOLUME (documents sent per month, emails per day) and SIX Pro items (Part 29, the maintainer 4 Oct):
//   unlimited_documents · auto_reminders · bulk_send · team_roles · hide_footer. Each is checked through `entitled()` below at the one place it takes effect, never by comparing plan keys elsewhere.
//   Free keeps: own email domain, logo, API and webhooks (inside the monthly allowance) — they are not gated.

/** The six things Pro adds (the maintainer, 4 Oct 2026). One list; the gates and the pricing page read it. */
/** A commercial licence (embedding, white-label, resale, a private fork) is quoted from about $3,000 a year (the maintainer, 5 Oct 2026). A policy value used by the public pages (a claim in claims.json binds to it), not a billing amount: commercial licences are quoted and invoiced by hand. */
export const COMMERCIAL_LICENCE_FROM_MINOR = 300000;
// hide_footer stays in this list for a SELF-HOSTED install (its Pro add-on / licence decides); the hosted service no longer offers the switch (Docustay v1 item 12), so no hosted screen, answer or plan line mentions it.
export const PRO_ITEMS = Object.freeze(["unlimited_documents", "hide_footer"]);
/** v1 item 16 (the maintainer, 17 Oct 2026): reminders, team roles, bulk send, signing groups, Scribe actions and AI bulk are on EVERY plan now (what is limited is volume and price, not these). The names stay so every gate keeps asking `entitled()` and the answer is yes. */
export const EVERY_PLAN_ITEMS = Object.freeze(["auto_reminders", "bulk_send", "team_roles", "signing_groups", "scribe_actions", "ai_bulk"]);
/** The AI and Plays items Pro adds (the maintainer, 7 Oct 2026; the six above stay six because the pricing page quotes them). Checked through the same `entitled()` and the same port. Free keeps how-to answers, the checks, the built-in plays and a monthly AI draft cap. */
/** Run 8 (the maintainer, 11 Oct 2026): making a document or a form with AI is NOT Pro any more (Free does it within its monthly AI credits), so `ai_create` and `ai_forms` left this list. */
export const AI_PRO_ITEMS = Object.freeze(["custom_plays", "plays_api"]);
/** Run 9 (the maintainer, 12 Oct 2026, decision 2): a playbook that runs, signing groups, renewal reminders from key dates, and Scribe actions are Pro. Search, the person page, notifications, conditions and formulas, witness signing, the check before sending and the contract repository stay Free. */
export const RUN9_PRO_ITEMS = Object.freeze([]);   // signing_groups and scribe_actions moved to EVERY_PLAN_ITEMS (v1 item 16)
/** ★ NEVER SHOWN TO ANYONE. The grace after the FIRST failed payment before Pro falls to Free. Not returned by any route, not in any email, not on any screen (a gate greps for it). */
const GRACE_MS = PRICES.budget.failedPaymentPauseDays * 24 * 3600 * 1000;   // about 7 days (the maintainer, 17 Oct 2026); documents are never deleted
const CANCEL_LATE_MS = 6 * 3600 * 1000;
/** Stripe price lookup keys — `docustay_pro_<interval>_<version>`. Prices are never edited in Stripe, so a new amount is a new version (the facts file names the current one). */
export const priceLookupKey = (interval, version) => `docustay_pro_${interval === "year" ? "yearly" : "monthly"}_${version}`;
/** The Stripe price version comes from the facts file only: an environment variable cannot make the app charge a different price than the one published. */
export const currentPriceVersion = () => PRICES.pro.stripeVersion;
/** What the public pages show when the billing system does not answer. NOT what anyone is charged. */
export const DISPLAY_PRICES = Object.freeze({ monthlyMinor: PRICES.pro.monthlyMinor });
/** The price chosen at the moment checkout STARTS (the session carries that price, whenever the card is entered). One price for everyone; the `founders` key stays false for API compatibility. */
export const checkoutPricing = (env = process.env) => ({ founders: false, version: currentPriceVersion(env) });
/** Annual billing is a setting, OFF and unpublished unless exactly "true". */
export const annualEnabled = (env = process.env) => env.KEYSTONE_DOCUSTAY_ANNUAL_ENABLED === "true";

const num = (v) => { const t = String(v ?? "").trim(); return /^\d{1,15}$/.test(t) ? Number(t) : null; };   // a whole number of digits only: a blank, "0x10" or "1e2" in the environment is "not set", never 0, 16 or 100

/** @param {Record<string,string|undefined>} env */
export function docustayPlans(env = process.env) {
  return Object.freeze([
    Object.freeze({
      key: "docustay_free", name: "Free", paid: false, feeBps: PRICES.free.feeBps, draftOverMinor: null, docOverMinor: null, bulkCap: PRICES.free.bulkCap, people: PRICES.free.people, priceMinor: 0, currency: "usd",
      signersPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_SIGNERS_PER_MONTH) ?? PRICES.free.signersPerMonth,   // ruled 21 Oct 2026 (the maintainer): 15 different signers a month on Free; starts PRICES.newLimitsFrom
      docsPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_DOCS_PER_MONTH) ?? PRICES.free.docsIncluded,      // ruled: 15 a month (Part 29)
      emailsPerDay: num(env.KEYSTONE_DOCUSTAY_FREE_EMAILS_PER_DAY) ?? FACTS.limits.freeEmailsPerDay,      // ruled: 25 a day Free (the maintainer, 6 Oct 2026); KEYSTONE_DOCUSTAY_FREE_EMAILS_PER_DAY changes it without code
      uploadMb: num(env.KEYSTONE_DOCUSTAY_FREE_UPLOAD_MB) ?? PRICES.free.uploadMb,               // ruled: 25 MB Free (the maintainer, 4 Oct 2026)
      aiDraftsPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_AI_DRAFTS_PER_MONTH) ?? PRICES.free.draftsIncluded,   // the small monthly cap on AI-made drafts and edits (the maintainer, 7 Oct 2026)
      templatesPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_TEMPLATES_PER_MONTH) ?? PRICES.free.templatesPerMonth,   // ruled: 5 NEW templates a month on Free, however they are made, documents and forms together (the maintainer, 11 Oct 2026; run8/TEMPLATE-CAP.md)
      features: Object.freeze(["send", "sign", "seal", "templates", "upload", "own_email_domain", "logo", "api", "webhooks", ...EVERY_PLAN_ITEMS]),
    }),
    Object.freeze({
      key: "docustay_pro", name: "Pro", paid: true, feeBps: 0, draftOverMinor: PRICES.pro.draftOverMinor, docOverMinor: null, bulkCap: null, priceMinor: PRICES.pro.monthlyMinor,
      yearlyPriceMinor: null, currency: "usd",
      docsPerMonth: num(env.KEYSTONE_DOCUSTAY_PRO_DOCS_PER_MONTH),             // null = unlimited
      emailsPerDay: num(env.KEYSTONE_DOCUSTAY_PRO_EMAILS_PER_DAY) ?? FACTS.limits.paidEmailsPerDay,      // ruled: 500 a day Pro (the maintainer, 6 Oct 2026); KEYSTONE_DOCUSTAY_PRO_EMAILS_PER_DAY changes it without code
      uploadMb: num(env.KEYSTONE_DOCUSTAY_PRO_UPLOAD_MB) ?? PRICES.pro.uploadMb,               // ruled: 100 MB Pro (the maintainer, 4 Oct 2026)
      aiDraftsPerMonth: num(env.KEYSTONE_DOCUSTAY_PRO_AI_DRAFTS_PER_MONTH) ?? PRICES.pro.draftsIncluded,   // 100 a month included (the maintainer, 17 Oct 2026); more at $0.30 each
      templatesPerMonth: null,                                                     // Pro has no template cap (the maintainer, 11 Oct 2026)
      features: Object.freeze(["send", "sign", "seal", "templates", "upload", "own_email_domain", "logo", "api", "webhooks", ...EVERY_PLAN_ITEMS, ...PRO_ITEMS, ...AI_PRO_ITEMS, ...RUN9_PRO_ITEMS]),
    }),
    Object.freeze({
      key: "docustay_payg", name: "Pay as you go", paid: true, usage: true, feeBps: PRICES.payg.feeBps, personMonthlyMinor: PRICES.payg.personMonthlyMinor, priceMinor: PRICES.payg.personMonthlyMinor, currency: "usd",
      docsPerMonth: PRICES.payg.docsIncluded, docOverMinor: PRICES.payg.docOverMinor, draftOverMinor: PRICES.payg.draftOverMinor, bulkCap: null,
      emailsPerDay: num(env.KEYSTONE_DOCUSTAY_PRO_EMAILS_PER_DAY) ?? FACTS.limits.paidEmailsPerDay, uploadMb: PRICES.payg.uploadMb, aiDraftsPerMonth: PRICES.payg.draftsIncluded, templatesPerMonth: num(env.KEYSTONE_DOCUSTAY_PAYG_TEMPLATES_PER_MONTH) ?? PRICES.payg.templatesPerMonth,   // ruled 21 Oct 2026 (the maintainer): 25 NEW templates a month on Pay as you go, not charged per template; over it the prompt offers Pro
      features: Object.freeze(["send", "sign", "seal", "templates", "upload", "own_email_domain", "logo", "api", "webhooks", ...EVERY_PLAN_ITEMS]),
    }),
    Object.freeze({
      key: "docustay_lifetime", name: "Lifetime", paid: true, lifetime: true, feeBps: 0, oneTimeMinor: PRICES.lifetime.oneTimeMinor, priceMinor: PRICES.lifetime.oneTimeMinor, currency: "usd",
      docsPerMonth: null, docOverMinor: null, draftOverMinor: PRICES.lifetime.draftOverMinor, bulkCap: null,
      emailsPerDay: num(env.KEYSTONE_DOCUSTAY_PRO_EMAILS_PER_DAY) ?? FACTS.limits.paidEmailsPerDay, uploadMb: PRICES.lifetime.uploadMb, aiDraftsPerMonth: PRICES.lifetime.draftsIncluded, templatesPerMonth: null,
      features: Object.freeze(["send", "sign", "seal", "templates", "upload", "own_email_domain", "logo", "api", "webhooks", ...EVERY_PLAN_ITEMS, ...PRO_ITEMS, ...AI_PRO_ITEMS, ...RUN9_PRO_ITEMS]),
    }),
  ]);
}
// ── AI CREDITS AND LIMITS (AI-COST-AND-USAGE-SPEC §2 and §4; the maintainer, 9 Oct 2026). One credit is about one Sonnet draft. Every number here is a default that an environment variable changes without code. ──
const dec = (v) => { const t = String(v ?? "").trim(); return /^\d{1,9}(\.\d{1,4})?$/.test(t) ? Number(t) : null; };
/** What each kind of AI work costs, in credits. */
function aiWeights(env = process.env) {
  return Object.freeze({
    draft: dec(env.KEYSTONE_AI_CREDITS_DRAFT) ?? 1, edit: dec(env.KEYSTONE_AI_CREDITS_EDIT) ?? 0.25, file_read: dec(env.KEYSTONE_AI_CREDITS_FILE_READ) ?? 0.5,
    detect: dec(env.KEYSTONE_AI_CREDITS_DETECT_PAGE) ?? 0.25, play: dec(env.KEYSTONE_AI_CREDITS_PLAY) ?? 0.1, check: dec(env.KEYSTONE_AI_CREDITS_CHECK) ?? 0.1,
    chat: 0, review: 0, summary: 0, vision_check: 0,
  });
}
/** The AI policy a plan carries: the allowance, the hard dollar cap, the request limits and the size limits. null for a plan that is not a Docustay plan. */
export function aiPolicyFor(planKey, env = process.env) {
  const LABEL = { docustay_free: "free", docustay_payg: "payg", docustay_pro: "pro", docustay_lifetime: "lifetime" };
  if (!LABEL[planKey]) return null;
  const free = planKey === "docustay_free", payg = planKey === "docustay_payg", pro = planKey === "docustay_pro", life = planKey === "docustay_lifetime";
  const P = free ? "FREE" : payg ? "PAYG" : life ? "LIFETIME" : "PRO", drafts = free ? PRICES.free.draftsIncluded : payg ? PRICES.payg.draftsIncluded : life ? PRICES.lifetime.draftsIncluded : PRICES.pro.draftsIncluded;
  return Object.freeze({
    plan: LABEL[planKey],
    creditsPerMonth: dec(env[`KEYSTONE_AI_${P}_CREDITS`]) ?? drafts,
    draftOverMinor: free ? null : PRICES.pro.draftOverMinor,   // over the allowance: $0.30 a draft, shown before use; Free simply stops (the maintainer, 17 Oct 2026)
    usdCapMicro: Math.round((dec(env[`KEYSTONE_AI_${P}_USD_CAP`]) ?? (free || payg ? 1.5 : pro ? 24 : 8)) * 1_000_000),
    perMinute: dec(env.KEYSTONE_AI_PER_MINUTE) ?? 5, perHour: dec(env.KEYSTONE_AI_PER_HOUR) ?? 60, perDay: dec(env[`KEYSTONE_AI_${P}_PER_DAY`]) ?? (free || payg ? 5 : 40),
    maxQueued: dec(env.KEYSTONE_AI_MAX_QUEUED) ?? 3, inputTokens: dec(env.KEYSTONE_AI_INPUT_TOKENS) ?? 60000, outputTokens: dec(env.KEYSTONE_AI_OUTPUT_TOKENS) ?? 12000,
    toolTurns: dec(env.KEYSTONE_AI_TOOL_TURNS) ?? 8, summariseAfter: dec(env.KEYSTONE_AI_SUMMARISE_AFTER) ?? 30, fileMb: dec(env.KEYSTONE_AI_FILE_MB) ?? 10, filePages: dec(env.KEYSTONE_AI_FILE_PAGES) ?? 30,
    weights: aiWeights(env),
  });
}
/** The platform-wide safety net (the Docustay owner's bill): a monthly dollar ceiling, a daily one twentieth of it, and the alert levels. */
export const aiPlatformCeilingUsd = (env = process.env) => dec(env.KEYSTONE_AI_PLATFORM_MONTHLY_USD) ?? 150;
export const AI_ALERT_LEVELS = Object.freeze([50, 80, 100]);

const DOCUSTAY_PLAN_KEYS = Object.freeze(["docustay_free", "docustay_payg", "docustay_pro", "docustay_lifetime"]);
export const isDocustayPlanKey = (k) => DOCUSTAY_PLAN_KEYS.includes(k);
export const docustayPlan = (key, env = process.env) => docustayPlans(env).find((p) => p.key === key) ?? null;
/** What a subscription row (or none) means: no row, or a non-Docustay plan, is "not a Docustay plan". A cancelled or past-due Pro falls back to the Free limits. */
export function effectivePlan(sub, env = process.env, now = new Date()) {
  if (!sub || !isDocustayPlanKey(sub.plan_key)) return null;
  const free = () => docustayPlan("docustay_free", env);
  if (sub.status === "canceled") return free();
  // D9 (13 Oct 2026): Pro REALLY stops when the paid period ends. Stripe ends a cancelled subscription at its cancel date and says so by webhook; if that notice is late or lost, the date itself ends Pro here
  //   (a 6-hour allowance for Stripe's own delay), and the daily reconcile then makes the row say so too.
  if (sub.cancel_at && now.getTime() > new Date(sub.cancel_at).getTime() + CANCEL_LATE_MS) return free();
  if (sub.status === "past_due") {
    // paid access continues for the grace after the FIRST failed payment (past_due_since); an older row without the date counts from its last change
    const since = new Date(sub.past_due_since ?? sub.updated_at ?? 0).getTime();
    if (!(now.getTime() < since + GRACE_MS)) return free();
  }
  return docustayPlan(sub.plan_key, env);
}
/** True when a subscription is past due and still inside the grace — for the customer's "update your payment method" notice. It carries no number of days. */
export const inGrace = (sub, now = new Date()) => sub?.status === "past_due" && now.getTime() < new Date(sub.past_due_since ?? sub.updated_at ?? 0).getTime() + GRACE_MS;
export const entitled = (plan, feature) => Boolean(plan?.features?.includes(feature));

/** Seats are never priced by default. Two settings, both OFF: how many people who sign in to send or manage are included (default unlimited), and what each extra one costs (default none; meaningless without an included count). */
export function seatSettings(env = process.env) {
  const included = num(env.KEYSTONE_DOCUSTAY_INCLUDED_SEATS);
  if (!included) return { includedSeats: null, extraSeatPriceMinor: null, on: false };
  return { includedSeats: included, extraSeatPriceMinor: num(env.KEYSTONE_DOCUSTAY_EXTRA_SEAT_PRICE_MINOR), on: true };
}
