// @ts-check
// B-3 — ONE REQUIREMENT MECHANISM. F793: `item_agreement_requirement.hold_until_signed` and
// `.first_booking_only` (0410) existed and were read by NOTHING — a practice could turn either
// switch on in the editor and it changed nothing about whether a booking held. This module is the
// first and only reader.
//
// ★★★ CONTRACTS.md (specs/de-code/CONTRACTS.md) §3 — the exact signatures this file must carry:
//   `requirementsFor(tx, { tenantId, serviceId })` → `[{ templateId, kind, holdUntilSigned,
//   firstBookingOnly }]`, reading `item_agreement_requirement` where `item_type = 'service'`.
//   `currentExecutedInstance(tx, { tenantId, templateId, personId })` → `{ instanceId } | null` —
//   the latest executed, unarchived instance of the template's LINEAGE (same `name` + `builder`) at
//   `version ≥` the newest `material = true` version of that lineage, not older than
//   `re_sign_months` when the reference template sets one.
//
// ★ `getAgreementRequirement`/`hasExecutedAgreement` (`src/items/agreements.mjs`) already answer the
//   SAME shape of question for a PURCHASE (one required agreement per item, presence-based). This
//   module answers it for a BOOKING, where 0511 widens the table to carry more than one row per
//   item (`kind IN ('agreement','intake')`) and `currentExecutedInstance` additionally understands
//   LINEAGE and re-signing — neither of which the purchase gate needs. Two different questions over
//   the same table, not a second definition of the same one.

import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { currentExecutedInstance } from "../documents/api.mjs";

/**
 * requirementsFor(tx, { tenantId, serviceId }) → [{ templateId, kind, holdUntilSigned, firstBookingOnly }]
 *
 * Every `item_agreement_requirement` row for this service (`item_type = 'service'`) — 0511 widens
 * the UNIQUE constraint to `(tenant_id, item_type, item_id, kind)`, so a service may carry both an
 * `agreement` row and a folded-in `intake` row; both come back here.
 */
export async function requirementsFor(tx, { tenantId, serviceId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.item_agreement_requirement")
    .select(["template_id", "kind", "hold_until_signed", "first_booking_only"])
    .where("tenant_id", "=", tenantId)
    .where("item_type", "=", "service")
    .where("item_id", "=", serviceId));
  return rows.map((r) => ({
    templateId: r.template_id,
    kind: r.kind,
    holdUntilSigned: r.hold_until_signed,
    firstBookingOnly: r.first_booking_only,
  }));
}

export { currentExecutedInstance } from "../documents/api.mjs";

/**
 * hasPriorBooking(tx, { tenantId, personId, serviceId }) → boolean
 *
 * §4, verbatim SQL — has this person already had a `confirmed`/`completed` booking of this service,
 * which is what `first_booking_only` means: the signature is asked for once, on the first booking,
 * never again on the second.
 */
export async function hasPriorBooking(tx, { tenantId, personId, serviceId }) {
  const { rows } = await tx.query(
    `SELECT EXISTS (
        SELECT 1 FROM keystone.booking b
        JOIN keystone.booking_participant p
          ON p.tenant_id = b.tenant_id AND p.booking_id = b.id
       WHERE b.tenant_id = $1 AND b.service_id = $3 AND p.app_user_id = $2
         AND b.state IN ('confirmed','completed')
     ) AS exists`,
    [tenantId, personId, serviceId]);
  return rows[0].exists;
}
