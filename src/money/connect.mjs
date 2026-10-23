// @ts-check
// B1.2 — STRIPE CONNECT, VIA ACCOUNT LINKS. Connect a practice's own Stripe account.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ STRIPE CONNECT vs STRIPE CHARGES. This module handles connecting a practice's OWN Stripe
//     account, so charges and payouts land on their account, not the platform's. `src/money/
//     charge.mjs` handles USING that connected account to create charges — two separate concerns.
//
// ★ FIX (coordinator, checkpoint, 24 Sep 2026, the maintainer's ruling): this was built as the OAuth flow
//   (authorize/token, `client_id`), which needs `KEYSTONE_STRIPE_CONNECT_CLIENT_ID` — a platform
//   Connect application ID that was never configured and is a SEPARATE Stripe Dashboard object
//   from the secret key. Switched to Account Links (`POST /v1/accounts` + `POST /v1/account_links`),
//   Stripe's other standard onboarding path, which needs only the platform's OWN secret key — no
//   client_id, no OAuth application to register. the maintainer's ruling: "switch to Account Links, the client
//   id isn't needed, delete the requirement."
//
// ★★★ FLAG-GATED LIKE THE CHARGE PATH. A practice with `stripe_enabled` off cannot start the
//     connect flow — the same per-practice kill switch the charge path checks. This is distinct
//     from the global `KEYSTONE_STRIPE_CHARGES_ENABLED` flag (`src/money/charge.mjs`'s HARD LIMIT 1).
//
// ★ THE STATE MACHINE (0351_connect_account_schema.sql, unchanged): not_connected → pending →
//   live | restricted. `pending` is set the moment the platform creates the Stripe account (before
//   the practice owner has even reached Stripe's hosted onboarding); `live` is set once the
//   callback finds `charges_enabled` true. Account Links fits this state machine better than OAuth
//   did — OAuth had no use for `pending` at all, jumping straight to `live` on code exchange.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { callOutside } from "../http/outside.mjs";
import { dependency } from "../http/errors.mjs";
import { SECRET_KEY_VAR, classifyStripeKeyShape } from "./charge.mjs";
import { stripeEnv } from "../product/stripeFor.mjs";
import { writeAudit } from "../permissions/audit.mjs";
// ★ L3.0 — every `tx.query(<static SQL>)` below now goes through the builder + `run`; the SQL
//   semantics are unchanged (same WHERE clauses, same RETURNING, same ON CONFLICT ... DO UPDATE ...
//   WHERE, same function calls). `sql` is the escape hatch for what the builder itself does not
//   express — calling a plpgsql function as a bare selection (`selectNoFrom`), `now()`. Imported as
//   `kdb` (not `db`) because `getConnectAccountState`'s own parameter below is named `db`.
import { db as kdb, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const STRIPE_ACCOUNTS_URL = "https://api.stripe.com/v1/accounts";
const STRIPE_ACCOUNT_LINKS_URL = "https://api.stripe.com/v1/account_links";

function requireApiKey(product = "workbench") {
  const apiKey = stripeEnv(product)[SECRET_KEY_VAR];   // Docustay -> its own account once it has one; the platform -> the Docustay key, exactly as before
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw dependency("Stripe is not configured — the platform operator needs to set up a Stripe key.");
  }
  if (classifyStripeKeyShape(apiKey.trim()) === "malformed") {
    throw dependency("Stripe is misconfigured — the platform operator needs to set a valid Stripe key.");
  }
  return apiKey.trim();
}

/**
 * Create a new Stripe connected account for a practice (Express, or Standard for a Docustay workspace). Returns `{ stripeAccountId }`.
 * ★ Called ONCE per practice — `startConnect` (below) reuses an existing pending/restricted
 *   account rather than creating a second one on every retry, which would orphan Stripe accounts
 *   nobody finishes onboarding.
 */
export async function createConnectAccount({ fetchImpl = fetch, type = "express", email = null, product = "workbench", prefill = null } = {}) {
  const apiKey = requireApiKey(product);
  if (!["express", "standard", "full_dashboard"].includes(type)) throw new Error(`createConnectAccount: type must be express, standard or full_dashboard, got "${type}"`);
  // ★ Part 30 item 11 — a Docustay workspace connects a STANDARD account: the customer's own full Stripe account (their dashboard, their payouts, their fees), not one the platform manages. A Standard account's payout
  //   schedule is theirs to set, so none is sent; the platform's Express accounts keep the weekly Friday schedule below.
  // ★ Part 30 item 11 (the maintainer, 5 Oct 2026) — "full_dashboard" is the account Stripe's CURRENT docs describe for a platform whose customers keep the normal Stripe Dashboard: Accounts v1 with CONTROLLER PROPERTIES (Stripe calls the legacy `type=standard` a deprecated
  //   shorthand and recommends controller properties or Accounts v2). Same behaviour as Standard: full Dashboard, the account pays its own Stripe fees (fees.payer=account), Stripe carries losses and collects the requirements (identity, bank, terms) in its hosted onboarding.
  //   v2 is not used: the same Stripe pages say to fall back to v1 + controller properties when v2 lacks something, and a v1 account is what the Account Links API, direct charges and the application-fee code here already take; the proof (specs/proofs/part-30/item-11.md) shows v1 works end to end.
  const params = new URLSearchParams(type === "full_dashboard" ? { "controller[stripe_dashboard][type]": "full", "controller[fees][payer]": "account", "controller[losses][payments]": "stripe", "controller[requirement_collection]": "stripe", ...(email ? { email } : {}) }
    : type === "standard" ? { type: "standard", ...(email ? { email } : {}) } : {
    type: "express",
    // ★ F20.8 — weekly payouts with Friday anchor
    "settings[payouts][schedule][interval]": "weekly",
    "settings[payouts][schedule][weekly_anchor]": "friday",
  });
  if (prefill) for (const [k, v] of Object.entries(prefillParams(prefill))) params.set(k, v);   // the wizard's non-sensitive details, so Stripe's page does not ask for them again
  const out = await callOutside("stripe_connect_accounts", STRIPE_ACCOUNTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${apiKey}`,
    },
    body: params.toString(),
  }, { fetchImpl });

  if (!out.ok || !out.body?.id) {
    throw dependency(
      `Stripe did not create the account (${out.body?.error?.message ?? out.status ?? "unreachable"}).`,
      out.body);
  }
  return { stripeAccountId: out.body.id };
}

/**
 * The wizard's NON-SENSITIVE details as Stripe account parameters (PRE-FILL: Stripe's own page then skips these questions). Docustay never collects or stores an SSN, EIN, ID, date of birth, address or bank number.
 * { businessType: "company"|"individual", name, firstName, lastName, website, productDescription, email, country }
 */
export function prefillParams(p = {}) {
  const out = {};
  if (p.businessType === "company") { out.business_type = "company"; if (p.name) out["company[name]"] = String(p.name).slice(0, 100); }
  else if (p.businessType === "individual") { out.business_type = "individual"; if (p.firstName) out["individual[first_name]"] = String(p.firstName).slice(0, 60); if (p.lastName) out["individual[last_name]"] = String(p.lastName).slice(0, 60); }
  if (p.website) out["business_profile[url]"] = String(p.website).slice(0, 200);
  if (p.productDescription) out["business_profile[product_description]"] = String(p.productDescription).slice(0, 300);
  if (p.email) out.email = String(p.email).slice(0, 254);
  return out;
}

/** Change the pre-fill on an account that has not submitted its details yet. Stripe refuses once details are submitted: the caller treats a refusal as "Stripe will ask for it itself". */
export async function updateConnectAccountPrefill({ stripeAccountId, prefill, fetchImpl = fetch, product = "workbench" }) {
  const apiKey = requireApiKey(product);
  const out = await callOutside("stripe_connect_accounts_update", `${STRIPE_ACCOUNTS_URL}/${encodeURIComponent(stripeAccountId)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${apiKey}` }, body: new URLSearchParams(prefillParams(prefill)).toString(),
  }, { fetchImpl });
  return { ok: out.ok === true, message: out.ok ? null : (out.body?.error?.message ?? "Stripe did not accept the details") };
}

/** Everything the "Your Stripe account" screen shows about the account, from the Account object. Names and numbers Stripe already holds; nothing sensitive (a bank is its name and last 4). */
export async function fetchConnectAccountDetail({ stripeAccountId, fetchImpl = fetch, product = "workbench" }) {
  const apiKey = requireApiKey(product);
  const out = await callOutside("stripe_connect_accounts_get", `${STRIPE_ACCOUNTS_URL}/${encodeURIComponent(stripeAccountId)}`, { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, { fetchImpl });
  if (!out.ok) throw dependency(`Stripe did not return the account (${out.body?.error?.message ?? out.status ?? "unreachable"}).`, out.body);
  const a = out.body ?? {}, bank = a.external_accounts?.data?.[0] ?? null, r = a.requirements ?? {};
  return {
    chargesEnabled: a.charges_enabled === true, payoutsEnabled: a.payouts_enabled === true, detailsSubmitted: a.details_submitted === true,
    businessType: a.business_type ?? null, businessName: a.business_profile?.name ?? a.company?.name ?? ([a.individual?.first_name, a.individual?.last_name].filter(Boolean).join(" ") || null), website: a.business_profile?.url ?? null,
    supportEmail: a.business_profile?.support_email ?? a.email ?? null, country: a.country ?? null, currency: a.default_currency ?? null, createdAt: a.created ? new Date(a.created * 1000).toISOString() : null,
    bank: bank ? { name: bank.bank_name ?? null, last4: bank.last4 ?? null } : null, schedule: a.settings?.payouts?.schedule ? { interval: a.settings.payouts.schedule.interval ?? null, weeklyAnchor: a.settings.payouts.schedule.weekly_anchor ?? null, delayDays: a.settings.payouts.schedule.delay_days ?? null } : null,
    requirements: { currentlyDue: Array.isArray(r.currently_due) ? r.currently_due.slice(0, 40) : [], pastDue: Array.isArray(r.past_due) ? r.past_due.slice(0, 40) : [], eventuallyDue: Array.isArray(r.eventually_due) ? r.eventually_due.slice(0, 40) : [], pendingVerification: Array.isArray(r.pending_verification) ? r.pending_verification.slice(0, 40) : [], deadline: r.current_deadline ? new Date(r.current_deadline * 1000).toISOString() : null, disabledReason: r.disabled_reason ?? null },
  };
}

/** The account's balance and its most recent payouts, through the Stripe-Account header. READ-ONLY. */
export async function fetchConnectMoney({ stripeAccountId, fetchImpl = fetch, product = "workbench" }) {
  const apiKey = requireApiKey(product), h = { Authorization: `Bearer ${apiKey}`, "Stripe-Account": stripeAccountId };
  const [bal, po] = await Promise.all([
    callOutside("stripe_connect_balance", "https://api.stripe.com/v1/balance", { method: "GET", headers: h }, { fetchImpl }),
    callOutside("stripe_connect_payouts", "https://api.stripe.com/v1/payouts?limit=5", { method: "GET", headers: h }, { fetchImpl }),
  ]);
  const sum = (l) => (Array.isArray(l) ? l.filter((x) => x.currency === (l[0]?.currency)).reduce((n, x) => n + (x.amount ?? 0), 0) : 0);
  const cur = bal.body?.available?.[0]?.currency ?? bal.body?.pending?.[0]?.currency ?? "usd";
  const payouts = (po.body?.data ?? []).map((x) => ({ id: x.id, amountMinor: x.amount, currency: x.currency, status: x.status, arrivalAt: x.arrival_date ? new Date(x.arrival_date * 1000).toISOString() : null, createdAt: x.created ? new Date(x.created * 1000).toISOString() : null, failure: x.failure_message ?? null }));
  return { ok: bal.ok === true, currency: cur, availableMinor: bal.ok ? sum(bal.body?.available) : null, pendingMinor: bal.ok ? sum(bal.body?.pending) : null, payouts: po.ok ? payouts : [] };
}

/**
 * Create an Account Link for onboarding — the URL the practice owner's browser is redirected to.
 * ★ `refresh_url` is hit if the link expires or onboarding is abandoned mid-way (Stripe's own
 *   retry convention); it points back at `/connect/start`, which reuses the same account id
 *   instead of creating a new one. `return_url` is the platform's callback.
 */
export async function createAccountLink({ stripeAccountId, refreshUrl, returnUrl, fetchImpl = fetch, product = "workbench", type = "account_onboarding" }) {
  const apiKey = requireApiKey(product);
  const out = await callOutside("stripe_connect_account_links", STRIPE_ACCOUNT_LINKS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${apiKey}`,
    },
    body: new URLSearchParams({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type,
    }).toString(),
  }, { fetchImpl });

  if (!out.ok || !out.body?.url) {
    throw dependency(
      `Stripe did not create the onboarding link (${out.body?.error?.message ?? out.status ?? "unreachable"}).`,
      out.body);
  }
  return { url: out.body.url };
}

/**
 * Read the connected account's status from Stripe directly — called on return from onboarding to
 * decide `pending` vs `live`. Returns `{ chargesEnabled, detailsSubmitted }`.
 */
export async function fetchConnectAccountStatus({ stripeAccountId, fetchImpl = fetch, product = "workbench" }) {
  const apiKey = requireApiKey(product);
  const out = await callOutside(
    "stripe_connect_accounts_get", `${STRIPE_ACCOUNTS_URL}/${encodeURIComponent(stripeAccountId)}`,
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, { fetchImpl });

  if (!out.ok) {
    throw dependency(
      `Stripe did not return the account's status (${out.body?.error?.message ?? out.status ?? "unreachable"}).`,
      out.body);
  }
  return {
    chargesEnabled: out.body?.charges_enabled === true,
    detailsSubmitted: out.body?.details_submitted === true,
    // what Stripe still needs (field names only — never a person's data) and whether Stripe has switched the account off, so the screen can say "needs more information" plainly
    requirementsDue: Array.isArray(out.body?.requirements?.currently_due) ? out.body.requirements.currently_due.slice(0, 30) : [],
    pastDue: Array.isArray(out.body?.requirements?.past_due) ? out.body.requirements.past_due.length : 0,
    disabledReason: out.body?.requirements?.disabled_reason ?? null,
    deadline: out.body?.requirements?.current_deadline ? new Date(out.body.requirements.current_deadline * 1000).toISOString() : null,
    isController: out.body?.controller?.is_controller === true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DATABASE WRITES. `tx` is always the tenant-scoped transaction.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Create or update the connect_account row. `state` is one of the schema's four
 * (not_connected/pending/live/restricted) — the caller decides which, since Account Links means
 * this now runs TWICE per connection: 'pending' when the Stripe account is first created (before
 * the practice owner has even reached Stripe's hosted onboarding), 'live' or 'restricted' when
 * they return from it. ★ Idempotent: an existing row for this stripeAccountId is updated in place.
 */
export async function connectAccount(tx, { tenantId, stripeAccountId, state, actorUserId = null }) {
  if (!["pending", "live", "restricted"].includes(state)) {
    throw new Error(`connectAccount: state must be pending/live/restricted, got "${state}"`);
  }
  // ★ Capture the before state for audit purposes
  const existing = await run(tx, kdb
    .selectFrom("keystone.connect_account")
    .select(["id", "state"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_account_id", "=", stripeAccountId));
  const beforeState = existing.rows.length > 0
    ? { state: existing.rows[0].state }
    : null;

  const { rows } = await run(tx, kdb
    .insertInto("keystone.connect_account")
    .values({
      tenant_id: tenantId ?? null,
      stripe_account_id: stripeAccountId ?? null,
      state,
    })
    .onConflict((oc) => oc
      .column("stripe_account_id")
      .doUpdateSet({ state, updated_at: sql`now()` })
      // ★ R2 (RECONCILE) — qualified: inside ON CONFLICT … WHERE a bare "tenant_id" is ambiguous
      //   (the target row vs EXCLUDED) and Postgres refuses the whole statement.
      .where("keystone.connect_account.tenant_id", "=", tenantId))
    .returning(["id", "stripe_account_id", "state"]));
  if (!rows.length) {
    throw new Error("connectAccount: INSERT/UPDATE failed");
  }

  // ★ Register the account in webhook_source so account-level Stripe events route correctly
  await run(tx, kdb
    .selectNoFrom(sql`keystone.ensure_stripe_account_source(${sql.val(stripeAccountId)})`.as("id")));

  // ★ R13-D381: only a real change is audited. The onboarding return re-reads the account and calls this with the same state,
  //   which put a second "Stripe account created" in the Payments activity list.
  if (beforeState?.state !== rows[0].state) {
    await writeAudit(tx, {
      tenantId,
      action: "settings.changed",
      object: "money.connect",
      subjectId: rows[0].id,
      before: beforeState,
      after: { state: rows[0].state },
      actorUserId: actorUserId ?? null,
    });
  }

  return { accountId: rows[0].id, state: rows[0].state };
}

/**
 * Mark the connect_account row as disconnected. Sets state to 'not_connected' and clears the
 * stripe_account_id so a fresh connection can be established.
 * ★ Idempotent — no error if already disconnected.
 */
export async function disconnectAccount(tx, { tenantId, actorUserId = null }) {
  // ★ Capture the before state for audit purposes
  const existing = await run(tx, kdb
    .selectFrom("keystone.connect_account")
    .select(["id", "state", "stripe_account_id"])
    .where("tenant_id", "=", tenantId)
    .where("state", "<>", "not_connected"));
  const beforeState = existing.rows.length > 0
    ? { state: existing.rows[0].state }
    : null;

  // ★ Retire the webhook source mapping before clearing the stripe_account_id
  if (existing.rows.length > 0 && existing.rows[0].stripe_account_id) {
    await run(tx, kdb
      .selectNoFrom(sql`keystone.retire_stripe_account_source(${sql.val(existing.rows[0].stripe_account_id)})`.as("id")));
  }

  const result = await run(tx, kdb
    .updateTable("keystone.connect_account")
    .set({ state: "not_connected", stripe_account_id: null, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("state", "<>", "not_connected")
    .returning("id"));

  // ★ Only audit if the update actually happened
  if (result.rows.length > 0 && beforeState) {
    await writeAudit(tx, {
      tenantId,
      action: "settings.changed",
      object: "money.connect",
      subjectId: result.rows[0].id,
      before: beforeState,
      after: { state: "not_connected" },
      actorUserId: actorUserId ?? null,
    });
  }

  return { disconnected: true };
}

/**
 * Read the current connection state for this practice. Returns `{ state, stripeAccountId, accountId }`
 * or `{ state: 'not_connected' }` if no row exists yet.
 */
export async function getConnectAccountState(db, tenantId) {
  const { rows } = await run(db, kdb
    .selectFrom("keystone.connect_account")
    .select(["id", "stripe_account_id", "state"])
    .where("tenant_id", "=", tenantId)
    // ★ a workspace that disconnected and connected again has an old 'not_connected' row beside the live one: the connected row wins, then the newest — never an arbitrary row (Part 30 item 11 found this: a reconnected workspace could read as Disconnected)
    .orderBy(sql`(state = 'not_connected')`, "asc")
    .orderBy("updated_at", "desc")
    .limit(1));
  if (rows.length) {
    return {
      state: rows[0].state,
      stripeAccountId: rows[0].stripe_account_id,
      accountId: rows[0].id,
    };
  }
  // ★★★ the maintainer's ruling, 28 Sep 2026 — Docustay IS the Stripe account (the platform Stripe account), not a
  //     connected sub-account of some separate "the platform platform" account. There is no separate
  //     platform account today — the one KEYSTONE_STRIPE_SECRET_KEY configured resolves directly
  //     to Docustay. Every OTHER (future) practice still gets a real Express connected account through
  //     the flow below, unchanged — this is a named, single exception, not a new default. Found
  //     live: every Stripe-embedded screen 409'd (`ConnectNotLive`) because keystone.connect_account
  //     genuinely has zero rows for Docustay's tenant — MEASURED, not assumed — and the 409-triggered
  //     onboarding retry then 502'd, because this account was never configured as a Connect
  //     platform at all (creating Express accounts / account sessions requires that Stripe
  //     Dashboard setting, which a plain merchant account doesn't have).
  const direct = await isDirectStripeAccountTenant(db, tenantId);
  if (direct) {
    return { state: "live", stripeAccountId: direct.stripeAccountId, accountId: null, isDirectAccount: true };
  }
  return { state: "not_connected", stripeAccountId: null, accountId: null };
}

/**
 * ★ The Docustay special case, isolated to one place. Slug-driven (not a hardcoded tenant id) so it
 *   reads at the call site as "this practice", not a mystery UUID — and does nothing for any
 *   tenant that isn't it. KEYSTONE_STRIPE_DIRECT_ACCOUNT_ID must be the exact account the
 *   platform's own KEYSTONE_STRIPE_SECRET_KEY resolves to; if that env var is unset, no tenant
 *   is ever treated as direct.
 */
async function isDirectStripeAccountTenant(db, tenantId) {
  const slug = process.env.KEYSTONE_STRIPE_DIRECT_TENANT_SLUG;
  const stripeAccountId = process.env.KEYSTONE_STRIPE_DIRECT_ACCOUNT_ID;
  if (!slug || !stripeAccountId) return null;
  const { rows } = await run(db, kdb
    .selectFrom("keystone.tenant")
    .select(["id"])
    .where("id", "=", tenantId)
    .where("slug", "=", slug)
    .limit(1));
  return rows.length ? { stripeAccountId } : null;
}

/**
 * Push branding settings to the connected Stripe account. Reads branding values from
 * tenant_setting, uploads logo file if present, and sends Account update with branding params.
 * Returns `{ pushed: true, fields: [...] }` on success, or `{ pushed: false, reason: '...' }` if not connected.
 * Fire-and-forget callers should handle promise rejections by logging, never throwing.
 */
export async function pushBrandingToStripe(tx, { tenantId, fetchImpl = fetch }) {
  const state = await getConnectAccountState(tx, tenantId);
  if (state.state !== "live") {
    return { pushed: false, reason: "not_connected" };
  }

  const apiKey = requireApiKey();
  const { getSetting } = await import("../settings/writes.mjs");

  // ★ Read branding settings from tenant_setting
  const logoUrl = await getSetting(tx, "branding.logo_url", null);
  const sidebarLogo = await getSetting(tx, "branding.sidebar_logo", null);

  const params = new URLSearchParams();
  const fields = [];

  // ★ Upload logo file to Stripe if it exists and cache the file id
  if (logoUrl && logoUrl.startsWith("ks-object:")) {
    try {
      const { getObject } = await import("../storage/s3.mjs");
      const key = logoUrl.slice("ks-object:".length);
      const got = await getObject({ key });
      if (got.ok) {
        const fileForm = new FormData();
        fileForm.append("file", new Blob([got.body], { type: "image/png" }), "logo.png");

        const fileOut = await callOutside("stripe_connect_upload_file", `https://files.stripe.com/v1/files`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: fileForm,
        }, { fetchImpl });

        if (fileOut.ok && fileOut.body?.id) {
          params.append("settings[branding][logo]", fileOut.body.id);
          fields.push("logo");
        }
      }
    } catch (err) {
      // Log file upload failure but continue with other params
      console.error("Failed to upload logo to Stripe:", err.message);
    }
  }

  // ★ Sidebar logo (icon in Stripe branding)
  if (sidebarLogo && sidebarLogo.startsWith("ks-object:")) {
    try {
      const { getObject } = await import("../storage/s3.mjs");
      const key = sidebarLogo.slice("ks-object:".length);
      const got = await getObject({ key });
      if (got.ok) {
        const fileForm = new FormData();
        fileForm.append("file", new Blob([got.body], { type: "image/png" }), "icon.png");

        const fileOut = await callOutside("stripe_connect_upload_file", `https://files.stripe.com/v1/files`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: fileForm,
        }, { fetchImpl });

        if (fileOut.ok && fileOut.body?.id) {
          params.append("settings[branding][icon]", fileOut.body.id);
          fields.push("icon");
        }
      }
    } catch (err) {
      // Log file upload failure but continue
      console.error("Failed to upload icon to Stripe:", err.message);
    }
  }

  // ★ NO STRIPE CUSTOMER-EMAIL TOGGLE IS EVER SET. Those toggles are Dashboard-only opt-INs
  //   and stay off. `receipt_email` is never set anywhere in this codebase.

  // ★ Send Account update if there are branding params to push
  if (params.toString()) {
    const out = await callOutside("stripe_connect_account_update", `${STRIPE_ACCOUNTS_URL}/${encodeURIComponent(state.stripeAccountId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${apiKey}`,
      },
      body: params.toString(),
    }, { fetchImpl });

    if (!out.ok) {
      throw dependency(
        `Stripe did not update the account (${out.body?.error?.message ?? out.status ?? "unreachable"}).`,
        out.body);
    }
  }

  return { pushed: fields.length > 0, fields };
}
