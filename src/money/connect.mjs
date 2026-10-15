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
export async function createConnectAccount({ fetchImpl = fetch, type = "express", email = null, product = "workbench" } = {}) {
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
 * Create an Account Link for onboarding — the URL the practice owner's browser is redirected to.
 * ★ `refresh_url` is hit if the link expires or onboarding is abandoned mid-way (Stripe's own
 *   retry convention); it points back at `/connect/start`, which reuses the same account id
 *   instead of creating a new one. `return_url` is the platform's callback.
 */
export async function createAccountLink({ stripeAccountId, refreshUrl, returnUrl, fetchImpl = fetch, product = "workbench" }) {
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
      type: "account_onboarding",
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

  await writeAudit(tx, {
    tenantId,
    action: "settings.changed",
    object: "money.connect",
    subjectId: rows[0].id,
    before: beforeState,
    after: { state: rows[0].state },
    actorUserId: actorUserId ?? null,
  });

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
