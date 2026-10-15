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
import { renderInvoicePdf, invoiceNumber } from "../billing/invoicePdf.mjs";
import { callOutside } from "../http/outside.mjs";
import { stripeSecretFor } from "./stripeFor.mjs";   // Docustay's own Stripe account (falls back to the shared KEYSTONE_STRIPE_* until it has one)
import { createStripeCustomer } from "../provisioning/steps/stripeCustomer.mjs";
import { flagIsOn } from "../platform/flags.mjs";
import { metadataFor } from "../money/metadata.mjs";
import { sendCountForPeriod, ensureDefaultDocumentType, anyInstanceEverSent, templateCreationsInPeriod } from "../documents/api.mjs";
import { aiUsageView, readAiConfig, detectUpload } from "../documents/frontDoor.mjs";
import * as mail from "../mail/index.mjs";
import { enrol } from "./lifecycle.mjs";
import { teamSeatUsage } from "../people/seats.mjs";
import { emit } from "../events/outbox.mjs";
import { seatSettings } from "./docustayPlans.mjs";
import { aiPolicyFor, aiWindow, aiPlatformCeilingUsd, docustayPlans, docustayPlan, effectivePlan, isDocustayPlanKey, entitled, inGrace, PRO_ITEMS, AI_PRO_ITEMS, RUN9_PRO_ITEMS, priceLookupKey, checkoutPricing, annualEnabled, foundersOpen, foundersUntil } from "./docustayPlans.mjs";

/** The UTC calendar month every Free counter uses (documents, templates; the Free AI allowance resets on the same day). */
const monthWindow = (now = new Date()) => ({ start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
const subRow = async (tx, tenantId) => (await tx.query(`SELECT plan_key, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at, past_due_since, founders_price, billing_interval, updated_at FROM keystone.workbench_subscription WHERE tenant_id = $1`, [tenantId])).rows[0] ?? null;

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
  await tx.query(
    `INSERT INTO keystone.workbench_subscription (tenant_id, plan_key, status, seat_count) VALUES ($1, 'docustay_free', 'active', 1) ON CONFLICT (tenant_id) DO NOTHING`, [tenantId]);
  // Launch step 3: the owner's welcome series starts here. The first email (the welcome) is sent by the worker's global tick a minute later (the web process cannot reach the queue): see pendingWelcomeTenants.
  if (actorUserId) await enrol(tx, { tenantId, userId: actorUserId, lang });
  if (actorUserId) await trackOnce(tx, tenantId, "signup_completed").catch(() => {});   // Launch step 6: a real owner (a demo has none)
  return workspaceStatus(tx, { tenantId });
}

export async function workspaceStatus(tx, { tenantId }) {
  const sub = await subRow(tx, tenantId);
  const plan = effectivePlan(sub);
  const { rows: t } = await tx.query(`SELECT shape, product FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const { start, end } = monthWindow();
  const docs = plan ? await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end }) : null;
  const lim = plan ? await mail.limitState(tx, { tenantId }) : null;
  const pro = docustayPlan("docustay_pro");
  const priced = pro.priceMinor != null;
  const ended = plan && !plan.paid && sub?.plan_key === "docustay_pro" && sub?.stripe_subscription_id ? (sub.status === "canceled" ? "cancelled" : sub.status === "past_due" ? "payment" : null) : null;
  const seatsOn = seatSettings().on && Boolean(plan);   // not shown, not even as a field value, while the seat settings are OFF
  const seatUse = seatsOn ? await teamSeatUsage(tx) : null;
  const fo = foundersOpen() && pro.foundersPriceMinor != null, yearly = annualEnabled();
  const shownMonthly = fo ? pro.foundersPriceMinor : pro.priceMinor, shownYearly = !yearly ? null : (fo && pro.foundersYearlyPriceMinor != null ? pro.foundersYearlyPriceMinor : pro.yearlyPriceMinor);
  return {
    demo: await (await import("./demo.mjs")).demoView(tx),   // the public demo's banner facts (null for a real workspace)
    workspace: t[0]?.shape === "documents", shape: t[0]?.shape ?? null, product: t[0]?.product ?? "workbench",
    // `ended` says why a paid subscription row no longer gives Pro: "cancelled" (the subscription was ended) or "payment" (a payment failed and the grace is over). It carries no date and no number of days, by rule.
    plan: plan ? { key: plan.key, name: plan.name, status: sub.status, renewsAt: ended ? null : (sub.current_period_end ?? null), cancelsAt: ended ? null : (sub.cancel_at ?? null), interval: sub.billing_interval ?? null, founders: Boolean(sub.founders_price), ended } : null,
    // the customer's notice when a payment failed — a flag and nothing else (no date, no number of days, by rule)
    paymentProblem: Boolean(plan?.paid && inGrace(sub)),
    entitlements: plan ? Object.fromEntries([...PRO_ITEMS, ...AI_PRO_ITEMS, ...RUN9_PRO_ITEMS].map((k) => [k, entitled(plan, k)])) : null,
    usage: plan ? { documentsThisMonth: docs, documentsLimit: plan.docsPerMonth, emailsToday: lim?.sent ?? 0, emailsLimit: lim?.limit ?? plan.emailsPerDay, templatesThisMonth: await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end }), templatesLimit: plan.templatesPerMonth ?? null, resetsAt: end.toISOString() } : null,
    seats: seatsOn ? { used: seatUse.staff, included: seatUse.limit, extraSeatPriceMinor: seatUse.extraSeatPriceMinor } : null,
    billing: { canManage: Boolean(sub?.stripe_customer_id), canUpgrade: Boolean(plan && !plan.paid && priced && ended !== "payment") },
    upgrade: { available: Boolean(plan && !plan.paid && priced && ended !== "payment"), plan: priced ? { key: pro.key, name: pro.name, priceMinor: shownMonthly, listPriceMinor: pro.priceMinor, founders: fo, foundersUntil: fo ? foundersUntil().toISOString() : null, yearlyPriceMinor: shownYearly, listYearlyPriceMinor: yearly ? (pro.yearlyPriceMinor ?? null) : null, currency: pro.currency, interval: "month" } : null },
    plans: docustayPlans().map((p) => ({ key: p.key, name: p.name, priceMinor: p.priceMinor, yearlyPriceMinor: yearly ? (p.yearlyPriceMinor ?? null) : null, docsPerMonth: p.docsPerMonth, emailsPerDay: p.emailsPerDay, templatesPerMonth: p.templatesPerMonth ?? null })),
  };
}

/** The plan this workspace is really on right now (grace and lapse applied) — null when it is not a Docustay workspace. */
/** The AI policy this workspace's plan carries, with the window its allowance is counted over (the entitlements port's `aiPolicy`). null for a workspace on no Docustay plan. */
export async function aiPolicy(tx, { tenantId, now = new Date() }) {
  const sub = await subRow(tx, tenantId); const plan = effectivePlan(sub, process.env, now);
  const pol = plan ? aiPolicyFor(plan.key) : null;
  return pol ? { ...pol, planKey: plan.key, platformMonthlyUsd: aiPlatformCeilingUsd(), window: aiWindow(plan.key, sub?.current_period_end, now) } : null;
}
export async function currentPlan(tx, { tenantId }) { return effectivePlan(await subRow(tx, tenantId)); }

/**
 * ★ THE ONE GATE for the six Pro items. A workspace not on a Docustay plan (a the platform organisation) is never limited by it. Refuses in plain words that do not name any other product.
 * @param {string} item one of PRO_ITEMS
 */
/** A self-hosted install with no Pro add-on (or whose Pro note has ended) is the Community build: the Pro items are off. Volume stays unlimited there ("no plans, no limits"). */
export const communityRefuses = (item) => process.env.KEYSTONE_SELF_HOST === "1" && item !== "unlimited_documents" && !addonInstalled();
export async function assertEntitled(tx, { tenantId, item }) {
  const plan = effectivePlan(await subRow(tx, tenantId));
  const refuse = (planKey) => forbidden(PRO_REFUSALS[item] ?? "This is part of Docustay Pro.", { code: "plan_pro_required", item, plan: planKey, upgrade: "pro" });   // the wire says which item and what to upgrade to (a stable code for SDKs, the CLI and MCP)
  if (!plan) { if (communityRefuses(item)) throw refuse("community"); return; }
  if (!entitled(plan, item)) throw refuse(plan.key);
}
const PRO_REFUSALS = Object.freeze({
  auto_reminders: "Automatic reminders are part of Docustay Pro. You can still send a reminder yourself at any time.",
  bulk_send: "Sending to a list is part of Docustay Pro.",
  team_roles: "Adding people and roles is part of Docustay Pro. This workspace has one user, the owner.",
  hide_footer: "Removing the Docustay footer is part of Docustay Pro.",
  own_signing_domain: "Signing links on your own address are part of Docustay Pro.",
  playbooks: "Automations (what runs on its own when a document is signed) are part of Docustay Pro.",
  signing_groups: "Signing groups (several people sharing one seat, the first to sign fills it) are part of Docustay Pro. Put one person in the seat to send it on Free.",
  renewal_reminders: "Reminders before a contract's renewal notice date are part of Docustay Pro. The dates still show on the contract and the person.",
  scribe_actions: "Asking Scribe to do things for you is part of Docustay Pro. Scribe still answers questions on Free.",
  unlimited_documents: "More documents is part of Docustay Pro.",
  custom_plays: "Making your own plays and playbooks is part of Docustay Pro. The built-in plays are free to use.",
  ai_bulk: "Sending to a list from the chat is part of Docustay Pro.",
  plays_api: "The plays and drafts API is part of Docustay Pro.",
  recurring_payments: "Installments and subscriptions are part of Docustay Pro. A one-time payment, a deposit and an amount the signer chooses are open on every plan.",
});

/** The name on Stripe's payment page (Run 9 launch, F1045): per Checkout Session, never the Stripe account itself. */
export const CHECKOUT_BRAND = "Docustay";
/** Shown on Stripe's payment page above the pay button (D-080). It replaces Stripe's default "reuse of your card" paragraph (hidden on the same session) with one line that names who is charging, what for, and how to stop. */
export const CHECKOUT_NOTE = "You are subscribing to Docustay (docustay.app). By subscribing you authorise Docustay to charge this card each billing period until you cancel. You can cancel at any time in Billing inside Docustay. Docustay does not give refunds: after you cancel, Pro stays on until the end of the period you have paid for.";
/** Stripe Checkout fields every Docustay session sets: the name, the replacement line, and the default reuse paragraph hidden so the one line above is the only authorisation text. */
const checkoutBranding = () => ({ "custom_text[submit][message]": CHECKOUT_NOTE, "branding_settings[display_name]": CHECKOUT_BRAND, "consent_collection[payment_method_reuse_agreement][position]": "hidden" });

/** Read-only: this month's sends against the plan's limit, for the Check step (Run 8 R8-64). No lock, no notices. null when the plan has no monthly limit. */
export async function sendAllowance(tx, { tenantId }) {
  const plan = effectivePlan(await subRow(tx, tenantId));
  if (!plan || plan.docsPerMonth == null) return null;
  const { start, end } = monthWindow();
  return { used: await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end }), limit: plan.docsPerMonth, plan: plan.name, paid: Boolean(plan.paid), resetsAt: end.toISOString() };
}

/** The island's entitlements port. Organisations that are not on a Docustay plan are never limited by it. */
export async function assertMaySend(tx, { tenantId, needsEmail = true }) {
  // a self-hosted install cannot invite a signer until email works (nothing would be delivered): say so instead of sending into the void.
  // D-051: only when an email would actually go out — a send where everyone signs on this device needs none.
  if (needsEmail && process.env.KEYSTONE_SELF_HOST === "1" && (await mail.mailStatus(tx, { tenantId })).state === "not_configured") {
    throw invalid("Email isn't set up yet, so signers cannot be invited. Open Settings → Email, connect your email, send yourself a test, then try again.");
  }
  const plan = effectivePlan(await subRow(tx, tenantId));
  if (!plan || plan.docsPerMonth == null) return;
  // Run 8 verify: a per-workspace transaction lock makes check → send (or first publication) one step, so two sends at 14 of 15 cannot both pass; held until the caller's transaction ends.
  // Only plans with a monthly limit take it (Pro returned above).
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('docustay.document_cap:' || $1::text, 0))`, [tenantId]);
  const { start, end } = monthWindow();
  const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
  if (used >= plan.docsPerMonth) {
    throw forbidden(`Your ${plan.name} plan allows ${plan.docsPerMonth} documents a month and you have sent ${used}. ${plan.paid ? "The count resets next month." : "Upgrade to Pro to send more."}`, { code: "plan_document_limit", used, limit: plan.docsPerMonth, resetsAt: end.toISOString() });
  }
  await usageAlerts(tx, { tenantId, plan, used: used + 1, start, end });   // this send is the one that brings the count to used + 1
}

/** A form response counts once it is SIGNED: run the same 80% / 100% check when a response is signed (once per period, as for a send). Never throws into the signing path.
 *  (Run 8: the form's FIRST publication also counts once — that is checked and noticed by assertMaySend inside publishForm.) */
export async function noteUsageAfterResponse(tx, { tenantId }, deps = {}) {
  try {
    const plan = effectivePlan(await subRow(tx, tenantId));
    if (!plan || plan.docsPerMonth == null || plan.paid) return [];
    const { start, end } = monthWindow();
    const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
    return await usageAlerts(tx, { tenantId, plan, used, start, end }, deps);
  } catch (e) { console.error(`usage check after a form response failed: ${e?.message ?? e}`); return []; }
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

/** What GET /api/v1/usage answers: the same numbers the Billing page shows, for a key with documents:read. */
export async function apiUsage(tx, { tenantId }) {
  const sub = await subRow(tx, tenantId);
  const plan = effectivePlan(sub);
  if (!plan) return { plan: null, period: null, documents: null, emails: null };
  const { start, end } = monthWindow();
  const used = await sendCountForPeriod(tx, { tenantId, periodStart: start, periodEnd: end });
  const lim = await mail.limitState(tx, { tenantId });
  const now = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const templates = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end });
  return { plan: plan.key.replace(/^docustay_/, ""), period: { start: start.toISOString(), end: end.toISOString() }, documents: { used, limit: plan.docsPerMonth }, templates: { used: templates, limit: plan.templatesPerMonth ?? null, resetsAt: end.toISOString() }, emails: { usedToday: lim.sent, limitPerDay: lim.limit, resetsAt: resetsAt.toISOString() } };
}

// ── THE FREE PLAN'S MONTHLY TEMPLATE CAP (Run 8, the maintainer 11 Oct 2026; specs/proofs/stage-t/run8/TEMPLATE-CAP.md) ──
const resetsOnText = (end) => new Date(end.getTime()).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
/** ★ THE ONE CHECK for a new template, reached through the island's entitlements port by the only three functions that make one. A workspace on no Docustay plan (self-hosted, the platform)
 *  and Pro (no cap) return at once. A per-workspace transaction lock makes check → insert → ledger one step, so two templates made at the same moment at 4 of 5 cannot both pass. */
export async function assertMayCreateTemplate(tx, { tenantId, now = new Date() }) {
  const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
  if (!plan || plan.templatesPerMonth == null) return;
  await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('docustay.template_cap:' || $1::text, 0))`, [tenantId]);
  const { start, end } = monthWindow(now);
  const used = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end });
  if (used >= plan.templatesPerMonth) {
    throw forbidden(`Your Free plan includes ${plan.templatesPerMonth} new templates a month and you have made ${used}. You can still use and edit every template you have. New templates open again on ${resetsOnText(end)}, or upgrade to Pro for unlimited templates.`,
      { code: "plan_template_limit", used, limit: plan.templatesPerMonth, resetsAt: end.toISOString() });
  }
}
/** After a new template is made: the owner's notices at 4 of 5 and at 5 of 5, each once a month (the same event as the documents notices, kind "templates"). Never throws into the create. */
export async function noteTemplateCreated(tx, { tenantId, now = new Date() }, { emitEvent = emit } = {}) {
  // a notice must never undo the template it is about: it runs in its own savepoint, so a failed query here is rolled back alone instead of aborting the caller's transaction (Run 8 verify)
  const sp = typeof tx.query === "function" ? await tx.query("SAVEPOINT ds_template_notice").then(() => true, () => false) : false;
  try {
    const plan = effectivePlan(await subRow(tx, tenantId), process.env, now);
    if (!plan || plan.templatesPerMonth == null) return [];
    const { start, end } = monthWindow(now);
    const used = await templateCreationsInPeriod(tx, { periodStart: start, periodEnd: end });
    const done = [];
    for (const [at, pct] of [[plan.templatesPerMonth - 1, 80], [plan.templatesPerMonth, 100]]) {
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
export async function planEmailLimit(tx, { tenantId }) { return effectivePlan(await subRow(tx, tenantId))?.emailsPerDay ?? null; }

const stripeCall = async (apiKey, method, path, params) => {
  const r = await callOutside("stripe", `https://api.stripe.com/v1${path}${method === "GET" && params ? `?${params}` : ""}`, { method, headers: { Authorization: `Bearer ${apiKey}`, ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, ...(method === "POST" ? { body: params } : {}) }, { timeoutMs: 20_000 });
  return r;
};
/** Where the customer lands after Stripe: the Docustay app (KEYSTONE_DOCUSTAY_APP_URL) — never a the platform address. Falls back to the workspace's own address until that is set. */
const returnBase = (slug) => (process.env.KEYSTONE_DOCUSTAY_APP_URL ? process.env.KEYSTONE_DOCUSTAY_APP_URL.replace(/\/+$/, "") : `https://${slug ?? "app"}.${process.env.KEYSTONE_APP_DOMAIN || "example.com"}`);

/** The Stripe price id for a lookup key (the price is made once, by scripts/stripe/docustay-catalogue.mjs; checkout never builds one inline). */
async function priceIdFor(apiKey, lookupKey) {
  const r = await stripeCall(apiKey, "GET", "/prices", new URLSearchParams({ "lookup_keys[]": lookupKey, active: "true" }).toString());
  const id = r.ok ? r.body?.data?.[0]?.id : null;
  if (!id) { console.error(`docustay checkout: no active Stripe price with lookup key ${lookupKey}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return id;
}

export async function startCheckout(tx, { tenantId, actorUserId = null, email = null, interval = "month" }) {
  if (!["month", "year"].includes(interval)) throw invalid("Choose monthly or yearly billing.", { field: "interval" });
  if (interval === "year" && !annualEnabled()) throw invalid("Yearly billing is not available. Choose monthly.", { field: "interval" });
  const plan = docustayPlan("docustay_pro");
  if (plan.priceMinor == null) throw invalid("Pro is not priced yet — nothing can be bought until it is.");
  if (!(await flagIsOn(tx, "stripe_enabled", tenantId))) throw invalid("stripe_enabled is off for this organisation — a platform operator turned it off.");
  const apiKey = stripeSecretFor("docustay");
  if (!apiKey) throw dependency("Billing is temporarily unavailable — try again shortly");
  const sub = await subRow(tx, tenantId);
  if (!sub || !isDocustayPlanKey(sub.plan_key)) throw invalid("this organisation is not a Docustay workspace");
  if (sub.plan_key === "docustay_pro" && ["active", "trialing", "past_due"].includes(sub.status) && sub.stripe_subscription_id) throw invalid("This workspace is already on Pro. Use Manage billing to change it.");
  const { rows: t } = await tx.query(`SELECT name, slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const origin = returnBase(t[0]?.slug);
  if (!email && actorUserId) email = (await tx.query(`SELECT email FROM keystone.app_user WHERE id = $1`, [actorUserId])).rows[0]?.email ?? null;
  if (!email) throw invalid("We need an email address on the account to start a subscription.");
  let customerId = sub.stripe_customer_id;
  if (!customerId) {
    const made = await createStripeCustomer({ tenantId, email, name: t[0]?.name }, { apiKey });
    if (!made.externalId) { console.error(`docustay checkout: no Stripe customer (${made.outcome}): ${made.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
    customerId = made.externalId;
    await tx.query(`UPDATE keystone.workbench_subscription SET stripe_customer_id = $2 WHERE tenant_id = $1`, [tenantId, customerId]);
  }
  // ★ the webhook finds this workspace from the Stripe customer id (invoice and payment events carry no workspace of their own)
  const { rows: known } = await tx.query(`SELECT 1 FROM keystone.list_webhook_sources() WHERE provider = 'stripe' AND external_id = $1 AND retired_at IS NULL`, [customerId]);
  if (known.length === 0) await tx.query(`SELECT keystone.create_webhook_source('stripe', $1)`, [customerId]);
  // the price is chosen when checkout STARTS: founders version up to the cut-off, the current list version after it; the stamp on the subscription (below) is what the webhook reads, so paying a minute after midnight does not change what was promised
  const { founders: foundersNow, version } = checkoutPricing();
  const priceId = await priceIdFor(apiKey, priceLookupKey(interval, version));
  const params = new URLSearchParams({
    customer: customerId, mode: "subscription", expires_at: String(Math.floor(Date.now() / 1000) + 3600),   // the price is the one chosen now; an unfinished session lapses within the hour
    success_url: `${origin}/billing?upgrade=success&session={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/billing?upgrade=cancelled`,   // B2: the return carries the session id; the page asks the server to re-read it
    "line_items[0][quantity]": "1", "line_items[0][price]": priceId,
    ...cardOnly(),   // a subscription is card only (wallets ride on card): the new account's API refuses payment_method_types, so the choice is a payment-method CONFIGURATION on the account (env KEYSTONE_DOCUSTAY_PM_CONFIG), not a parameter
    "managed_payments[enabled]": "false",   // 14 Oct 2026: the new Docustay account has Stripe Managed Payments ON by default, which refuses our consent_collection; Docustay is its own seller
    ...checkoutBranding(),   // D-080 + F1045: the name, the one authorisation line, the default reuse paragraph hidden (Stripe's own small print and the card statement still show the account — only the dashboard changes that; see TY-ONLY.md)
    ...Object.fromEntries(Object.entries(metadataFor("subscription", { workbench_tenant_id: tenantId, plan_key: plan.key, seat_count: "1", billing_interval: interval, founders_price: foundersNow ? "true" : "false" })).flatMap(([k, v]) => [[`subscription_data[metadata][${k}]`, v], [`metadata[${k}]`, v]])),
  });
  const r = await stripeCall(apiKey, "POST", "/checkout/sessions", params);
  if (!r.ok || !r.body?.url) { console.error(`docustay checkout: Stripe refused the session (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return { url: r.body.url };
}

/** A founder's portal offers only founders prices and everyone else's only list prices — one shared portal would let a list customer pick the founders price. */
const portalConfigFor = (founders, env = process.env) => (founders ? env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG_FOUNDERS || env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG : env.KEYSTONE_DOCUSTAY_PORTAL_CONFIG) || null;
/** Stripe's customer portal for this workspace: change card, see invoices, switch monthly/yearly, cancel. Returns where to send the browser. */
export async function startPortal(tx, { tenantId }) {
  const apiKey = stripeSecretFor("docustay");
  if (!apiKey) throw dependency("Billing is temporarily unavailable — try again shortly");
  const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_customer_id) throw invalid("There is no billing to manage yet — this workspace has not subscribed.");
  const { rows: t } = await tx.query(`SELECT slug FROM keystone.tenant WHERE id = $1`, [tenantId]);
  const params = new URLSearchParams({ customer: sub.stripe_customer_id, return_url: `${returnBase(t[0]?.slug)}/billing`, ...(portalConfigFor(sub.founders_price) ? { configuration: portalConfigFor(sub.founders_price) } : {}) });
  const r = await stripeCall(apiKey, "POST", "/billing_portal/sessions", params);
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
    ...checkoutBranding(),   // D-080 + F1045
    ...Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => [[`subscription_data[metadata][${k}]`, v], [`metadata[${k}]`, v]])),
  });
  const r = await stripeCall(apiKey, "POST", "/checkout/sessions", params);
  if (!r.ok || !r.body?.url) { console.error(`docustay self-host checkout: Stripe refused the session (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); }
  return { url: r.body.url };
}
// Run 10 R10-3 / R10-29: Stripe's newer API versions reject `payment_method_types` outright (the first attempt at card-only broke every Docustay checkout). A card-only payment-method configuration (created once through the API, id kept in the environment) does the same job.
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
  return { mode: v.mode, plan: v.plan, allowance: v.allowance, used: v.used, remaining: v.remaining, percent: v.percent, state: v.state, resetsAt: v.resetsAt, byFeature: v.byFeature, thinkHarder: v.thinkHarder, paused: v.paused };
}

/** POST /api/v1/documents/detect-fields: find the fields on a file; nothing is stored. */
export async function apiDetectFields(db, { bytes, fileName, minConfidence, ocr }) {
  void db;   // nothing is read or stored: the file goes in, the fields come out (the AI look is the editor's, on a draft)
  return detectUpload({ bytes, fileName, ...(minConfidence != null ? { minConfidence } : {}), ...(ocr === false ? { ocr: false } : {}) });
}

// ══ Run 9 Part 3.7 — PRO BILLING ON DOCUSTAY'S OWN PAGES (boards B2–B5). Stripe stays the record: every figure below is read from Stripe, and after every write the mirror is refreshed from
//    Stripe's own response (mirrorSubscriptionFromStripe), never from what we asked for. Live-mode Stripe is the maintainer's (R9-m): these run against whatever key the environment has.
const proKey = () => { const k = stripeSecretFor("docustay"); if (!k) throw dependency("Billing is temporarily unavailable — try again shortly"); return k; };
const stripeOk = (r, what) => { if (!r.ok) { console.error(`docustay ${what}: Stripe refused (${r.status}): ${r.body?.error?.message ?? "no detail"}`); throw dependency("Billing is temporarily unavailable — try again shortly"); } return r.body; };

/** B2 · back from Stripe's checkout page: Pro switches on only when Stripe itself says this workspace's session is complete and paid. Re-reads the session (and its subscription) from Stripe,
 *  then mirrors it. The browser's return alone never counts; a session for another customer is refused. → { confirmed, status } */
export async function confirmUpgrade(tx, { tenantId, sessionId }) {
  if (typeof sessionId !== "string" || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) throw invalid("That is not a checkout session.", { field: "sessionId" });
  const apiKey = proKey();
  const sub = await subRow(tx, tenantId);
  if (!sub || !isDocustayPlanKey(sub.plan_key)) throw invalid("this organisation is not a Docustay workspace");
  const s = stripeOk(await stripeCall(apiKey, "GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`, new URLSearchParams({ "expand[]": "subscription" }).toString()), "upgrade confirm");
  const mine = s.mode === "subscription" && (s.metadata?.workbench_tenant_id === tenantId) && (!sub.stripe_customer_id || s.customer === sub.stripe_customer_id);
  if (!mine) throw forbidden("That checkout does not belong to this workspace.");
  const paid = s.status === "complete" && ["paid", "no_payment_required"].includes(s.payment_status) && s.subscription && typeof s.subscription === "object";
  if (!paid) return { confirmed: false, status: s.status === "expired" ? "expired" : "waiting" };
  await tx.query(`UPDATE keystone.workbench_subscription SET stripe_customer_id = COALESCE(stripe_customer_id, $2), stripe_subscription_id = COALESCE($3, stripe_subscription_id) WHERE tenant_id = $1`, [tenantId, s.customer ?? null, s.subscription.id]);
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: s.subscription, why: "checkout" });
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
  if (sub.stripe_subscription_id) {
    const s = stripeOk(await stripeCall(apiKey, "GET", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, new URLSearchParams([["expand[]", "default_payment_method"], ["expand[]", "customer.invoice_settings.default_payment_method"]]).toString()), "billing details");
    const item = s.items?.data?.[0];
    const end = item?.current_period_end ?? s.current_period_end ?? null;
    if (!["canceled", "incomplete_expired"].includes(s.status) && !s.cancel_at_period_end && !s.cancel_at && end) out.nextPayment = { at: new Date(end * 1000).toISOString(), amountMinor: (item?.price?.unit_amount ?? 0) * (item?.quantity ?? 1), currency: item?.price?.currency ?? "usd", interval: item?.price?.recurring?.interval ?? null };
    const pm = (typeof s.default_payment_method === "object" && s.default_payment_method) || (typeof s.customer === "object" && typeof s.customer?.invoice_settings?.default_payment_method === "object" && s.customer.invoice_settings.default_payment_method) || null;
    if (pm?.card) out.card = { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null, expMonth: pm.card.exp_month ?? null, expYear: pm.card.exp_year ?? null };
  }
  const inv = stripeOk(await stripeCall(apiKey, "GET", "/invoices", new URLSearchParams({ customer: sub.stripe_customer_id, limit: "12" }).toString()), "invoices");
  out.invoices = (inv.data ?? []).filter((i) => i.status !== "draft").map((i) => ({ id: i.id, number: invoiceNumber(i), at: new Date((i.status_transitions?.paid_at ?? i.created) * 1000).toISOString(), totalMinor: i.total ?? 0, currency: i.currency ?? "usd", status: i.status, pdf: `/api/product/docustay/invoices/${encodeURIComponent(i.id)}/pdf` }));   // Docustay's own PDF, never Stripe's hosted page or its "Pay online" link
  return out;
}

/** D5: the invoice PDF, built here from Stripe's data (white paper, the Docustay wordmark, our number). The invoice must belong to THIS workspace's Stripe customer. → { bytes, filename } */
export async function invoicePdfFor(tx, { tenantId, invoiceId }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_customer_id || !/^in_[A-Za-z0-9]+$/.test(String(invoiceId))) throw notFoundInvoice();
  const inv = stripeOk(await stripeCall(apiKey, "GET", `/invoices/${encodeURIComponent(invoiceId)}`, new URLSearchParams([["expand[]", "customer"], ["expand[]", "payments.data.payment.payment_intent"]]).toString()), "invoice");
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
  if (!sub?.stripe_subscription_id || sub.plan_key !== "docustay_pro") throw invalid("There is no Pro subscription to cancel.");
  const r = await record(tx, { tenantId, kind: "cancel_intent", actorUserId, subscriptionId: sub.stripe_subscription_id });
  return { token: r.id, at: r.at, notBefore: new Date(Date.parse(r.at) + INTENT_MIN_MS).toISOString() };
}
/** B5 / C · cancel in the app: Pro stays on to the end of what was paid for (Stripe's cancel_at_period_end); the reason goes to Stripe's own cancellation record. Owner or admin (the route).
 *  ONLY ever reached after the cancel page's explicit confirm: it needs the token `prepareCancel` issued. Safe to repeat: a second call with the same token returns the same answer and cancels nothing twice.
 *  → the plan as Stripe now says it */
export async function cancelPro(tx, { tenantId, actorUserId = null, token = null, reason = null, reasonText = null }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || sub.plan_key !== "docustay_pro") throw invalid("There is no Pro subscription to cancel.");
  if (typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(token)) throw invalid("Open the cancel page and confirm there.", { code: "cancel_needs_confirmation" });
  const { rows: [intent] } = await tx.query(`SELECT id, at, actor_user_id, stripe_subscription_id FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND id = $2 AND kind = 'cancel_intent'`, [tenantId, token]);
  if (!intent || intent.stripe_subscription_id !== sub.stripe_subscription_id || (intent.actor_user_id && actorUserId && intent.actor_user_id !== actorUserId)) throw invalid("Open the cancel page and confirm there.", { code: "cancel_needs_confirmation" });
  const age = Date.now() - Date.parse(intent.at);
  const { rows: [used] } = await tx.query(`SELECT 1 FROM keystone.docustay_billing_record WHERE tenant_id = $1 AND kind = 'cancel_confirmed' AND detail->>'intent' = $2`, [tenantId, token]);
  if (used) return workspaceStatus(tx, { tenantId });   // the same confirm sent twice (a double click, a second tab): already done, nothing more is sent to Stripe
  if (age < INTENT_MIN_MS) throw invalid("That was too quick. Read the page, then confirm.", { code: "cancel_too_quick" });
  if (age > INTENT_MAX_MS) throw invalid("This page has been open a while. Reload it and confirm again.", { code: "cancel_expired" });
  const form = new URLSearchParams({ cancel_at_period_end: "true", ...(CANCEL_FEEDBACK[reason] ? { "cancellation_details[feedback]": CANCEL_FEEDBACK[reason] } : {}), ...(typeof reasonText === "string" && reasonText.trim() ? { "cancellation_details[comment]": reasonText.trim().slice(0, 500) } : {}) });
  const s = stripeOk(await stripeCall(apiKey, "POST", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, form.toString()), "cancel");
  await record(tx, { tenantId, kind: "cancel_confirmed", actorUserId, subscriptionId: sub.stripe_subscription_id, detail: { intent: token, reason: CANCEL_FEEDBACK[reason] ? reason : null, hasComment: Boolean(reasonText && String(reasonText).trim()), cancelAt: s.cancel_at ?? null } });
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: s, why: "cancel" });
  return workspaceStatus(tx, { tenantId });
}
/** B5 · changed their mind before the end date: Pro carries on as it was (the founders price too — the subscription never ended). */
export async function resumePro(tx, { tenantId, actorUserId = null }) {
  const apiKey = proKey(); const sub = await subRow(tx, tenantId);
  if (!sub?.stripe_subscription_id || sub.plan_key !== "docustay_pro" || sub.status === "canceled") throw invalid("Pro has already ended. Upgrade again to start a new subscription.");
  const s = stripeOk(await stripeCall(apiKey, "POST", `/subscriptions/${encodeURIComponent(sub.stripe_subscription_id)}`, new URLSearchParams({ cancel_at_period_end: "false" }).toString()), "resume");
  const { mirrorSubscriptionFromStripe } = await import("../billing/webhook.mjs");
  await record(tx, { tenantId, kind: "resumed", actorUserId, subscriptionId: sub.stripe_subscription_id });
  await mirrorSubscriptionFromStripe(tx, { tenantId, subscription: s, why: "resume" });
  return workspaceStatus(tx, { tenantId });
}
