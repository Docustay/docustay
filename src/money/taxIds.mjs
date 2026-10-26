// @ts-check
// Stage 20 Task 20.65 — TAX IDENTITIES: CRUD, STRIPE SYNC, VERIFICATION WEBHOOK
//
// ★★★ A TAX ID IS A BUSINESS IDENTIFIER, NOT A PERSONAL ONE. It belongs to a payer
// account or a business person record. It is never a government ID for an individual.
// The CLIENT APP NEVER WRITES A TAX ID — there is no route for it, deliberately.
//
// STRIPE REFERENCE: customer.tax_ids (POST/DELETE), customer.tax_exempt param on create,
// customer.tax_id.verification_succeeded/verification_failed webhook events.
//
// WRITERS:
// - POST /api/tax-ids (create)
// - PATCH /api/tax-ids/:id (update)
// - DELETE /api/tax-ids/:id (delete, detaches from Stripe)
// - webhook (customer.tax_id.verification_succeeded|verification_failed)
//
// READERS:
// - src/money/invoiceStripe.mjs (reads practice tax_ids for invoice header)
// - src/app routes (client app never reads these — no client routes exist)

import { invalid, notFound, dependency } from "../http/errors.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";
import { emit, userActor } from "../events/outbox.mjs";
// ★ L3.money/taxIds — every `tx.query(<static SQL>)` below now goes through the builder + `run`;
//   the SQL semantics are unchanged (same WHERE clauses, same RETURNING columns, same
//   parameterization). None of the 12 statements in this file needs the `sql` escape hatch beyond
//   `now()` literals — no CTEs, no ON CONFLICT, no FOR UPDATE, no plpgsql calls.
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "money";

// ── THE TAX_ID_TYPES ENUM — DATA TRANSCRIBED FROM STRIPE'S PUBLISHED LIST ────────────────
// https://stripe.com/docs/api/customer_tax_ids/object#customer_tax_id_object-type
// Country grouping for clarity; the type list itself is the enforcement.
export const TAX_ID_TYPES = Object.freeze({
  // United States
  us_ein: { country: "US", label: "EIN" },
  us_itin: { country: "US", label: "ITIN" },

  // European Union
  eu_vat: { country: "EU", label: "VAT" },
  au_abn: { country: "AU", label: "ABN" },
  au_arn: { country: "AU", label: "ARN" },

  // Other countries
  br_cnpj: { country: "BR", label: "CNPJ" },
  br_cpf: { country: "BR", label: "CPF" },
  ca_bn: { country: "CA", label: "BN" },
  ca_gst_hst: { country: "CA", label: "GST/HST" },
  ca_pst_bc: { country: "CA", label: "PST (BC)" },
  ca_pst_mb: { country: "CA", label: "PST (MB)" },
  ca_pst_sk: { country: "CA", label: "PST (SK)" },
  ca_qst: { country: "CA", label: "QST" },
  ch_vat: { country: "CH", label: "VAT" },
  cl_tin: { country: "CL", label: "TIN" },
  cn_tin: { country: "CN", label: "TIN" },
  co_nit: { country: "CO", label: "NIT" },
  de_stn: { country: "DE", label: "STN" },
  eg_tin: { country: "EG", label: "TIN" },
  es_cif: { country: "ES", label: "CIF" },
  gb_vat: { country: "GB", label: "VAT" },
  hk_br: { country: "HK", label: "BR" },
  hu_tin: { country: "HU", label: "TIN" },
  id_npwp: { country: "ID", label: "NPWP" },
  ie_vat: { country: "IE", label: "VAT" },
  il_vat: { country: "IL", label: "VAT" },
  in_gst: { country: "IN", label: "GST" },
  jp_cn: { country: "JP", label: "CN" },
  jp_rn: { country: "JP", label: "RN" },
  jp_trn: { country: "JP", label: "TRN" },
  ke_pin: { country: "KE", label: "PIN" },
  kr_brn: { country: "KR", label: "BRN" },
  li_uid: { country: "LI", label: "UID" },
  mx_rfc: { country: "MX", label: "RFC" },
  my_frp: { country: "MY", label: "FRP" },
  my_itn: { country: "MY", label: "ITN" },
  my_sst: { country: "MY", label: "SST" },
  ng_tin: { country: "NG", label: "TIN" },
  no_vat: { country: "NO", label: "VAT" },
  nz_gst: { country: "NZ", label: "GST" },
  ph_tin: { country: "PH", label: "TIN" },
  ru_inn: { country: "RU", label: "INN" },
  ru_kpp: { country: "RU", label: "KPP" },
  sa_vat: { country: "SA", label: "VAT" },
  sg_gst: { country: "SG", label: "GST" },
  sg_uen: { country: "SG", label: "UEN" },
  si_tin: { country: "SI", label: "TIN" },
  th_vat: { country: "TH", label: "VAT" },
  tr_tin: { country: "TR", label: "TIN" },
  tw_vat: { country: "TW", label: "VAT" },
  ua_vat: { country: "UA", label: "VAT" },
  vn_tin: { country: "VN", label: "TIN" },
  za_vat: { country: "ZA", label: "VAT" },
});

const VALID_TYPES = Object.freeze(Object.keys(TAX_ID_TYPES));

/**
 * ★ CREATE A TAX ID RECORD AND PUSH TO STRIPE.
 *
 * @param tx the transaction
 * @param {tenantId, subjectType, subjectId, type, value, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns {id, stripe_tax_id, type, value, verification_state}
 */
export async function createTaxId(tx, {
  tenantId, subjectType, subjectId, type, value, actorUserId,
} = {}, deps = {}) {
  if (!tenantId || !subjectType || !subjectId || !type || !value) {
    throw invalid("tenantId, subjectType, subjectId, type, and value are required");
  }

  if (!["person", "account"].includes(subjectType)) {
    throw invalid("subjectType must be person or account");
  }

  if (!VALID_TYPES.includes(type)) {
    throw invalid(`type "${type}" is not a known tax ID type. Valid: ${VALID_TYPES.join(", ")}`);
  }

  // Create the record locally first
  const ins = await run(tx, db
    .insertInto("keystone.tax_id")
    .values({
      tenant_id: tenantId ?? null,
      subject_type: subjectType ?? null,
      subject_id: subjectId ?? null,
      type: type ?? null,
      value: value ?? null,
      created_by: actorUserId ?? null,
    })
    .returning(["id", "stripe_tax_id", "type", "value", "verification_state"]));

  if (ins.rowCount === 0) {
    throw new Error("Failed to insert tax_id");
  }

  const taxIdRow = ins.rows[0];

  // Push to Stripe if this is an account (has Stripe customer)
  let stripeTaxId = null;
  try {
    if (subjectType === "account") {
      // Get the account's Stripe customer id
      const custRes = await run(tx, db
        .selectFrom("keystone.account")
        .select("stripe_customer_id")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", subjectId));

      if (custRes.rows.length > 0 && custRes.rows[0].stripe_customer_id) {
        const customerId = custRes.rows[0].stripe_customer_id;
        stripeTaxId = await pushTaxIdToStripe(tx, {
          tenantId, customerId, type, value, actorUserId,
        }, deps);

        // Store the Stripe tax_id on the record
        await run(tx, db
          .updateTable("keystone.tax_id")
          .set({ stripe_tax_id: stripeTaxId ?? null, updated_at: sql`now()` })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", taxIdRow.id));
      }
    }
  } catch (e) {
    throw dependency(`Stripe refused this: ${e.message}`, e);
  }

  await emit(tx, {
    tenantId,
    topic: "money.tax_id.created",
    emittedBy: SECTION,
    subjectType: "tax_id",
    subjectId: taxIdRow.id,
    actor: userActor(actorUserId),
    payload: {
      subject_type: subjectType,
      subject_id: subjectId,
      type,
      value,
      stripe_tax_id: stripeTaxId,
    },
  });

  return {
    id: taxIdRow.id,
    stripe_tax_id: stripeTaxId,
    type: taxIdRow.type,
    value: taxIdRow.value,
    verification_state: taxIdRow.verification_state,
  };
}

/**
 * ★ PUSH A TAX ID TO STRIPE.
 *
 * @param tx the transaction
 * @param {tenantId, customerId, type, value, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns stripe tax_id object id
 */
async function pushTaxIdToStripe(tx, {
  tenantId, customerId, type, value, actorUserId,
} = {}, deps = {}) {
  const form = {
    type,
    value,
  };

  const result = await stripeConnectedRequest(tx, {
    tenantId,
    method: "POST",
    path: `/customers/${customerId}/tax_ids`,
    sdk: (s, o, form, query) => s.customers.createTaxId(customerId, form, o),
    form,
    idempotencyKey: `tax_id:${tenantId}:${customerId}:${type}:${value}`,
    movesMoney: false,
    purpose: "create_tax_id",
    actorUserId,
  }, deps);

  return result.body.id;
}

/**
 * ★ UPDATE A TAX ID (type and value only; verification_state is webhook-only).
 *
 * @param tx the transaction
 * @param {tenantId, taxIdId, type, value, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns {id, stripe_tax_id, type, value, verification_state}
 */
export async function updateTaxId(tx, {
  tenantId, taxIdId, type, value, actorUserId,
} = {}, deps = {}) {
  if (!tenantId || !taxIdId) {
    throw invalid("tenantId and taxIdId are required");
  }

  if (type && !VALID_TYPES.includes(type)) {
    throw invalid(`type "${type}" is not a known tax ID type`);
  }

  // Load the existing record
  const sel = await run(tx, db
    .selectFrom("keystone.tax_id")
    .select(["id", "subject_type", "subject_id", "type", "value", "stripe_tax_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", taxIdId));

  if (sel.rowCount === 0) {
    throw notFound("tax_id not found");
  }

  const existing = sel.rows[0];
  const newType = type || existing.type;
  const newValue = value || existing.value;

  // Update locally
  const upd = await run(tx, db
    .updateTable("keystone.tax_id")
    .set({ type: newType ?? null, value: newValue ?? null, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", taxIdId)
    .returning(["id", "stripe_tax_id", "type", "value", "verification_state"]));

  const updated = upd.rows[0];

  // If it has a Stripe tax_id, delete the old one and push the new one
  if (existing.stripe_tax_id && existing.subject_type === "account") {
    const custRes = await run(tx, db
      .selectFrom("keystone.account")
      .select("stripe_customer_id")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", existing.subject_id));

    if (custRes.rows.length > 0 && custRes.rows[0].stripe_customer_id) {
      const customerId = custRes.rows[0].stripe_customer_id;

      // Delete old Stripe tax_id
      try {
        await stripeConnectedRequest(tx, {
          tenantId,
          method: "DELETE",
          path: `/customers/${customerId}/tax_ids/${existing.stripe_tax_id}`,
          sdk: (s, o, form, query) => s.customers.deleteTaxId(customerId, existing.stripe_tax_id, {}, o),
          movesMoney: false,
          purpose: "delete_tax_id",
          actorUserId,
        }, deps);
      } catch (e) {
        throw dependency(`Stripe refused this: ${e.message}`, e);
      }

      // Push new one
      try {
        const newStripeTaxId = await pushTaxIdToStripe(tx, {
          tenantId, customerId, type: newType, value: newValue, actorUserId,
        }, deps);

        await run(tx, db
          .updateTable("keystone.tax_id")
          .set({ stripe_tax_id: newStripeTaxId ?? null, verification_state: null, updated_at: sql`now()` })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", taxIdId));
      } catch (e) {
        throw dependency(`Stripe refused this: ${e.message}`, e);
      }
    }
  }

  await emit(tx, {
    tenantId,
    topic: "money.tax_id.updated",
    emittedBy: SECTION,
    subjectType: "tax_id",
    subjectId: taxIdId,
    actor: userActor(actorUserId),
    payload: {
      type: newType,
      value: newValue,
    },
  });

  return {
    id: updated.id,
    stripe_tax_id: updated.stripe_tax_id,
    type: updated.type,
    value: updated.value,
    verification_state: updated.verification_state,
  };
}

/**
 * ★ DELETE A TAX ID AND DETACH FROM STRIPE.
 *
 * @param tx the transaction
 * @param {tenantId, taxIdId, actorUserId}
 * @param deps optional {fetchImpl, env}
 * @returns {deleted: true}
 */
export async function deleteTaxId(tx, {
  tenantId, taxIdId, actorUserId,
} = {}, deps = {}) {
  if (!tenantId || !taxIdId) {
    throw invalid("tenantId and taxIdId are required");
  }

  // Load the record to get Stripe id and subject
  const sel = await run(tx, db
    .selectFrom("keystone.tax_id")
    .select(["id", "subject_type", "subject_id", "stripe_tax_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", taxIdId));

  if (sel.rowCount === 0) {
    throw notFound("tax_id not found");
  }

  const row = sel.rows[0];

  // Delete from Stripe if present
  if (row.stripe_tax_id && row.subject_type === "account") {
    const custRes = await run(tx, db
      .selectFrom("keystone.account")
      .select("stripe_customer_id")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", row.subject_id));

    if (custRes.rows.length > 0 && custRes.rows[0].stripe_customer_id) {
      try {
        await stripeConnectedRequest(tx, {
          tenantId,
          method: "DELETE",
          path: `/customers/${custRes.rows[0].stripe_customer_id}/tax_ids/${row.stripe_tax_id}`,
          sdk: (s, o, form, query) => s.customers.deleteTaxId(custRes.rows[0].stripe_customer_id, row.stripe_tax_id, {}, o),
          movesMoney: false,
          purpose: "delete_tax_id",
          actorUserId,
        }, deps);
      } catch (e) {
        throw dependency(`Stripe refused this: ${e.message}`, e);
      }
    }
  }

  // Delete locally
  await run(tx, db
    .deleteFrom("keystone.tax_id")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", taxIdId));

  await emit(tx, {
    tenantId,
    topic: "money.tax_id.deleted",
    emittedBy: SECTION,
    subjectType: "tax_id",
    subjectId: taxIdId,
    actor: userActor(actorUserId),
    payload: {
      subject_type: row.subject_type,
      subject_id: row.subject_id,
    },
  });

  return { deleted: true };
}

/**
 * ★ WEBHOOK: customer.tax_id.updated
 *
 * ★ [Stripe webhook crisis, 2 Oct 2026] This used to listen for
 *   `customer.tax_id.verification_succeeded`/`verification_failed` — NEITHER is a real Stripe
 *   event (confirmed against Stripe's own live `enabled_events` enum via the API: the only
 *   `customer.tax_id.*` events are `created`/`updated`/`deleted`). Stripe reports a verification
 *   result as a `verification.status` field on the Tax ID object inside a plain
 *   `customer.tax_id.updated` event, not as two separate pass/fail event types. This handler had
 *   never fired for any real tax ID, ever — confirmed no `customer.tax_id.updated` event has ever
 *   occurred on this account (Docustay has never had a customer add a tax ID), so this was a real but
 *   zero-impact gap until now.
 *
 * Idempotently updates verification_state from the real `verification.status` field.
 *
 * @param tx the transaction
 * @param event Stripe event object
 * @param {tenantId}
 */
export async function handleTaxIdVerificationWebhook(tx, event, { tenantId } = {}) {
  if (!event?.data?.object?.id || !event?.type) {
    throw new Error("Webhook missing event data");
  }

  const stripeTaxIdId = event.data.object.id;
  // ★ Stripe's own enum: 'pending' | 'unavailable' | 'unverified' | 'verified'. Passed through
  //   as-is rather than collapsed to a binary verified/unavailable — this column has no CHECK
  //   constraint, and collapsing would throw away real information Stripe is giving us.
  const verificationState = event.data.object?.verification?.status ?? null;
  const isVerified = verificationState === "verified";

  // Find the tax_id row by stripe_tax_id
  const sel = await run(tx, db
    .selectFrom("keystone.tax_id")
    .select("id")
    .where("tenant_id", "=", tenantId)
    .where("stripe_tax_id", "=", stripeTaxIdId));

  if (sel.rowCount === 0) {
    // Tax ID not found locally; silently skip (may be for a different practice)
    return { applied: false, reason: "tax_id_not_found" };
  }

  const taxId = sel.rows[0];

  // Update verification state idempotently
  await run(tx, db
    .updateTable("keystone.tax_id")
    .set({ verification_state: verificationState, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", taxId.id));

  await emit(tx, {
    tenantId,
    topic: isVerified ? "money.tax_id.verified" : "money.tax_id.verification_failed",
    emittedBy: SECTION,
    subjectType: "tax_id",
    subjectId: taxId.id,
    actor: "webhook:stripe",
    payload: {
      stripe_tax_id: stripeTaxIdId,
      verification_state: verificationState,
    },
  });

  return { applied: true, reason: verificationState ?? "unknown" };
}
