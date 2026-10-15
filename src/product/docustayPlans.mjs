// src/product/docustayPlans.mjs — THE DOCUSTAY HOSTED PLANS (Batch B). Pure: no imports, environment injectable.
// ★ the maintainer ruled (3 Oct) that NO price and NO Pro feature list is decided: every number below is a SETTING read from the environment at call time, with a working placeholder
//   that is marked as one. Pro has NO price until KEYSTONE_DOCUSTAY_PRO_PRICE_MINOR is set — until then checkout refuses ("not priced yet") and nothing can be bought.
// ★ Core signing is never paywalled: the Free plan can create, send, sign and seal. What the plans change is VOLUME (documents sent per month, emails per day) and SIX Pro items (Part 29, the maintainer 4 Oct):
//   unlimited_documents · auto_reminders · bulk_send · team_roles · hide_footer · own_signing_domain. Each is checked through `entitled()` below at the one place it takes effect, never by comparing plan keys elsewhere.
//   Free keeps: own email domain, logo, API and webhooks (inside the monthly allowance) — they are not gated.

/** The six things Pro adds (the maintainer, 4 Oct 2026). One list; the gates and the pricing page read it. */
/** A commercial licence (embedding, white-label, resale, a private fork) is quoted from about $3,000 a year (the maintainer, 5 Oct 2026). A policy value used by the public pages (a claim in claims.json binds to it), not a billing amount: commercial licences are quoted and invoiced by hand. */
export const COMMERCIAL_LICENCE_FROM_MINOR = 300000;
export const PRO_ITEMS = Object.freeze(["unlimited_documents", "auto_reminders", "bulk_send", "team_roles", "hide_footer", "own_signing_domain"]);
/** The AI and Plays items Pro adds (the maintainer, 7 Oct 2026; the six above stay six because the pricing page quotes them). Checked through the same `entitled()` and the same port. Free keeps how-to answers, the checks, the built-in plays and a monthly AI draft cap. */
/** Run 8 (the maintainer, 11 Oct 2026): making a document or a form with AI is NOT Pro any more (Free does it within its monthly AI credits), so `ai_create` and `ai_forms` left this list. */
export const AI_PRO_ITEMS = Object.freeze(["custom_plays", "ai_bulk", "plays_api", "recurring_payments"]);
/** Run 9 (the maintainer, 12 Oct 2026, decision 2): a playbook that runs, signing groups, renewal reminders from key dates, and Scribe actions are Pro. Search, the person page, notifications, conditions and formulas, witness signing, the check before sending and the contract repository stay Free. */
export const RUN9_PRO_ITEMS = Object.freeze(["playbooks", "signing_groups", "renewal_reminders", "scribe_actions"]);
/** ★ NEVER SHOWN TO ANYONE. The grace after the FIRST failed payment before Pro falls to Free. Not returned by any route, not in any email, not on any screen (a gate greps for it). */
const GRACE_MS = 14 * 24 * 3600 * 1000;
const CANCEL_LATE_MS = 6 * 3600 * 1000;
/** ★ Founders' price (the maintainer, 4 Oct 2026): anyone who subscribes on or before this moment (three months after launch: provisionally the end of 27 Jan 2027, Pacific time; ONE setting, KEYSTONE_DOCUSTAY_FOUNDERS_UNTIL, changeable without code) keeps the price they got, for life; the flag belongs to the workspace. */
export const foundersUntil = (env = process.env) => new Date(env.KEYSTONE_DOCUSTAY_FOUNDERS_UNTIL || "2027-01-28T08:00:00Z");
/** Stripe price lookup keys — `docustay_pro_<interval>_<version>`. Founders keep the version they bought; new customers get the current one. */
export const priceLookupKey = (interval, version) => `docustay_pro_${interval === "year" ? "yearly" : "monthly"}_${version}`;
/** v1 is the retired $16 test price (Stripe cannot edit an amount): founders are v2 ($25), the current list price is v3 ($39) — the maintainer, 6 Oct 2026. */
export const currentPriceVersion = (env = process.env) => env.KEYSTONE_DOCUSTAY_PRICE_VERSION || "v3";
export const foundersPriceVersion = (env = process.env) => env.KEYSTONE_DOCUSTAY_FOUNDERS_VERSION || "v2";
/** What the public pages show when the billing system does not answer. NOT what anyone is charged: the code sells nothing until the price settings are set (production has none until the maintainer sets them). */
export const DISPLAY_PRICES = Object.freeze({ listMonthlyMinor: 3900, foundersMonthlyMinor: 2500, listYearlyMinor: 39000, foundersYearlyMinor: 25000 });
/** Founders window: open strictly before the cut-off instant (the first instant of 28 Jan 2027 Pacific, which is the end of 27 Jan: the page and the Terms say "the end of that day, Pacific time"). */
export const foundersOpen = (env = process.env, now = new Date()) => now.getTime() < foundersUntil(env).getTime();
/** The price chosen at the moment checkout STARTS (the session carries that price, whenever the card is entered). */
export const checkoutPricing = (env = process.env, now = new Date()) => { const founders = foundersOpen(env, now); return { founders, version: founders ? foundersPriceVersion(env) : currentPriceVersion(env) }; };
/** What a subscription event says about the workspace's founders flag: true/false to set it, null to leave it. Set only once the subscription is paid (active or trialing); cleared only by the subscription ending.
 *  The stamp put on the subscription at checkout is the truth; a subscription made before the stamp existed falls back to its creation date. */
export function foundersFlagFor({ status, metadata, created, deleted }, env = process.env) {
  if (deleted || status === "canceled") return false;
  if (status !== "active" && status !== "trialing") return null;
  const stamp = metadata?.founders_price;
  if (stamp === "true") return true;
  if (stamp === "false") return false;
  return created ? new Date(created * 1000).getTime() < foundersUntil(env).getTime() : null;
}
/** Annual billing is a setting, OFF and unpublished unless exactly "true". */
export const annualEnabled = (env = process.env) => env.KEYSTONE_DOCUSTAY_ANNUAL_ENABLED === "true";

const num = (v) => { const t = String(v ?? "").trim(); return /^\d{1,15}$/.test(t) ? Number(t) : null; };   // a whole number of digits only: a blank, "0x10" or "1e2" in the environment is "not set", never 0, 16 or 100

/** @param {Record<string,string|undefined>} env */
export function docustayPlans(env = process.env) {
  return Object.freeze([
    Object.freeze({
      key: "docustay_free", name: "Free", paid: false, priceMinor: 0, currency: "usd",
      docsPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_DOCS_PER_MONTH) ?? 15,      // ruled: 15 a month (Part 29)
      emailsPerDay: num(env.KEYSTONE_DOCUSTAY_FREE_EMAILS_PER_DAY) ?? 25,      // ruled: 25 a day Free (the maintainer, 6 Oct 2026); KEYSTONE_DOCUSTAY_FREE_EMAILS_PER_DAY changes it without code
      uploadMb: num(env.KEYSTONE_DOCUSTAY_FREE_UPLOAD_MB) ?? 25,               // ruled: 25 MB Free (the maintainer, 4 Oct 2026)
      aiDraftsPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_AI_DRAFTS_PER_MONTH) ?? 10,   // the small monthly cap on AI-made drafts and edits (the maintainer, 7 Oct 2026)
      templatesPerMonth: num(env.KEYSTONE_DOCUSTAY_FREE_TEMPLATES_PER_MONTH) ?? 5,   // ruled: 5 NEW templates a month on Free, however they are made, documents and forms together (the maintainer, 11 Oct 2026; run8/TEMPLATE-CAP.md)
      features: Object.freeze(["send", "sign", "seal", "templates", "upload", "own_email_domain", "logo", "api", "webhooks"]),
    }),
    Object.freeze({
      key: "docustay_pro", name: "Pro", paid: true, priceMinor: num(env.KEYSTONE_DOCUSTAY_PRO_PRICE_MINOR), foundersPriceMinor: num(env.KEYSTONE_DOCUSTAY_FOUNDERS_PRICE_MINOR),
      yearlyPriceMinor: num(env.KEYSTONE_DOCUSTAY_PRO_PRICE_YEARLY_MINOR), foundersYearlyPriceMinor: num(env.KEYSTONE_DOCUSTAY_FOUNDERS_PRICE_YEARLY_MINOR), currency: "usd",
      docsPerMonth: num(env.KEYSTONE_DOCUSTAY_PRO_DOCS_PER_MONTH),             // null = unlimited
      emailsPerDay: num(env.KEYSTONE_DOCUSTAY_PRO_EMAILS_PER_DAY) ?? 500,      // ruled: 500 a day Pro (the maintainer, 6 Oct 2026); KEYSTONE_DOCUSTAY_PRO_EMAILS_PER_DAY changes it without code
      uploadMb: num(env.KEYSTONE_DOCUSTAY_PRO_UPLOAD_MB) ?? 100,               // ruled: 100 MB Pro (the maintainer, 4 Oct 2026)
      aiDraftsPerMonth: num(env.KEYSTONE_DOCUSTAY_PRO_AI_DRAFTS_PER_MONTH) ?? 150,   // higher AI limits on Pro (the maintainer, 7 Oct 2026)
      templatesPerMonth: null,                                                     // Pro has no template cap (the maintainer, 11 Oct 2026)
      features: Object.freeze(["send", "sign", "seal", "templates", "upload", "own_email_domain", "logo", "api", "webhooks", ...PRO_ITEMS, ...AI_PRO_ITEMS, ...RUN9_PRO_ITEMS]),
    }),
  ]);
}
// ── AI CREDITS AND LIMITS (AI-COST-AND-USAGE-SPEC §2 and §4; the maintainer, 9 Oct 2026). One credit is about one Sonnet draft. Every number here is a default that an environment variable changes without code. ──
const dec = (v) => { const t = String(v ?? "").trim(); return /^\d{1,9}(\.\d{1,4})?$/.test(t) ? Number(t) : null; };
/** What each kind of AI work costs, in credits. Think harder (Opus 5.5) replaces the draft/edit weight for that request. */
function aiWeights(env = process.env) {
  return Object.freeze({
    draft: dec(env.KEYSTONE_AI_CREDITS_DRAFT) ?? 1, edit: dec(env.KEYSTONE_AI_CREDITS_EDIT) ?? 0.25, file_read: dec(env.KEYSTONE_AI_CREDITS_FILE_READ) ?? 0.5,
    detect: dec(env.KEYSTONE_AI_CREDITS_DETECT_PAGE) ?? 0.25, play: dec(env.KEYSTONE_AI_CREDITS_PLAY) ?? 0.1, check: dec(env.KEYSTONE_AI_CREDITS_CHECK) ?? 0.1,
    think_harder: dec(env.KEYSTONE_AI_CREDITS_THINK) ?? 3, chat: 0, review: 0, summary: 0, vision_check: 0,
  });
}
/** The AI policy a plan carries: the allowance, the hard dollar cap, the request limits and the size limits. null for a plan that is not a Docustay plan. */
export function aiPolicyFor(planKey, env = process.env) {
  const free = planKey === "docustay_free", pro = planKey === "docustay_pro";
  if (!free && !pro) return null;
  const P = free ? "FREE" : "PRO";
  return Object.freeze({
    plan: free ? "free" : "pro",
    creditsPerMonth: dec(env[`KEYSTONE_AI_${P}_CREDITS`]) ?? (free ? 10 : 150),
    usdCapMicro: Math.round((dec(env[`KEYSTONE_AI_${P}_USD_CAP`]) ?? (free ? 1.5 : 24)) * 1_000_000),
    perMinute: dec(env.KEYSTONE_AI_PER_MINUTE) ?? 5, perHour: dec(env.KEYSTONE_AI_PER_HOUR) ?? 60, perDay: dec(env[`KEYSTONE_AI_${P}_PER_DAY`]) ?? (free ? 5 : 40),
    maxQueued: dec(env.KEYSTONE_AI_MAX_QUEUED) ?? 3, inputTokens: dec(env.KEYSTONE_AI_INPUT_TOKENS) ?? 60000, outputTokens: dec(env.KEYSTONE_AI_OUTPUT_TOKENS) ?? 12000,
    toolTurns: dec(env.KEYSTONE_AI_TOOL_TURNS) ?? 8, summariseAfter: dec(env.KEYSTONE_AI_SUMMARISE_AFTER) ?? 30, fileMb: dec(env.KEYSTONE_AI_FILE_MB) ?? 10, filePages: dec(env.KEYSTONE_AI_FILE_PAGES) ?? 30,
    thinkHarder: pro, thinkPerMonth: pro ? (dec(env.KEYSTONE_AI_THINK_PER_MONTH) ?? 20) : 0, thinkPerDay: pro ? (dec(env.KEYSTONE_AI_THINK_PER_DAY) ?? 3) : 0,
    perUserShare: dec(env.KEYSTONE_AI_PER_USER_SHARE) ?? 0.6,
    weights: aiWeights(env),
  });
}
/** The window a plan's AI allowance is counted over: Free resets on the 1st of the month (UTC); Pro on its billing anniversary (the day its current period ends), falling back to the calendar month when the period is unknown or already past. */
export function aiWindow(planKey, currentPeriodEnd, now = new Date()) {
  const calendar = () => ({ start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
  if (planKey !== "docustay_pro" || !currentPeriodEnd) return calendar();
  const end = new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) return calendar();
  const prevMonth = (d) => { const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(), m = (d.getUTCMonth() + 11) % 12; const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())); };
  let start = prevMonth(end), e = end;
  while (start.getTime() > now.getTime()) { e = start; start = prevMonth(start); }   // a yearly period: step back to the monthly slice that holds now
  while (e.getTime() <= now.getTime()) { start = e; e = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, Math.min(e.getUTCDate(), new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 2, 0)).getUTCDate()))); }
  return { start, end: e };
}
/** The platform-wide safety net (the Docustay owner's bill): a monthly dollar ceiling, a daily one twentieth of it, and the alert levels. */
export const aiPlatformCeilingUsd = (env = process.env) => dec(env.KEYSTONE_AI_PLATFORM_MONTHLY_USD) ?? 150;
export const AI_ALERT_LEVELS = Object.freeze([50, 80, 100]);

const DOCUSTAY_PLAN_KEYS = Object.freeze(["docustay_free", "docustay_pro"]);
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
