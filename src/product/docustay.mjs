// src/product/docustay.mjs — THE DOCUSTAY HOSTED WORKSPACE (Batch B), host side. A Docustay workspace is an ordinary tenant of shape 'documents' on a Docustay plan:
// the SAME subscription row (keystone.workbench_subscription), the SAME Stripe checkout/webhook machinery, the SAME Documents island — nothing duplicated.
//   activateWorkspace  — make the signed-in owner's brand-new organisation a Documents-only workspace on the Free plan
//   workspaceStatus    — plan, limits and what has been used (for the screen)
//   assertMaySend      — the entitlements port the island calls before any send (monthly document limit)
//   planEmailLimit     — the mail module's per-organisation daily default
//   startCheckout      — a Stripe Checkout session for Pro (TEST mode in the sandbox; refuses until Pro has a price; never run with a live key outside production)
import { trackOnce } from "./analytics.mjs";
import { addonInstalled } from "../documents/frontDoor.mjs";
import { forbidden, invalid, dependency, notFound } from "../http/errors.mjs";
import { uploadCapMb } from "../documents/uploadLimit.mjs";   // R13-D392: field detection takes the same file-size cap as uploads
import { renderInvoicePdf, invoiceNumber } from "../billing/invoicePdf.mjs";
import { callOutside } from "../http/outside.mjs";
import { stripeSecretFor } from "./stripeFor.mjs";   // Docustay's own Stripe account (falls back to the shared KEYSTONE_STRIPE_* until it has one)
import { createStripeCustomer } from "../provisioning/steps/stripeCustomer.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { metadataFor } from "../money/metadata.mjs";
import { sendCountForPeriod, ensureDefaultDocumentType, anyInstanceEverSent, templateCreationsInPeriod, signersInPeriod, newSignersAmong } from "../documents/api.mjs";
import { signerLimitText, templateLimitText, GLOSSARY, FOOTNOTE, PER_TEAM_MEMBER, GRANDFATHER_NOTICE, compareTable, costExample } from "./docustayWords.mjs";
import { aiUsageView, readAiConfig, detectUpload } from "../documents/frontDoor.mjs";
import * as mail from "../mail/index.mjs";
import { enrol } from "./lifecycle.mjs";
import { teamSeatUsage } from "../people/seats.mjs";
import { emit } from "../events/outbox.mjs";
import { seatSettings } from "./docustayPlans.mjs";
import { PRICES } from "./docustayPrices.mjs";
import { randomUUID } from "node:crypto";
import { assertMayStartFree, recordSignupIdentity } from "./docustayIntegrity.mjs";
import { disputeHold, HOLD_MESSAGE } from "./docustayDisputes.mjs";
import { checkTenantLimit } from "../http/rateLimit.mjs";
import { withLimiterConnection } from "../db/index.mjs";
/** The two allowances added on 21 Oct 2026 (Free signers, Pay as you go templates) start on PRICES.newLimitsFrom, so no workspace is stopped partway through the month it already started. */
/** The signer and PAYG template limits start on PRICES.newLimitsFrom (1 Nov 2026); KEYSTONE_DOCUSTAY_NEW_LIMITS_FROM moves it for a test environment only. */
export const newLimitsOn = (now = new Date()) => now.getTime() >= Date.parse(process.env.KEYSTONE_DOCUSTAY_NEW_LIMITS_FROM || PRICES.newLimitsFrom);
import { assertWithinBudget, recordBillableUnit, checkBudgetAlerts, budgetState, estimateDocuments, ensureEarlyInvoiceThreshold, settleUsageAtStripe } from "./docustayUsage.mjs";
import { periodFor } from "./docustayPeriod.mjs";
import { planItem, licensedTotalMinor } from "../billing/subscriptionPeriod.mjs";
import { aiPolicyFor, aiPlatformCeilingUsd, docustayPlans, docustayPlan, effectivePlan, isDocustayPlanKey, entitled, inGrace, EVERY_PLAN_ITEMS, PRO_ITEMS, AI_PRO_ITEMS, RUN9_PRO_ITEMS, priceLookupKey, checkoutPricing, annualEnabled, foundersOpen, foundersUntil } from "./docustayPlans.mjs";

/** The window every counter is taken over for this workspace (src/product/docustayPeriod.mjs): Free the UTC calendar month, Pay as you go and Pro their Stripe billing period, Lifetime monthly from purchase. */
export const windowOf = async (tx, tenantId, now = new Date()) => { const { start, end, kind } = await periodFor(tx, tenantId, now); return { start, end, kind }; };
/** One row of the Billing invoice list. Docustay's own PDF, never Stripe's hosted page or its "Pay online" link. R13-D379: dueMinor is what was charged (the total less account credit), shown as the amount */
export const invoiceRow = (i) => ({ id: i.id, number: invoiceNumber(i), label: invoiceLabel(i), at: new Date((i.status_transitions?.paid_at ?? i.created) * 1000).toISOString(), totalMinor: i.total ?? 0, dueMinor: i.amount_due ?? i.total ?? 0, creditMinor: Math.max(0, (i.total ?? 0) - (i.amount_due ?? i.total ?? 0)), currency: i.currency ?? "usd", status: i.status, pdf: `/api/product/docustay/invoices/${encodeURIComponent(i.id)}/pdf` });
export const subRow = async (tx, tenantId) => (await tx.query(`SELECT plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at, past_due_since, founders_price, billing_interval, updated_at FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId])).rows[0] ?? null;

/** Make this organisation a Documents-only workspace on the Free plan. Idempotent. An organisation that is already on another plan keeps it (the shape still narrows the menu). */
export async function activateWorkspace(tx, { tenantId, selfHosted = false, requestHost = null, actorUserId = null, lang = "en" }) {
  if (!selfHosted) {
    // only a brand-new, empty organisation may be turned into a Documents-only workspace, and never through a the platform address: an existing practice must not lose its menu to a stray call
    if (requestHost && /(^|\.)examplecore\.com(:\d+)?$/i.test(String(requestHost).trim())) throw forbidden("This is not available here.");
    const { rows: [t] } = await tx.query(`SELECT product, (SELECT count(*) FROM keystone.app_user WHERE tenant_id = $1)::int AS users, (SELECT count(*) FROM keystone.invoice WHERE tenant_id = $1)::int AS invoices FROM keystone.tenant WHERE id = $1`, [tenantId]);
    if (t && t.product !== "docustay" && (t.users > 1 || t.invoices > 0 || await anyInstanceEverSent(tx))) throw forbidden("This organisation already has data, so it cannot be turned into a Documents-only workspace.");
  }
  await tx.query(`UPDATE keystone.tenant SET shape = 'documents', product = 'docustay' WHERE id = $1`, [tenantId]);
  await ensureDefaultDocumentType(tx, { tenantId });   // nothing can be uploaded or sent into a workspace with no document type
  if (selfHosted) return workspaceStatus(tx, { tenantId });   // a self-hosted install has no plans and no limits
  const { rowCount: madeNow } = await tx.query(
    `INSERT INTO keystone.workbench_subscription (tenant_id, plan_key, status, seat_count) VALUES ($1, 'docustay_free', 'active', 1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  // A NEW hosted workspace starts with Scribe on: every plan includes drafts (10 free), and a first "Describe" that answers "switched off" contradicts the pricing page (found by the production smoke check, 18 Oct 2026). The owner can switch it off; an existing workspace is never touched.
  // 21 Oct 2026 (pricing integrity): ONE FREE WORKSPACE PER PERSON, no temporary addresses. A refusal rolls this whole step back, so the empty workspace stays a plain, unused one.
  if (madeNow && actorUserId) {
    const { rows: [who] } = await tx.query(`SELECT email FROM keystone.app_user WHERE id = $1`, [actorUserId]);
    if (who?.email) { await assertMayStartFree((sql, p) => tx.query(sql, p), { email: who.email, alias: false }); await recordSignupIdentity(tx, { tenantId, email: who.email }); }
  }
  if (madeNow) await tx.query(`INSERT INTO keystone.document_setting (tenant_id, key, value, updated_by) VALUES ($1, 'ai.enabled', 'true'::jsonb, $2) ON CONFLICT (tenant_id, key) DO NOTHING`, [tenantId, actorUserId]);
  // Launch step 3: the owner's welcome series starts here. The first email (the welcome) is sent by the worker's global tick a minute later (the web process cannot reach the queue): see pendingWelcomeTenants.
  if (actorUserId) await enrol(tx, { tenantId, userId: actorUserId, lang });
  if (actorUserId) await trackOnce(tx, tenantId, "signup_completed").catch(() => {});   // Launch step 6: a real owner (a demo has none)
  return workspaceStatus(tx, { tenantId });
}

/** The plan list the Billing page compares, one card per plan, read from the one price list (docustayPlans). Exported so a test or a screen proof builds the SAME cards the status payload carries. */
export const planCards = (yearly = false) => docustayPlans().map((p) => ({ key: p.key, name: p.name, feeBps: p.feeBps ?? 0, draftsPerMonth: p.aiDraftsPerMonth ?? null, docOverMinor: p.docOverMinor ?? null, draftOverMinor: p.draftOverMinor ?? null, bulkCap: p.bulkCap ?? null, priceMinor: p.priceMinor, yearlyPriceMinor: yearly ? (p.yearlyPriceMinor ?? null) : null, docsPerMonth: p.docsPerMonth, emailsPerDay: p.emailsPerDay, templatesPerMonth: p.templatesPerMonth ?? null, signersPerMonth: p.signersPerMonth ?? null, people: p.people ?? null, customPlays: (p.features ?? []).includes("custom_plays"), firstWorkspaces: p.key === "docustay_lifetime" ? PRICES.lifetime.firstWorkspaces : null }));

export async function workspaceStatus(tx, { tenantId, now = new Date() }) {
  const sub = await subRow(tx, tenantId);
  const plan = effectivePlan(sub, process.env, now);
  const { rows: t } = await tx.query(`SELECT shape, product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const { start, end, kind } = await windowOf(tx, tenantId, now);
  const docs = plan ? await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end }) : null;
  const lim = plan ? await mail.limitState(tx, { tenantId }) : null;
  const pro = docustayPlan("docustay_pro");
  const priced = pro.priceMinor != null;
  const ended = plan && !plan.paid && ["docustay_pro", "docustay_payg"].includes(sub?.plan_key) && sub?.stripe_subscription_id ? (sub.status === "canceled" ? "cancelled" : sub.status === "past_due" ? "payment" : null) : null;
  const everSent = plan ? docs > 0 || await anyInstanceEverSent(tx) : false;   // plan prompts wait for a first sent document
  const seatsOn = seatSettings().on && Boolean(plan);   // not shown, not even as a field value, while the seat settings are OFF
  const seatUse = seatsOn ? await teamSeatUsage(tx) : null;
  // R13-D382: the offer shown here is judged at the same moment checkout judges it (pricingMoment): live, now; on a Stripe TEST clock, the clock's time.
  //   Before, a test-clock workspace past the founders cut-off was shown "Founders price" here and charged the list price at checkout. A live key makes no Stripe call.
  const moment = sub?.stripe_customer_id ? await pricingMoment(stripeSecretFor("docustay"), sub.stripe_customer_id, { now }).catch(() => now) : now;
  const fo = foundersOpen(process.env, moment) && pro.foundersPriceMinor != null, yearly = annualEnabled();
  const shownMonthly = fo ? pro.foundersPriceMinor : pro.priceMinor, shownYearly = !yearly ? null : (fo && pro.foundersYearlyPriceMinor != null ? pro.foundersYearlyPriceMinor : pro.yearlyPriceMinor);
  return {
    demo: await (await import("./demo.mjs")).demoView(tx),   // the public demo's banner facts (null for a real workspace)
    workspace: t[0]?.shape === "documents", shape: t[0]?.shape ?? null, product: t[0]?.product ?? "workbench",
    // `ended` says why a paid subscription row no longer gives Pro: "cancelled" (the subscription was ended) or "payment" (a payment failed and the grace is over). It carries no date and no number of days, by rule.
    plan: plan ? { key: plan.key, name: plan.name, status: sub.status, renewsAt: ended ? null : (sub.current_period_end ?? null), cancelsAt: ended ? null : (sub.cancel_at ?? null), interval: sub.billing_interval ?? null, founders: Boolean(sub.founders_price), ended, pendingSwitch: sub.plan_key === "docustay_pro" && !ended ? await pendingSwitch(tx, { tenantId, now }) : null } : null,
    // the customer's notice when a payment failed — a flag and nothing else (no date, no number of days, by rule)
    paymentProblem: Boolean(plan?.paid && inGrace(sub)),
    entitlements: plan ? Object.fromEntries([...EVERY_PLAN_ITEMS, ...PRO_ITEMS, ...AI_PRO_ITEMS, ...RUN9_PRO_ITEMS].map((k) => [k, entitled(plan, k)])) : null,
    usage: plan ? { documentsThisMonth: docs, documentsLimit: plan.docsPerMonth, emailsToday: lim?.sent ?? 0, emailsLimit: lim?.limit ?? plan.emailsPerDay, templatesThisMonth: await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end }), templatesLimit: plan.key === "docustay_payg" && !newLimitsOn(now) ? null : (plan.templatesPerMonth ?? null), signersThisMonth: plan.signersPerMonth != null ? (await signersInPeriod(tx, { tenantId, periodStart: start, periodEnd: end })).length : null, signersLimit: newLimitsOn(now) ? (plan.signersPerMonth ?? null) : null, newLimitsFrom: PRICES.newLimitsFrom, resetsAt: end.toISOString(), periodStart: start.toISOString(), periodEnd: end.toISOString(), periodKind: kind, everSent } : null,
    seats: seatsOn ? { used: seatUse.staff, included: seatUse.limit, extraSeatPriceMinor: seatUse.extraSeatPriceMinor } : null,
    billing: { canManage: Boolean(sub?.stripe_customer_id) && plan?.key !== "docustay_lifetime", canUpgrade: Boolean(plan && !plan.paid && ended !== "payment") },
    // usage billing (v1): this month's billable units, the budget and where it stands (null on a plan with no per-unit price)
    budget: plan && (plan.docOverMinor != null || plan.draftOverMinor != null) ? await budgetState(tx, { tenantId, now }) : null,
    upgrade: { available: Boolean(plan && !plan.paid && ended !== "payment"), plan: priced ? { key: pro.key, name: pro.name, priceMinor: shownMonthly, listPriceMinor: pro.priceMinor, founders: fo, foundersUntil: fo ? foundersUntil().toISOString() : null, yearlyPriceMinor: shownYearly, listYearlyPriceMinor: yearly ? (pro.yearlyPriceMinor ?? null) : null, currency: pro.currency, interval: "month" } : null },
    plans: planCards(yearly),
    words: { glossary: GLOSSARY, footnote: FOOTNOTE, perTeamMember: PER_TEAM_MEMBER, compare: compareTable({ foundersOpen: fo }), costExample: costExample({ foundersOpen: fo }), newLimitsFrom: PRICES.newLimitsFrom, newLimitsStarted: newLimitsOn(now), grandfather: GRANDFATHER_NOTICE },
  };
}

/** The plan this workspace is really on right now (grace and lapse applied) — null when it is not a Docustay workspace. */
/** The AI policy this workspace's plan carries, with the window its allowance is counted over (the entitlements port's `aiPolicy`). null for a workspace on no Docustay plan. */
export async function aiPolicy(tx, { tenantId, now = new Date() }) {
  const sub = await subRow(tx, tenantId); const plan = effectivePlan(sub, process.env, now);
  const pol = plan ? aiPolicyFor(plan.key) : null;
  return pol ? { ...pol, planKey: plan.key, platformMonthlyUsd: aiPlatformCeilingUsd(), window: await windowOf(tx, tenantId, now) } : null;
}
export async function currentPlan(tx, { tenantId }) { return effectivePlan(await subRow(tx, tenantId)); }

/** The refusals keep their stable codes and plain messages; each also carries `options` (the plans or actions that would let the person go on, cheapest first, with prices) and `severity`, the same answer the
 *  preflight gives BEFORE the action (src/product/docustayPreflight.mjs). Best effort: a refusal is never lost because the options could not be read. */
async function withOptions(tx, tenantId, err, action, size = {}, item = null) {
  try {
    const { preflight } = await import("./docustayPreflight.mjs");
    const p = await preflight(tx, { tenantId, action, size, item });
    if (p.options?.length) err.detail = { ...(err.detail ?? {}), options: p.options, severity: p.severity };
    const { recordLimitHit } = await import("./promptEvents.mjs"); void recordLimitHit(tx, { tenantId, code: err.detail?.code ?? p.reason, action });
  } catch { /* the plain refusal stands */ }
  return err;
}
/**
 * ★ THE ONE GATE for the six Pro items. A workspace not on a Docustay plan (a the platform organisation) is never limited by it. Refuses in plain words that do not name any other product.
 * @param {string} item one of PRO_ITEMS
 */
/** A self-hosted install with no Pro add-on (or whose Pro note has ended) is the Community build: the Pro items are off. Volume stays unlimited there ("no plans, no limits"). */
export const communityRefuses = (item) => process.env.KEYSTONE_SELF_HOST === "1" && item !== "unlimited_documents" && !EVERY_PLAN_ITEMS.includes(item) && !addonInstalled();
export async function assertEntitled(tx, { tenantId, item }) {
  const plan = effectivePlan(await subRow(tx, tenantId));
  const refuse = (planKey) => forbidden(PRO_REFUSALS[item] ?? "This is part of Docustay Pro and Lifetime.", { code: "plan_pro_required", item, plan: planKey, upgrade: "pro" });   // the wire says which item and what to upgrade to (a stable code for SDKs, the CLI and MCP)
  if (!plan) { if (communityRefuses(item)) throw refuse("community"); return; }
  if (!entitled(plan, item)) throw await withOptions(tx, tenantId, refuse(plan.key), "use_feature", {}, item);
}
// Only what is really a plan-bound item on a hosted workspace has a refusal text. Reminders, team roles, bulk send, signing groups, Scribe actions and AI bulk are on EVERY plan (decisions 46 and 47, v1 item 16),
// so they have none; the Docustay footer stays on hosted workspaces (decision 45) and only a self-hosted install can switch it off.
const PRO_REFUSALS = Object.freeze({
  hide_footer: "Hosted workspaces keep the small Sent with Docustay line. Self-hosted installs can switch it off.",
  unlimited_documents: "Sending without a monthly document limit is part of Pro and Lifetime.",
  custom_plays: "Your own skills and playbooks are part of Pro and Lifetime. The built-in ones are free to use.",
  plays_api: "The plays and drafts API is part of Pro and Lifetime.",
});

/** The name on Stripe's payment page (Run 9 launch, F1045): per Checkout Session, never the Stripe account itself. */
export const CHECKOUT_BRAND = "Docustay";
/** Shown on Stripe's payment page above the pay button (D-080). It replaces Stripe's default "reuse of your card" paragraph (hidden on the same session) with one line that names who is charging, what for, and how to stop. */
export const checkoutNote = (planKey = "docustay_pro") => planKey === "docustay_lifetime"
  ? "You are buying Docustay Lifetime (docustay.app): one payment, charged once to this card. Lifetime lasts as long as Docustay runs its hosted service. Each month includes 50 AI drafts; extra drafts are $0.30 each and are charged to this card. Docustay does not give refunds."
  : `You are subscribing to Docustay (docustay.app). By subscribing you authorise Docustay to charge this card each billing period until you cancel.${planKey === "docustay_payg" ? " Each billing period includes 15 documents and 10 AI drafts; more are billed on your invoice at $0.50 a document and $0.30 a draft." : ""} You can cancel at any time in Billing inside Docustay. Docustay does not give refunds: after you cancel, ${planKey === "docustay_payg" ? "Pay as you go" : planKey === "docustay_selfhost" ? "your subscription" : "Pro"} stays on until the end of the period you have paid for.`;
export const CHECKOUT_NOTE = checkoutNote("docustay_pro");
/** Stripe Checkout fields every Docustay session sets: the name, the replacement line, and the default reuse paragraph hidden so the one line above is the only authorisation text. */
const checkoutBranding = (planKey = "docustay_pro") => ({ "custom_text[submit][message]": checkoutNote(planKey), "branding_settings[display_name]": CHECKOUT_BRAND, "consent_collection[payment_method_reuse_agreement][position]": "hidden" });

/** Read-only: this month's sends against the plan's limit, for the Check step (Run 8 R8-64). No lock, no notices. null when the plan has no monthly limit. */
export async function sendAllowance(tx, { tenantId, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan || plan.docsPerMonth == null) return null;
  if (plan.docOverMinor != null) return null;   // Pay as you go goes on past its included documents at the per-document price; only the budget stops it, and Send says so with its options. The Check step must not call it "not ready" (found by the beta screen walkthrough, 20 Oct 2026).
  const { start, end } = await windowOf(tx, tenantId, now);
  return { used: await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end }), limit: plan.docsPerMonth, plan: plan.name, paid: Boolean(plan.paid), resetsAt: end.toISOString() };
}

/** The island's entitlements port. Organisations that are not on a Docustay plan are never limited by it. */
export async function assertMaySend(tx, { tenantId, needsEmail = true, recipients = null, now = new Date() }) {
  // a self-hosted install cannot invite a signer until email works (nothing would be delivered): say so instead of sending into the void.
  // D-051: only when an email would actually go out — a send where everyone signs on this device needs none.
  if (needsEmail && process.env.KEYSTONE_SELF_HOST === "1" && (await mail.mailStatus(tx, { tenantId })).state === "not_configured") {
    throw invalid("Email isn't set up yet, so signers cannot be invited. Open Settings → Email, connect your email, send yourself a test, then try again.");
  }
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (plan?.paid && (await disputeHold(tx, { tenantId })).held) throw forbidden(HOLD_MESSAGE, { code: "workspace_on_hold" });   // 21 Oct 2026: a lost dispute on a plan payment pauses sending (docustayDisputes.mjs)
  if (!plan || plan.docsPerMonth == null) return;
  // Run 8 verify: a per-workspace transaction lock makes check → send (or first publication) one step, so two sends at 14 of 15 cannot both pass; held until the caller's transaction ends.
  // Only plans with a monthly limit take it (Pro returned above).
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('docustay.document_cap:' || $1::text, 0))`, [tenantId]);
  const { start, end } = await windowOf(tx, tenantId, now);
  const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
  // Pay as you go goes on past its included documents at the plan's per-document price (metered when the document is sent; the budget, not this gate, decides when it pauses). Free stops.
  if (used >= plan.docsPerMonth && plan.docOverMinor != null) { try { await assertWithinBudget(tx, { tenantId, plan, kind: "document", now }); } catch (e) { throw await withOptions(tx, tenantId, e, "send_document", {}); } }   // Pay as you go: past the included documents each costs money, and the budget decides when it pauses
  if (used >= plan.docsPerMonth && plan.docOverMinor == null) {
    throw await withOptions(tx, tenantId, forbidden(`Your ${plan.name} plan allows ${plan.docsPerMonth} documents a month and you have sent ${used}. ${plan.paid ? "The count resets next month." : `Switch to Pay as you go to keep sending ($${(PRICES.payg.docOverMinor / 100).toFixed(2)} a document after the first ${PRICES.payg.docsIncluded}), or choose Pro.`}`, { code: "plan_document_limit", used, limit: plan.docsPerMonth, resetsAt: end.toISOString() }), "send_document", {});
  }
  // FREE SIGNERS (the maintainer, 21 Oct 2026): 15 different email addresses a month. Only a NEW person counts; resending to someone already counted, and an internal send to a team member, are always allowed.
  if (plan.signersPerMonth != null && newLimitsOn(now) && Array.isArray(recipients)) {
    const { used: signersUsed, fresh } = await newSignersAmong(tx, { tenantId, emails: recipients, periodStart: start, periodEnd: end });
    if (fresh.length && signersUsed + fresh.length > plan.signersPerMonth) {
      throw await withOptions(tx, tenantId, forbidden(signerLimitText(signersUsed, plan.signersPerMonth, resetsOnText(end)),
        { code: "plan_signer_limit", used: signersUsed, limit: plan.signersPerMonth, newSigners: fresh.length, resetsAt: end.toISOString() }), "send_document", { signers: fresh.length, recipients });
    }
    await signerAlerts(tx, { tenantId, plan, used: signersUsed + fresh.length, start, end });
  }
  await usageAlerts(tx, { tenantId, plan, used: used + 1, start, end });   // this send is the one that brings the count to used + 1
}

/** The two notices a workspace owner gets about the monthly document limit: once at 80% and once at 100%, each once per month (the event log is the memory — no new table). */
export const USAGE_THRESHOLDS = Object.freeze([80, 100]);
export async function usageAlerts(tx, { tenantId, plan, used, start, end }, { emitEvent = emit } = {}) {
  if (!plan || plan.docsPerMonth == null || plan.paid) return [];
  const sent = [];
  for (const pct of USAGE_THRESHOLDS) {
    if (used < Math.ceil((plan.docsPerMonth * pct) / 100)) continue;
    const { rows } = await tx.query(`SELECT 1 FROM keystone.event WHERE topic = 'documents.usage.threshold' AND coalesce(payload->>'kind', 'documents') = 'documents' AND payload->>'percent' = $1 AND created_at >= $2 AND created_at < $3 LIMIT 1`, [String(pct), start, end]);
    if (rows.length) continue;
    await emitEvent(tx, { tenantId, topic: "documents.usage.threshold", emittedBy: "documents", subjectType: "usage_period", subjectId: tenantId, actor: "system", payload: { kind: "documents", percent: pct, used, limit: plan.docsPerMonth, plan: plan.key, period_start: start.toISOString(), period_end: end.toISOString() } });
    sent.push(pct);
  }
  return sent;
}

/** The owner's notices about the Free signers allowance: at 80% (12 of 15) and at the limit, each once a month (the event log is the memory, like the documents notices). */
export async function signerAlerts(tx, { tenantId, plan, used, start, end }, { emitEvent = emit } = {}) {
  if (!plan || plan.signersPerMonth == null) return [];
  const sent = [];
  for (const pct of USAGE_THRESHOLDS) {
    if (used < Math.ceil((plan.signersPerMonth * pct) / 100)) continue;
    const { rows } = await tx.query(`SELECT 1 FROM keystone.event WHERE topic = 'documents.usage.threshold' AND payload->>'kind' = 'signers' AND payload->>'percent' = $1 AND created_at >= $2 AND created_at < $3 LIMIT 1`, [String(pct), start, end]);
    if (rows.length) continue;
    await emitEvent(tx, { tenantId, topic: "documents.usage.threshold", emittedBy: "documents", subjectType: "usage_period", subjectId: tenantId, actor: "system", payload: { kind: "signers", percent: pct, used, limit: plan.signersPerMonth, plan: plan.key, period_start: start.toISOString(), period_end: end.toISOString() } });
    sent.push(pct);
  }
  return sent;
}

/** What GET /api/v1/usage answers: the same numbers the Billing page shows, for a key with documents:read. */
const isPaygPlan = (plan) => plan?.key === "docustay_payg";
export async function apiUsage(tx, { tenantId, now = new Date() }) {
  const sub = await subRow(tx, tenantId);
  const plan = effectivePlan(sub, process.env, now);
  if (!plan) return { plan: null, period: null, documents: null, emails: null };
  const { start, end } = await windowOf(tx, tenantId, now);
  const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
  const lim = await mail.limitState(tx, { tenantId });
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const templates = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end });
  const signers = plan.signersPerMonth != null ? (await signersInPeriod(tx, { tenantId, periodStart: start, periodEnd: end })).length : null;
  // v1 item 25: AI drafts against the plan's allowance, and the money side (billable units this month, the budget, whether sending is paused)
  const ai = await aiUsageView(tx, { tenantId, userId: null, cfg: await readAiConfig(tx) }).catch(() => null);
  const budget = plan.docOverMinor != null || plan.draftOverMinor != null ? await budgetState(tx, { tenantId, now }) : null;
  // the plan's limits and prices in one place, so a developer or an agent can read them without calling the preflight (every value is the one price list or the plan record; null = no limit or no price)
  const limits = { documentsPerPeriod: plan.docsPerMonth ?? null, perDocumentMinor: plan.docOverMinor ?? null, draftsPerPeriod: plan.aiDraftsPerMonth ?? null, perDraftMinor: plan.draftOverMinor ?? null, templatesPerPeriod: plan.templatesPerMonth ?? null, signersPerPeriod: plan.signersPerMonth ?? null, people: plan.people ?? null, personMonthlyMinor: isPaygPlan(plan) ? PRICES.payg.personMonthlyMinor : null, uploadMb: plan.uploadMb ?? null, emailsPerDay: plan.emailsPerDay ?? null, bulkSendMax: plan.bulkCap ?? null, paymentsFeePercent: (plan.feeBps ?? 0) / 100 };
  return { plan: plan.key.replace(/^docustay_/, ""), period: { start: start.toISOString(), end: end.toISOString() }, periodStart: start.toISOString(), periodEnd: end.toISOString(), documents: { used, limit: plan.docsPerMonth }, limits,
    drafts: ai && ai.mode === "hosted" ? { used: ai.used, included: ai.allowance } : null,
    billing: budget ? { perDocumentMinor: plan.docOverMinor ?? null, perDraftMinor: plan.draftOverMinor ?? null, billableDocuments: budget.usage.documents.units, billableDrafts: budget.usage.drafts.units, unbilledMinor: budget.usedMinor, budgetMinor: budget.budgetMinor, percentOfBudget: budget.percent, paused: budget.paused, currency: "usd" } : null, templates: { used: templates, limit: plan.templatesPerMonth ?? null, resetsAt: end.toISOString() }, signers: { used: signers, limit: plan.signersPerMonth ?? null, resetsAt: end.toISOString() }, emails: { usedToday: lim.sent, limitPerDay: lim.limit, resetsAt: resetsAt.toISOString() } };
}

/** What sending `documents` more would cost this workspace right now, for the confirm step: whole cents, whether it needs a confirm (bulk, or over $5, or past the budget) and whether the budget has room. */
export async function estimateSend(tx, { tenantId, documents = 1, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan || plan.docOverMinor == null) return { amountMinor: 0, billableUnits: 0, needsConfirm: false, withinBudget: true, currency: "usd" };
  const { start, end } = await windowOf(tx, tenantId, now);
  const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
  const e = estimateDocuments(plan, used, Math.max(1, documents));
  const b = await budgetState(tx, { tenantId, now });
  const withinBudget = !b.paused && b.usedMinor + e.amountMinor <= b.budgetMinor;
  return { ...e, perDocumentMinor: plan.docOverMinor, includedLeft: Math.max(0, plan.docsPerMonth - used), needsConfirm: documents > 1 || e.amountMinor > PRICES.budget.confirmOverMinor || !withinBudget, withinBudget, budgetMinor: b.budgetMinor, unbilledMinor: b.usedMinor, currency: "usd" };
}
/** Free includes one person (the owner). Adding another person to a Free workspace is refused with the way forward; Pay as you go adds one at $5 a month, which the invite screen says first. Every other plan has no cap. */
export async function assertMayAddPerson(tx, { tenantId }) {
  const plan = effectivePlan(await subRow(tx, tenantId));
  if (!plan || plan.people == null) return;
  const { staff, openInvites } = await teamSeatUsage(tx);
  if (staff + openInvites >= plan.people) throw await withOptions(tx, tenantId, forbidden(`The ${plan.name} plan is for one team member. Switch to Pay as you go to add team members at $${(PRICES.payg.personMonthlyMinor / 100).toFixed(0)} ${PER_TEAM_MEMBER}, or choose Pro.`, { code: "plan_people_limit", limit: plan.people }), "invite_person", {});
}
/** The island calls this once per document that was really sent (never a practice run, never a resend). A document past the plan's included amount becomes one billable unit: ledger row, budget alerts, and (by the worker) one Stripe meter event. */
export async function noteDocumentSent(tx, { tenantId, instanceId, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan || plan.docOverMinor == null || plan.docsPerMonth == null) return { billable: false };
  const { start, end } = await windowOf(tx, tenantId, now);
  const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });   // includes this document
  if (used <= plan.docsPerMonth) return { billable: false };
  const r = await recordBillableUnit(tx, { tenantId, kind: "document", identifier: `doc:${instanceId}`, plan, now });
  if (r.recorded) await checkBudgetAlerts(tx, { tenantId, now }).catch((e) => console.error("docustay budget alert:", e?.message ?? e));
  return { billable: r.recorded, amountMinor: r.amountMinor };
}
/** Before an AI draft that would pass the plan's allowance: the budget must have room. Throws the plain budget sentence. A plan with no per-draft price never reaches here (it stops at the allowance). */
export async function assertAiBudget(tx, { tenantId, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (plan?.paid && (await disputeHold(tx, { tenantId })).held) throw forbidden(HOLD_MESSAGE, { code: "workspace_on_hold" });
  if (!plan || plan.draftOverMinor == null) return;
  try { await assertWithinBudget(tx, { tenantId, plan, kind: "ai_draft", now }); } catch (e) { throw await withOptions(tx, tenantId, e, "ai_draft", {}); }
}
/** After a SUCCESSFUL draft or edit that was past the allowance: one billable unit, once per AI request. A failed or empty answer never gets here. */
export async function noteAiBilled(tx, { tenantId, identifier, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan || plan.draftOverMinor == null) return { billable: false };
  const r = await recordBillableUnit(tx, { tenantId, kind: "ai_draft", identifier: `ai:${identifier}`, plan, now });
  if (r.recorded) await checkBudgetAlerts(tx, { tenantId, now }).catch((e) => console.error("docustay budget alert:", e?.message ?? e));
  return { billable: r.recorded, amountMinor: r.amountMinor };
}

// ── THE FREE PLAN'S MONTHLY TEMPLATE CAP (Run 8, the maintainer 11 Oct 2026; specs/proofs/stage-t/run8/TEMPLATE-CAP.md) ──
const resetsOnText = (end) => new Date(end.getTime()).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
/** ★ THE ONE CHECK for a new template, reached through the island's entitlements port by the only three functions that make one. A workspace on no Docustay plan (self-hosted, the platform)
 *  and Pro (no cap) return at once. A per-workspace transaction lock makes check → insert → ledger one step, so two templates made at the same moment at 4 of 5 cannot both pass. */
export async function assertMayCreateTemplate(tx, { tenantId, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan || plan.templatesPerMonth == null) return;
  if (plan.key === "docustay_payg" && !newLimitsOn(now)) return;   // the Pay as you go cap starts on PRICES.newLimitsFrom
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('docustay.template_cap:' || $1::text, 0))`, [tenantId]);
  const { start, end } = await windowOf(tx, tenantId, now);
  const used = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end });
  if (used >= plan.templatesPerMonth) {
    throw await withOptions(tx, tenantId, forbidden(templateLimitText(plan.name, plan.templatesPerMonth, used, resetsOnText(end)),
      { code: "plan_template_limit", used, limit: plan.templatesPerMonth, resetsAt: end.toISOString() }), "create_template", {});
  }
}
/** After a new template is made: the owner's notices at 4 of 5 and at 5 of 5, each once a month (the same event as the documents notices, kind "templates"). Never throws into the create. */
export async function noteTemplateCreated(tx, { tenantId, now = new Date() }, { emitEvent = emit } = {}) {
  // a notice must never undo the template it is about: it runs in its own savepoint, so a failed query here is rolled back alone instead of aborting the caller's transaction (Run 8 verify)
  const sp = typeof tx.query === "function" ? await tx.query("SAVEPOINT ds_template_notice").then(() => true, () => false) : false;
  try {
    const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
    if (!plan || plan.templatesPerMonth == null) return [];
    if (plan.key === "docustay_payg" && !newLimitsOn(now)) return [];
    const { start, end } = await windowOf(tx, tenantId, now);
    const used = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end });
    const done = [];
    for (const [at, pct] of [[Math.ceil(plan.templatesPerMonth * 0.8), 80], [plan.templatesPerMonth, 100]]) {
      if (at < 1 || used < at) continue;
      const { rows } = await tx.query(`SELECT 1 FROM keystone.event WHERE topic = 'documents.usage.threshold' AND payload->>'kind' = 'templates' AND payload->>'percent' = $1 AND created_at >= $2 AND created_at < $3 LIMIT 1`, [String(pct), start, end]);
      if (rows.length) continue;
      await emitEvent(tx, { tenantId, topic: "documents.usage.threshold", emittedBy: "documents", subjectType: "usage_period", subjectId: tenantId, actor: "system", payload: { kind: "templates", percent: pct, used, limit: plan.templatesPerMonth, plan: plan.key, period_start: start.toISOString(), period_end: end.toISOString() } });
      done.push(pct);
    }
    if (sp) await tx.query("RELEASE SAVEPOINT ds_template_notice");
    return done;
  } catch (e) { if (sp) await tx.query("ROLLBACK TO SAVEPOINT ds_template_notice").catch(() => {}); console.error(`template usage notice failed: ${e?.message ?? e}`); return []; }
}

/** The mail module's default daily limit for this organisation (null when it is not on a Docustay plan). */
/** The most emails a workspace may send in a day: its plan's line, and in its first 7 days a tighter one (the maintainer, 21 Oct 2026, decision 6: a brand-new workspace that mails hundreds of strangers on day one is the usual shape of abuse). */
export const NEW_WORKSPACE_EMAILS = Object.freeze({ days: 7, free: 10, paid: 100 });
export async function planEmailLimit(tx, { tenantId, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId));
  const line = plan?.emailsPerDay ?? null;
  if (line == null) return null;
  const { rows: [t] } = await tx.query(`SELECT created_at FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const young = t?.created_at && now.getTime() - new Date(t.created_at).getTime() < NEW_WORKSPACE_EMAILS.days * 86_400_000;
  return young ? Math.min(line, plan.paid ? NEW_WORKSPACE_EMAILS.paid : NEW_WORKSPACE_EMAILS.free) : line;
}

const stripeCall = async (apiKey, method, path, params) => {
  const r = await callOutside("stripe", `https://api.stripe.com/v1${path}${method === "GET" && params ? `?${params}` : ""}`, { method, headers: { Authorization: `Bearer ${apiKey}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(method === "POST" ? { body: params } : {}) }, { timeoutMs: 20_000 });
  return r;
};
/** R13-D212: the moment a checkout's price is judged. Live: now. Test mode with the customer on a Stripe TEST CLOCK: the clock's frozen time, so a clock moved past the founders cut-off is offered the list price as a real customer would be then. Any failure reading the clock falls back to now. */
export async function pricingMoment(apiKey, customerId, { now = new Date(), call = stripeCall } = {}) {
  if (!String(apiKey ?? "").startsWith("sk_test_") || !customerId) return now;
  const c = await call(apiKey, "GET", `/customers/${encodeURIComponent(customerId)}`).catch(() => null);
  const clock = c?.ok ? c.body?.test_clock : null; if (!clock) return now;
  const t = await call(apiKey, "GET", `/test_helpers/test_clocks/${encodeURIComponent(typeof clock === "string" ? clock : clock.id)}`).catch(() => null);
  const frozen = t?.ok ? Number(t.body?.frozen_time) : NaN;
  return Number.isFinite(frozen) && frozen > 0 ? new Date(frozen * 1000) : now;
}
/** Where the customer lands after Stripe: the Docustay app (KEYSTONE_DOCUSTAY_APP_URL) — never a the platform address. Falls back to the workspace's own address until that is set. */
const returnBase = (slug) => (process.env.KEYSTONE_DOCUSTAY_APP_URL ? process.env.KEYSTONE_DOCUSTAY_APP_URL.replace(/\/+$/, "") : `https://${slug ?? "app"}.${process.env.KEYSTONE_APP_DOMAIN || "example.com"}`);

/** The Stripe price id for a lookup key (the price is made once, by scripts/stripe/docustay-catalogue.mjs; checkout never builds one inline). */
async function priceIdFor(apiKey, lookupKey) {
  const r = await stripeCall(apiKey, "GET", "/prices", new URLSearchParams({ "lookup_keys[]": lookupKey, active: "true" }).toString());
  const id = r.ok ? r.body?.data?.[0]?.id : null;
  if (!id) { console.error(`docustay checkout: no active Stripe price with lookup key ${lookupKey}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return id;
}

const BUYABLE = Object.freeze(["docustay_payg", "docustay_pro", "docustay_lifetime"]);
const PAID_ACTIVE = ["active", "trialing", "past_due"];
/** Stripe Tax is switched on by the environment once the account's head office address is set (a Stripe requirement; see TY-ONLY.md). With it on, Checkout collects the billing address and adds the tax. */
const taxParams = () => (process.env.KEYSTONE_DOCUSTAY_TAX_ON === "1" ? { "automatic_tax[enabled]": "true", billing_address_collection: "required", "customer_update[address]": "auto", "customer_update[name]": "auto" } : {});

/** A Stripe Checkout session for one of the three paid plans: Pay as you go (a per-person price, documents and drafts metered), Pro (the flat price, drafts metered), Lifetime (one payment, the first 200 workspaces).
 *  The plan, the founders stamp and the workspace travel in the metadata; the webhook reads them. Never a live key outside production. */
export async function startCheckout(tx, { tenantId, actorUserId = null, email = null, interval = "month", planKey = "docustay_pro" }) {
  if (!BUYABLE.includes(planKey)) throw invalid("Choose Pay as you go, Pro or Lifetime.", { field: "plan" });
  if (!["month", "year"].includes(interval)) throw invalid("Choose monthly or yearly billing.", { field: "interval" });
  if (interval === "year" && (!annualEnabled() || planKey !== "docustay_pro")) throw invalid("Yearly billing is not available. Choose monthly.", { field: "interval" });
  const plan = docustayPlan(planKey);
  if (planKey === "docustay_pro" && plan.priceMinor == null) throw invalid("Pro is not priced yet — nothing can be bought until it is.");
  if (!(await flagIsOn(tx, "stripe_enabled", tenantId))) throw invalid("stripe_enabled is off for this organisation — a platform operator turned it off.");
  const apiKey = stripeSecretFor("docustay");
  if (!apiKey) throw dependency("Billing is temporarily unavailable — try again shortly");
  const sub = await subRow(tx, tenantId);
  if (!sub || !isDocustayPlanKey(sub.plan_key)) throw invalid("this organisation is not a Docustay workspace");
  if (sub.plan_key === "docustay_lifetime") throw invalid("This workspace already has Lifetime.");
  const stale = await staleStripeIds(apiKey, sub);   // ids from another Stripe account (earlier test / old account) must not block a fresh purchase; nothing is deleted
  if (stale.customer) console.error(`docustay checkout: workspace ${tenantId} has a Stripe customer this account does not know; a new one is created`);
  if (!stale.subscription && !stale.customer && planKey !== "docustay_lifetime" && ["docustay_pro", "docustay_payg"].includes(sub.plan_key) && PAID_ACTIVE.includes(sub.status) && sub.stripe_subscription_id) throw invalid(`This workspace is already on ${sub.plan_key === "docustay_pro" ? "Pro" : "Pay as you go"}. Use Manage billing, or cancel it first to choose a different plan.`);
  if (planKey === "docustay_lifetime") {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('docustay.lifetime_cap', 0))`);
    const { rows: [c] } = await tx.query(`SELECT keystone.docustay_lifetime_count() AS n`);
    if ((c?.n ?? 0) >= PRICES.lifetime.firstWorkspaces) throw invalid("Lifetime was for the first 200 workspaces and they are taken. Pro is the plan to choose.");
  }
  const { rows: t } = await tx.query(`SELECT name, slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const origin = returnBase(t[0]?.slug);
  if (!email && actorUserId) email = (await tx.query(`SELECT email FROM keystone.app_user WHERE id = $1`, [actorUserId])).rows[0]?.email ?? null;
  if (!email) throw invalid("We need an email address on the account to start a subscription.");
  let customerId = stale.customer ? null : sub.stripe_customer_id;
  if (!customerId) {
    const made = await createStripeCustomer({ tenantId, email, name: t[0]?.name }, { apiKey });
    if (!made.externalId) { console.error(`docustay checkout: no Stripe customer (${made.outcome}): ${made.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
    customerId = made.externalId;
    await tx.query(`UPDATE keystone.workbench_subscription SET stripe_customer_id = $2 WHERE tenant_id = $1`, [tenantId, customerId]);
  } else if (t[0]?.name) {
    // Run 13 R13-D179 (23 Oct 2026): the customer's name is the workspace's name TODAY (it may have been renamed since the customer was made), so the invoice is billed to the right name; best effort
    await stripeCall(apiKey, "POST", `/customers/${encodeURIComponent(customerId)}`, new URLSearchParams({ name: t[0].name }).toString()).catch(() => null);
  }
  // ★ the webhook finds this workspace from the Stripe customer id (invoice and payment events carry no workspace of their own)
  const { rows: known } = await tx.query(`SELECT 1 FROM keystone.list_webhook_sources() WHERE provider = 'stripe' AND external_id = $1 AND retired_at IS NULL`, [customerId]);
  if (known.length === 0) await tx.query(`SELECT keystone.create_webhook_source('stripe', $1)`, [customerId]);
  // Pro: the price is chosen when checkout STARTS (founders version up to the cut-off); the stamp on the subscription is what the webhook reads, so paying a minute after midnight does not change what was promised
  const { founders: foundersNow, version } = checkoutPricing(process.env, await pricingMoment(apiKey, customerId));
  const meta = { workbench_tenant_id: tenantId, plan_key: plan.key, seat_count: "1", billing_interval: interval, founders_price: planKey === "docustay_pro" && foundersNow ? "true" : "false" };
  const common = {
    customer: customerId, expires_at: String(Math.floor(Date.now() / 1000) + 3600),   // the price is the one chosen now; an unfinished session lapses within the hour
    success_url: `${origin}/billing?upgrade=success&session={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/billing?upgrade=cancelled`,   // B2: the return carries the session id; the page asks the server to re-read it
    ...promotionCodeParams(),
    ...cardOnly(),   // card only is a payment-method CONFIGURATION on the account (env KEYSTONE_DOCUSTAY_PM_CONFIG), not a parameter
    "managed_payments[enabled]": "false",   // 14 Oct 2026: Docustay is its own seller
    ...checkoutBranding(planKey), ...taxParams(),
  };
  let params;
  if (planKey === "docustay_lifetime") {
    const priceId = await priceIdFor(apiKey, "docustay_lifetime_v1");
    const lm = { ...meta, docustay_kind: "lifetime" };
    // 21 Oct 2026 (the maintainer): Lifetime from Pay as you go or Pro credits the unused, already-paid time against the $299. A payment-mode Checkout cannot use the customer balance, so the credit is a one-off coupon (used once, gone within the hour) on THIS session.
    //   A Checkout cannot take a coupon and a promotion-code box together, so the box is left out of a session that carries a credit.
    let creditMinor = 0;
    if (!stale.subscription && !stale.customer && SWITCHABLE.includes(sub.plan_key) && PAID_ACTIVE.includes(sub.status) && sub.stripe_subscription_id) {
      creditMinor = Math.min((await unusedTimeCredit(apiKey, sub)).creditMinor, await priceMinorOf(apiKey, "docustay_lifetime_v1"));
      if (creditMinor > 0) {
        const cp = await stripeCall(apiKey, "POST", "/coupons", new URLSearchParams({ amount_off: String(creditMinor), currency: "usd", duration: "once", max_redemptions: "1", redeem_by: String(Math.floor(Date.now() / 1000) + 3500), name: "Credit for unused time", "metadata[kind]": "switch_credit", "metadata[tenant]": tenantId }).toString());
        if (!cp.ok || !cp.body?.id) { console.error(`docustay lifetime: could not make the credit coupon (${cp.status}): ${cp.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
        common["discounts[0][coupon]"] = cp.body.id; delete common.allow_promotion_codes; lm.credit_minor = String(creditMinor);
      }
    }
    params = new URLSearchParams({ ...common, mode: "payment", "line_items[0][quantity]": "1", "line_items[0][price]": priceId, "payment_intent_data[setup_future_usage]": "off_session", "invoice_creation[enabled]": "true",
      ...Object.fromEntries(Object.entries(metadataFor("subscription", lm)).flatMap(([k, v]) => [[`payment_intent_data[metadata][${k}]`, v], [`metadata[${k}]`, v]])) });
  } else {
    const items = [];
    if (planKey === "docustay_pro") items.push([await priceIdFor(apiKey, priceLookupKey(interval, version)), "1"]);
    else {
      const seats = Math.max(1, (await teamSeatUsage(tx)).staff);
      meta.seat_count = String(seats);
      items.push([await priceIdFor(apiKey, "docustay_payg_person_monthly_v1"), String(seats)], [await priceIdFor(apiKey, "docustay_payg_document_v1"), null]);
    }
    items.push([await priceIdFor(apiKey, "docustay_ai_draft_v1"), null]);
    params = new URLSearchParams({ ...common, mode: "subscription",
      ...Object.fromEntries(items.flatMap(([price, qty], i) => [[`line_items[${i}][price]`, price], ...(qty ? [[`line_items[${i}][quantity]`, qty]] : [])])),
      ...Object.fromEntries(Object.entries(metadataFor("subscription", meta)).flatMap(([k, v]) => [[`subscription_data[metadata][${k}]`, v], [`metadata[${k}]`, v]])) });
  }
  const r = await stripeCall(apiKey, "POST", "/checkout/sessions", params);
  if (!r.ok || !r.body?.url) { console.error(`docustay checkout: Stripe refused the session (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return { url: r.body.url };
}

/** A founder's portal offers only founders prices and everyone else's only list prices — one shared portal would let a list customer pick the founders price. */
const portalConfigFor = (founders, env = process.env, planKey = "docustay_pro") => (planKey === "docustay_payg" ? env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG_PAYG : founders ? env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG_FOUNDERS || env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG : env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG) || null;
/** Stripe's customer portal for this workspace: change card, see invoices, switch monthly/yearly, cancel. Returns where to send the browser. */
export async function startPortal(tx, { tenantId }) {
  const apiKey = stripeSecretFor("docustay");
  if (!apiKey) throw dependency("Billing is temporarily unavailable — try again shortly");
  const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_customer_id) throw invalid("There is no billing to manage yet — this workspace has not subscribed.");
  const { rows: t } = await tx.query(`SELECT slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const params = new URLSearchParams({ customer: sub.stripe_customer_id, return_url: `${returnBase(t[0]?.slug)}/billing`, ...(portalConfigFor(sub.founders_price, process.env, sub.plan_key) ? { configuration: portalConfigFor(sub.founders_price, process.env, sub.plan_key) } : {}) });
  const r = await stripeCall(apiKey, "POST", "/billing_portal/sessions", params);
  if (stripeMissing(r)) { console.error(`docustay portal: workspace ${tenantId} has a Stripe customer this account does not know`); throw invalid("This workspace has no billing in the current Stripe account. Choose a plan on the Billing page to start fresh.", { code: "billing_record_missing" }); }
  if (!r.ok || !r.body?.url) { console.error(`docustay portal: Stripe refused (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return { url: r.body.url };
}

/** The self-hosted licence ($390 a year, its own price): a public Checkout for someone who has no Docustay workspace. TEST mode in the sandbox, never a live key outside production. The webhook finds the platform organisation from the
 *  stamped id and issues the licence key when Stripe says the first payment went through (see docustaySelfhost.mjs). */
export async function startSelfhostCheckout({ platformTenantId, email }) {
  if (typeof email !== "string" || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email.trim()) || email.length > 200) throw invalid("Enter the email address the licence key should be sent to.", { field: "email" });
  const apiKey = stripeSecretFor("docustay");
  if (!apiKey) throw dependency("Billing is temporarily unavailable — try again shortly");
  const origin = returnBase(null);
  const priceId = await priceIdFor(apiKey, SELFHOST_LOOKUP_KEY);
  const meta = { docustay_kind: "selfhost", keystone_tenant_id: platformTenantId, buyer_email: email.trim().toLowerCase() };
  const params = new URLSearchParams({
    mode: "subscription", customer_email: email.trim(),
    success_url: `${origin}/self-host?bought=1`, cancel_url: `${origin}/self-host`,
    "line_items[0][quantity]": "1", "line_items[0][price]": priceId,
    ...cardOnly(),   // a subscription is card only (wallets ride on card): the new account's API refuses payment_method_types, so the choice is a payment-method CONFIGURATION on the account (env KEYSTONE_DOCUSTAY_PM_CONFIG), not a parameter
    "managed_payments[enabled]": "false",   // 14 Oct 2026: the new Docustay account has Stripe Managed Payments ON by default, which refuses our consent_collection; Docustay is its own seller
    ...checkoutBranding("docustay_selfhost"),   // D-080 + F1045
    ...Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => [[`subscription_data[metadata][${k}]`, v], [`metadata[${k}]`, v]])),
  });
  const r = await stripeCall(apiKey, "POST", "/checkout/sessions", params);
  if (!r.ok || !r.body?.url) { console.error(`docustay self-host checkout: Stripe refused the session (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return { url: r.body.url };
}
// Run 10 R10-3 / R10-29: Stripe's newer API versions reject `payment_method_types` outright (the first attempt at card-only broke every Docustay checkout). A card-only payment-method configuration (created once through the API, id kept in the environment) does the same job.
/** Stripe's own promotion-code box on Checkout (a customer who has a valid code can use it; invalid codes are refused by Stripe). */
export const promotionCodeParams = () => ({ allow_promotion_codes: "true" });
const cardOnly = () => (process.env.KEYSTONE_DOCUSTAY_PM_CONFIG ? { payment_method_configuration: process.env.KEYSTONE_DOCUSTAY_PM_CONFIG } : {});
const SELFHOST_LOOKUP_KEY = "docustay_pro_selfhost_yearly_v2";

/** The same two notices for the day's email limit: at 80% and at 100% of the daily limit, each once per UTC day, to the workspace owner. Counted sends only (the notices themselves never count). */
export async function emailUsageAlerts(tx, { tenantId, sent }, { emitEvent = emit, limitOf = undefined } = {}) {
  const plan = effectivePlan(await subRow(tx, tenantId));
  if (!plan) return [];
  const limit = limitOf !== undefined ? limitOf : (await mail.limitState(tx, { tenantId })).limit;
  if (!limit) return [];
  const now = new Date(), dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), dayEnd = new Date(dayStart.getTime() + 86400000);
  const done = [];
  for (const pct of USAGE_THRESHOLDS) {
    if (sent < Math.ceil((limit * pct) / 100)) continue;
    const { rows } = await tx.query(`SELECT 1 FROM keystone.event WHERE topic = 'documents.usage.threshold' AND payload->>'kind' = 'emails' AND payload->>'percent' = $1 AND created_at >= $2 AND created_at < $3 LIMIT 1`, [String(pct), dayStart, dayEnd]);
    if (rows.length) continue;
    await emitEvent(tx, { tenantId, topic: "documents.usage.threshold", emittedBy: "documents", subjectType: "usage_period", subjectId: tenantId, actor: "system", payload: { kind: "emails", percent: pct, used: sent, limit, plan: plan.key, period_start: dayStart.toISOString(), period_end: dayEnd.toISOString() } });
    done.push(pct);
  }
  return done;
}

/** GET /api/v1/ai/usage: the same allowance, use and reset the Settings card shows, for a key (no per-person detail: a key has no person). */
export async function apiAiUsage(db, { tenantId }) {
  const v = await aiUsageView(db, { tenantId, userId: null, cfg: await readAiConfig(db) });
  return { mode: v.mode, plan: v.plan, allowance: v.allowance, used: v.used, remaining: v.remaining, percent: v.percent, state: v.state, resetsAt: v.resetsAt, byFeature: v.byFeature, paused: v.paused };
}

/** POST /api/v1/documents/detect-fields: find the fields on a file; nothing is stored. */
/** 21 Oct 2026 (the maintainer, answer 7): finding fields through the API runs on this server (geometry and text recognition) and calls NO AI model, so it is not metered as an AI draft;
 *  it only has a rate limit per workspace (30 an hour). The counter shares the per-tenant window table; its window start is shifted by 30 s so it can never meet a one-minute or one-hour window of another bucket user. */
export const DETECT_PER_HOUR = 30;
const shiftedBump = (tenantId, bucket, start) => withLimiterConnection(({ query }) => query(`SELECT keystone.bump_rate_limit_window($1, $2, $3) AS count`, [tenantId, bucket, new Date(start.getTime() + 30_000)]));
export const detectRateCheck = (tenantId, opts = {}) => checkTenantLimit(tenantId, "documents", { limit: DETECT_PER_HOUR, windowMs: 3_600_000, bump: shiftedBump, ...opts });
export async function apiDetectFields(db, { bytes, fileName, minConfidence, ocr }) {
  const { rows: [t] } = await db.query(`SELECT keystone.current_tenant_id() AS t`);   // nothing is read or stored: the file goes in, the fields come out
  if (t?.t) await detectRateCheck(t.t);
  // R13-D392: the same file-size cap as every other upload (the plan's limit, under the workspace's own setting); before, only the transport limit applied
  if (t?.t) { const maxMb = await uploadCapMb(db, { tenantId: t.t }); if (bytes.length > maxMb * 1024 * 1024) throw invalid(`That file is ${(bytes.length / 1048576).toFixed(1)} MB; the most that can be uploaded is ${maxMb} MB.`, { field: "file", code: "too_big", maxMb }); }
  return detectUpload({ bytes, fileName, ...(minConfidence != null ? { minConfidence } : {}), ...(ocr === false ? { ocr: false } : {}) });
}

// ══ Run 9 Part 3.7 — PRO BILLING ON DOCUSTAY'S OWN PAGES (boards B2–B5). Stripe stays the record: every figure below is read from Stripe, and after every write the mirror is refreshed from
//    Stripe's own response (mirrorSubscriptionFromStripe), never from what we asked for. Live-mode Stripe is the maintainer's (R9-m): these run against whatever key the environment has.
const proKey = () => { const k = stripeSecretFor("docustay"); if (!k) throw dependency("Billing is temporarily unavailable — try again shortly"); return k; };
/** Stripe answered "no such object": the stored id is from another Stripe account (an earlier test or the old account) or was deleted. Not an outage. */
export const stripeMissing = (r) => !r.ok && (r.status === 404 || r.body?.error?.code === "resource_missing");
const stripeOk = (r, what) => {
  if (!r.ok) {
    console.error(`docustay ${what}: Stripe refused (${r.status}): ${r.body?.error?.message ?? "no detail"}`);
    if (stripeMissing(r)) throw invalid("This workspace's billing record is not in the current Stripe account, so there is nothing to show or change. Choose a plan on the Billing page to start fresh.", { code: "billing_record_missing" });
    throw dependency("Billing is temporarily unavailable — try again shortly");
  }
  return r.body;
};
/** Which of a workspace's stored Stripe ids the CURRENT Stripe account does not know. Reads only; nothing is changed or deleted. A real Stripe outage still throws (it is not "missing"). */
export async function staleStripeIds(apiKey, sub, call = stripeCall) {
  const out = { customer: false, subscription: false };
  if (sub?.stripe_customer_id) { const r = await call(apiKey, "GET", `/customers/${encodeURIComponent(sub.stripe_customer_id)}`, ""); if (stripeMissing(r) || (r.ok && r.body?.deleted)) out.customer = true; else if (!r.ok) throw dependency("Billing is temporarily unavailable — try again shortly"); }
  if (sub?.stripe_subscription_id) { const r = await call(apiKey, "GET", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, ""); if (stripeMissing(r)) out.subscription = true; else if (!r.ok) throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return out;
}

/** B2 · back from Stripe's checkout page: Pro switches on only when Stripe itself says this workspace's session is complete and paid. Re-reads the session (and its subscription) from Stripe,
 *  then mirrors it. The browser's return alone never counts; a session for another customer is refused. → { confirmed, status } */
export async function confirmUpgrade(tx, { tenantId, sessionId }) {
  if (typeof sessionId !== "string" || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) throw invalid("That is not a checkout session.", { field: "sessionId" });
  const apiKey = proKey();
  const sub = await subRow(tx, tenantId);
  if (!sub || !isDocustayPlanKey(sub.plan_key)) throw invalid("this organisation is not a Docustay workspace");
  const s = stripeOk(await stripeCall(apiKey, "GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`, new URLSearchParams({ "expand[]": "subscription" }).toString()), "upgrade confirm");
  if (s.mode === "payment" && s.metadata?.docustay_kind === "lifetime") {   // Lifetime: one payment, no subscription to mirror
    if (s.metadata?.workbench_tenant_id !== tenantId || (sub.stripe_customer_id && s.customer !== sub.stripe_customer_id)) throw forbidden("That checkout does not belong to this workspace.");
    if (!(s.status === "complete" && s.payment_status === "paid")) return { confirmed: false, status: s.status === "expired" ? "expired" : "waiting" };
    await (await import("../billing/webhook.mjs")).applyLifetimePurchase(tx, { tenantId, customer: s.customer ?? null });
    return { confirmed: true, status: "pro" };
  }
  const mine = s.mode === "subscription" && (s.metadata?.workbench_tenant_id === tenantId) && (!sub.stripe_customer_id || s.customer === sub.stripe_customer_id);
  if (!mine) throw forbidden("That checkout does not belong to this workspace.");
  const paid = s.status === "complete" && ["paid", "no_payment_required"].includes(s.payment_status) && s.subscription && typeof s.subscription === "object";
  if (!paid) return { confirmed: false, status: s.status === "expired" ? "expired" : "waiting" };
  await tx.query(`UPDATE keystone.workbench_subscription SET stripe_customer_id = COALESCE(stripe_customer_id, $2), stripe_subscription_id = COALESCE($3, stripe_subscription_id) WHERE tenant_id = $1`, [tenantId, s.customer ?? null, s.subscription.id]);
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: s.subscription, why: "checkout" });
  await (await import("./docustayUsage.mjs")).ensureEarlyInvoiceThreshold({ subscription: s.subscription, apiKey }).catch(() => false);   // an early invoice at about $50 unbilled
  // AB 2863 (13 Oct 2026): the person agreed to the renewal terms on Stripe's checkout page (the line CHECKOUT_NOTE is shown above the Subscribe button). Keep proof, once per checkout session: when, who is the workspace, which text.
  const { rows: [had] } = await tx.query(`SELECT 1 FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND kind = 'renewal_terms_accepted' AND detail->>'session' = $2`, [tenantId, sessionId]);
  if (!had) await record(tx, { tenantId, kind: "renewal_terms_accepted", subscriptionId: s.subscription.id, detail: { session: sessionId, text: CHECKOUT_NOTE, completedAt: s.created ? new Date(s.created * 1000).toISOString() : null } });
  const plan = effectivePlan(await subRow(tx, tenantId));
  return { confirmed: Boolean(plan?.paid), status: plan?.paid ? "pro" : "waiting" };
}

/** B4 · what the billing page shows on Pro, read from Stripe: the next payment (date and amount), the card on file, the invoices with their PDFs, and the fees saved this month (the Free rate
 *  on what was paid through payment boxes while on Pro). → { nextPayment, card, invoices, savedThisMonth } — or nulls where there is no subscription yet */
export async function billingDetails(tx, { tenantId }) {
  const sub = await subRow(tx, tenantId);
  const { paidOnProThisMonth } = await import("../documents/frontDoor.mjs");
  const { FREE_FEE_BPS, feeMinorOf } = await import("./docustayFee.mjs");
  const pro = await paidOnProThisMonth(tx);
  const savedMinor = pro.amounts.reduce((n, a) => n + feeMinorOf(Math.max(0, a), FREE_FEE_BPS), 0);
  const out = { nextPayment: null, card: null, invoices: [], savedThisMonth: { minor: savedMinor, currency: pro.currency, payments: pro.amounts.length } };
  if (!sub?.stripe_customer_id) return out;
  const apiKey = proKey();
  try {
  if (sub.stripe_subscription_id) {
    const s = stripeOk(await stripeCall(apiKey, "GET", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, new URLSearchParams([["expand[]", "default_payment_method"], ["expand[]", "customer.invoice_settings.default_payment_method"]]).toString()), "billing details");
    const item = planItem(s);   // R13-D211: the plan line, never a metered price
    const end = item?.current_period_end ?? s.current_period_end ?? null;
    if (!["canceled", "incomplete_expired"].includes(s.status) && !s.cancel_at_period_end && !s.cancel_at && end) out.nextPayment = { at: new Date(end * 1000).toISOString(), amountMinor: licensedTotalMinor(s), currency: item?.price?.currency ?? "usd", interval: item?.price?.recurring?.interval ?? null };
    const pm = (typeof s.default_payment_method === "object" && s.default_payment_method) || (typeof s.customer === "object" && typeof s.customer?.invoice_settings?.default_payment_method === "object" && s.customer.invoice_settings.default_payment_method) || null;
    if (pm?.card) out.card = { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null, expMonth: pm.card.exp_month ?? null, expYear: pm.card.exp_year ?? null };
  }
  const inv = stripeOk(await stripeCall(apiKey, "GET", "/invoices", new URLSearchParams({ customer: sub.stripe_customer_id, limit: "12" }).toString()), "invoices");
  out.invoices = (inv.data ?? []).filter((i) => i.status !== "draft").map(invoiceRow);
  } catch (e) {
    if (e?.detail?.code !== "billing_record_missing") throw e;
    console.error(`docustay billing details: workspace ${tenantId} has Stripe ids this account does not know; showing the plan without Stripe details`);
    return { ...out, nextPayment: null, card: null, invoices: [], stale: true };
  }
  return out;
}

/** Run 13 R13-D179 (23 Oct 2026): what an invoice was FOR, from its own first plan line (e.g. "Docustay Lifetime"), never the plan the workspace is on today. null when the invoice names no Docustay plan. */
export function invoiceLabel(i) {
  const lines = [...(i?.lines?.data ?? [])].sort((a, b) => ((a.amount ?? 0) < 0) - ((b.amount ?? 0) < 0));   // a charge line before an unused-time credit line
  for (const l of lines) { const m = /Docustay (Pro|Lifetime|Pay as you go|Free)/i.exec(String(l.description ?? "")); if (m) return `Docustay ${m[1]}`; }
  return null;
}

/** D5: the invoice PDF, built here from Stripe's data (white paper, the Docustay wordmark, our number). The invoice must belong to THIS workspace's Stripe customer. → { bytes, filename } */
export async function invoicePdfFor(tx, { tenantId, invoiceId }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_customer_id || !/^in_[A-Za-z0-9]+$/.test(String(invoiceId))) throw notFoundInvoice();
  const inv = stripeOk(await stripeCall(apiKey, "GET", `/invoices/${encodeURIComponent(invoiceId)}`, new URLSearchParams([["expand[]", "customer"], ["expand[]", "payments.data.payment.payment_intent"], ["expand[]", "total_discount_amounts.discount"]]).toString()), "invoice");
  const custId = typeof inv.customer === "object" ? inv.customer?.id : inv.customer;
  if (custId !== sub.stripe_customer_id || inv.status === "draft") throw notFoundInvoice();
  let card = null;
  const chargeId = inv.payments?.data?.map((p) => p.payment?.payment_intent?.latest_charge).find(Boolean);
  if (chargeId) { const ch = await stripeCall(apiKey, "GET", `/charges/${encodeURIComponent(chargeId)}`, "").catch(() => null); const c = ch?.ok ? ch.body?.payment_method_details?.card : null; if (c) card = { brand: c.brand, last4: c.last4 }; }
  const bytes = await renderInvoicePdf({ invoice: inv, card, seller: process.env.DOCUSTAY_INVOICE_SELLER || "" });
  return { bytes, filename: `${invoiceNumber(inv)}.pdf` };
}
const notFoundInvoice = () => notFound("No such invoice.");

const CANCEL_FEEDBACK = Object.freeze({ too_expensive: "too_expensive", missing_feature: "missing_features", testing: "unused", other: "other" });
const record = (tx, { tenantId, kind, actorUserId = null, subscriptionId = null, detail = {} }) =>
  tx.query(`INSERT INTO keystone.docustay_billing_record (tenant_id, kind, actor_user_id, stripe_subscription_id, detail) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id, at`, [tenantId, kind, actorUserId, subscriptionId, JSON.stringify(detail)]).then((r) => r.rows[0]);
const INTENT_MIN_MS = 1500, INTENT_MAX_MS = 30 * 60_000;
/** C · step 2 of cancelling: the cancel PAGE opens and asks for a one-time confirm token. Nothing is cancelled here. The token is a row in the billing record (the person, the subscription, the time); the confirm refuses it
 *  when it is missing, someone else's, issued less than 1.5 seconds ago (a stray double click through a page change), older than 30 minutes, or already used. */
export async function prepareCancel(tx, { tenantId, actorUserId = null }) {
  const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || !["docustay_pro", "docustay_payg"].includes(sub.plan_key)) throw invalid("There is no subscription to cancel.");
  const r = await record(tx, { tenantId, kind: "cancel_intent", actorUserId, subscriptionId: sub.stripe_subscription_id });
  return { token: r.id, at: r.at, notBefore: new Date(Date.parse(r.at) + INTENT_MIN_MS).toISOString() };
}
/** B5 / C · cancel in the app: Pro stays on to the end of what was paid for (Stripe's cancel_at_period_end); the reason goes to Stripe's own cancellation record. Owner or admin (the route).
 *  ONLY ever reached after the cancel page's explicit confirm: it needs the token `prepareCancel` issued. Safe to repeat: a second call with the same token returns the same answer and cancels nothing twice.
 *  → the plan as Stripe now says it */
export async function cancelPro(tx, { tenantId, actorUserId = null, token = null, reason = null, reasonText = null }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || !["docustay_pro", "docustay_payg"].includes(sub.plan_key)) throw invalid("There is no subscription to cancel.");
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(token)) throw invalid("Open the cancel page and confirm there.", { code: "cancel_needs_confirmation" });
  const { rows: [intent] } = await tx.query(`SELECT id, at, actor_user_id, stripe_subscription_id FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND id = $2 AND kind = 'cancel_intent'`, [tenantId, token]);
  if (!intent || intent.stripe_subscription_id !== sub.stripe_subscription_id || (intent.actor_user_id && actorUserId && intent.actor_user_id !== actorUserId)) throw invalid("Open the cancel page and confirm there.", { code: "cancel_needs_confirmation" });
  const age = Date.now() - Date.parse(intent.at);
  const { rows: [used] } = await tx.query(`SELECT 1 FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND kind = 'cancel_confirmed' AND detail->>'intent' = $2`, [tenantId, token]);
  if (used) return workspaceStatus(tx, { tenantId });   // the same confirm sent twice (a double click, a second tab): already done, nothing more is sent to Stripe
  if (age < INTENT_MIN_MS) throw invalid("That was too quick. Read the page, then confirm.", { code: "cancel_too_quick" });
  if (age > INTENT_MAX_MS) throw invalid("This page has been open a while. Reload it and confirm again.", { code: "cancel_expired" });
  await releasePendingSchedule(tx, { tenantId, sub, apiKey });   // a subscription waiting to switch plans is managed by its schedule: that is released first, then the cancel applies to the plan as it is
  const form = new URLSearchParams({ cancel_at_period_end: "true", ...(CANCEL_FEEDBACK[reason] ? { "cancellation_details[feedback]": CANCEL_FEEDBACK[reason] } : {}), ...(typeof reasonText === "string" && reasonText.trim() ? { "cancellation_details[comment]": reasonText.trim().slice(0, 500) } : {}) });
  const s = stripeOk(await stripeCall(apiKey, "POST", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, form.toString()), "cancel");
  await record(tx, { tenantId, kind: "cancel_confirmed", actorUserId, subscriptionId: sub.stripe_subscription_id, detail: { intent: token, reason: CANCEL_FEEDBACK[reason] ? reason : null, hasComment: Boolean(reasonText && String(reasonText).trim()), cancelAt: s.cancel_at ?? null } });
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: s, why: "cancel" });
  return workspaceStatus(tx, { tenantId });
}
// ── plan switches WITH CREDIT (21 Oct 2026, the maintainer; specs/v1/PRICING-INTEGRITY-SPEC.md decision 1, RECON-FINDINGS.md "Pricing integrity", section B) ──────────────────────────────────────────────────────────────────────────────
//   UPGRADE (Pay as you go to Pro): the new plan starts now at its full price and a new period begins (Decision 54: allowances, tally and budget start fresh). What was already PAID for the time not yet used on the old plan comes back as a
//     credit: Stripe's own invoice preview of ending the old subscription says how much (its proration lines), that exact amount is put on the customer's balance, the new subscription's first invoice uses it ("Pro $25 minus $4.84"), and a credit bigger
//     than that invoice stays on the balance for the next ones. The old subscription is then ended with its usage invoiced and NO proration (the credit was given once). If the new subscription cannot be started (a declined card) the credit is taken
//     back and nothing changes. Usage (documents, AI drafts) is billed in arrears and is never credited, always invoiced.
//   DOWNGRADE (Pro to Pay as you go): at the END of the period already paid, through a Stripe subscription schedule on the same subscription; the screen says so, and the pending switch can be cancelled (the schedule is released).
//   LIFETIME (from Pay as you go or Pro): one Checkout payment; the same credit is a one-off coupon on that session (a balance cannot be used in a payment-mode Checkout); the old subscription ends once the payment is confirmed.
//   A switch back and forth cannot create money: credit exists only for time that was paid for, usage is always billed, and the only way back from Pro is the period end.
const SWITCHABLE = Object.freeze(["docustay_payg", "docustay_pro"]);
const planName = (k) => (k === "docustay_pro" ? "Pro" : k === "docustay_payg" ? "Pay as you go" : k === "docustay_lifetime" ? "Lifetime" : "Free");
/** One switch at a time per workspace: a double click or two tabs must not give the credit twice. */
const lockSwitch = (tx, tenantId) => tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`docustay.switch:${tenantId}`]);

/** What Stripe says the unused, already-paid time of this subscription is worth right now: its own preview of ending the subscription now with prorations. Only the credit lines count (negative proration lines);
 *  usage lines are never credited. → { creditMinor, currency, text } */
export async function unusedTimeCredit(apiKey, sub) {
  const body = stripeOk(await stripeCall(apiKey, "POST", "/invoices/create_preview", new URLSearchParams({ customer: sub.stripe_customer_id, subscription: sub.stripe_subscription_id, "subscription_details[cancel_now]": "true", "subscription_details[proration_behavior]": "create_prorations" }).toString()), "switch preview");
  const credit = (body.lines?.data ?? []).filter((l) => l.parent?.subscription_item_details?.proration === true && Number(l.amount) < 0);
  return { creditMinor: Math.max(0, -credit.reduce((n, l) => n + Number(l.amount), 0)), currency: String(body.currency ?? "usd"), text: credit.map((l) => String(l.description ?? "")).filter(Boolean) };
}
/** The price in minor units of a plan's first charge, read from Stripe's own price (never typed). */
async function priceMinorOf(apiKey, lookupKey) {
  const r = await stripeCall(apiKey, "GET", "/prices", new URLSearchParams({ "lookup_keys[]": lookupKey, active: "true" }).toString());
  const p = r.ok ? r.body?.data?.[0] : null;
  if (!p || p.unit_amount == null) throw dependency("Billing is temporarily unavailable — try again shortly");
  return Number(p.unit_amount);
}

/** What a switch would do, in Stripe's own numbers, for the confirm dialog. Reads only. Throws the plain reason when the switch is not possible.
 *  kind "upgrade" | "downgrade" | "lifetime". → { kind, from, to, currency, creditMinor, firstChargeMinor, dueTodayMinor, accountCreditMinor, effectiveAt, creditText, foundersLost } */
export async function previewSwitch(tx, { tenantId, toPlanKey }) {
  if (![...SWITCHABLE, "docustay_lifetime"].includes(toPlanKey)) throw invalid("Choose Pay as you go, Pro or Lifetime.", { field: "plan" });
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || !SWITCHABLE.includes(sub.plan_key) || sub.status !== "active") throw invalid("There is no active subscription to switch.");
  if (sub.plan_key === toPlanKey) throw invalid(`This workspace is already on ${planName(toPlanKey)}.`);
  if (!sub.stripe_customer_id) throw invalid("There is no billing record to switch.");
  const out = { from: sub.plan_key, to: toPlanKey, currency: "usd", creditMinor: 0, firstChargeMinor: 0, dueTodayMinor: 0, accountCreditMinor: 0, effectiveAt: null, creditText: [], foundersLost: false };
  if (toPlanKey === "docustay_payg") {   // Pro to Pay as you go: at the end of the period that is paid
    if (sub.cancel_at) throw invalid("Your plan ends at the end of this period already. Resume it first if you want to switch it.", { code: "switch_needs_resume" });
    return { ...out, kind: "downgrade", effectiveAt: sub.current_period_end ? new Date(sub.current_period_end).toISOString() : null, foundersLost: Boolean(sub.founders_price) };
  }
  if (sub.cancel_at && toPlanKey !== "docustay_lifetime") throw invalid("Resume your plan before switching it.", { code: "switch_needs_resume" });
  if (toPlanKey === "docustay_pro" && docustayPlan("docustay_pro").priceMinor == null) throw invalid("Pro is not priced yet.");
  const credit = await unusedTimeCredit(apiKey, sub);
  const { version } = checkoutPricing();
  const first = toPlanKey === "docustay_lifetime" ? await priceMinorOf(apiKey, "docustay_lifetime_v1") : await priceMinorOf(apiKey, priceLookupKey("month", version));
  const used = Math.min(credit.creditMinor, first);
  return { ...out, kind: toPlanKey === "docustay_lifetime" ? "lifetime" : "upgrade", currency: credit.currency, creditMinor: credit.creditMinor, firstChargeMinor: first, dueTodayMinor: Math.max(0, first - credit.creditMinor), accountCreditMinor: Math.max(0, credit.creditMinor - used), creditText: credit.text };
}

/** The card a plan switch charges (R13-D209): the current subscription's own card first (where Checkout puts it), then the customer's invoice default. null when there is none. */
async function cardOnFile(apiKey, sub) {
  const s = await stripeCall(apiKey, "GET", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, "");
  const fromSub = s.ok ? s.body?.default_payment_method : null;
  if (fromSub) return typeof fromSub === "string" ? fromSub : fromSub.id;
  const c = await stripeCall(apiKey, "GET", `/customers/${encodeURIComponent(sub.stripe_customer_id)}`, "");
  const fromCustomer = c.ok ? (c.body?.invoice_settings?.default_payment_method ?? c.body?.default_source) : null;
  if (!s.ok && !c.ok) throw dependency("Billing is temporarily unavailable — try again shortly");
  return fromCustomer ? (typeof fromCustomer === "string" ? fromCustomer : fromCustomer.id) : null;
}
/** Switch between Pay as you go and Pro (18 Oct 2026; with credit and at-period-end downgrades 21 Oct 2026). `expectedDueMinor` is what the dialog showed: if Stripe's number has moved by more than a few cents since, nothing is done and the new numbers are returned for another look.
 *  Needs an active, paid subscription. → the workspace status as it is after. */
export async function switchPlan(tx, { tenantId, actorUserId = null, toPlanKey, expectedDueMinor = null }) {
  if (!SWITCHABLE.includes(toPlanKey)) throw invalid("Choose Pay as you go or Pro.", { field: "plan" });
  await lockSwitch(tx, tenantId);
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || !SWITCHABLE.includes(sub.plan_key) || sub.status !== "active") throw invalid("There is no active subscription to switch.");
  if (sub.plan_key === toPlanKey) throw invalid(`This workspace is already on ${planName(toPlanKey)}.`);
  if (sub.cancel_at) throw invalid("Resume your plan before switching it.", { code: "switch_needs_resume" });
  if (!sub.stripe_customer_id) throw invalid("There is no billing record to switch.");
  if (toPlanKey === "docustay_payg") return scheduleDowngrade(tx, { tenantId, actorUserId });
  if (docustayPlan("docustay_pro").priceMinor == null) throw invalid("Pro is not priced yet.");
  await releasePendingSchedule(tx, { tenantId, sub, apiKey });   // an upgrade replaces a pending downgrade
  const pv = await previewSwitch(tx, { tenantId, toPlanKey });
  if (expectedDueMinor != null && Math.abs(Number(expectedDueMinor) - pv.dueTodayMinor) > 2) throw invalid("The amount changed while you were looking. Check the new amount and confirm again.", { code: "switch_numbers_changed", preview: pv });
  const attempt = randomUUID();
  const { founders: foundersNow, version } = checkoutPricing(process.env, await pricingMoment(apiKey, sub.stripe_customer_id));
  const meta = { workbench_tenant_id: tenantId, plan_key: toPlanKey, billing_interval: "month", founders_price: toPlanKey === "docustay_pro" && foundersNow ? "true" : "false", seat_count: "1" };
  const items = [[await priceIdFor(apiKey, priceLookupKey("month", version)), "1"], [await priceIdFor(apiKey, "docustay_ai_draft_v1"), null]];
  // 1 · the credit goes on the customer's balance first, so the new plan's first invoice uses it
  let creditTx = null;
  if (pv.creditMinor > 0) {
    const r = await stripeCall(apiKey, "POST", `/customers/${encodeURIComponent(sub.stripe_customer_id)}/balance_transactions`, new URLSearchParams({ amount: String(-pv.creditMinor), currency: pv.currency, description: `Credit for unused ${planName(sub.plan_key)} time`, "metadata[kind]": "switch_credit", "metadata[attempt]": attempt, "metadata[tenant]": tenantId }).toString());
    if (!r.ok) { await giveBackCredit(apiKey, sub.stripe_customer_id, attempt); console.error(`docustay switch: could not put the credit on the balance (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
    creditTx = r.body?.id ?? null;
  }
  // 2 · the new subscription, on the same customer and card; a declined card stops here and gives the credit back.
  //     R13-D209: Checkout saves the card on the SUBSCRIPTION (default_payment_method), not on the customer, so the new one is told which card to use: the old
  //     subscription's, else the customer's default. With no card at all nothing is charged and the person is asked to add one (never a 502).
  const pm = await cardOnFile(apiKey, sub);
  if (!pm) { if (creditTx) await giveBackCredit(apiKey, sub.stripe_customer_id, attempt); throw invalid("There is no card on file for this workspace. Add a card under Billing, then switch again.", { code: "switch_no_card" }); }
  const form = new URLSearchParams({ customer: sub.stripe_customer_id, default_payment_method: pm, payment_behavior: "error_if_incomplete", ...Object.fromEntries(Object.entries(metadataFor("subscription", meta)).map(([k, v]) => [`metadata[${k}]`, v])),
    ...Object.fromEntries(items.flatMap(([price, qty], i) => [[`items[${i}][price]`, price], ...(qty ? [[`items[${i}][quantity]`, qty]] : [])])) });
  const made = await stripeCall(apiKey, "POST", "/subscriptions", form.toString());
  if (!made.ok) {
    if (creditTx) await giveBackCredit(apiKey, sub.stripe_customer_id, attempt);
    console.error(`docustay switch: the new subscription was refused (${made.status}): ${made.body?.error?.message ?? "no detail"}`);
    if (made.status === 402 || made.body?.error?.type === "card_error") throw invalid("The card was declined, so nothing was changed. Update your card and try again.", { code: "switch_card_declined" });
    throw dependency("Billing is temporarily unavailable — try again shortly");
  }
  const created = made.body;
  const end = async (id, mode) => stripeCall(apiKey, "DELETE", `/subscriptions/${encodeURIComponent(id)}?invoice_now=true&prorate=${mode === "credit" ? "true" : "false"}`, "");
  // 3 · the old plan's metered units must be counted by Stripe before its final invoice is cut, or they never get billed
  if (sub.plan_key === "docustay_payg") await settleUsageAtStripe(tx, { tenantId, subscriptionId: sub.stripe_subscription_id, priceIds: [await priceIdFor(apiKey, "docustay_payg_document_v1"), await priceIdFor(apiKey, "docustay_ai_draft_v1")] }).catch((e) => console.error("docustay switch: could not settle usage first:", e?.message ?? e));
  // 4 · the old subscription ends now: its usage is invoiced, and nothing is prorated again (the credit was already given)
  let ended = await end(sub.stripe_subscription_id, "none");
  if (!ended.ok && !stripeMissing(ended)) ended = await end(sub.stripe_subscription_id, "none");
  if (!ended.ok && !stripeMissing(ended)) {
    // the old plan carries on, so the new one is ended with its paid time credited back to the balance: nothing is lost
    await end(created.id, "credit");
    console.error(`docustay switch: could not end the old subscription (${ended.status}); the new one was ended and its payment credited to the balance`);
    throw dependency("Billing is temporarily unavailable — try again shortly");
  }
  if (toPlanKey === "docustay_payg") await ensureEarlyInvoiceThreshold({ subscription: created, apiKey }).catch(() => false);
  await record(tx, { tenantId, kind: "plan_switched", actorUserId, subscriptionId: created.id, detail: { from: sub.plan_key, to: toPlanKey, old: sub.stripe_subscription_id, creditMinor: pv.creditMinor, firstChargeMinor: pv.firstChargeMinor, dueTodayMinor: pv.dueTodayMinor } });
  if (pv.creditMinor > 0) await record(tx, { tenantId, kind: "switch_credit", actorUserId, subscriptionId: created.id, detail: { creditMinor: pv.creditMinor, currency: pv.currency, balanceTransaction: creditTx, from: sub.plan_key, to: toPlanKey } });
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: created, why: "switch" });
  return workspaceStatus(tx, { tenantId });
}
/** A failed attempt's credit comes back off the balance: whatever balance transaction this attempt made (found by its attempt id, so a lost answer is still reversed) is cancelled out with an equal opposite one. Never throws. */
async function giveBackCredit(apiKey, customerId, attempt) {
  try {
    const l = await stripeCall(apiKey, "GET", `/customers/${encodeURIComponent(customerId)}/balance_transactions`, new URLSearchParams({ limit: "10" }).toString());
    const mine = (l.body?.data ?? []).find((b) => b.metadata?.attempt === attempt && b.metadata?.kind === "switch_credit");
    if (mine) await stripeCall(apiKey, "POST", `/customers/${encodeURIComponent(customerId)}/balance_transactions`, new URLSearchParams({ amount: String(-Number(mine.amount)), currency: mine.currency, description: "Credit taken back: the switch did not go through", "metadata[kind]": "switch_credit_reversed", "metadata[attempt]": attempt }).toString());
  } catch (e) { console.error("docustay switch: could not take the credit back:", e?.message ?? e); }
}

// ── the downgrade: Pro to Pay as you go at the end of the paid period ────────────────────────────────────────────────────────
/** The subscription schedule (if any) that is waiting to switch this workspace's plan. Reads Stripe. */
async function scheduleOf(apiKey, sub) {
  const s = stripeOk(await stripeCall(apiKey, "GET", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, ""), "subscription");
  return { subscription: s, scheduleId: typeof s.schedule === "string" ? s.schedule : s.schedule?.id ?? null };
}
async function releasePendingSchedule(tx, { tenantId, sub, apiKey }) {
  const { scheduleId } = await scheduleOf(apiKey, sub);
  if (!scheduleId) return false;
  const r = await stripeCall(apiKey, "POST", `/subscription_schedules/${encodeURIComponent(scheduleId)}/release`, "");
  if (!r.ok && !stripeMissing(r)) throw dependency("Billing is temporarily unavailable — try again shortly");
  await record(tx, { tenantId, kind: "downgrade_cancelled", subscriptionId: sub.stripe_subscription_id, detail: { schedule: scheduleId, why: "replaced" } });
  return true;
}
/** Pro to Pay as you go when the paid period ends. The person keeps Pro until then; nothing is charged or credited now. */
export async function scheduleDowngrade(tx, { tenantId, actorUserId = null }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || sub.plan_key !== "docustay_pro" || sub.status !== "active") throw invalid("Only Pro can switch to Pay as you go at the end of its period.");
  if (sub.cancel_at) throw invalid("Your plan ends at the end of this period already. Resume it first if you want to switch it.", { code: "switch_needs_resume" });
  const { subscription: cur, scheduleId: existing } = await scheduleOf(apiKey, sub);
  if (existing) return workspaceStatus(tx, { tenantId });   // already waiting: saying it twice changes nothing
  const periodEnd = cur.items?.data?.[0]?.current_period_end ?? cur.current_period_end;
  if (!periodEnd) throw dependency("Billing is temporarily unavailable — try again shortly");
  const seats = Math.max(1, (await teamSeatUsage(tx)).staff);
  const sched = stripeOk(await stripeCall(apiKey, "POST", "/subscription_schedules", new URLSearchParams({ from_subscription: sub.stripe_subscription_id }).toString()), "downgrade (schedule)");
  const ph0 = sched.phases?.[0];
  const keep = Object.entries(cur.metadata ?? {});
  const paygMeta = { ...metadataFor("subscription", { workbench_tenant_id: tenantId, plan_key: "docustay_payg", billing_interval: "month", founders_price: "false", seat_count: String(seats) }) };
  const f = new URLSearchParams({ end_behavior: "release", proration_behavior: "none", "phases[0][start_date]": String(ph0.start_date), "phases[0][end_date]": String(periodEnd) });
  (ph0.items ?? []).forEach((it, k) => { f.set(`phases[0][items][${k}][price]`, typeof it.price === "string" ? it.price : it.price.id); if (it.quantity != null) f.set(`phases[0][items][${k}][quantity]`, String(it.quantity)); });
  for (const [k, v] of keep) f.set(`phases[0][metadata][${k}]`, String(v));   // the schedule would replace the subscription's metadata with the phase's, so each phase carries the whole set
  f.set("phases[1][items][0][price]", await priceIdFor(apiKey, "docustay_payg_person_monthly_v1")); f.set("phases[1][items][0][quantity]", String(seats));
  f.set("phases[1][items][1][price]", await priceIdFor(apiKey, "docustay_payg_document_v1")); f.set("phases[1][items][2][price]", await priceIdFor(apiKey, "docustay_ai_draft_v1"));
  for (const [k, v] of Object.entries(paygMeta)) f.set(`phases[1][metadata][${k}]`, String(v));
  f.set("phases[1][billing_thresholds][amount_gte]", String(PRICES.budget.earlyInvoiceMinor)); f.set("phases[1][billing_thresholds][reset_billing_cycle_anchor]", "false");
  const upd = await stripeCall(apiKey, "POST", `/subscription_schedules/${encodeURIComponent(sched.id)}`, f.toString());
  if (!upd.ok) { await stripeCall(apiKey, "POST", `/subscription_schedules/${encodeURIComponent(sched.id)}/release`, "").catch(() => {}); console.error(`docustay downgrade: Stripe refused the schedule (${upd.status}): ${upd.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  await record(tx, { tenantId, kind: "downgrade_scheduled", actorUserId, subscriptionId: sub.stripe_subscription_id, detail: { schedule: sched.id, to: "docustay_payg", at: new Date(periodEnd * 1000).toISOString(), foundersLost: Boolean(sub.founders_price) } });
  return workspaceStatus(tx, { tenantId });
}
/** Changed their mind: the pending switch is cancelled and Pro carries on exactly as it was. */
export async function cancelPendingDowngrade(tx, { tenantId, actorUserId = null }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || sub.plan_key !== "docustay_pro") throw invalid("There is no pending switch to cancel.");
  const { scheduleId } = await scheduleOf(apiKey, sub);
  if (!scheduleId) throw invalid("There is no pending switch to cancel.");
  const r = await stripeCall(apiKey, "POST", `/subscription_schedules/${encodeURIComponent(scheduleId)}/release`, "");
  if (!r.ok && !stripeMissing(r)) throw dependency("Billing is temporarily unavailable — try again shortly");
  await record(tx, { tenantId, kind: "downgrade_cancelled", actorUserId, subscriptionId: sub.stripe_subscription_id, detail: { schedule: scheduleId } });
  return workspaceStatus(tx, { tenantId });
}
/** The switch waiting for the end of the period, from the billing record: { to, at } or null. The facts are written by the two functions above; a switch that has happened (the plan is no longer Pro) or a date that has passed is not pending. */
export async function pendingSwitch(tx, { tenantId, now = new Date() }) {
  const { rows: [r] } = await tx.query(`SELECT kind, detail FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND kind IN ('downgrade_scheduled', 'downgrade_cancelled', 'plan_switched', 'cancel_confirmed') ORDER BY at DESC, id DESC LIMIT 1`, [tenantId]);
  if (r?.kind !== "downgrade_scheduled" || !r.detail?.at || Date.parse(r.detail.at) <= now.getTime()) return null;
  return { to: r.detail.to ?? "docustay_payg", at: r.detail.at, foundersLost: Boolean(r.detail.foundersLost) };
}

/** Lifetime bought from a running subscription: once the payment is confirmed, the old subscription is ended with its usage invoiced and nothing prorated (the credit was the coupon). Safe to repeat. */
export async function endSubscriptionForLifetime(tx, { tenantId, subscriptionId, fromPlanKey }) {
  if (!subscriptionId) return { ended: false };
  const apiKey = proKey();
  if (fromPlanKey === "docustay_payg") await settleUsageAtStripe(tx, { tenantId, subscriptionId, priceIds: [await priceIdFor(apiKey, "docustay_payg_document_v1"), await priceIdFor(apiKey, "docustay_ai_draft_v1")] }).catch((e) => console.error("docustay lifetime: could not settle usage first:", e?.message ?? e));
  let r = await stripeCall(apiKey, "DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}?invoice_now=true&prorate=false`, "");
  if (!r.ok && !stripeMissing(r)) r = await stripeCall(apiKey, "DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}?invoice_now=true&prorate=false`, "");
  if (!r.ok && !stripeMissing(r)) { console.error(`docustay lifetime: could not end subscription ${subscriptionId} (${r.status}); it must be ended by hand`); return { ended: false, failed: true }; }
  await record(tx, { tenantId, kind: "plan_switched", subscriptionId, detail: { from: fromPlanKey, to: "docustay_lifetime", old: subscriptionId } });
  return { ended: true };
}
// ── deleting a workspace ends its plan at once (21 Oct 2026, the maintainer) ───────────────────────────────────────────────────────────
const DELETION_PAID_STATES = ["active", "trialing", "past_due", "unpaid"];
/** What the owner stands to lose if the workspace is deleted, in numbers the screen can say plainly. kind: "none" (Free: nothing to lose) | "subscription" (Pay as you go or Pro: the days left in the period already paid for, an exact number
 *  from the billing period; a plan that is cancelled but still running counts too) | "lifetime" (the one-time purchase). Nothing is changed here. */
export async function planLossNotice(tx, { tenantId, now = new Date() }) {
  const sub = await subRow(tx, tenantId);
  if (!sub) return { kind: "none" };
  if (sub.plan_key === "docustay_lifetime") return { kind: "lifetime", planKey: sub.plan_key, planName: "Lifetime" };
  if (["docustay_pro", "docustay_payg"].includes(sub.plan_key) && sub.stripe_subscription_id && DELETION_PAID_STATES.includes(String(sub.status))) {
    const end = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const paid = ["active", "trialing"].includes(String(sub.status)) && end && end > now;   // a payment that failed paid for nothing
    return { kind: "subscription", planKey: sub.plan_key, planName: sub.plan_key === "docustay_pro" ? "Pro" : "Pay as you go", daysLeft: paid ? Math.ceil((end - now) / 86_400_000) : 0, periodEnd: end ? end.toISOString() : null, cancelling: Boolean(sub.cancel_at) };
  }
  return { kind: "none" };
}
/** The plan ends NOW, because the owner chose to delete the workspace and confirmed it: the Stripe subscription is ended at once with no proration and no refund (Docustay gives none); what the period's metered usage had built up is invoiced
 *  now, exactly like a plan switch. A Lifetime workspace goes back to Free (the one-time purchase is not refunded). The workspace row ends on Free, which is what "Keep this workspace" gives back. Throws when Stripe cannot end it: nothing is scheduled. */
export async function endPlanForDeletion(tx, { tenantId, actorUserId = null }) {
  const notice = await planLossNotice(tx, { tenantId });
  if (notice.kind === "none") return { ended: false, ...notice };
  const sub = await subRow(tx, tenantId);
  if (sub.stripe_subscription_id) {
    const apiKey = proKey();
    const end = async (id) => stripeCall(apiKey, "DELETE", `/subscriptions/${encodeURIComponent(id)}?invoice_now=true&prorate=false`, "");
    if (sub.plan_key === "docustay_payg") await settleUsageAtStripe(tx, { tenantId, subscriptionId: sub.stripe_subscription_id, priceIds: [await priceIdFor(apiKey, "docustay_payg_document_v1"), await priceIdFor(apiKey, "docustay_ai_draft_v1")] }).catch((e) => console.error("docustay delete: could not settle usage first:", e?.message ?? e));
    let r = await end(sub.stripe_subscription_id);
    if (!r.ok && !stripeMissing(r)) r = await end(sub.stripe_subscription_id);
    if (!r.ok && !stripeMissing(r)) throw dependency("Your plan could not be cancelled just now, so nothing was scheduled. Try again in a moment.");
    if (r.ok && r.body?.id) { const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs"); await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: { ...r.body, status: "canceled" }, why: "workspace_deletion" }); }
  }
  const { rows: [row] } = await tx.query(`UPDATE keystone.workbench_subscription SET plan_key = 'docustay_free', status = 'active', stripe_subscription_id = NULL, cancel_at = NULL, past_due_since = NULL, founders_price = false, current_period_end = NULL WHERE tenant_id = $1 RETURNING id`, [tenantId]);
  if (row) await emit(tx, { tenantId, emittedBy: "settings", topic: "settings.subscription.updated", subjectType: "workbench_subscription", subjectId: row.id, actor: "system", payload: { planKey: "docustay_free", plan_key: "docustay_free", status: "active", change: "ended_for_deletion", from: notice.planKey, days_lost: notice.daysLeft ?? null } });
  return { ended: true, ...notice };
}
/** B5 · changed their mind before the end date: Pro carries on as it was (the founders price too — the subscription never ended). */
export async function resumePro(tx, { tenantId, actorUserId = null }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || !["docustay_pro", "docustay_payg"].includes(sub.plan_key) || sub.status === "canceled") throw invalid("Your plan has already ended. Upgrade again to start a new subscription.");
  const s = stripeOk(await stripeCall(apiKey, "POST", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, new URLSearchParams({ cancel_at_period_end: "false" }).toString()), "resume");
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await record(tx, { tenantId, kind: "resumed", actorUserId, subscriptionId: sub.stripe_subscription_id });
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: s, why: "resume" });
  return workspaceStatus(tx, { tenantId });
}
