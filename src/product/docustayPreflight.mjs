// src/product/docustayPreflight.mjs — THE ONE PREFLIGHT (plan-aware prompting, Part 2, 19 Oct 2026; specs/v1/PROMPTING-SPEC.md sections 3 and 5).
// "May I do this, what does it cost, and what are my options?" answered BEFORE the action, in one place, for the web, the REST API, the SDKs, the CLI and the MCP server.
// It decides nothing new: every number and every gate is read from what already exists (`PRICES`, `effectivePlan`, the period window, the send and template counts, the budget, the AI credit view,
// the seat count, the upload cap, `entitled`). The refusals the gates throw keep their stable codes and messages; this answers the same question first, with the options.
//   preflight(tx, { tenantId, action, size, item })  → { action, allowed, plan, period, meter, cost, afterThis, severity, reason, options, message }
// Two halves so the matrix can be tested without a database: `gatherFacts` reads what the action needs, `decide` is pure (facts in, answer out).
import { PRICES } from "./docustayPrices.mjs";
import { docustayPlan, effectivePlan, entitled, aiPolicyFor, foundersOpen } from "./docustayPlans.mjs";
import { windowOf, subRow, newLimitsOn } from "./docustay.mjs";
import { signerLimitText, templateLimitText } from "./docustayWords.mjs";
import { budgetState, estimateDocuments } from "./docustayUsage.mjs";
import { sendCountForPeriod, templateCreationsInPeriod, signersInPeriod, newSignersAmong } from "../documents/api.mjs";
import { aiUsageView } from "../documents/frontDoor.mjs";
import { teamSeatUsage } from "../people/seats.mjs";
import { uploadCapMb } from "../documents/uploadLimit.mjs";
import { invalid } from "../http/errors.mjs";

export const PREFLIGHT_ACTIONS = Object.freeze(["send_document", "bulk_send", "invite_person", "remove_person", "ai_draft", "ai_edit", "ai_read_file", "create_template", "upload", "use_feature", "connect_payments"]);
export const SEVERITIES = Object.freeze(["none", "info", "warn", "limit", "blocked"]);
const AI_WEIGHT_KEY = { ai_draft: "draft", ai_edit: "edit", ai_read_file: "file_read" };

/** Whole dollars read "$5", anything else "$0.50". */
export const dollars = (minor) => (Number(minor) % 100 === 0 ? `$${Number(minor) / 100}` : `$${(Number(minor) / 100).toFixed(2)}`);
const dayText = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** The severity of a meter at `percent` of its limit. `blocked` is decided by the caller (the action would be refused). */
export const severityAt = (percent) => (percent >= 100 ? "limit" : percent >= 80 ? "warn" : percent >= 50 ? "info" : "none");
const worse = (a, b) => (SEVERITIES.indexOf(a) >= SEVERITIES.indexOf(b) ? a : b);

const OPTIONS = {
  payg: () => ({ key: "payg", label: "Switch to Pay as you go", priceMinor: PRICES.payg.personMonthlyMinor, per: "team member a month",
    unlocks: [`${PRICES.payg.docsIncluded} documents included, then ${dollars(PRICES.payg.docOverMinor)} each`, `${PRICES.payg.draftsIncluded} AI drafts included, then ${dollars(PRICES.payg.draftOverMinor)} each`, `${PRICES.payg.templatesPerMonth} new templates a month`, `${PRICES.payg.feeBps / 100}% fee on payments`] }),
  pro: () => { const o = proOfferNow(); return o ? { key: "pro", label: "Choose Pro", priceMinor: o.priceMinor, per: "month", founders: o.founders,
    unlocks: ["Unlimited documents and people", `${PRICES.pro.draftsIncluded} AI drafts a month, then ${dollars(PRICES.pro.draftOverMinor)} each`, `${PRICES.pro.uploadMb} MB uploads`, "0% fee on payments", "Your own plays and playbooks"] } : null; },
  lifetime: () => ({ key: "lifetime", label: "Choose Lifetime", priceMinor: PRICES.lifetime.oneTimeMinor, per: "once",
    unlocks: ["Pro for as long as Docustay runs the hosted service", `${PRICES.lifetime.draftsIncluded} AI drafts a month, then ${dollars(PRICES.lifetime.draftOverMinor)} each`, "0% fee on payments", `First ${PRICES.lifetime.firstWorkspaces} workspaces`] }),
  raise_budget: (b) => ({ key: "raise_budget", label: "Raise the budget", priceMinor: null, per: null, unlocks: [`Your budget is ${dollars(b.budgetMinor)} and ${dollars(b.usedMinor)} is used`, "Sending and AI drafting go on at once"] }),
  wait: (end) => ({ key: "wait", label: `Wait until ${dayText(end)}`, priceMinor: 0, per: null, unlocks: ["Your allowance starts again"] }),
};
const proOfferNow = () => {
  const pro = docustayPlan("docustay_pro"); if (pro.priceMinor == null) return null;
  const fo = foundersOpen() && pro.foundersPriceMinor != null;
  return { priceMinor: fo ? pro.foundersPriceMinor : pro.priceMinor, founders: fo };
};
const cheapest = (list) => list.filter(Boolean).sort((a, b) => (a.priceMinor ?? 0) - (b.priceMinor ?? 0));
const ZERO_COST = Object.freeze({ minor: 0, currency: "usd", units: 0, perUnitMinor: null, per: null, prorated: false });

/** Read the facts an action needs, nothing more. `plan` null means a workspace on no Docustay plan. */
export async function gatherFacts(tx, { tenantId, action, now = new Date(), size = {} }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan) return { plan: null };
  const { start, end, kind } = await windowOf(tx, tenantId, now);
  const F = { plan, start, end, kind, pro: proOfferNow(), lifetimeOpen: false };
  try { const { rows: [c] } = await tx.query(`SELECT keystone.docustay_lifetime_count() AS n`); F.lifetimeOpen = (c?.n ?? 0) < PRICES.lifetime.firstWorkspaces; } catch { /* the option is simply not offered */ }
  const hasBudget = plan.docOverMinor != null || plan.draftOverMinor != null;
  if (action === "send_document" || action === "bulk_send") {
    if (plan.docsPerMonth != null) F.docsUsed = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
    if (plan.signersPerMonth != null && newLimitsOn(now)) {   // Free: different signers a month (the same count the send gate reads)
      const emails = Array.isArray(size.recipients) ? size.recipients : null;
      if (emails) { const r = await newSignersAmong(tx, { tenantId, emails, periodStart: start, periodEnd: end }); F.signersUsed = r.used; F.signersFresh = r.fresh.length; }
      else F.signersUsed = (await signersInPeriod(tx, { tenantId, periodStart: start, periodEnd: end })).length;
    }
    if (plan.docOverMinor != null) { F.budget = await budgetState(tx, { tenantId, now }); F.seats = await teamSeatUsage(tx); }
  } else if (action === "invite_person" || action === "remove_person") { F.seats = await teamSeatUsage(tx); }
  else if (AI_WEIGHT_KEY[action]) {
    F.aiPolicy = aiPolicyFor(plan.key); F.ai = await aiUsageView(tx, { tenantId, now }).catch(() => null);
    if (hasBudget) { F.budget = await budgetState(tx, { tenantId, now }); F.seats = payg(plan) ? await teamSeatUsage(tx) : null; }
  } else if (action === "create_template") { if (plan.templatesPerMonth != null) F.templatesUsed = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end }); F.templateCapOn = !payg(plan) || newLimitsOn(now); }
  else if (action === "upload") { F.uploadCapMb = (await uploadCapMb(tx, { tenantId })) ?? plan.uploadMb; }
  return F;
}
const payg = (plan) => plan.key === "docustay_payg";

const answer = (base, o) => ({ action: base.action, allowed: true, plan: base.plan, period: base.period, meter: null, cost: ZERO_COST, afterThis: null, severity: "none", reason: null, options: [], message: "", ...o });

/** The pure half: facts in, the answer out. Every number is from `PRICES`, the plan record or the facts. */
export function decide(F, { action, size = {}, item = null }) {
  const n = (v, d = 1) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const plan = F.plan;
  if (!plan) return { action, allowed: true, plan: null, period: null, meter: null, cost: ZERO_COST, afterThis: null, severity: "none", reason: null, options: [], message: "" };   // a workspace on no Docustay plan is never limited by it
  const { start, end, kind } = F;
  const base = { action, plan: { key: plan.key.replace(/^docustay_/, ""), name: plan.name }, period: { start: start.toISOString(), end: end.toISOString(), resets: dayText(end), kind } };
  const isPayg = payg(plan), free = !plan.paid;
  const upgrades = (...keys) => cheapest(keys.filter((k) => k !== "lifetime" || F.lifetimeOpen).map((k) => OPTIONS[k]()));
  const budgetAfter = (addMinor) => {
    const b = F.budget, after = b.usedMinor + addMinor;
    return { b, afterMinor: after, within: !b.paused && b.usedMinor < b.budgetMinor && after <= b.budgetMinor, percent: b.budgetMinor > 0 ? Math.floor((after * 100) / b.budgetMinor) : (after > 0 ? 100 : 0) };
  };
  /** would Pro cost no more than this month on Pay as you go? (the pricing calculator's maths: people at $5, the usage so far, this action) */
  const proCheaper = (b, addMinor) => !!(F.pro && isPayg && F.pro.priceMinor <= (F.seats?.staff ?? 1) * PRICES.payg.personMonthlyMinor + b.usedMinor + addMinor);
  const proOpt = () => (F.pro ? OPTIONS.pro() : null);
  const blockedBudget = (b, addMinor, extra = {}) => answer(base, { allowed: false, severity: "blocked", reason: "budget_reached", options: [OPTIONS.raise_budget(b), ...(proCheaper(b, addMinor) ? [proOpt()] : [])].filter(Boolean),
    meter: { key: "budget", usedMinor: b.usedMinor, budgetMinor: b.budgetMinor, percent: b.percent }, message: `Your monthly budget of ${dollars(b.budgetMinor)} is reached, so this is paused. Raise the budget to go on. Nothing is deleted.`, ...extra });

  if (action === "send_document" || action === "bulk_send") {
    const count = action === "send_document" ? 1 : Math.max(1, n(size.documents, 1));
    if (plan.docsPerMonth == null) return answer(base, {});
    const used = F.docsUsed ?? 0, included = plan.docsPerMonth, left = Math.max(0, included - used);
    if (plan.docOverMinor == null) {   // Free stops at the allowance
      const afterUsed = used + count, pct = Math.floor((afterUsed * 100) / included), meter = { key: "documents", used, included, left, unit: "documents" };
      if (afterUsed > included) return answer(base, { allowed: false, severity: "blocked", reason: "plan_document_limit", meter, afterThis: { used: afterUsed, included, percent: pct }, allowedCount: count > 1 ? left : 0, options: upgrades("payg", "pro"),
        message: count > 1 && left > 0 ? `Free has ${left} of ${included} documents left this month, and this list has ${count}. Send the first ${left} now, or switch to Pay as you go (${dollars(PRICES.payg.docOverMinor)} a document after the first ${PRICES.payg.docsIncluded}) or choose Pro. Resets ${dayText(end)}.`
          : `You have used all ${included} documents on Free this month. Resets ${dayText(end)}. To keep sending now, switch to Pay as you go (${dollars(PRICES.payg.docOverMinor)} a document after the first ${PRICES.payg.docsIncluded}) or choose Pro.` });
      if (plan.signersPerMonth != null && F.signersUsed != null) {   // Free: different signers a month. A person already sent to this month is not new.
        const cap = plan.signersPerMonth, su = F.signersUsed, fresh = F.signersFresh ?? Math.max(0, n(size.signers, 0)), after = su + fresh, sm = { key: "signers", used: su, included: cap, left: Math.max(0, cap - su), unit: "signers" };
        if (after > cap) return answer(base, { allowed: false, severity: "blocked", reason: "plan_signer_limit", meter: sm, afterThis: { used: after, included: cap, percent: 100 }, options: upgrades("payg", "pro"), message: signerLimitText(su, cap, dayText(end)) });
        const spct = Math.floor((after * 100) / cap);
        if (fresh > 0 && spct >= 80 && severityAt(spct) !== "none" && spct >= pct) return answer(base, { meter: sm, afterThis: { used: after, included: cap, percent: spct }, severity: severityAt(spct), options: upgrades("payg", "pro"),
          message: after === cap ? `This is your last new signer this month. Sending again to people you already sent to is always allowed. Resets ${dayText(end)}.` : `${cap - after === 1 ? "1 new signer is left" : `${cap - after} of ${cap} new signers are left`} this month. Resets ${dayText(end)}.` });
      }
      const sev = severityAt(pct);
      return answer(base, { meter, afterThis: { used: afterUsed, included, percent: pct }, severity: sev, options: sev === "limit" || sev === "warn" ? upgrades("payg", "pro") : [],
        message: afterUsed === included ? `This is your last free document this month. Resets ${dayText(end)}.` : sev === "none" ? "" : `${included - used} of ${included} free documents left this month. Resets ${dayText(end)}.` });
    }
    const est = estimateDocuments(plan, used, count), bs = budgetAfter(est.amountMinor);
    const meter = { key: "budget", usedMinor: bs.b.usedMinor, budgetMinor: bs.b.budgetMinor, percent: bs.b.percent };
    const cost = { minor: est.amountMinor, currency: "usd", units: est.billableUnits, perUnitMinor: plan.docOverMinor, per: "document", prorated: false };
    if (!bs.within && (est.amountMinor > 0 || bs.b.paused)) return blockedBudget(bs.b, est.amountMinor, { cost, meter });
    let sev = severityAt(bs.percent); if (est.amountMinor > 0) sev = worse(sev, "info");
    const leftAfter = included - used - count;
    return answer(base, { meter, cost, afterThis: { used: used + count, included, budgetPercent: bs.percent, budgetUsedMinor: bs.afterMinor }, severity: sev, options: (sev === "warn" || sev === "limit") && proCheaper(bs.b, est.amountMinor) ? [proOpt()] : [],
      message: est.amountMinor > 0 ? `${count > 1 ? `${est.billableUnits} of these are past your ${included} included documents: ${dollars(est.amountMinor)} (${dollars(plan.docOverMinor)} each).` : `This one is past your ${included} included documents: ${dollars(est.amountMinor)}.`} ${dollars(bs.afterMinor)} of your ${dollars(bs.b.budgetMinor)} budget after this.`
        : bs.percent >= 50 ? `${dollars(bs.afterMinor)} of your ${dollars(bs.b.budgetMinor)} monthly budget is used. Resets ${dayText(end)}.`
        : leftAfter >= 0 && leftAfter <= 3 ? `${leftAfter} included documents left this billing month, then ${dollars(plan.docOverMinor)} each.` : "" });
  }

  if (action === "invite_person" || action === "remove_person") {
    const people = Math.max(1, n(size.people, 1));
    if (plan.people != null) {   // Free: one person
      const used = (F.seats?.staff ?? 1) + (F.seats?.openInvites ?? 0), meter = { key: "people", used, included: plan.people, unit: "people" };
      if (action === "invite_person" && used + people > plan.people) return answer(base, { allowed: false, severity: "blocked", reason: "plan_people_limit", meter, options: upgrades("payg", "pro"),
        message: `The Free plan is for one team member${(F.seats?.openInvites ?? 0) > 0 ? " (an invitation that has not been accepted yet counts as that team member)" : ""}. Switch to Pay as you go to add team members at ${dollars(PRICES.payg.personMonthlyMinor)} per team member a month, or choose Pro (no price per team member).` });
      return answer(base, { meter });
    }
    if (isPayg) {
      const per = PRICES.payg.personMonthlyMinor, cost = { minor: per * people, currency: "usd", units: people, perUnitMinor: per, per: "month", prorated: true };
      return answer(base, action === "invite_person" ? { cost, severity: "info", message: `Adds ${dollars(per * people)} a month once ${people > 1 ? "they accept and join" : "they accept and join"}, not before. An invitation that has not been accepted is not billed.` }
        : { cost: { ...cost, minor: -per * people }, severity: "info", message: `Takes ${dollars(per * people)} a month off your bill. Your team member count updates once a day, and the days left in this month are adjusted on your next invoice.` });
    }
    return answer(base, {});   // Pro and Lifetime: no price per team member, nothing to say
  }

  if (AI_WEIGHT_KEY[action]) {
    const pol = F.aiPolicy, view = F.ai;
    if (!pol || !view || view.mode !== "hosted" || view.allowance == null) return answer(base, {});   // an own key or no credit policy: not metered by the plan
    const w = ({ draft: 1, edit: 0.25, file_read: 0.5 })[AI_WEIGHT_KEY[action]] ?? 1;
    const used = view.used ?? 0, included = view.allowance, left = Math.max(0, included - used), meter = { key: "drafts", used, included, left: Math.round(left * 100) / 100, unit: "drafts" };
    const afterUsed = used + w;
    if (afterUsed <= included + 1e-9) {
      const pct = Math.floor((afterUsed * 100) / included), sev = severityAt(pct), leftAfter = Math.max(0, Math.round((included - afterUsed) * 100) / 100);
      return answer(base, { meter, afterThis: { used: afterUsed, included, percent: pct }, severity: sev, options: (sev === "limit" || sev === "warn") && free ? upgrades("payg", "pro") : [],
        message: leftAfter === 0 ? `This is your last ${free ? "free" : "included"} AI draft this month. Resets ${dayText(end)}.` : `${Math.round((included - used) * 100) / 100} of ${included} ${free ? "free" : "included"} AI drafts left this month. Resets ${dayText(end)}.` });
    }
    if (pol.draftOverMinor == null) return answer(base, { allowed: false, severity: "blocked", reason: "ai_limit_credits", meter, afterThis: { used: afterUsed, included, percent: 100 }, options: upgrades("payg", "pro"),
      message: `You have used all ${included} free AI drafts this month. Resets ${dayText(end)}. Switch to Pay as you go (${dollars(PRICES.payg.draftOverMinor)} a draft after the first ${PRICES.payg.draftsIncluded}) or choose Pro (${PRICES.pro.draftsIncluded} a month). The guided builder still works.` });
    const bs = budgetAfter(pol.draftOverMinor), cost = { minor: pol.draftOverMinor, currency: "usd", units: 1, perUnitMinor: pol.draftOverMinor, per: "draft", prorated: false };
    if (!bs.within) return blockedBudget(bs.b, pol.draftOverMinor, { cost, meter });
    return answer(base, { meter, cost, afterThis: { used: afterUsed, included, budgetPercent: bs.percent, budgetUsedMinor: bs.afterMinor }, severity: worse(severityAt(bs.percent), "info"),
      message: `Past your ${included} included AI drafts, this one is ${dollars(pol.draftOverMinor)}. ${dollars(bs.afterMinor)} of your ${dollars(bs.b.budgetMinor)} budget after this.` });
  }

  if (action === "create_template") {
    if (plan.templatesPerMonth == null || (isPayg && !F.templateCapOn)) return answer(base, {});
    const used = F.templatesUsed ?? 0, limit = plan.templatesPerMonth, meter = { key: "templates", used, included: limit, left: Math.max(0, limit - used), unit: "templates" };
    const opts = () => (isPayg ? upgrades("pro") : upgrades("payg", "pro"));
    if (used >= limit) return answer(base, { allowed: false, severity: "blocked", reason: "plan_template_limit", meter, options: opts(), message: templateLimitText(plan.name, limit, used, dayText(end)) });
    const pct = Math.floor(((used + 1) * 100) / limit), sev = severityAt(pct);
    return answer(base, { meter, afterThis: { used: used + 1, included: limit, percent: pct }, severity: sev, options: sev === "limit" || sev === "warn" ? opts() : [],
      message: used + 1 === limit ? `This is your last new template this month. Resets ${dayText(end)}.` : sev === "none" ? "" : `${limit - used} of ${limit} new templates left this month.` });
  }

  if (action === "upload") {
    const capMb = F.uploadCapMb ?? plan.uploadMb, bytes = n(size.bytes, 0), meter = { key: "upload", used: bytes, included: capMb * 1024 * 1024, unit: "bytes", capMb };
    if (bytes > capMb * 1024 * 1024) {
      const bigger = PRICES.pro.uploadMb > capMb;
      return answer(base, { allowed: false, severity: "blocked", reason: "too_big", meter, options: bigger ? upgrades("pro", "lifetime") : [],
        message: `That file is ${(bytes / 1048576).toFixed(1)} MB; the most that can be uploaded on ${plan.name} is ${capMb} MB.${bigger ? ` Pro and Lifetime take files up to ${PRICES.pro.uploadMb} MB.` : ""}` });
    }
    return answer(base, { meter });
  }

  if (action === "use_feature") {
    if (!item) throw invalid("use_feature needs an item");
    if (entitled(plan, item)) return answer(base, {});
    return answer(base, { allowed: false, severity: "blocked", reason: "plan_pro_required", options: upgrades("pro", "lifetime"), message: LOCK_TEXT[item] ?? "This is part of Docustay Pro and Lifetime." });
  }

  if (action === "connect_payments") {
    const bps = plan.feeBps ?? 0, cost = { ...ZERO_COST, feePercent: bps / 100 };
    return answer(base, bps > 0 ? { severity: "info", cost, options: upgrades("pro", "lifetime"), message: `Docustay takes a ${bps / 100}% fee on payments collected through ${plan.name}. It is 0% on Pro and Lifetime. Stripe's own fees still apply.` }
      : { cost, message: `No Docustay fee on payments with ${plan.name}. Stripe's own fees still apply.` });
  }
  return answer(base, {});
}

/** @param {{tenantId:string, action:string, size?:{documents?:number, people?:number, bytes?:number}, item?:string|null, now?:Date}} a */
export async function preflight(tx, { tenantId, action, size = {}, item = null, now = new Date() }) {
  if (!PREFLIGHT_ACTIONS.includes(action)) throw invalid(`action must be one of ${PREFLIGHT_ACTIONS.join(", ")}`);
  // R13-D184 (23 Oct): while the workspace's test switch is on, a send is a practice run that is never counted (pdfSend.mjs), so no plan limit refuses it
  if ((action === "send_document" || action === "bulk_send") && (await (await import("../documents/settings.mjs")).getDocumentSetting(tx, "test_mode.on").catch(() => false)) === true)
    return { action, allowed: true, plan: null, period: null, meter: null, cost: ZERO_COST, afterThis: null, severity: "none", reason: null, options: [], message: "", testMode: true };
  return decide(await gatherFacts(tx, { tenantId, action, now, size }), { action, size, item });
}

/** What a locked item does and which plans have it, in plain words (the feature-lock form). Only items that really are plan-bound on a hosted workspace appear. */
export const LOCK_TEXT = Object.freeze({
  unlimited_documents: "Sending without a monthly document limit is part of Pro and Lifetime.",
  custom_plays: "Your own skills and playbooks are part of Pro and Lifetime. The built-in ones are free to use.",
  plays_api: "The plays and drafts API is part of Pro and Lifetime.",
  hide_footer: "Hosted workspaces keep the small Sent with Docustay line. Self-hosted installs can switch it off.",
});
