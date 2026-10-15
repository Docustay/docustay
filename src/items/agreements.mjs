// @ts-check
// Spec 02 (Items) §3/§10 — Task 2.3, CT-121's items-side half.
//
// ★★★ THE PRICE FREEZE ALREADY EXISTS. Nothing new is built for it here. `executeInstance(tx,
//     {tenantId, instanceId, priceRef, terms, actorUserId})` (`src/documents/writes.mjs:736`) already
//     reads `keystone.current_price(priceRef.subjectType, priceRef.subjectId)` AT THE MOMENT OF
//     EXECUTION and freezes `{price_id, amount_minor, currency, effective_from}` into
//     `document_instance.template_snapshot.price` — refusing to execute at all if no price is in
//     force. This file's only job is the ITEMS-SIDE half of the contract spec 02 hands to spec 04/05:
//     the two read helpers that answer "does this item need an agreement, and has this buyer already
//     signed one" so spec 04's purchase-flow route knows whether to show `DocsSignAndPay` (and which
//     template) before it ever calls `executeInstance` with
//     `priceRef: { subjectType: itemType, subjectId: itemId }` (§9 point 1, verbatim).
//
// ★ Nothing here charges, refunds, activates an entitlement or calls `executeInstance` itself — that
//   remains spec 04/05's own call site. This module only reads `keystone.item_agreement_requirement`
//   (0269) and `keystone.document_instance` (spec 04's own table) so that call site knows what to do.

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { executedInstanceForTemplate } from "../documents/api.mjs";

const ITEM_TYPES = Object.freeze(["service", "package", "plan"]);

/**
 * getAgreementRequirement(tx, {tenantId, itemType, itemId}) → { templateId } | null
 *
 * §10 — spec 04's purchase-flow route calls this to know whether to show `DocsSignAndPay` at all,
 * and if so, which template. Presence of a row IS "required" (0269 — one required agreement per
 * item, not a list of optional-vs-required agreements), so `null` means "buy freely, no agreement
 * gate."
 */
export async function getAgreementRequirement(tx, { tenantId, itemType, itemId }) {
  if (!ITEM_TYPES.includes(itemType)) {
    throw new Error(`itemType must be one of ${ITEM_TYPES.join(", ")} — got ${JSON.stringify(itemType)}`);
  }
  const { rows } = await run(tx, db
    .selectFrom("keystone.item_agreement_requirement")
    .select(["template_id"])
    .where("tenant_id", "=", tenantId)
    .where("item_type", "=", itemType)
    .where("item_id", "=", itemId));
  if (rows.length === 0) return null;
  return { templateId: rows[0].template_id };
}

/**
 * hasExecutedAgreement(tx, {tenantId, itemType, itemId, buyerUserId}) → { instanceId } | null
 *
 * §10 — reads `keystone.document_instance` (spec 04's own table), filtered to `state='executed'`,
 * `archived_at IS NULL`, matching the item's required `template_id` (via
 * `getAgreementRequirement`) and `subject_user_id`, so a renewal does not ask for a second
 * signature (§12:369, "Renewals don't need a new signature"). `null` both when the item has no
 * agreement requirement at all, and when it has one this buyer has not yet executed — the caller
 * (spec 04/05's checkout gate) treats both the same way: no proof of signature on file.
 */
export async function hasExecutedAgreement(tx, { tenantId, itemType, itemId, buyerUserId }) {
  const requirement = await getAgreementRequirement(tx, { tenantId, itemType, itemId });
  if (!requirement) return null;

  // ★ DOCUSTAY WALL FIX — this used to query `keystone.document_instance` directly. `documents/api.mjs`
  //   is the one door onto a document_* table now; `executedInstanceForTemplate` is the SAME query,
  //   relocated verbatim.
  return executedInstanceForTemplate(tx, {
    tenantId, templateId: requirement.templateId, subjectUserId: buyerUserId,
  });
}
