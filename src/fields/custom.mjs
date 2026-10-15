// @ts-check
// P2.2 — THE CUSTOM LAYER: read and write a tenant's own fields.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE CONSTRAINT THIS MODULE IS SHAPED BY. P2.1 made `buildRecordShell` THROW when a declared
//     panel field is absent from the row — which is right, and which makes the obvious design for
//     custom fields impossible: **a custom field declared by tenant A must not make the shell throw
//     for tenant B**, whose query will never select it.
//   ★★ So custom fields do NOT go through the static panel descriptors. They arrive as DATA — a
//      resolved list of `{key, label, kind, value}` — and `buildRecordShell` appends them as a panel
//      built from that list. The static panels stay static and keep their guard; the dynamic ones
//      are dynamic all the way down. **Two different things, kept apart, rather than one mechanism
//      bent to do both.**
//
// ★ A DOMAIN WRITER: defining a field changes what the practice records about people, and
//   `db/gates/write-census.mjs` wants the argument. It emits.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

class FieldViolation extends Error {
  constructor(message) { super(message); this.name = "FieldViolation"; }
}

const KEY_SHAPE = /^[a-z][a-z0-9_]*$/;
const KINDS = ["text", "number", "date", "boolean", "select"];

/** Define a custom field for this tenant. */
export async function defineCustomField(tx, {
  tenantId, recordType, key, label, kind, options = [], position = 0, actorId = null,
}) {
  if (!tenantId) throw new FieldViolation("defineCustomField requires a tenantId");
  // ★★ Validate before the database does, for a message aimed at the person who typed it — the
  //    same split every writer in P1 uses. A 23514 naming `custom_field_options_shape` is not it.
  if (!KEY_SHAPE.test(key ?? "")) {
    throw new FieldViolation(
      `"${key}" is not a field key — lowercase letters, digits and underscores, starting with a letter`);
  }
  if (!label || !String(label).trim()) throw new FieldViolation("a field needs a label");
  if (!KINDS.includes(kind)) throw new FieldViolation(`"${kind}" is not a field kind — use ${KINDS.join(", ")}`);
  if (kind === "select" && (!Array.isArray(options) || options.length === 0)) {
    // ★ A select with nothing to pick is a control that cannot be used — the dead-control defect
    //   wearing a field's clothes.
    throw new FieldViolation("a select field needs at least one option");
  }
  if (kind !== "select" && Array.isArray(options) && options.length > 0) {
    throw new FieldViolation(`options are only meaningful on a select field, not on "${kind}"`);
  }

  const { rows } = await run(tx, db
    .insertInto("keystone.custom_field")
    .columns(["tenant_id", "record_type", "key", "label", "kind", "options", "position", "created_by"])
    .values({
      tenant_id: tenantId ?? null,
      record_type: recordType ?? null,
      key: key ?? null,
      label: label ?? null,
      kind: kind ?? null,
      options: (kind === "select" ? options : []) ?? null,
      position: position ?? null,
      created_by: actorId ?? null,
    })
    .returning(["id", "key", "label", "kind"]));

  // ★★★ ZERO ROWS IS A REFUSAL — F52's shape. Under FORCE RLS a cross-tenant write returns no row
  //     rather than raising, and a caller that ignored it would report "saved" for nothing.
  if (rows.length === 0) {
    throw new FieldViolation(
      `"${key}" was not created — row-level security refused it, which means the transaction's ` +
      `tenant does not match the tenantId passed in`);
  }

  await emit(tx, {
    tenantId,
    topic: "people.field.defined",
    emittedBy: "people",
    subjectType: "custom_field",
    subjectId: rows[0].id,
    payload: { recordType, key, kind, actorId },
  });
  return rows[0];
}

/**
 * Every active custom field this tenant has defined for a record type, in display order.
 * ★ NOT EXPORTED — no caller yet. **P6.62's field-management screen is the one that needs it** (a
 *   list of the practice's own fields, with no record in hand). Exporting it now would be an orphan,
 *   and the wiring gate caught it the moment it was written. Fourth time this decision has been made
 *   in this build; the rule is the same each time — **export it WITH its caller.**
 */
async function customFieldsFor(tx, recordType) {
  const { rows } = await tx.query(
    `SELECT id, key, label, kind, options, position
       FROM keystone.custom_field
      WHERE record_type = $1 AND active
      ORDER BY position, label`,
    [recordType]);
  return rows;
}

/**
 * The custom fields for a record type, WITH this record's values — the shape `buildRecordShell`
 * takes.
 * ★★ A field with no stored value still appears, with `value: null`. A practice that defined
 *    "Referral source" and has not filled it in for this person has a field, not an absence — and
 *    dropping it would make the card differ per record, which is the shape a reader cannot learn.
 */
export async function customFieldValues(tx, recordType, recordId) {
  if (!recordId) return [];
  const { rows } = await tx.query(
    `SELECT f.key, f.label, f.kind, f.options, v.value
       FROM keystone.custom_field f
       LEFT JOIN keystone.custom_field_value v
         ON v.field_id = f.id AND v.record_id = $2
      WHERE f.record_type = $1 AND f.active
      ORDER BY f.position, f.label`,
    [recordType, recordId]);
  return rows.map((r) => ({
    key: r.key, label: r.label, kind: r.kind, options: r.options,
    // ★ jsonb comes back parsed; `null` and "never set" are the same fact here and both render empty.
    value: r.value ?? null,
  }));
}

/** Set one custom field's value on one record. */
export async function setCustomFieldValue(tx, { tenantId, fieldId, recordId, value, actorId = null }) {
  if (!tenantId || !fieldId || !recordId) {
    throw new FieldViolation("setCustomFieldValue requires tenantId, fieldId and recordId");
  }
  const { rows } = await tx.query(
    `INSERT INTO keystone.custom_field_value (tenant_id, field_id, record_id, value, updated_by)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (tenant_id, field_id, record_id)
       DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING field_id`,
    [tenantId, fieldId, recordId, JSON.stringify(value ?? null), actorId]);

  if (rows.length === 0) {
    throw new FieldViolation(
      "the value was not written — row-level security refused it, which means the transaction's " +
      "tenant does not match the tenantId passed in");
  }
  return { ok: true };
}
