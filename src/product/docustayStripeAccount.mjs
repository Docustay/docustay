// src/product/docustayStripeAccount.mjs — THE SETUP WIZARD AND "YOUR STRIPE ACCOUNT" (21 Oct 2026, specs/v1/STRIPE-PAYMENTS-SPEC.md).
// Stripe keeps collecting identity, bank and terms on its own hosted page (the account stays full-dashboard, requirement_collection=stripe). This module WRAPS that:
//   · the wizard saves only NON-sensitive details server-side (business type, name, website, email, what for) and sends them to Stripe as PRE-FILL, then sends the person to Stripe's page;
//   · the account screen shows what Stripe says (status, requirements in plain words, balance, payouts) read-only, cached about 60 seconds per workspace, and NEVER while a database connection is held;
//   · three switches live here: Take payments, Also send a receipt, and Disconnect (the last is docustayPayments.stopPayments).
// Docustay never stores or asks for an SSN, EIN, ID, date of birth, address or bank number. Only Admins and Owners reach any of this (the routes' own guard); Members get `adminsAndOwners` and nothing else.
import { stripeEnv } from "./stripeFor.mjs";
import { fetchConnectAccountDetail, fetchConnectMoney, updateConnectAccountPrefill, createConnectAccount, createAccountLink, connectAccount, getConnectAccountState } from "../money/connect.mjs";
import { writeAudit } from "../permissions/audit.mjs";
import { invalid, conflict } from "../http/errors.mjs";
import { effectivePlan } from "./docustayPlans.mjs";
import { subRow } from "./docustay.mjs";

// ── Stripe's requirement keys, in plain English (one table) ──
const REQUIREMENT_WORDS = [
  [/^external_account/, "A bank account, so Stripe can pay you"],
  [/^tos_acceptance/, "Agreeing to Stripe's terms"],
  [/(verification\.(document|additional_document)|\.document$)/, "A photo of your ID"],
  [/(\.dob\b|date_of_birth)/, "Your date of birth"],
  [/(ssn_last_4|id_number|tax_id|\.vat_id)/, "The last 4 digits of your SSN, or your business number (EIN)"],
  [/address/, "Your home or business address"],
  [/phone/, "A phone number"],
  [/^business_profile\.(url|product_description|mcc)/, "A few details about your business"],
  [/^business_profile\./, "Details about your business"],
  [/^(representative|relationship|owners|directors|executives)/, "Details about the people who run the business"],
  [/^(company|individual)\./, "Details about you or your company"],
  [/^business_type/, "Whether you are an individual or a company"],
];
/** Stripe requirement keys → a short list of plain sentences (each once, in the order Stripe lists them). */
export function plainRequirements(keys = []) {
  const out = [];
  for (const k of keys) { const hit = REQUIREMENT_WORDS.find(([re]) => re.test(k)); const w = hit ? hit[1] : "More information Stripe needs"; if (!out.includes(w)) out.push(w); }
  return out;
}
const DISABLED_WORDS = { "requirements.past_due": "Stripe has paused this account until the information below is sent.", "requirements.pending_verification": "Stripe is checking the details you sent.", "listed": "Stripe could not approve this account. Open your Stripe account for what to do next.", "rejected.fraud": "Stripe could not approve this account. Open your Stripe account for what to do next.", "rejected.listed": "Stripe could not approve this account. Open your Stripe account for what to do next.", "rejected.terms_of_service": "Stripe could not approve this account. Open your Stripe account for what to do next.", "rejected.other": "Stripe could not approve this account. Open your Stripe account for what to do next.", "under_review": "Stripe is reviewing this account.", "other": "Stripe has paused this account. Open your Stripe account for why." };
const daysUntil = (iso, now = new Date()) => (iso ? Math.ceil((Date.parse(iso) - now.getTime()) / 86_400_000) : null);

/** Ready, Needs attention, Verifying, Restricted, Disconnected or Paused by you, from the stored state and what Stripe said. Pure. */
export function statusOf({ row, detail, now = new Date() }) {
  if (!row || row.state === "not_connected") return row?.disconnected ? "disconnected" : "not_connected";
  if (!detail) return row.state === "live" ? (row.paused ? "paused" : "ready") : row.state === "restricted" ? "needs_attention" : "verifying";
  const r = detail.requirements, due = [...r.pastDue, ...r.currentlyDue];
  const rejected = /^(rejected|listed)/.test(r.disabledReason ?? "");
  if (rejected) return "restricted";
  if (!detail.detailsSubmitted) return "needs_attention";
  if (due.length) return r.pastDue.length && !detail.chargesEnabled ? "restricted" : "needs_attention";
  if (!detail.chargesEnabled || !detail.payoutsEnabled) return r.pendingVerification.length || !r.disabledReason ? "verifying" : "restricted";
  return row.paused ? "paused" : "ready";
}
const STATUS_LABEL = { ready: "Ready", needs_attention: "Needs attention", verifying: "Verifying", restricted: "Restricted", disconnected: "Disconnected", paused: "Paused by you", not_connected: "Not connected" };

// ── the 60 second cache: Stripe is read at most once a minute per workspace, and never inside a database transaction ──
const CACHE = new Map(); const TTL_MS = 60_000;
export const forgetStripeCache = (tenantId) => { CACHE.delete(tenantId); };
async function stripeParts({ tenantId, accountId, fetchImpl = fetch, now = Date.now(), bust = false }) {
  const hit = CACHE.get(tenantId);
  if (!bust && hit && hit.accountId === accountId && now - hit.at < TTL_MS) return hit.value;
  let detail = null, money = null, error = false;
  try { [detail, money] = await Promise.all([fetchConnectAccountDetail({ stripeAccountId: accountId, fetchImpl, product: "docustay" }), fetchConnectMoney({ stripeAccountId: accountId, fetchImpl, product: "docustay" }).catch(() => null)]); }
  catch { error = true; if (hit && hit.accountId === accountId) return { ...hit.value, stale: true }; }
  const value = { detail, money, error, stale: false };
  if (!error) CACHE.set(tenantId, { at: now, accountId, value });
  return value;
}

const clean = (v, n) => String(v ?? "").trim().slice(0, n);
const PURPOSES = { deposits: "Deposits and fees", services: "Services", other: "Other payments" };
/** Validate the wizard's details. Non-sensitive only: nothing here is an SSN, EIN, ID, date of birth, address or bank number. → the saved shape, or throws invalid(). */
export function checkDetails(d = {}) {
  const businessType = d.businessType === "individual" ? "individual" : "company";
  const name = clean(d.name, 100), firstName = clean(d.firstName, 60), lastName = clean(d.lastName, 60);
  if (businessType === "company" && !name) throw invalid("Enter your business name.");
  if (businessType === "individual" && (!firstName || !lastName)) throw invalid("Enter your first and last name.");
  let website = clean(d.website, 200); if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website) { try { const u = new URL(website); if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) throw new Error("host"); website = u.toString().replace(/\/$/, ""); } catch { throw invalid("Enter a website address such as yourbusiness.com."); } }
  const email = clean(d.email, 254); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid("Enter an email address such as you@yourbusiness.com.");
  const purpose = PURPOSES[d.purpose] ? d.purpose : "services";
  return { businessType, name, firstName, lastName, website, email, purpose, country: "US" };
}

/** The connect_account row that is current for this workspace (the connected one, else the newest), or null. */
async function currentRow(tx, tenantId) {
  const { rows: [r] } = await tx.query(`SELECT id, stripe_account_id, state, wizard, paused_at, send_own_receipt, disconnected_at, connect_via, created_at FROM keystone.connect_account WHERE tenant_id = $1 ORDER BY (state = 'not_connected'), updated_at DESC LIMIT 1`, [tenantId]);
  return r ?? null;
}
async function ensureRow(tx, tenantId) {
  const r = await currentRow(tx, tenantId); if (r) return r;
  const { rows: [n] } = await tx.query(`INSERT INTO keystone.connect_account (tenant_id, state) VALUES ($1, 'not_connected') RETURNING id, stripe_account_id, state, wizard, paused_at, send_own_receipt, disconnected_at, connect_via, created_at`, [tenantId]);
  return n;
}
const setRow = (tx, id, patch) => {
  const cols = Object.keys(patch), vals = cols.map((c) => (c === "wizard" ? JSON.stringify(patch[c]) : patch[c]));
  return tx.query(`UPDATE keystone.connect_account SET ${cols.map((c, i) => `${c} = $${i + 2}${c === "wizard" ? "::jsonb" : ""}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...vals]);
};
async function assertDocustay(tx, tenantId) { const { rows: [t] } = await tx.query(`SELECT product, name FROM keystone.tenant WHERE id = $1`, [tenantId]); if (t?.product !== "docustay") throw invalid("This is for Docustay workspaces."); return t; }
const audit = (tx, { tenantId, actorUserId, key, value, subjectId = null, state = null }) =>
  writeAudit(tx, { tenantId, action: "settings.changed", object: "money.connect", subjectId, after: { key, value: String(value).slice(0, 120), ...(state ? { state } : {}) }, actorUserId });

/** READ 1, inside the tenant transaction (no Stripe call): everything we hold. */
export async function readContext(tx, { tenantId }) {
  const tenant = await assertDocustay(tx, tenantId);
  const row = await currentRow(tx, tenantId);
  const s = await getConnectAccountState(tx, tenantId);
  const { rows: acts } = await tx.query(
    `SELECT a.at, a.after, a.before, coalesce(u.display_name, u.email) AS who FROM keystone.audit_entry a LEFT JOIN keystone.app_user u ON u.id = a.actor_user_id
      WHERE a.tenant_id = $1 AND a.object = 'money.connect' ORDER BY a.at DESC LIMIT 25`, [tenantId]);
  const { rows: first } = await tx.query(`SELECT a.at, coalesce(u.display_name, u.email) AS who FROM keystone.audit_entry a LEFT JOIN keystone.app_user u ON u.id = a.actor_user_id WHERE a.tenant_id = $1 AND a.object = 'money.connect' AND a.after->>'state' IN ('pending','live') ORDER BY a.at ASC LIMIT 1`, [tenantId]);
  const sub = await subRow(tx, tenantId); const plan = effectivePlan(sub, process.env, new Date());
  const { rows: [own] } = await tx.query(`SELECT email FROM keystone.app_user WHERE tenant_id = $1 AND role = 'staff' AND staff_role = 'owner' AND archived_at IS NULL AND lifecycle_status <> 'former' AND email IS NOT NULL AND email NOT LIKE '%@deleted.invalid' ORDER BY created_at LIMIT 1`, [tenantId]);
  return { tenantId, ownerEmail: own?.email ?? "", tenant: { name: tenant.name }, row: row && { id: row.id, accountId: s.stripeAccountId ?? row.stripe_account_id ?? null, state: s.state, wizard: row.wizard ?? {}, paused: Boolean(row.paused_at), pausedAt: row.paused_at, sendOwnReceipt: row.send_own_receipt, disconnected: s.state === "not_connected" && Boolean(row.disconnected_at), via: row.connect_via, createdAt: row.created_at }, state: s.state, accountId: s.stripeAccountId ?? null, activity: acts, first: first[0] ?? null,
    feeBps: plan?.feeBps ?? 0, planName: plan?.name ?? null, mode: String(stripeEnv("docustay").KEYSTONE_STRIPE_SECRET_KEY ?? "").startsWith("sk_test_") ? "test" : "live" };
}

const ACTIVITY_WORDS = {
  state: { pending: "Stripe account created", live: "Stripe account ready", restricted: "Stripe needs more information", not_connected: "Stripe disconnected" },
  key: { payments_paused: (v) => (v === "true" ? "Payments paused" : "Payments turned back on"), receipt_switch: (v) => (v === "true" ? "Docustay receipts turned on" : "Docustay receipts turned off"), update_details_opened: () => "Opened Update details at Stripe", wizard_started: () => "Started payments setup", wizard_saved: () => "Saved setup details", payout_paid: () => "A payout was paid", payout_failed: () => "A payout failed", dispute_opened: () => "A payment was disputed", requirements_added: () => "Stripe asked for more information", connected_existing: () => "Connected an existing Stripe account" },
};
const activityLine = (a) => { const af = a.after ?? {}; if (af.key && ACTIVITY_WORDS.key[af.key]) return ACTIVITY_WORDS.key[af.key](af.value); if (af.state && ACTIVITY_WORDS.state[af.state]) return ACTIVITY_WORDS.state[af.state]; return "Payments settings changed"; };

/** READ 2 (outside any transaction): add what Stripe says, cached. → the whole "Your Stripe account" payload. */
export async function composeAccount(ctx, { fetchImpl = fetch, now = new Date(), bust = false } = {}) {
  const row = ctx.row, connected = Boolean(ctx.accountId) && ctx.state !== "not_connected";
  const parts = connected ? await stripeParts({ tenantId: ctx.tenantId, accountId: ctx.accountId, fetchImpl, bust }) : { detail: null, money: null, error: false };
  const detail = parts.detail;
  const status = statusOf({ row: row ? { ...row, state: ctx.state } : null, detail, now });
  const r = detail?.requirements;
  const dueKeys = r ? [...r.pastDue, ...r.currentlyDue] : [];
  const days = r ? daysUntil(r.deadline, now) : null;
  const attention = connected && (status === "needs_attention" || status === "restricted") ? {
    items: plainRequirements(dueKeys), deadline: r?.deadline ?? null, daysLeft: days, overdue: Boolean(r?.pastDue?.length),
    why: r?.disabledReason ? (DISABLED_WORDS[r.disabledReason] ?? DISABLED_WORDS.other) : (detail && !detail.detailsSubmitted ? "Stripe still needs a few details from you before payments can start." : null),
    payoutsPause: days != null && days >= 0 ? `Payouts pause on ${new Date(r.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })} if this is not finished.` : null,
  } : null;
  const m = parts.money;
  const next = m?.payouts?.find((p) => p.status === "pending" || p.status === "in_transit") ?? null, last = m?.payouts?.find((p) => p.status === "paid" || p.status === "failed") ?? null;
  const sched = detail?.schedule ? (detail.schedule.interval === "weekly" ? `Weekly${detail.schedule.weeklyAnchor ? `, ${detail.schedule.weeklyAnchor[0].toUpperCase()}${detail.schedule.weeklyAnchor.slice(1)}s` : ""}` : detail.schedule.interval === "monthly" ? "Monthly" : detail.schedule.interval === "manual" ? "Manual (you start each payout at Stripe)" : `Daily${detail.schedule.delayDays != null ? `, ${detail.schedule.delayDays} days after a payment` : ""}`) : null;
  return {
    status, label: STATUS_LABEL[status], connectState: ctx.state, mode: ctx.mode, prefill: { name: ctx.tenant.name ?? "", email: ctx.ownerEmail ?? "" }, workspace: ctx.tenant.name, stripeError: parts.error, stale: Boolean(parts.stale),
    account: ctx.accountId ? { id: ctx.accountId, masked: `acct_••••${String(ctx.accountId).slice(-4)}` } : null,
    panel: connected ? {
      charges: detail ? detail.chargesEnabled : null, payouts: detail ? detail.payoutsEnabled : null, verification: !detail ? null : (detail.detailsSubmitted && !dueKeys.length ? (detail.chargesEnabled ? "verified" : "pending") : "needed"),
      business: detail?.businessName ?? ctx.row?.wizard?.details?.name ?? null, type: detail?.businessType ? (detail.businessType === "individual" ? "Individual" : "Company") : null, website: detail?.website ?? null, supportEmail: detail?.supportEmail ?? null,
      country: detail?.country ?? null, currency: detail?.currency ? String(detail.currency).toUpperCase() : null,
      connectedAt: ctx.first?.at ?? row?.createdAt ?? null, connectedBy: ctx.first?.who ?? null, how: ctx.row?.via === "oauth" ? "An existing Stripe account" : "Stripe setup through Docustay",
    } : null,
    attention,
    money: connected && m ? { currency: m.currency, availableMinor: m.availableMinor, pendingMinor: m.pendingMinor, bank: detail?.bank ?? null, schedule: sched,
      next: next ? { amountMinor: next.amountMinor, currency: next.currency, arrivalAt: next.arrivalAt, status: next.status } : null, last: last ? { amountMinor: last.amountMinor, currency: last.currency, at: last.arrivalAt ?? last.createdAt, status: last.status } : null } : (connected && detail ? { currency: detail.currency, availableMinor: null, pendingMinor: null, bank: detail.bank, schedule: sched, next: null, last: null } : null),
    settings: { paused: Boolean(row?.paused), sendOwnReceipt: row?.sendOwnReceipt !== false, whoCanAdd: "Admins and Owners" },
    fee: { percent: ctx.feeBps / 100, planName: ctx.planName },
    dashboardUrl: connected ? `https://dashboard.stripe.com/${ctx.mode === "test" ? "test/" : ""}dashboard` : null,
    activity: ctx.activity.map((a) => ({ at: a.at, text: activityLine(a), who: a.who ?? null })),
    wizard: { step: row?.wizard?.step ?? 1, details: row?.wizard?.details ?? null },
    disconnected: Boolean(row?.disconnected),
  };
}

/** Save the wizard's step and details (server-side, so closing the page loses nothing). Only the non-sensitive fields are kept. */
export async function saveWizard(tx, { tenantId, actorUserId, step, details }) {
  await assertDocustay(tx, tenantId);
  const row = await ensureRow(tx, tenantId);
  const cur = row.wizard ?? {};
  const next = { ...cur, step: Math.min(4, Math.max(1, Number.isInteger(step) ? step : cur.step ?? 1)), ...(details ? { details: checkDetails(details) } : {}), savedAt: new Date().toISOString() };
  await setRow(tx, row.id, { wizard: next });
  if (details) await audit(tx, { tenantId, actorUserId, key: "wizard_saved", value: "details", subjectId: row.id });
  return { step: next.step, details: next.details ?? null };
}

/** Step 2 → 3: create (or update) the Stripe account with the details as PRE-FILL, then an Account Link to Stripe's own page. Never a second account for the same workspace. */
export async function continueOnStripe(tx, { tenantId, actorUserId, email = null, details, returnUrl, refreshUrl, fetchImpl = fetch, env = stripeEnv("docustay") }) {
  await assertDocustay(tx, tenantId);
  if (!/^sk_(test|live)_/.test(String(env.KEYSTONE_STRIPE_SECRET_KEY ?? ""))) throw conflict("Stripe is not set up on this server, so payments cannot be connected yet.");
  if (!returnUrl || !refreshUrl) throw invalid("payments: a return address and a refresh address are required");
  const d = checkDetails(details ?? (await currentRow(tx, tenantId))?.wizard?.details ?? {});
  const prefill = { businessType: d.businessType, name: d.name, firstName: d.firstName, lastName: d.lastName, website: d.website, productDescription: PURPOSES[d.purpose], email: d.email || email };
  const row = await ensureRow(tx, tenantId);
  const s = await getConnectAccountState(tx, tenantId);
  let accountId = s.stripeAccountId, prefilled = true, created = false;
  if (accountId && s.state === "live") return { state: "live" };
  if (!accountId || s.state === "not_connected") {
    // Stripe refuses a pre-filled field it cannot accept (a website it cannot reach, an email it calls invalid): start the account without that field and Stripe's own page asks for it (R13-D182)
    try { ({ stripeAccountId: accountId } = await createConnectAccount({ type: "full_dashboard", email: prefill.email, fetchImpl, product: "docustay", prefill })); }
    catch (e) {
      const param = String(e?.cause?.error?.param ?? ""); if (!/url|email|company|individual/.test(param)) throw e;
      ({ stripeAccountId: accountId } = await createConnectAccount({ type: "full_dashboard", email: null, fetchImpl, product: "docustay", prefill: { businessType: prefill.businessType, productDescription: prefill.productDescription } }));
      prefilled = false;
    }
    await connectAccount(tx, { tenantId, stripeAccountId: accountId, state: "pending", actorUserId }); created = true;
  } else {
    const u = await updateConnectAccountPrefill({ stripeAccountId: accountId, prefill, fetchImpl, product: "docustay" });   // refused once Stripe has the details: then Stripe's page simply asks for them itself
    prefilled = u.ok;
  }
  const cur = await currentRow(tx, tenantId);
  await tx.query(`UPDATE keystone.connect_account SET connect_via = 'account_link', disconnected_at = NULL, wizard = $2::jsonb, send_own_receipt = CASE WHEN $3 THEN false ELSE send_own_receipt END, updated_at = now() WHERE id = $1`,
    [cur.id, JSON.stringify({ ...(row.wizard ?? {}), step: 3, details: d, accountId, savedAt: new Date().toISOString() }), created]);
  const link = await createAccountLink({ stripeAccountId: accountId, refreshUrl, returnUrl, fetchImpl, product: "docustay" });
  await audit(tx, { tenantId, actorUserId, key: "wizard_started", value: prefilled ? "prefilled" : "not_prefilled", subjectId: cur.id });
  forgetStripeCache(tenantId);
  return { url: link.url, prefilled };
}

/** "Update details at Stripe": an Account Link for an account that already exists (Stripe allows only onboarding links for these accounts; it shows only what is still missing or editable). */
export async function updateLink(tx, { tenantId, actorUserId, returnUrl, refreshUrl, fetchImpl = fetch }) {
  await assertDocustay(tx, tenantId);
  const s = await getConnectAccountState(tx, tenantId);
  if (!s.stripeAccountId || s.state === "not_connected") throw conflict("There is no Stripe account to update. Set up payments first.");
  const link = await createAccountLink({ stripeAccountId: s.stripeAccountId, refreshUrl, returnUrl, fetchImpl, product: "docustay" });
  await audit(tx, { tenantId, actorUserId, key: "update_details_opened", value: "opened" });
  return { url: link.url };
}

/** The two switches. `paused` true = Take payments off. Audit-logged; forgets the cache so the screen is right at once. */
export async function saveSettings(tx, { tenantId, actorUserId, paused, sendOwnReceipt }) {
  await assertDocustay(tx, tenantId);
  const row = await currentRow(tx, tenantId); if (!row) throw conflict("Set up payments first.");
  const patch = {};
  if (typeof paused === "boolean") { patch.paused_at = paused ? new Date().toISOString() : null; if (Boolean(row.paused_at) !== paused) await audit(tx, { tenantId, actorUserId, key: "payments_paused", value: paused, subjectId: row.id }); }
  if (typeof sendOwnReceipt === "boolean") { patch.send_own_receipt = sendOwnReceipt; if ((row.send_own_receipt !== false) !== sendOwnReceipt) await audit(tx, { tenantId, actorUserId, key: "receipt_switch", value: sendOwnReceipt, subjectId: row.id }); }
  if (Object.keys(patch).length) await setRow(tx, row.id, patch);
  forgetStripeCache(tenantId);
  return { paused: typeof paused === "boolean" ? paused : Boolean(row.paused_at), sendOwnReceipt: typeof sendOwnReceipt === "boolean" ? sendOwnReceipt : row.send_own_receipt !== false };
}

/** For a Member: who runs billing and payments (every role may read this; it holds names, nothing else). */
export async function whoManages(tx) {
  const { rows } = await tx.query(`SELECT u.display_name, u.email, u.staff_role FROM keystone.app_user u WHERE u.role = 'staff' AND u.archived_at IS NULL AND u.lifecycle_status <> 'former' AND u.staff_role IN ('owner','admin') AND u.email NOT LIKE '%@deleted.invalid' ORDER BY (u.staff_role = 'owner') DESC, lower(coalesce(u.display_name, u.email)) LIMIT 20`);
  return rows.map((r) => ({ name: (r.display_name && r.display_name.trim()) || r.email, role: r.staff_role }));
}
