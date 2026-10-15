// specs/STRIPE-MIRROR.md §3 — STRIPE IS THE SINGLE SOURCE OF TRUTH FOR MONEY, MIRRORED HERE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THREE JOBS, ONE FILE, BECAUSE §3.2 SAYS "ONE PLACE DECIDES THE SCHEMA":
//   1 · `getStripeSync()` — the one `StripeSync` instance, configured from the SAME env vars every
//       other Stripe call in this codebase already reads (`stripeSecretKeyForConfig`,
//       `webhookSigningSecret`), never a second credential surface.
//   2 · `processStripeWebhook()` — called from `src/routes/webhooks.mjs` AFTER the platform's own
//       `verifyWebhookSignature` has already accepted the request (§3.5). Failure here is logged
//       and swallowed: a mirror hiccup must never block the receipt email or credit grant that
//       the platform's own `handlePaymentWebhook` is about to run in the same request.
//   3 · `schemaForTenant()` / `queryMirror()` — the ONLY code path allowed to read the `stripe`
//       schema (§3.4). Not exposed to a route, not given caller-supplied SQL — every call site is
//       a fixed, file-defined query, because the mirror carries no the platform tenant id of its own
//       and the only safe scope is "the Stripe ids this tenant's own `keystone` rows already link".
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { StripeSync } from "@supabase/stripe-sync-engine";
import { stripeSecretKeyForConfig } from "./charge.mjs";
import { webhookSigningSecret } from "../webhooks/verify.mjs";
import { withStripeMirrorConnection } from "../db/index.mjs";

// ★ The real account API version every other live Stripe call in this codebase already pins
//   (`src/money/stripeConnected.mjs`). The library defaults to '2020-08-27' if this is omitted
//   (confirmed from source, STRIPE-MIRROR.md §1.2) — silently reading a six-year-stale shape.
const STRIPE_API_VERSION = "2026-09-30.endive";

/** The one schema this implementation reads/writes. §3.2: the only tenant today is Docustay, which
 *  uses the platform's own direct account — not a Connect sub-account. */
const PLATFORM_SCHEMA = "stripe";

let syncInstance = null;

/**
 * The one `StripeSync` instance. Lazy so a process that never touches Stripe (a test run, a
 * script) never requires `KEYSTONE_STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to be set just to
 * import this module.
 * ★ `stripeSecretKeyForConfig`, not `stripeSecretKey` — this never moves money (§HARD LIMIT 1 in
 *   `charge.mjs` is scoped to the charge path only, confirmed by the maintainer's own 29 Sep 2026 ruling there),
 *   it only reads Stripe's own API responses to mirror them.
 */
export function getStripeSync(env = process.env) {
  if (syncInstance) return syncInstance;
  syncInstance = new StripeSync({
    // ★ The engine writes the mirror on ITS OWN login (`app_stripe_sync`, db/migrate.mjs#splitStripeSyncLogin). Without KEYSTONE_STRIPE_SYNC_DATABASE_URL it falls back to the application login — which works only
    //   on a database whose split is not enforced (dev, a fresh self-hosted install); once enforced, a missing variable fails loudly on the first write (permission denied for schema stripe), never silently.
    poolConfig: { connectionString: env.KEYSTONE_STRIPE_SYNC_DATABASE_URL || env.KEYSTONE_DATABASE_URL, max: 4 },
    schema: PLATFORM_SCHEMA,
    stripeSecretKey: stripeSecretKeyForConfig(env),
    // ★ The worker process runs the reconcile/backfill but never receives webhooks and may not carry
    //   STRIPE_WEBHOOK_SECRET. A placeholder here makes `processWebhook` in such a process FAIL CLOSED
    //   (no signature can match it) instead of making every non-webhook use throw at construction.
    stripeWebhookSecret: (() => { try { return webhookSigningSecret("stripe", env); } catch { return "whsec_not_configured_in_this_process"; } })(),
    stripeApiVersion: STRIPE_API_VERSION,
    autoExpandLists: true,
    backfillRelatedEntities: true,
  });
  return syncInstance;
}

/**
 * §3.5 — called right after the platform's own `verifyWebhookSignature` accepts the request, with the
 * SAME raw bytes and `Stripe-Signature` header already in scope. Deliberately never throws: the
 * mirror update and the platform's own business-logic dispatch are independent, so a payload shape the
 * library doesn't recognize yet must not turn into a 500 that makes Stripe retry an event the platform
 * itself already applied correctly.
 * @returns {Promise<{mirrored: boolean, reason?: string}>}
 */
export async function processStripeWebhook(rawBody, signatureHeader, env = process.env) {
  try {
    await getStripeSync(env).processWebhook(rawBody, signatureHeader);
    return { mirrored: true };
  } catch (err) {
    // ★ The engine THROWS "Unhandled webhook event" for every event type it has no handler for
    //   (payout.*, quote.*, invoice.upcoming, customer.source.expiring …). That is not a failure to
    //   mirror — there is nothing in the mirror for it — and counting it as one would raise the
    //   stripe_webhooks alarm on every such event. Benign; reported but never counted.
    if (/Unhandled webhook event/i.test(err?.message ?? "")) {
      return { mirrored: false, benign: true, reason: "unhandled_by_engine" };
    }
    console.error("stripe mirror: processWebhook failed, continuing without it:", err?.message ?? err);
    return { mirrored: false, reason: err?.message ?? String(err) };
  }
}

/**
 * §3.2 — the ONE place "which schema do I read for this tenant" is decided. Today: every tenant
 * resolves to the platform's own direct account, because Docustay is the only real tenant and it IS
 * that account (CLAUDE.md, 29 Sep 2026 ruling). The day a real Express-connected practice exists,
 * this grows a branch reading `keystone.connect_account` (via a tenant tx the caller already holds)
 * and returns a per-account schema (`stripe_<account_id>`) backed by a second `StripeSync`
 * instance — same pattern, not a redesign. `tenantId` is accepted now so no future call site needs
 * to change shape.
 */
function schemaForTenant(_tenantId) {
  return PLATFORM_SCHEMA;
}

/**
 * §3.4 — the only sanctioned read of the `stripe` schema. `sql` must be a fixed, file-defined
 * query written by the caller, schema-qualified (`stripe.invoices`, not `invoices`) — never a
 * caller-assembled WHERE clause. Scope every real query by the Stripe id(s) the caller's own
 * `keystone` row already links (e.g. `stripe_invoice_id`); the mirror itself has no the platform
 * tenant id to filter by.
 */
export async function queryMirror(tenantId, sql, params = []) {
  const schema = schemaForTenant(tenantId);
  if (!sql.includes(`${schema}.`)) {
    throw new Error(
      `queryMirror: query must be schema-qualified against "${schema}." — got: ${sql.slice(0, 80)}`);
  }
  return withStripeMirrorConnection((conn) => conn.query(sql, params));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THE SYNC ENGINE DOES NOT DO, DONE HERE (specs/STRIPE-MIRROR.md §1.3, §4 stage (e)/(f)):
//     the library has no payout support (no live handler, no backfill, no `syncSingleEntity`
//     prefix for `po_`), yet `stripe.payouts` exists. Payouts are written with the SAME
//     `jsonb_populate_record` shape for any Stripe object whose JSON field names match its
//     mirror table's columns — which is every table the engine creates.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const RAW_UPSERT_TABLES = new Set(["payouts"]);

export async function upsertRawStripeObject(table, obj, env = process.env) {
  if (!RAW_UPSERT_TABLES.has(table)) throw new Error(`upsertRawStripeObject: "${table}" is not an allowed mirror table`);
  if (!obj?.id) throw new Error("upsertRawStripeObject: object has no id");
  const sync = getStripeSync(env);
  const { rows } = await sync.postgresClient.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'stripe' AND table_name = $1`, [table]);
  const cols = rows.map((r) => r.column_name);
  // ★ `bank_account` is never on the payout object itself (only a `destination` id) — src/money/payoutLinks.mjs
  //   fills it from the expanded destination, so a re-upsert of the bare object must not wipe it.
  const set = cols.filter((c) => c !== "id").map((c) => (c === "bank_account"
    ? `"${c}" = COALESCE(EXCLUDED."${c}", stripe."${table}"."${c}")` : `"${c}" = EXCLUDED."${c}"`)).join(", ");
  const stamped = { ...obj, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await sync.postgresClient.query(
    `INSERT INTO stripe."${table}" SELECT * FROM jsonb_populate_record(NULL::stripe."${table}", $1::jsonb)
     ON CONFLICT (id) DO UPDATE SET ${set}`,
    [JSON.stringify(stamped)]);
}

/**
 * ★★★ §3.3 — "writes still go through Stripe's API as today, then the mirror refreshes from Stripe's
 *     own API RESPONSE, never from the platform's own assumption." Called by `stripeConnectedRequest`
 *     after every successful non-GET: re-reads the object Stripe just returned and upserts it.
 *     Best effort and never throws — the write already succeeded at Stripe; a mirror hiccup must not
 *     turn a real, completed charge/void/refund into an error for the caller. Anything missed is
 *     healed by the next webhook or the nightly reconciliation.
 */
export async function refreshMirrorObject(stripeId, env = process.env) {
  try {
    if (typeof stripeId !== "string" || !stripeId) return { refreshed: false, reason: "no_id" };
    const sync = getStripeSync(env);
    if (stripeId.startsWith("po_")) {
      const po = await sync.stripe.payouts.retrieve(stripeId);
      await upsertRawStripeObject("payouts", po, env);
      return { refreshed: true };
    }
    await sync.syncSingleEntity(stripeId);
    return { refreshed: true };
  } catch (err) {
    console.error("stripe mirror: refreshMirrorObject failed, continuing:", stripeId, err?.message ?? err);
    return { refreshed: false, reason: err?.message ?? String(err) };
  }
}

/** Test seam: drop the cached StripeSync (a different env/key). */
export function __resetStripeSyncForTests() { syncInstance = null; }

/**
 * ★★★ THE MIRROR'S OWN HEALTH ROW (keystone_meta.stripe_mirror_health, migration 0578) — what
 *     `stripe_webhooks` in src/health/watch.mjs reads, so a broken webhook finally alarms instead of
 *     reading "unknown". Best effort, never throws: failing to record health must not fail a webhook.
 *   · { webhook: true, failed } — a verified Stripe event reached the route; `failed` = the mirror
 *     update threw (counted until the next clean reconcile clears it).
 *   · { reconcile: { ok, driftCount, failedDeliveries, error, report } } — the nightly job's verdict.
 */
export async function recordMirrorHealth(patch, env = process.env) {
  try {
    const sync = getStripeSync(env);
    if (patch.webhook) {
      await sync.postgresClient.query(
        `UPDATE keystone_meta.stripe_mirror_health
            SET last_webhook_at = now(),
                webhook_failures_since = webhook_failures_since + $1,
                updated_at = now()
          WHERE id`, [patch.failed ? 1 : 0]);
    }
    if (patch.reconcile) {
      const r = patch.reconcile;
      await sync.postgresClient.query(
        `UPDATE keystone_meta.stripe_mirror_health
            SET last_reconcile_at = now(), last_reconcile_ok = $1, drift_count = $2,
                failed_deliveries = $3, last_error = $4, last_report = $5::jsonb,
                webhook_failures_since = CASE WHEN $1 THEN 0 ELSE webhook_failures_since END,
                updated_at = now()
          WHERE id`,
        [Boolean(r.ok), r.driftCount ?? 0, r.failedDeliveries ?? 0, r.error ?? null, JSON.stringify(r.report ?? null)]);
    }
  } catch (err) {
    console.error("stripe mirror: recordMirrorHealth failed, continuing:", err?.message ?? err);
  }
}
