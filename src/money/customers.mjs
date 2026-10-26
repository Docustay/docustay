// @ts-check
// C1.2 — STRIPE CUSTOMER SYNC. Ensure every person/account gets a Customer on the practice's
// connected Stripe account.
//
// ★★★ STRIPE IS THE MONEY RECORD — THE PLATFORM MIRRORS ONLY. The Stripe-Account header
//     routes all calls to the practice's own connected account. Every person and account gets
//     a Customer there, and the platform stores the id.
//
// ★ NO CONNECT ACCOUNT → QUEUE AND RETURN. If the practice hasn't connected their Stripe account,
//   the customer creation is queued (stored as null). Later, when the account connects,
//   backfillCustomers() creates them all.
//
// ★ IDEMPOTENCY KEY — DOUBLE-CREATE IS ONE CUSTOMER. Same (tenantId, personId) always produces
//   the same key, so concurrent requests produce one customer, not two.
//
// ★★★ BLOCKED LIST — NEVER SENT TO STRIPE. date_of_birth, sobriety_date, recovery_programme,
//     sponsor_name, support_network, notes, emergency_contact_*, consent_status_detail,
//     guardian_relationship must NEVER leave the platform, not even in metadata. That is not
//     an optimization; it is the contract.

import { getConnectAccountState } from "./connect.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { metadataFor } from "./metadata.mjs";
// ★ L3.money/customers — every `tx.query(<static SQL>)` below now goes through the builder + `run`;
//   the SQL semantics are unchanged (same WHERE clauses, same columns, same parameterization).
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

/**
 * Idempotency key for a person, derived from tenantId + personId.
 * Same input always produces the same key, so concurrent requests produce one customer.
 */
export function customerIdempotencyKey({ tenantId, personId, accountId = null }) {
  const targetId = personId || accountId;
  if (!targetId) throw new Error("customerIdempotencyKey needs personId or accountId");
  return `customer:${tenantId}:${targetId}`;
}

/**
 * Build the Stripe customer payload. TESTABLE — call this to check what Stripe will see.
 * ★ BLOCKED LIST: no date_of_birth, sobriety_date, recovery_programme, sponsor_name,
 *   support_network, notes, emergency_contact_*, consent_status_detail, guardian_relationship.
 *
 * @param person - the app_user row (for a person) or account row (for an account)
 * @param tenant - the tenant row { id, slug, ... }
 * @returns { name, email, phone, address, description, metadata, idempotency_key }
 */
export function buildCustomerPayload({ person, tenant, isAccount = false }) {
  if (!person || !tenant) throw new Error("buildCustomerPayload needs person and tenant");

  const payload = {};

  // Name
  if (person.display_name) payload.name = person.display_name;

  // Email
  if (person.email) payload.email = person.email;

  // Phone
  if (person.mobile_phone) payload.phone = person.mobile_phone;

  // Address — only on people; accounts have billing_* columns
  if (!isAccount && (person.address_line1 || person.city || person.state_region || person.postcode || person.country)) {
    payload.address = {};
    if (person.address_line1) payload.address.line1 = person.address_line1;
    if (person.address_line2) payload.address.line2 = person.address_line2;
    if (person.city) payload.address.city = person.city;
    if (person.state_region) payload.address.state = person.state_region;
    if (person.postcode) payload.address.postal_code = person.postcode;
    if (person.country) payload.address.country = person.country;
  }

  // Address for accounts (billing_* columns)
  if (isAccount && (person.billing_line1 || person.billing_city || person.billing_state_region || person.billing_postcode || person.billing_country)) {
    payload.address = {};
    if (person.billing_line1) payload.address.line1 = person.billing_line1;
    if (person.billing_line2) payload.address.line2 = person.billing_line2;
    if (person.billing_city) payload.address.city = person.billing_city;
    if (person.billing_state_region) payload.address.state = person.billing_state_region;
    if (person.billing_postcode) payload.address.postal_code = person.billing_postcode;
    if (person.billing_country) payload.address.country = person.billing_country;
  }

  // Description
  if (person.description) payload.description = person.description;

  // ★ the maintainer, 29 Sep 2026 — F: `POST /customers` has no top-level `currency` parameter; Stripe's own
  //   Customer-object currency is set from the account/first charge, never supplied at create.
  //   A live `currency: "usd"` here was rejected outright ("Received unknown parameter: currency"),
  //   which is why creating Docustay's first real client 502'd — no test tenant had ever had a live
  //   Connect account, so `ensureCustomer` had only ever taken the no-Connect queue-and-return path.

  // Metadata — composed through metadataFor("customer", …), the ONE writer of Stripe metadata
  // (F785/F787). The ten keys below are the ones test/c_stripe_sync.test.mjs requires, and they are
  // ALWAYS present (blank string when unknown) so the shape itself is provable without a live person
  // row.
  // ★★★ THE BLOCKED LIST NEVER ENTERS THIS OBJECT — only these ten named fields are read from
  //     `person`; date_of_birth, sobriety_date, recovery_programme, sponsor_name, support_network,
  //     notes, emergency_contact_*, consent_status_detail, guardian_relationship are never touched.
  // ★★★ the maintainer, 29 Sep 2026 — "parent" is no longer a `role`; a person is `adult_client` or
  //   `adolescent_client` and the SHORT word is what Stripe sees ("adult"/"adolescent"), never the
  //   raw enum. `tags` is the four system tags (Adult/Adolescent/Parent/Lead — CLAUDE.md's own
  //   ruling), comma-joined since Stripe metadata values are strings. `person.is_guardian` is
  //   computed by the CALLER (a `keystone.guardian` EXISTS check), never re-derived from role.
  const roleLabel = person.role === "adult_client" ? "adult"
    : person.role === "adolescent_client" ? "adolescent"
    : String(person.role || (isAccount ? "account" : ""));
  const tags = [];
  if (person.role === "adult_client") tags.push("adult");
  if (person.role === "adolescent_client") tags.push("adolescent");
  if (person.is_guardian) tags.push("parent");
  if (person.lifecycle_status === "lead") tags.push("lead");

  payload.metadata = metadataFor("customer", {
    workbench_person_id: String(!isAccount ? (person.id ?? "") : ""),
    workbench_tenant_id: String(tenant.id ?? ""),
    tenant_slug: String(tenant.slug ?? ""),
    role: roleLabel,
    tags: tags.join(","),
    lifecycle_status: String(person.lifecycle_status ?? ""),
    assigned_coach_id: String(person.assigned_coach_id ?? ""),
    account_id: String(isAccount ? (person.id ?? "") : (person.account_id ?? "")),
    consent_status: String(person.consent_status ?? ""),
    source: String(person.source ?? ""),
    created_in_workbench_at: String(person.created_in_workbench_at ?? ""),
  });

  return payload;
}

/**
 * Ensure a customer exists for this person on the practice's connected Stripe account.
 * If no Connect account, return { customerId: null, queued: true }.
 * Otherwise create on Stripe and store the id.
 *
 * @returns { customerId, created, livemode } or { customerId: null, queued: true }
 */
export async function ensureCustomer(tx, { tenantId, personId = null, accountId = null, fetchImpl = fetch }) {
  if (!tenantId) throw new Error("ensureCustomer needs tenantId");
  if (!personId && !accountId) throw new Error("ensureCustomer needs personId or accountId");

  const isAccount = Boolean(accountId);
  const targetId = personId || accountId;

  // Check if Connect account exists
  const connectState = await getConnectAccountState(tx, tenantId);
  if (connectState.state !== "live" || !connectState.stripeAccountId) {
    // No Connect account — queue the customer (store as null)
    return { customerId: null, queued: true };
  }

  // Fetch the person/account row to build the payload
  const table = isAccount ? "account" : "app_user";
  const { rows } = isAccount
    ? await run(tx, db
        .selectFrom(`keystone.${table}`)
        .selectAll()
        .where("id", "=", targetId)
        .where("tenant_id", "=", tenantId))
    // ★ the maintainer, 29 Sep 2026 — the Parent TAG, a fact (a keystone.guardian row), never a role. Accounts
    //   have no guardian concept, so `is_guardian` is only selected for a person.
    : await run(tx, db
        .selectFrom(`keystone.${table}`)
        .selectAll()
        .select(sql`EXISTS (
            SELECT 1 FROM keystone.guardian g WHERE g.guardian_user_id = "app_user".id
          )`.as("is_guardian"))
        .where("id", "=", targetId)
        .where("tenant_id", "=", tenantId));

  if (rows.length === 0) {
    throw new Error(`ensureCustomer: ${isAccount ? "account" : "person"} not found`);
  }

  const row = rows[0];

  // Fetch the tenant row for slug
  const { rows: tenantRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select(["id", "slug"])
    .where("id", "=", tenantId));
  if (tenantRows.length === 0) {
    throw new Error("ensureCustomer: tenant not found");
  }
  const tenant = tenantRows[0];

  // Build the payload
  const payload = buildCustomerPayload({ person: row, tenant, isAccount });

  // Build form object (excluding null/undefined values)
  const formObj = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== null && value !== undefined) {
      formObj[key] = value;
    }
  }

  const idempotencyKey = customerIdempotencyKey({ tenantId, personId, accountId });

  // ★★★ the maintainer, 29 Sep 2026 — WAS a hand-rolled fetch straight to api.stripe.com, with an
  //   UNCONDITIONAL `Stripe-Account` header. That header is exactly what Docustay's direct-account
  //   case (this account was never made a Connect platform) makes Stripe reject — routing this
  //   through `stripeConnectedRequest` is what makes the Docustay special case (isDirectAccount ⇒
  //   the header is dropped) actually apply here too, same as every other Stripe call.
  const { body } = await stripeConnectedRequest(tx, {
    tenantId, method: "POST", path: "/customers", form: formObj, idempotencyKey,
    movesMoney: false, purpose: "customer_create",
  }, { fetchImpl });

  const customerId = body?.id;
  const livemode = body?.livemode;

  if (!customerId) {
    throw new Error("Stripe did not return a customer id");
  }

  // Store the customer id on the person/account row
  await run(tx, db
    .updateTable(`keystone.${table}`)
    .set({ stripe_customer_id: customerId, stripe_livemode: livemode ?? null, stripe_synced_at: sql`now()` })
    .where("id", "=", targetId)
    .where("tenant_id", "=", tenantId));

  // ★ 0587 — register the customer so a Stripe event ABOUT it (a charge, a refund, an invoice) finds this practice. Only account ids were ever
  //   registered, so events on the platform account (Docustay) resolved no practice and the platform's own handlers never ran.
  await run(tx, db.selectNoFrom(sql`keystone.ensure_stripe_customer_source(${sql.val(customerId)})`.as("id")));

  return { customerId, created: true, livemode };
}

/**
 * Backfill customers for all people/accounts that are queued (have stripe_customer_id = null
 * but should have one now that Connect is set up). Batched to 100 at a time, resumable.
 *
 * @returns { created: number }
 */
export async function backfillCustomers(tx, tenantId, { fetchImpl = fetch, batchSize = 100 } = {}) {
  if (!tenantId) throw new Error("backfillCustomers needs tenantId");

  const connectState = await getConnectAccountState(tx, tenantId);
  if (connectState.state !== "live" || !connectState.stripeAccountId) {
    // Nothing to backfill without a Connect account
    return { created: 0 };
  }

  // Find queued people (stripe_customer_id IS NULL, not archived)
  const { rows: queuedPeople } = await run(tx, db
    .selectFrom("keystone.app_user")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("stripe_customer_id", "is", null)
    .where("archived_at", "is", null)
    .limit(batchSize));

  let createdCount = 0;
  for (const row of queuedPeople) {
    try {
      await ensureCustomer(tx, { tenantId, personId: row.id, fetchImpl });
      createdCount++;
    } catch (e) {
      // Log but continue — one failure should not block the whole backfill
      console.error(`backfillCustomers: failed to create customer for person ${row.id}:`, e.message);
    }
  }

  // Also backfill accounts
  const { rows: queuedAccounts } = await run(tx, db
    .selectFrom("keystone.account")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("stripe_customer_id", "is", null)
    .where("archived_at", "is", null)
    .limit(batchSize));

  for (const row of queuedAccounts) {
    try {
      await ensureCustomer(tx, { tenantId, accountId: row.id, fetchImpl });
      createdCount++;
    } catch (e) {
      console.error(`backfillCustomers: failed to create customer for account ${row.id}:`, e.message);
    }
  }

  return { created: createdCount };
}

/**
 * Sync a person's Stripe customer — name, email, phone, address AND metadata (role/tags/
 * lifecycle_status/etc, via the SAME `buildCustomerPayload` `ensureCustomer` uses — one writer,
 * not two answers to what a customer payload is). If no customer exists yet, this is a no-op.
 * ★ the maintainer, 29 Sep 2026 — extended to push metadata too (previously name/email/phone/address only),
 *   for "re-sync every affected person" after the role migration.
 */
export async function syncCustomer(tx, personId, { fetchImpl = fetch } = {}) {
  if (!personId) throw new Error("syncCustomer needs personId");

  // Find the person and their tenant
  const { rows } = await run(tx, db
    .selectFrom("keystone.app_user")
    .selectAll()
    .select(sql`EXISTS (
        SELECT 1 FROM keystone.guardian g WHERE g.guardian_user_id = "app_user".id
      )`.as("is_guardian"))
    .where("id", "=", personId));

  if (rows.length === 0) {
    throw new Error("syncCustomer: person not found");
  }

  const person = rows[0];

  // No customer to sync
  if (!person.stripe_customer_id) {
    return { synced: false, reason: "no_customer" };
  }

  const tenantId = person.tenant_id;

  // Fetch Connect account
  const connectState = await getConnectAccountState(tx, tenantId);
  if (connectState.state !== "live" || !connectState.stripeAccountId) {
    return { synced: false, reason: "no_connect" };
  }

  const { rows: tenantRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select(["id", "slug"])
    .where("id", "=", tenantId));
  if (tenantRows.length === 0) {
    throw new Error("syncCustomer: tenant not found");
  }

  const payload = buildCustomerPayload({ person, tenant: tenantRows[0], isAccount: false });
  const formObj = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== null && value !== undefined) formObj[key] = value;
  }

  // ★ the maintainer, 29 Sep 2026 — WAS a hand-rolled fetch with an unconditional `Stripe-Account` header;
  //   see the identical note on `ensureCustomer` above. `stripeConnectedRequest` is what makes
  //   Docustay's direct-account case apply here too.
  await stripeConnectedRequest(tx, {
    tenantId, method: "POST", path: `/customers/${person.stripe_customer_id}`, form: formObj,
    movesMoney: false, purpose: "customer_update",
  }, { fetchImpl });

  // Update synced_at timestamp
  await run(tx, db
    .updateTable("keystone.app_user")
    .set({ stripe_synced_at: sql`now()` })
    .where("id", "=", personId));

  return { synced: true };
}
