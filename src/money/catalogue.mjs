// @ts-check
// src/money/catalogue.mjs — Stage 14 task 14.26. STRIPE CATALOGUE SYNC (0271's missing writer).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ WHAT THIS FILE IS FOR, AND WHY ITS TITLE NAMES A DEFECT CLASS. Migration 0271 added
//     `service.stripe_product_id` / `package.stripe_product_id` / `plan.stripe_product_id` /
//     `price.stripe_price_id` — nullable, with NO WRITER, by 0271's own header: "these columns are
//     the mirror TARGET spec 05/06 write into on 'success' … building the columns now, empty, means
//     spec 05 does not need its own items migration just to have somewhere to write the id."
//     Migration 0410 later added `discount.stripe_coupon_id` / `discount.stripe_promotion_code_id`
//     the same way — its own comment says outright: "`stripe_coupon_id`/`stripe_promotion_code_id`
//     are 14.26's own write (Stripe sync), left NULL here." THIS FILE is that writer, and it is
//     reached from the running application (not only from its own test) via the `catalogue_sync`
//     dispatcher listener and the `catalogue_stripe_sync` queue job — both registered in
//     `src/queue/tasks.mjs`, fired by the REAL `items.service.created` / `.package.created` /
//     `.plan.created` / `.price.changed` / `.discount.created` / `*.updated` events every catalogue
//     write route in `src/items/writes.mjs` already emits.
//
// ★★★ ON THE PRACTICE'S OWN CONNECTED ACCOUNT, NEVER THE PLATFORM'S (Group C ruling, CLAUDE.md /
//     GROUP-C-RECLUSTERED.md: "every person and payer account gets a Customer on THAT PRACTICE'S
//     connected account" — the same posture, one domain over, for the catalogue). `Stripe-Account:
//     <acct>` is read FRESH every sync from `getConnectAccountState` (src/money/connect.mjs) — no
//     caching, so a disconnect/reconnect is honoured on the very next sync, never a stale account id.
//
// ★★★ FIX, 29 Sep 2026 (Stripe/the platform sync task) — Docustay's `isDirectAccount` exception
//     (`connect.mjs`, the maintainer's ruling 28 Sep 2026) landed in `stripeConnected.mjs`'s
//     `stripeConnectedRequest` (`onAccount = false` when direct) but was never applied HERE — this
//     file has its own, separate Stripe-calling code and kept sending `Stripe-Account: <acct>`
//     unconditionally, even for a tenant whose key already resolves directly to that account.
//     `stripeHeaders` now takes `isDirectAccount` and omits the header in that case, matching the
//     already-fixed sibling file. ★ NOT the confirmed cause of the reported "success but nothing in
//     Stripe" symptom — MEASURED: the four life-coaching products this exact code path created via
//     this exact unconditional header exist and are fully formed in Stripe TEST mode, so Stripe did
//     not reject the self-referencing header here. The confirmed, sole, sufficient cause of that
//     symptom is `KEYSTONE_STRIPE_SECRET_KEY` being a test-mode key on both services (see the report).
//     Fixed anyway for correctness and to stop relying on undocumented Stripe leniency.
//
// ★★★ NO CLIENT DATA, EVER (CT-F18 / the blocked list: DOB, sobriety date, recovery fields, notes,
//     emergency contact, consent detail, guardian relationship). What travels to Stripe from this
//     file is: a catalogue item's own NAME (a service/package/plan/discount name — never a person's),
//     its `active` boolean, its price in minor units + currency, and — ONLY on a price row —
//     `location_id`/`delivery_mode` metadata, both closed enums on THIS PRACTICE's own settings
//     (0413). Nothing else is ever sent, in a body field or in metadata.
//
// ★★★ STRIPE DOWN NEVER BLOCKS THE SAVE (field 1). `syncCatalogueSubject` is called from the
//     `catalogue_stripe_sync` QUEUE JOB (src/queue/tasks.mjs) — never inline with `createService` /
//     `createPackage` / `createPlan` / `createDiscount` / `createPrice`, all of which already commit
//     and return to their caller before this file's first line ever runs.
//
// ★★★ IDEMPOTENT BY CONSTRUCTION — THE SAME EVENT ARRIVING TWICE MAKES ZERO EXTRA STRIPE CALLS,
//     NOT BECAUSE OF A DEDUPLICATION LAYER BUT BECAUSE EACH PIECE READS ITS OWN STORED ID FIRST:
//   · PRODUCT (service/package/plan) — Stripe products ARE mutable (a rename, an active toggle), so
//     this always CREATES when the row's `stripe_product_id` is NULL and always UPDATES in place
//     (`POST /v1/products/{id}`) when one is already stored — never a second product for one subject.
//   · PRICE — Stripe Prices are immutable, and this ruling is doubled by our own schema:
//     `keystone.price` is append-only (0024's trigger refuses to change `amount_minor`/`currency`/
//     `subject_type`/`subject_id`/`effective_from` on any row, ever). So once a price row's
//     `stripe_price_id` is set, THIS MODULE NEVER TOUCHES THAT ROW'S STRIPE OBJECT AGAIN — a
//     re-dispatched `items.price.changed`, or a completely different topic mapped to this same
//     listener, finds the id already there and makes no `/v1/prices` call for it. A changed amount
//     is always a NEW `price` row (createPrice's own supersede law) and therefore a NEW, separate
//     Stripe Price — never an edit to the old one, on either side.
//   · COUPON — `discount.kind`/`percent_bp`/`amount_minor`/`currency` have NO update route at all in
//     this codebase (0265's own comment: "retiring a discount and creating a new one is the only path
//     to changing its value"), so a coupon is created ONCE and never touched again once
//     `discount.stripe_coupon_id` is set — the exact same one-shot shape as a price.
//   · PROMOTION CODE — created once `discount.code` is present and no `stripe_promotion_code_id` is
//     stored yet; never re-created once it is.
//   In every case: read the local mirror column first: an id already there means "already done",
//   full stop. No Stripe call, no new object, no second row.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";
import { callOutside } from "../http/outside.mjs";
import { getConnectAccountState } from "./connect.mjs";
import { stripeSecretKeyForConfig } from "./charge.mjs";
import { metadataFor } from "./metadata.mjs";
import { encodeForm } from "./stripeConnected.mjs";
import { currentPrice } from "../items/writes.mjs";
// ★ L3.money/catalogue — every `tx.query(<static SQL>)` below now goes through the builder + `run`;
//   the SQL semantics are unchanged (same WHERE clauses, same RETURNING/row shapes, same
//   parameterization). `sql` is the escape hatch for what the builder itself does not express —
//   ANY(...) over an array parameter and a correlated EXISTS subquery over a runtime table name —
//   per the L3 per-file ruling: "SQL that calls plpgsql or uses features the builder lacks stays as
//   sql`…` through run".
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "items";
const STRIPE_PRODUCTS_URL = "https://api.stripe.com/v1/products";
const STRIPE_PRICES_URL = "https://api.stripe.com/v1/prices";
const STRIPE_COUPONS_URL = "https://api.stripe.com/v1/coupons";
const STRIPE_PROMOTION_CODES_URL = "https://api.stripe.com/v1/promotion_codes";

const CATALOGUE_PRODUCT_SUBJECTS = Object.freeze(["service", "package", "plan"]);
const CATALOGUE_SUBJECTS = Object.freeze([...CATALOGUE_PRODUCT_SUBJECTS, "discount"]);

/** ★ The subject type is also its own table name for service/package/plan — named once, here. */
const PRODUCT_TABLE = Object.freeze({ service: "service", package: "package", plan: "plan" });

/** ★ A `callOutside` failure, turned into the shape every sync step returns on refusal. */
function stripeFailure(out) {
  return {
    ok: false, reason: "stripe_error", retryable: out.retryable === true, kind: out.kind,
    detail: out.body?.error?.message ?? (out.status != null ? `Stripe returned ${out.status}` : "no reply from Stripe"),
  };
}

/** ★ field 4 — "invalid_request 'No such product' → re-create and log." Named narrowly on purpose:
 *   only a PRODUCT is ever re-created; a price/coupon is never updated at all (see header). */
function isNoSuchProduct(out) {
  return out.status === 400 && out.body?.error?.type === "invalid_request_error" &&
    typeof out.body?.error?.message === "string" && out.body.error.message.includes("No such product");
}

function stripeHeaders(apiKey, acct, isDirectAccount) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${apiKey}` };
  if (!isDirectAccount) headers["Stripe-Account"] = acct;
  return headers;
}

/** ★ Create-or-update — `existingId` null creates; set updates the SAME Stripe object in place.
 *   ★ FIX, 29 Sep 2026 — `metadata` (built by the caller: category, coaching_group/Life-Recovery
 *     tag, practice_id) was computed and never sent; this function accepted only name/active. */
async function upsertStripeProduct({ apiKey, acct, isDirectAccount, fetchImpl, logger, existingId, name, active, metadata = null }) {
  const headers = stripeHeaders(apiKey, acct, isDirectAccount);
  const body = () => encodeForm(metadata && Object.keys(metadata).length > 0
    ? { name, active: String(active), metadata }
    : { name, active: String(active) });

  if (existingId) {
    const out = await callOutside("stripe_catalogue_products_update",
      `${STRIPE_PRODUCTS_URL}/${encodeURIComponent(existingId)}`,
      { method: "POST", headers, body: body() }, { fetchImpl, timeoutMs: 20_000 });
    if (out.ok) return { ok: true, id: out.body.id, recreated: false };
    if (!isNoSuchProduct(out)) return stripeFailure(out);
    // ★ The stored id no longer names a real Stripe object (deleted on Stripe's side) — re-create,
    //   and LOG (field 4's own words), rather than fail the whole sync over a stale mirror.
    logger?.warn?.(
      `catalogue sync: stripe product ${existingId} no longer exists on Stripe — re-creating and ` +
      `re-pointing the local row.`);
  }

  const out = await callOutside("stripe_catalogue_products_create", STRIPE_PRODUCTS_URL,
    { method: "POST", headers, body: body() }, { fetchImpl, timeoutMs: 20_000 });
  if (!out.ok) return stripeFailure(out);
  return { ok: true, id: out.body.id, recreated: existingId != null };
}

/** ★ FIX, 29 Sep 2026 — `keystone.plan.interval` (0009: week/month/quarter/year) maps to Stripe's
 *   `recurring[interval]` (day/week/month/year, no "quarter" of its own — expressed as month×3). */
function stripeRecurringFor(planInterval) {
  if (!planInterval) return null;
  if (planInterval === "quarter") return { interval: "month", interval_count: 3 };
  if (["week", "month", "year"].includes(planInterval)) return { interval: planInterval, interval_count: 1 };
  return null;
}

/** ★ NEVER called once `price.stripe_price_id` is set — see the header's PRICE paragraph.
 *  ★ FIX, 29 Sep 2026 — `recurring` (a plan's billing interval) was never sent, so every plan price
 *    synced as a one-time Stripe Price instead of a subscription price. */
async function createStripePrice({ apiKey, acct, isDirectAccount, fetchImpl, productId, amountMinor, currency, locationId, deliveryMode, metadata = null, recurring = null }) {
  const metadataFields = { service_id: productId, practice_id: acct, location_id: locationId, delivery_mode: deliveryMode };
  const actualMetadata = metadata ?? metadataFor("price", metadataFields);
  const formObj = {
    product: productId,
    unit_amount: String(amountMinor),
    currency: currency.toLowerCase(),
    metadata: actualMetadata,
  };
  if (recurring) formObj.recurring = recurring;
  const out = await callOutside("stripe_catalogue_prices_create", STRIPE_PRICES_URL,
    { method: "POST", headers: stripeHeaders(apiKey, acct, isDirectAccount), body: encodeForm(formObj) }, { fetchImpl, timeoutMs: 20_000 });
  if (!out.ok) return stripeFailure(out);
  return { ok: true, id: out.body.id };
}

/**
 * ★ the maintainer, 29 Sep 2026 — "archive the old one." A Stripe Price is immutable but its `active` flag is
 *   not — this is the one field this module is ever allowed to change on an already-synced price.
 *   Called ONCE per superseded row (see the header's PRICE paragraph and 0534's own header for why
 *   `stripe_archived_at` is what makes that "once" true rather than "every sync, forever").
 */
async function archiveStripePrice({ apiKey, acct, isDirectAccount, fetchImpl, priceId }) {
  const out = await callOutside("stripe_catalogue_prices_archive",
    `${STRIPE_PRICES_URL}/${encodeURIComponent(priceId)}`,
    { method: "POST", headers: stripeHeaders(apiKey, acct, isDirectAccount), body: encodeForm({ active: "false" }) },
    { fetchImpl, timeoutMs: 20_000 });
  if (!out.ok) return stripeFailure(out);
  return { ok: true, id: out.body.id };
}

/** ★ NEVER called once `discount.stripe_coupon_id` is set — see the header's COUPON paragraph. */
async function createStripeCoupon({ apiKey, acct, isDirectAccount, fetchImpl, name, kind, percentBp, amountMinor, currency, validTo, appliesToProducts = [] }) {
  const params = new URLSearchParams({ name, duration: "forever" });
  if (kind === "percent") params.set("percent_off", String(percentBp / 100));
  else { params.set("amount_off", String(amountMinor)); params.set("currency", currency.toLowerCase()); }
  if (validTo) params.set("redeem_by", String(Math.floor(new Date(validTo).getTime() / 1000)));
  // ★ applies_to[products] — array of Stripe product IDs this coupon is valid for
  if (appliesToProducts && appliesToProducts.length > 0) {
    appliesToProducts.forEach((prodId, idx) => params.set(`applies_to[products][${idx}]`, prodId));
  }
  const out = await callOutside("stripe_catalogue_coupons_create", STRIPE_COUPONS_URL,
    { method: "POST", headers: stripeHeaders(apiKey, acct, isDirectAccount), body: params.toString() }, { fetchImpl, timeoutMs: 20_000 });
  if (!out.ok) return stripeFailure(out);
  return { ok: true, id: out.body.id };
}

/** ★ NEVER called once `discount.stripe_promotion_code_id` is set. */
async function createStripePromotionCode({ apiKey, acct, isDirectAccount, fetchImpl, couponId, code, restrictions = {} }) {
  const params = new URLSearchParams({ coupon: couponId, code });
  // ★ restrictions: first_time_transaction (boolean), minimum_amount (integer in cents)
  if (restrictions.first_time_transaction) {
    params.set("restrictions[first_time_transaction]", "true");
  }
  if (restrictions.minimum_amount_cents != null) {
    params.set("restrictions[minimum_amount_cents]", String(restrictions.minimum_amount_cents));
  }
  const out = await callOutside("stripe_catalogue_promotion_codes_create", STRIPE_PROMOTION_CODES_URL,
    { method: "POST", headers: stripeHeaders(apiKey, acct, isDirectAccount), body: params.toString() }, { fetchImpl, timeoutMs: 20_000 });
  if (!out.ok) return stripeFailure(out);
  return { ok: true, id: out.body.id };
}

async function syncProductAndPrices(tx, { tenantId, subjectType, subjectId, acct, isDirectAccount, apiKey, fetchImpl, logger }) {
  const table = PRODUCT_TABLE[subjectType];
  // ★ QUEUE §4 — `program_id` exists on all three catalogue subjects, unlike category_id (service-only).
  // ★ FIX, 29 Sep 2026 — `interval` (0009: week/month/quarter/year) is `plan`-only, selected here so
  //   its price can sync as a recurring Stripe Price instead of a one-time charge (see below).
  // ★★★ FOUND LIVE, Programs follow-up brief (30 Sep 2026, Part 9) — MEASURED: `archiveRecord`/
  //     `restoreRecord` (src/records/archive.mjs) only ever set/clear `archived_at`, and neither
  //     `items.service.archived` nor `items.plan.archived` was registered to the CATALOGUE_SYNC
  //     dispatcher (src/queue/tasks.mjs's HANDLER_LISTENER map) at all — archiving a service or plan
  //     told nobody outside this app. Even sending the event, this function never selected
  //     `archived_at` or read it, so `upsertStripeProduct`'s `active` param was always just
  //     `subject.active` — an archived-but-still-active-flagged row would have kept syncing to
  //     Stripe as `active: true`, fully purchasable, indefinitely. `archived_at` is added to every
  //     subject's column list (service/plan already carry it; package as of migration 0544) and
  //     folded into the Stripe-bound active flag below — SILENT-FAILURE class, now closed.
  const productCols = subjectType === "service"
    ? ["id", "name", "active", "stripe_product_id", "category_id", "program_id", "archived_at"]
    : subjectType === "plan"
    ? ["id", "name", "active", "stripe_product_id", "program_id", "interval", "archived_at"]
    : ["id", "name", "active", "stripe_product_id", "program_id", "archived_at"];
  const { rows } = await run(tx, db
    .selectFrom(`keystone.${table}`)
    .select(productCols)
    .where("tenant_id", "=", tenantId)
    .where("id", "=", subjectId));
  const subject = rows[0];
  if (!subject) return { state: "not_synced", reason: "subject_gone", retryable: false };

  // ★ Build metadata for the product: service includes category snapshot; every subject includes
  //   the program (id + name) so the metadata is never dropped just because there was no
  //   category to report.
  const KIND_OF = { service: "service", package: "package", plan: "subscription" };
  // ★ QUEUE §4 — the Program rides along as id + name (replaces coaching_group).
  let programFacts = {};
  if (subject.program_id) {
    const { rows: prog } = await run(tx, db.selectFrom("keystone.program").select(["id", "name"]).where("tenant_id", "=", tenantId).where("id", "=", subject.program_id));
    if (prog[0]) programFacts = { program_id: prog[0].id, program: prog[0].name };
  }
  let productMetadata = {};
  if (subjectType === "service" && subject.category_id) {
    const { rows: catRows } = await run(tx, db
      .selectFrom("keystone.service_category")
      .select(["id", "name"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", subject.category_id));
    if (catRows[0]) {
      productMetadata = metadataFor("product", { service_id: subjectId, practice_id: acct, category: `${catRows[0].id}:${catRows[0].name}`, kind: KIND_OF[subjectType], ...programFacts });
    }
  }
  if (Object.keys(productMetadata).length === 0) {
    productMetadata = metadataFor("product", { service_id: subjectId, practice_id: acct, kind: KIND_OF[subjectType], ...programFacts });
  }

  // ★ QUEUE §4 — Stripe MERGES metadata, so a product synced before this release still carries `coaching_group`. An empty value UNSETS it
  //   (Stripe's own rule); this line is the whole migration of already-synced products — it fires on their next sync.
  productMetadata = { ...productMetadata, coaching_group: "" };

  // ★ An archived row is never purchasable on Stripe regardless of its own `active` column — see
  //   the FOUND LIVE note above this function's column list.
  const stripeActive = subject.active && !subject.archived_at;
  const product = await upsertStripeProduct({
    apiKey, acct, isDirectAccount, fetchImpl, logger, existingId: subject.stripe_product_id, name: subject.name, active: stripeActive,
    metadata: productMetadata,
  });
  if (!product.ok) {
    return { state: "not_synced", reason: product.reason, retryable: product.retryable, kind: product.kind, detail: product.detail };
  }
  if (product.id !== subject.stripe_product_id) {
    await run(tx, db
      .updateTable(`keystone.${table}`)
      .set({ stripe_product_id: product.id ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", subjectId));
  }

  // ★ "each active price row" (field 4) — read as the price supersede law reads it: the CURRENT
  //   (open) row(s) for this subject, which may be more than one under 0413's location/mode variants.
  const priceQuery = subjectType === "service"
    ? db.selectFrom("keystone.price as p")
        .leftJoin("keystone.service as s", (join) => join
          .onRef("s.tenant_id", "=", "p.tenant_id")
          .onRef("s.id", "=", "p.subject_id"))
        .select(["p.id", "p.amount_minor", "p.currency", "p.location_id", "p.delivery_mode", "p.stripe_price_id", "s.unit_label"])
        .where("p.tenant_id", "=", tenantId)
        .where("p.subject_type", "=", subjectType)
        .where("p.subject_id", "=", subjectId)
        .where("p.effective_to", "is", null)
    : db.selectFrom("keystone.price")
        .select(["id", "amount_minor", "currency", "location_id", "delivery_mode", "stripe_price_id"])
        .where("tenant_id", "=", tenantId)
        .where("subject_type", "=", subjectType)
        .where("subject_id", "=", subjectId)
        .where("effective_to", "is", null);
  const { rows: priceRows } = await run(tx, priceQuery);

  for (const p of priceRows) {
    if (p.stripe_price_id) continue; // ★ already synced — see the header's PRICE paragraph

    // ★ Build metadata for price: includes unit_label if service and it exists
    let priceMetadata = { service_id: subjectId, practice_id: acct, location_id: p.location_id, delivery_mode: p.delivery_mode };
    if (subjectType === "service" && p.unit_label) {
      priceMetadata.unit_label = p.unit_label;
    }
    const metadata = metadataFor("price", priceMetadata);

    const price = await createStripePrice({
      apiKey, acct, isDirectAccount, fetchImpl, productId: product.id, amountMinor: p.amount_minor, currency: p.currency,
      locationId: p.location_id, deliveryMode: p.delivery_mode, metadata,
      recurring: subjectType === "plan" ? stripeRecurringFor(subject.interval) : null,
    });
    if (!price.ok) {
      return { state: "not_synced", reason: price.reason, retryable: price.retryable, kind: price.kind, detail: price.detail };
    }
    await run(tx, db
      .updateTable("keystone.price")
      .set({ stripe_price_id: price.id ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", p.id));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // ★★★ the maintainer, 29 Sep 2026 — "archive the old one." A row that WAS open, got a Stripe Price above
  //     (this sync or an earlier one), and has SINCE been superseded (§Z4's supersede closes
  //     `effective_to`) keeps its Stripe Price sitting `active: true` forever unless something
  //     turns it off — Stripe Prices have no "this one replaced that one" concept of their own.
  //     `stripe_archived_at IS NULL` is the same "read the local mirror first" idiom the rest of
  //     this file uses (0534's own header) — a row this has already archived is never revisited.
  // ═══════════════════════════════════════════════════════════════════════════════════════
  const { rows: supersededRows } = await run(tx, db
    .selectFrom("keystone.price")
    .select(["id", "stripe_price_id"])
    .where("tenant_id", "=", tenantId)
    .where("subject_type", "=", subjectType)
    .where("subject_id", "=", subjectId)
    .where("effective_to", "is not", null)
    .where("stripe_price_id", "is not", null)
    .where("stripe_archived_at", "is", null));

  for (const s of supersededRows) {
    const archived = await archiveStripePrice({ apiKey, acct, isDirectAccount, fetchImpl, priceId: s.stripe_price_id });
    if (!archived.ok) {
      // ★ Never fails the whole sync over a superseded price that would not archive (a stale id,
      //   Stripe unreachable) — the NEW price is already live and bookable either way, which is
      //   the outcome that matters most; this stays for the next sync to retry.
      logger?.warn?.(
        `catalogue sync: could not archive superseded Stripe price ${s.stripe_price_id} ` +
        `for ${subjectType} ${subjectId}: ${archived.detail}`);
      continue;
    }
    await run(tx, db
      .updateTable("keystone.price")
      .set({ stripe_archived_at: sql`now()` })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", s.id));
  }

  return { state: "in_sync", stripeProductId: product.id };
}

async function syncDiscount(tx, { tenantId, subjectId, acct, isDirectAccount, apiKey, fetchImpl }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.coupon")
    .select(["id", "name", "kind", "percent_bp", "amount_minor", "currency", "valid_to", "stripe_coupon_id",
      "target_ids", "first_purchase_only", "per_person_limit"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", subjectId));
  const coupon = rows[0];
  if (!coupon) return { state: "not_synced", reason: "subject_gone", retryable: false };

  let couponId = coupon.stripe_coupon_id;
  if (!couponId) {
    // ★ Resolve target_ids (service IDs) to Stripe product IDs
    let appliesToProducts = [];
    if (coupon.target_ids && coupon.target_ids.length > 0) {
      // ★ L3 — ANY($2) over an array parameter is a builder-lacks case (same as credits.mjs's
      //   SPENDABLE ANY(...)); kept as a whole statement through run.
      const { rows: serviceRows } = await run(tx, sql`
        SELECT stripe_product_id FROM keystone.service
         WHERE tenant_id = ${tenantId} AND id = ANY(${sql.val(coupon.target_ids)}) AND stripe_product_id IS NOT NULL
      `);
      appliesToProducts = serviceRows.map((r) => r.stripe_product_id);
    }

    const stripeCoupon = await createStripeCoupon({
      apiKey, acct, isDirectAccount, fetchImpl, name: coupon.name, kind: coupon.kind, percentBp: coupon.percent_bp,
      amountMinor: coupon.amount_minor, currency: coupon.currency, validTo: coupon.valid_to,
      appliesToProducts,
    });
    if (!stripeCoupon.ok) {
      return { state: "not_synced", reason: stripeCoupon.reason, retryable: stripeCoupon.retryable, kind: stripeCoupon.kind, detail: stripeCoupon.detail };
    }
    couponId = stripeCoupon.id;
    await run(tx, db
      .updateTable("keystone.coupon")
      .set({ stripe_coupon_id: couponId ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", subjectId));
  }

  // ★ Check for existing promotion_code rows for this coupon and sync them
  const { rows: codeRows } = await run(tx, db
    .selectFrom("keystone.promotion_code")
    .select(["id", "code", "stripe_promotion_code_id"])
    .where("tenant_id", "=", tenantId)
    .where("coupon_id", "=", subjectId)
    .where("stripe_promotion_code_id", "is", null));

  let syncedCodes = 0;
  for (const codeRow of codeRows) {
    // ★ Build restrictions from coupon's rules: first_purchase_only → first_time_transaction,
    //   per_person_limit → maximum_redemptions (per customer). These move from "ours-only rules"
    //   to "Stripe enforces at redemption" per the F20 ruling.
    const restrictions = {};
    if (coupon.first_purchase_only) {
      restrictions.first_time_transaction = true;
    }
    // ★ per_person_limit would map to maximum_redemptions on the promotion code itself,
    //   but Stripe's API does not expose per-customer limits on promotion codes — only on the coupon.
    //   We pass what we can, and app enforcement handles the rest.

    const promo = await createStripePromotionCode({ apiKey, acct, isDirectAccount, fetchImpl, couponId, code: codeRow.code, restrictions });
    if (!promo.ok) {
      return { state: "not_synced", reason: promo.reason, retryable: promo.retryable, kind: promo.kind, detail: promo.detail };
    }
    await run(tx, db
      .updateTable("keystone.promotion_code")
      .set({ stripe_promotion_code_id: promo.id ?? null })
      .where("tenant_id", "=", tenantId)
      .where("id", "=", codeRow.id));
    syncedCodes++;
  }

  return { state: "in_sync", stripeCouponId: couponId, syncedPromotionCodes: syncedCodes };
}

/**
 * ★★★ THE ENTRY POINT — called by the `catalogue_stripe_sync` job (src/queue/tasks.mjs), itself
 *     enqueued by the `catalogue_sync` dispatcher listener. Never called inline with a catalogue
 *     write (field 1: "Stripe down never blocks the save").
 * ★★ NEVER THROWS FOR A PROVIDER FAILURE — same posture as `callOutside`/`createChargeIntent`
 *    (src/money/charge.mjs): it RETURNS an outcome, and its caller (the job wrapper in
 *    src/queue/tasks.mjs) is what turns a retryable outcome into a `JobFailure` so the job policy's
 *    ladder actually retries — the same shape `deliverNotificationEmail`/`emailFailure` already use.
 * @returns {Promise<{state:'in_sync'|'not_synced', reason?:string, retryable?:boolean, kind?:string, detail?:string}>}
 */
export async function syncCatalogueSubject(tx, { tenantId, subjectType, subjectId },
                                            { fetchImpl = globalThis.fetch, env = process.env, logger = null } = {}) {
  // ★ modifier is not in CATALOGUE_SUBJECTS for registration purposes (0411 predates the job queue),
  //   but it IS handled by the sync flow when dispatched.
  if (!CATALOGUE_SUBJECTS.includes(subjectType) && subjectType !== "modifier") {
    throw new Error(`syncCatalogueSubject: subjectType must be one of ${CATALOGUE_SUBJECTS.join(", ")}, or "modifier" — got ${JSON.stringify(subjectType)}`);
  }

  // ★★★ MODIFIER → STRIPE IS NOT BUILT (RUN-2 ruling, 26 Sep 2026). As written it could never work:
  //     items.modifier.created carries subjectId null; `modifier` is not a SUBJECT_TYPE so every emit
  //     below threw; syncModifier looked its price up by price.metadata (no such column) and then
  //     inserted the modifier's DELTA as a new open BASE price for each service (refused only by
  //     price_variation_one_open). Returned honestly, before any emit or query, so the job does not
  //     die on every modifier save. A modifier's Stripe price needs its own table — F-R2-6.
  if (subjectType === "modifier") {
    return { state: "not_synced", reason: "not_built" };
  }

  // ★★★ field 4 — "if no live connected account → return {state:'not_synced', reason:'no_connect'}".
  //     Read FRESH every call, no cache — a disconnect/reconnect is honoured on the very next sync.
  const connect = await getConnectAccountState(tx, tenantId);
  if (connect.state !== "live") {
    await emit(tx, {
      tenantId, topic: "items.catalogue.synced", emittedBy: SECTION, subjectType, subjectId, actor: "worker",
      payload: { subject_type: subjectType, state: "not_synced" },
    });
    return { state: "not_synced", reason: "no_connect" };
  }

  // ★ the maintainer's ruling, 29 Sep 2026 — a catalogue sync creates/updates Products, Prices, Coupons and
  //   Promotion Codes. None of that moves money, so it takes the config-only key (no live-charge
  //   approval needed) — see stripeSecretKeyForConfig's own header in charge.mjs.
  const apiKey = stripeSecretKeyForConfig(env);
  const isDirectAccount = connect.isDirectAccount === true;
  let result;
  if (subjectType === "discount") {
    result = await syncDiscount(tx, { tenantId, subjectId, acct: connect.stripeAccountId, isDirectAccount, apiKey, fetchImpl });
  } else {
    result = await syncProductAndPrices(tx, { tenantId, subjectType, subjectId, acct: connect.stripeAccountId, isDirectAccount, apiKey, fetchImpl, logger });
  }

  await emit(tx, {
    tenantId, topic: "items.catalogue.synced", emittedBy: SECTION, subjectType, subjectId, actor: "worker",
    payload: { subject_type: subjectType, state: result.state },
  });

  return result;
}

/**
 * ★★★ THE BACKFILL — `{tenantId, all:true}` (field 4/field 9). Walks every service/package/plan
 *     whose product or an open price row is not yet synced, and every discount whose coupon is not
 *     yet synced, syncing each in turn. Enqueued ONCE PER PRACTICE by the Stage 14 deploy step
 *     (documented in the close record) — never by a scheduled sweep in this file.
 */
export async function backfillCatalogueSync(tx, { tenantId }, deps = {}) {
  const results = [];
  for (const subjectType of CATALOGUE_PRODUCT_SUBJECTS) {
    const table = PRODUCT_TABLE[subjectType];
    // ★ L3 — a correlated EXISTS subquery over a runtime table name is a builder-lacks case; kept
    //   as a whole statement through run. `sql.table` safely renders the dynamic identifier
    //   (PRODUCT_TABLE's own fixed allowlist, never user input).
    const { rows } = await run(tx, sql`
      SELECT s.id FROM ${sql.table(`keystone.${table}`)} s
       WHERE s.tenant_id = ${tenantId}
         AND (s.stripe_product_id IS NULL OR EXISTS (
           SELECT 1 FROM keystone.price p
            WHERE p.tenant_id = s.tenant_id AND p.subject_type = ${subjectType} AND p.subject_id = s.id
              AND p.effective_to IS NULL AND p.stripe_price_id IS NULL))
    `);
    for (const row of rows) {
      const outcome = await syncCatalogueSubject(tx, { tenantId, subjectType, subjectId: row.id }, deps);
      results.push({ subjectType, subjectId: row.id, ...outcome });
    }
  }
  const { rows: discountRows } = await run(tx, db
    .selectFrom("keystone.coupon")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .where("stripe_coupon_id", "is", null));
  for (const row of discountRows) {
    const outcome = await syncCatalogueSubject(tx, { tenantId, subjectType: "discount", subjectId: row.id }, deps);
    results.push({ subjectType: "discount", subjectId: row.id, ...outcome });
  }
  return { synced: results.filter((r) => r.state === "in_sync").length,
            notSynced: results.filter((r) => r.state !== "in_sync").length, results };
}
