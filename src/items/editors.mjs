// @ts-check
// Stage 14 task 14.21 — THE EDITORS: update, duplicate, the editor read, the defaults read.
//
// ═════════════════════════════════════════════════════════════════════════════
// ★★★ `src/items/writes.mjs` IS NOT THIS TASK'S FILE (14.20 owns it, in parallel tonight).
//     `duplicateService` below CALLS `createService` — imported, never redefined, never assumed to
//     still have its OLD (pre-14.20) signature. 14.20's own field 4 (`STAGE-14-PLAN.md` ~line 1019)
//     is the list this file trusts for what `createService` now accepts.
// ═════════════════════════════════════════════════════════════════════════════
//
// ★★★ THE STALE-VS-ARCHIVED DISTINCTION, MEASURED, NOT ASSUMED. `db/migrations/0088_archive_not_
//     delete.sql:40-41` adds `archived_at`/`archived_by` to exactly `['app_user','account',
//     'network_party','booking','invoice','service','plan','subscription','document_instance']` —
//     `keystone.package` and `keystone.coupon` are NOT on that list and carry no `archived_at`
//     column at all (MEASURED: grep over every migration finds no `ADD COLUMN archived_at` naming
//     either table). So the four `update*` functions below split into two shapes:
//       · service / plan  — a second read distinguishes STALE (row exists, `archived_at IS NULL`,
//         different `updated_at`) from ARCHIVED (row exists, `archived_at IS NOT NULL` → 404 naming
//         who archived it, read off `archived_by` → `app_user.display_name`).
//       · package / discount — there is no archived state this schema can name today; a second read
//         that FINDS the row is STALE, one that finds nothing is a plain "no such X" 404 (the same
//         sentence `setItemActive`/`setDiscountActive` already use for a missing row, `writes.mjs`,
//         M, kept consistent rather than inventing a second wording).
//     Reported to Opus: this is a real schema fact, not a guess — `updatePackage`/`updateDiscount`
//     cannot report "archived by {name}" because there is no column to read it from.
//
// ★★★ WHICH COLUMNS EACH `update*` MAY TOUCH. Field 4 says "same shape" for the structure (optimistic
//     check → conflict/notFound → emit), not a field list per type. This file's own, evidenced
//     boundary: every column `14.20` (0410/R-14.7) added to that table, plus the table's own `name` —
//     NEVER price (`createPrice`/§Z4 owns that, a separate route), NEVER `kind`/`percent_bp`/
//     `amount_minor`/`currency` on discount (`discount_kind_shape`, 0265 — changing the SHAPE of an
//     already-saved discount is a re-creation, not an edit), NEVER `interval`/`lines`/`service_id`/
//     `sessions_included`/`rollover_*` (Stage 2's own plan/package fields — structural, not named by
//     this task, left untouched rather than guessed at).
//
// ★★ CT-F36, INLINE, PER FIELD 8's OWN INSTRUCTION. `price_history` is present in `editorRead`'s
//    return object ONLY when `keystone.user_may(viewer,'invoice','view',NULL)` is true — ABSENT
//    (the key itself, not an empty array) otherwise, so a Coach without "See practice money" gets a
//    payload with no `price_history` key at all.
//
// ★ TOPICS. `items.service.updated` / `items.package.updated` / `items.plan.updated` /
//   `items.discount.updated` are NOT YET in `src/events/topics.mjs`'s `items` array as of this write
//   (MEASURED: grepped the file, they are absent) — task **14.15** (a named dependency of this task,
//   field 10) owns adding them, in the same parallel batch. `emit()` will refuse these topics until
//   14.15 lands; this is the same "depends on a sibling task's file" shape 14.20 has with 14.3's
//   migration, not a defect in this file. Flagged in the build report, not silently worked around.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { getSetting, getSettings } from "../settings/writes.mjs";
// ★★★ 14.20's file, imported and CALLED — never redefined. `duplicateService` passes through the
//     R-14.7 fields 14.20 widened `createService` to accept.
import { createService } from "./writes.mjs";
import { ensureServiceAddress, retireServiceAddress, ensurePersonAddress } from "../booking/addresses.mjs";
// ★ The one-word edit this task also makes: `export` added before this const's declaration
//   (`src/provisioning/sampleContent.mjs:36`) so it can be imported here, read-only.
import { STARTER_SERVICE_NAMES } from "../provisioning/sampleContent.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";
import { templateNamesByIds } from "../documents/api.mjs";

const SECTION = "items";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const boolField = (name) => (v) => (typeof v === "boolean" ? null : `${name} must be a boolean`);
const nonEmptyString = (v) => (typeof v === "string" && v.trim() ? null : "a name is required");
const trimTransform = (v) => (typeof v === "string" ? v.trim() : v);
const optionalPositiveInt = (name) => (v) =>
  (v === null || v === undefined || (Number.isInteger(v) && v > 0) ? null : `${name} must be a positive integer, or empty`);
const optionalNonNegativeInt = (name) => (v) =>
  (v === null || v === undefined || (Number.isInteger(v) && v >= 0) ? null : `${name} must be a non-negative integer, or empty`);
// ★ Programs follow-up brief (30 Sep 2026) — programId/categoryId are plain nullable FKs; the
//   database's own composite FK (tenant_id, program_id) is the real authority on whether an id
//   names something this tenant owns, so this only checks the shape, same as `imageId`/`unitId`
//   above (which carry no `validate` at all — kept consistent with those rather than inventing a
//   stricter rule this codebase doesn't apply to its other bare-FK fields).

// ═══════════════════════════════════════════════════════════════════════════════
// FIELD MAPS — camelCase request key → { column, validate?, transform? }. Only the columns 14.20's
// own field 4 named for that table, plus the table's pre-existing `name`.
// ═══════════════════════════════════════════════════════════════════════════════
const SERVICE_FIELDS = Object.freeze({
  name:            { column: "name", validate: nonEmptyString, transform: trimTransform },
  durationMinutes: { column: "duration_minutes",
    validate: (v) => (Number.isInteger(v) && v > 0 ? null : "durationMinutes must be a positive integer") },
  bookable:        { column: "bookable", validate: boolField("bookable") },
  // ★ BOOKING-EVERYWHERE spec §2.2 — the public switch; `updateService` below gives/retires the service's address with it.
  publicBookable:  { column: "public_bookable", validate: boolField("publicBookable") },
  categoryId:      { column: "category_id" },
  imageId:         { column: "image_id" },
  colour:          { column: "colour",
    validate: (v) => (v === null || /^#[0-9A-Fa-f]{6}$/.test(v) ? null : "colour must be a 6-digit hex code, like #4B7BEC") },
  sku:             { column: "sku" },
  invoiceWording:  { column: "invoice_wording" },
  addonOnly:       { column: "addon_only", validate: boolField("addonOnly") },
  intakeFormId:    { column: "intake_form_id" },
  description:     { column: "description" },
  internalNotes:   { column: "internal_notes" },
  taxCode:         { column: "tax_code" },
  deliveryModes:   { column: "delivery_modes",
    validate: (v) => (Array.isArray(v) && v.length > 0 ? null : "deliveryModes must be a non-empty array") },
  capacity:        { column: "capacity",
    validate: (v) => (Number.isInteger(v) && v >= 1 ? null : "capacity must be a positive integer") },
  unitId:          { column: "unit_id" },
  programId:       { column: "program_id" },
});

const PACKAGE_FIELDS = Object.freeze({
  name:                { column: "name", validate: nonEmptyString, transform: trimTransform },
  description:         { column: "description" },
  imageId:             { column: "image_id" },
  expiryMonths:        { column: "expiry_months",
    validate: (v) => (v === null || (Number.isInteger(v) && v >= 1 && v <= 120)
      ? null : "Pick between 1 and 120 months, or leave it empty.") },
  warnAtRemaining:     { column: "warn_at_remaining", validate: optionalNonNegativeInt("warnAtRemaining") },
  portalSellable:      { column: "portal_sellable", validate: boolField("portalSellable") },
  publicSellable:      { column: "public_sellable", validate: boolField("publicSellable") },
  installmentsAllowed: { column: "installments_allowed", validate: boolField("installmentsAllowed") },
  programId:           { column: "program_id" },
  categoryId:          { column: "category_id" },
});

const PLAN_FIELDS = Object.freeze({
  name:              { column: "name", validate: nonEmptyString, transform: trimTransform },
  description:       { column: "description" },
  billingDay:        { column: "billing_day",
    validate: (v) => (v === null || (Number.isInteger(v) && v >= 1 && v <= 28)
      ? null : "Pick a day between the 1st and the 28th.") },
  allowClientPause:  { column: "allow_client_pause", validate: boolField("allowClientPause") },
  maxPausesPerYear:  { column: "max_pauses_per_year", validate: optionalNonNegativeInt("maxPausesPerYear") },
  maxPauseMonths:    { column: "max_pause_months", validate: optionalPositiveInt("maxPauseMonths") },
  dunningRetries:    { column: "dunning_retries", validate: optionalNonNegativeInt("dunningRetries") },
  dunningDays:       { column: "dunning_days", validate: optionalPositiveInt("dunningDays") },
  dunningPauseAfter: { column: "dunning_pause_after", validate: optionalNonNegativeInt("dunningPauseAfter") },
  programId:         { column: "program_id" },
  categoryId:        { column: "category_id" },
  minimumTermMonths: { column: "minimum_term_months", validate: optionalPositiveInt("minimumTermMonths") },
});

const DISCOUNT_FIELDS = Object.freeze({
  name:              { column: "name", validate: nonEmptyString, transform: trimTransform },
  descriptionClient: { column: "description_client" },
  maxDiscountMinor:  { column: "max_discount_minor", validate: optionalPositiveInt("maxDiscountMinor") },
  firstPurchaseOnly: { column: "first_purchase_only", validate: boolField("firstPurchaseOnly") },
  perPersonLimit:    { column: "per_person_limit", validate: optionalPositiveInt("perPersonLimit") },
  targetIds:         { column: "target_ids" },
  coachMayApply:     { column: "coach_may_apply", validate: boolField("coachMayApply") },
  maxRedemptions:    { column: "max_redemptions", validate: optionalPositiveInt("maxRedemptions") },
  validFrom:         { column: "valid_from" },
  validTo:           { column: "valid_to" },
});

/**
 * ★★★ THE SHARED ENGINE. One optimistic-concurrency UPDATE, then — on 0 rows — a second read that
 *     tells STALE apart from ARCHIVED apart from NOT FOUND, per this file's header note.
 */
async function updateCatalogueRow(tx, {
  tableName, subjectType, itemLabel, fieldsMap, hasArchivedAt,
  tenantId, id, expectedUpdatedAt, actorUserId, input,
}) {
  if (typeof tenantId !== "string" || !tenantId) throw invalid("tenantId is required");
  if (typeof id !== "string" || !id) throw invalid(`${itemLabel} id is required`);
  if (!expectedUpdatedAt) throw invalid("expectedUpdatedAt is required");

  const setCols = [];
  const values = [tenantId, id, expectedUpdatedAt];
  const changed = [];
  let newName = null;
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    const spec = fieldsMap[key];
    if (!spec) throw invalid(`unknown field "${key}" for a ${itemLabel} update`, { field: key });
    const value = spec.transform ? spec.transform(raw) : raw;
    if (spec.validate) {
      const problem = spec.validate(value);
      if (problem) throw invalid(problem, { field: key });
    }
    if (key === "name") newName = value;
    values.push(value);
    setCols.push(`${spec.column} = $${values.length}`);
    changed.push(spec.column);
  }
  if (setCols.length === 0) throw invalid("nothing to update");

  let result;
  try {
    // ★ F531 (~/example-rebuild/FINDINGS-ARCHIVE.md) — "a timestamptz compared exactly to a value
    //   that round-tripped through JSON is broken by construction": node-postgres reads
    //   `updated_at` (microsecond precision) into a JS Date (millisecond precision), so
    //   `expectedUpdatedAt` arrives here with its last three digits already gone — a plain
    //   `updated_at = $3` was false for ~999 rows in 1000, reported as a "stale" conflict on the
    //   FIRST save attempt on almost every existing service/package/plan/coupon. MEASURED live,
    //   29 Sep 2026: reproduced against a freshly-loaded, untouched row. F531's own rule: compare
    //   at millisecond granularity on both sides.
    result = await tx.query(
      `UPDATE keystone.${tableName}
          SET ${setCols.join(", ")}
        WHERE tenant_id = $1 AND id = $2
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $3::timestamptz)
        RETURNING id, updated_at`,
      values);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(
        newName ? `You already have a ${itemLabel} called ${JSON.stringify(newName)}.`
                : `That value is already used by another ${itemLabel}.`,
        { field: "name" });
    }
    if (e.code === CHECK_VIOLATION) {
      // ★ 14.3/0410 — `discount_cap_is_percent_only`: the same sentence 14.20 gives at create time.
      if (e.constraint === "discount_cap_is_percent_only") {
        throw invalid("Only for percentage discounts. A fixed amount is already capped.");
      }
      throw invalid(`the database refused this change: ${e.constraint ?? e.message}`);
    }
    if (e.code === FOREIGN_KEY_VIOLATION) {
      throw invalid(`the database refused this change: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  if (result.rowCount === 0) {
    // ── STALE vs ARCHIVED vs NOT FOUND — the SECOND READ, never inferred from the 0-row UPDATE alone.
    const selectCols = hasArchivedAt ? "updated_at, archived_at, archived_by" : "updated_at";
    const { rows: check } = await tx.query(
      `SELECT ${selectCols} FROM keystone.${tableName} WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]);
    if (!check[0]) {
      throw notFound(`no such ${itemLabel} in this practice's catalogue`);
    }
    if (hasArchivedAt && check[0].archived_at) {
      let archivedByName = "someone";
      if (check[0].archived_by) {
        const { rows: who } = await run(tx, db
          .selectFrom("keystone.app_user")
          .select(["display_name"])
          .where("tenant_id", "=", tenantId)
          .where("id", "=", check[0].archived_by));
        archivedByName = who[0]?.display_name ?? "someone";
      }
      throw notFound(`This ${itemLabel} was archived by ${archivedByName} a moment ago.`);
    }
    // ★ The row exists, is not archived (or cannot be, on this table) — `updated_at` moved under us.
    throw conflict(
      `This ${itemLabel} changed while you had it open — See what changed · your edits are kept here until you decide.`,
      { kind: "stale" });
  }

  await emit(tx, {
    tenantId, topic: `items.${subjectType}.updated`, emittedBy: SECTION,
    subjectType, subjectId: id,
    actor: userActor(actorUserId),
    // ★ §2.4 payload rule — CHANGED COLUMN NAMES ONLY, never the new values themselves (field 4,
    //   verbatim: "payload: changed column NAMES only").
    payload: { changed },
  });

  return { id, updated_at: result.rows[0].updated_at };
}

/**
 * `POST /api/items/services/update` — object:"item", action:"edit".
 * ★ the maintainer, 29 Sep 2026 — "Who delivers a saved service can't be changed... build it." `hostIds` is not
 *   a plain column on `service` (it lives in the join table `keystone.service_host`, the same one
 *   `createService`/`duplicateService` already write), so it is pulled out of `fields` before they
 *   reach `updateCatalogueRow` — that function's own `fieldsMap` throws on any key it does not
 *   recognise, exactly as it should for a real column typo.
 */
export async function updateService(tx, { tenantId, id, expectedUpdatedAt, actorUserId = null, principal, hostIds, ...fields }) {
  let result;
  if (Object.keys(fields).length > 0) {
    result = await updateCatalogueRow(tx, {
      tableName: "service", subjectType: "service", itemLabel: "service",
      fieldsMap: SERVICE_FIELDS, hasArchivedAt: true,
      tenantId, id, expectedUpdatedAt, actorUserId, input: fields,
    });
    // ★ BOOKING-EVERYWHERE spec §2.2/§2.3 — public on → the service has an address; public off → it answers "not available online".
    if (typeof fields.publicBookable === "boolean") {
      if (fields.publicBookable) await ensureServiceAddress(tx, { tenantId, serviceId: id, actorUserId });
      else await retireServiceAddress(tx, { tenantId, serviceId: id, actorUserId });
    }
  }
  if (hostIds !== undefined) {
    if (!result) {
      // ★ hostIds is the ONLY thing changing — still enforce the SAME optimistic-concurrency check
      //   every other field does, by touching `updated_at` through the identical guarded UPDATE,
      //   rather than silently skipping it because no plain column happened to change too.
      // ★ F531 — same millisecond-truncation fix as updateCatalogueRow above.
      const { rows } = await tx.query(
        `UPDATE keystone.service SET updated_at = now()
          WHERE tenant_id = $1 AND id = $2
            AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $3::timestamptz)
          RETURNING id, updated_at`,
        [tenantId, id, expectedUpdatedAt]);
      if (!rows[0]) {
        const { rows: check } = await tx.query(
          `SELECT updated_at, archived_at, archived_by FROM keystone.service WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id]);
        if (!check[0]) throw notFound("no such service in this practice's catalogue");
        if (check[0].archived_at) {
          let archivedByName = "someone";
          if (check[0].archived_by) {
            const { rows: who } = await run(tx, db
              .selectFrom("keystone.app_user")
              .select(["display_name"])
              .where("tenant_id", "=", tenantId)
              .where("id", "=", check[0].archived_by));
            archivedByName = who[0]?.display_name ?? "someone";
          }
          throw notFound(`This service was archived by ${archivedByName} a moment ago.`);
        }
        throw conflict(
          `This service changed while you had it open — See what changed · your edits are kept here until you decide.`,
          { kind: "stale" });
      }
      result = rows[0];
    }
    if (!Array.isArray(hostIds)) throw invalid("hostIds must be an array of person ids", { field: "hostIds" });
    await tx.query(`DELETE FROM keystone.service_host WHERE tenant_id = $1 AND service_id = $2`, [tenantId, id]);
    for (const hostId of hostIds) {
      await tx.query(
        `INSERT INTO keystone.service_host (tenant_id, service_id, app_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT service_host_unique DO NOTHING`,
        [tenantId, id, hostId]);
      // ★ BOOKING-EVERYWHERE spec §2.2 — added as a host = takes bookings = has an address (no-op if they have one or are not staff).
      await ensurePersonAddress(tx, { tenantId, userId: hostId, actorUserId });
    }
    await emit(tx, {
      tenantId, topic: "items.service.updated", emittedBy: SECTION,
      subjectType: "service", subjectId: id, actor: userActor(actorUserId),
      payload: { changed: ["host_ids"] },
    });
  }
  if (!result) throw invalid("nothing to update");
  return result;
}

/** `POST /api/items/packages/update` — object:"item", action:"edit". */
/**
 * ★★★ FIX, 30 Sep 2026 ("Package editor shows what's inside" brief) — `lines`, WHEN GIVEN, REPLACES
 *   THE WHOLE SET. A package's contents are a small, fully-visible list (never paginated, never
 *   partially loaded) — the same "the editor sent back everything, so everything is authoritative"
 *   shape `createPackage`'s own lines param already uses for a NEW package, applied here to an
 *   EXISTING one. Delete-then-insert, in the same transaction as the row update, so a crash between
 *   the two cannot leave a package with half its old contents and none of its new ones.
 * ★ Omitting `lines` entirely (undefined) leaves the existing contents untouched — a caller updating
 *   only the name/price must not accidentally empty the package by every other field's own absence
 *   meaning "no change".
 */
export async function updatePackage(tx, { tenantId, id, expectedUpdatedAt, actorUserId = null, principal, lines, ...fields }) {
  const result = await updateCatalogueRow(tx, {
    tableName: "package", subjectType: "package", itemLabel: "package",
    fieldsMap: PACKAGE_FIELDS, hasArchivedAt: false,
    tenantId, id, expectedUpdatedAt, actorUserId, input: fields,
  });

  if (lines !== undefined) {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw invalid("a package must contain at least one service line — an empty package is billable and delivers nothing");
    }
    for (const l of lines) {
      if (!l?.serviceId) throw invalid("every package line needs a serviceId");
      if (!Number.isInteger(l.quantity) || l.quantity <= 0) {
        throw invalid(`every package line needs a positive integer quantity — got ${JSON.stringify(l.quantity)}`);
      }
    }
    await run(tx, db.deleteFrom("keystone.package_line")
      .where("tenant_id", "=", tenantId)
      .where("package_id", "=", id));
    for (const l of lines) {
      try {
        await run(tx, db.insertInto("keystone.package_line").values({
          tenant_id: tenantId ?? null, package_id: id ?? null,
          service_id: l.serviceId ?? null, quantity: l.quantity ?? null,
        }));
      } catch (e) {
        if (e.code === UNIQUE_VIOLATION) {
          throw invalid(`service ${l.serviceId} appears twice in this package — combine the quantities into one line`);
        }
        throw e;
      }
    }
  }

  return result;
}

/** `POST /api/items/plans/update` — object:"item", action:"edit". */
export async function updatePlan(tx, { tenantId, id, expectedUpdatedAt, actorUserId = null, principal, ...fields }) {
  return updateCatalogueRow(tx, {
    tableName: "plan", subjectType: "plan", itemLabel: "plan",
    fieldsMap: PLAN_FIELDS, hasArchivedAt: true,
    tenantId, id, expectedUpdatedAt, actorUserId, input: fields,
  });
}

/** `POST /api/items/coupons/update` — object:"discount", action:"edit". */
export async function updateDiscount(tx, { tenantId, id, expectedUpdatedAt, actorUserId = null, principal, ...fields }) {
  return updateCatalogueRow(tx, {
    tableName: "discount", subjectType: "discount", itemLabel: "discount",
    fieldsMap: DISCOUNT_FIELDS, hasArchivedAt: false,
    tenantId, id, expectedUpdatedAt, actorUserId, input: fields,
  });
}

/**
 * `POST /api/items/services/duplicate` — object:"item", action:"edit". Copies the R-14.7 definition
 * fields and the host list (§0.4 A minus touch trigger) via `createService`, `name + " (copy)"`, and
 * ★ NEVER the price — `amountMinor` is omitted so `createService` fills it from
 * `items.default_price_minor` (F06 §8), which is what "the default price" means (field 4, verbatim).
 */
export async function duplicateService(tx, { tenantId, id, actorUserId = null }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.service")
    .select(["name", "duration_minutes", "bookable", "currency", "category_id", "image_id", "colour", "sku", "invoice_wording", "addon_only", "intake_form_id", "description", "internal_notes", "tax_code", "delivery_modes", "capacity", "unit_id", "program_id"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id)
    .where("archived_at", "is", null));
  if (!rows[0]) throw notFound("no such service in this practice's catalogue");
  const s = rows[0];

  const { rows: hostRows } = await run(tx, db
    .selectFrom("keystone.service_host")
    .select(["app_user_id"])
    .where("tenant_id", "=", tenantId)
    .where("service_id", "=", id));

  return createService(tx, {
    tenantId,
    name: `${s.name} (copy)`,
    durationMinutes: s.duration_minutes,
    bookable: s.bookable,
    currency: s.currency,
    categoryId: s.category_id, imageId: s.image_id, colour: s.colour, sku: s.sku,
    invoiceWording: s.invoice_wording, addonOnly: s.addon_only, intakeFormId: s.intake_form_id,
    description: s.description, internalNotes: s.internal_notes, taxCode: s.tax_code,
    deliveryModes: s.delivery_modes, capacity: s.capacity, unitId: s.unit_id,
    programId: s.program_id,
    hostIds: hostRows.map((r) => r.app_user_id),
    actorUserId,
    // amountMinor deliberately omitted — see docstring above.
  });
}

const EDITOR_TABLES = Object.freeze({
  service: "keystone.service", package: "keystone.package",
  plan: "keystone.plan", coupon: "keystone.coupon",
});
// ★ 14.26 (M) — service/package/plan carry `stripe_product_id` (migration 0271, already applied);
//   discount carries `stripe_coupon_id` (migration 0410, unapplied). Two different columns, same read.
const STRIPE_ID_COLUMN = Object.freeze({
  service: "stripe_product_id", package: "stripe_product_id",
  plan: "stripe_product_id", coupon: "stripe_coupon_id",
});

/**
 * `GET /api/items/{services,packages,plans,discounts}/:id/editor` — object:"item"/"discount", action:"view".
 *
 * ★★★ CT-F36, INLINE (field 8). `viewerId` decides whether `price_history` is a key on the return
 *     object AT ALL — absent, not `[]`, for a viewer who may not see money. Both halves of that gate
 *     are exercised by ONE test in `test/s14_items_editors.test.mjs` (a positive control alongside
 *     the negative), per this task's own instruction.
 *
 * ★ `booking_policy` — MEASURED (7-pt point 1): `db/migrations/0013_booking_model.sql:288-305` gives
 *   `keystone.booking_policy` ONLY a `tenant_isolation`/`tenant_insert` pair and a table-level GRANT
 *   to `app_rw` — no role-scoped RLS policy exists on this table at all. It is readable at the
 *   database layer by ANY authenticated member of the tenant; the only gate is this route's own
 *   `assertMay(...,'item'/'discount','view')`, the SAME check that gates the rest of the editor
 *   payload. So it is NOT coach-hidden, and this read includes the real per-service row rather than
 *   falling back to settings-only (field 7-pt's own conditional, resolved: the "if" does not apply).
 */
export async function editorRead(tx, { tenantId, subjectType, id, viewerId }) {
  const table = EDITOR_TABLES[subjectType];
  if (!table) {
    throw invalid(`subjectType must be one of ${Object.keys(EDITOR_TABLES).join(", ")} — got ${JSON.stringify(subjectType)}`);
  }

  const { rows: itemRows } = await tx.query(`SELECT * FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!itemRows[0]) throw notFound(`no such ${subjectType} in this practice's catalogue`);
  const item = itemRows[0];

  // ── booking_policy — service only (0013's FK is service_id NOT NULL) ──────────────────────────
  let bookingPolicy = null;
  if (subjectType === "service") {
    const { rows: bp } = await run(tx, db
      .selectFrom("keystone.booking_policy")
      .select(["buffer_before_minutes", "buffer_after_minutes", "minimum_notice_minutes", "booking_window_days", "cancellation_notice_minutes", "client_may_book", "client_may_reschedule", "client_may_cancel", "reschedule_notice_minutes", "late_cancel_behaviour", "late_cancel_charge_percent", "card_required_at_booking", "card_kept_on_file", "cancel_requires_contact", "policy_text"])
      .where("tenant_id", "=", tenantId)
      .where("service_id", "=", id));
    bookingPolicy = bp[0] ?? null;
  }

  // ── agreement — item_agreement_requirement row (items-owned) + template name(s) ──────────────
  // ★ DOCUSTAY WALL FIX (recon+build round, 29 Sep 2026) — this used to JOIN `document_template`
  //   directly. `item_agreement_requirement` is an items-owned table, still queried here directly;
  //   the template NAME lookup now goes through `documents/api.mjs`'s one door
  //   (`templateNamesByIds`), the same query relocated verbatim rather than run as a cross-domain JOIN.
  let agreement = null;
  if (subjectType !== "coupon") {
    const { rows: agr } = await tx.query(
      `SELECT r.id, r.template_id, r.first_booking_only, r.hold_until_signed, r.teen_template_id
         FROM keystone.item_agreement_requirement r
        WHERE r.tenant_id = $1 AND r.item_type = $2 AND r.item_id = $3`,
      [tenantId, subjectType, id]);
    if (agr.length > 0) {
      const row = agr[0];
      const names = await templateNamesByIds(tx, {
        tenantId, ids: [row.template_id, row.teen_template_id],
      });
      agreement = {
        ...row,
        template_name: names[row.template_id] ?? null,
        teen_template_name: row.teen_template_id ? (names[row.teen_template_id] ?? null) : null,
      };
    }
  }

  // ── used_in {packages, plans} — service only ─────────────────────────────────────────────────
  let usedIn = { packages: 0, plans: 0 };
  if (subjectType === "service") {
    const { rows: pkgRows } = await tx.query(
      `SELECT count(DISTINCT package_id)::int AS n FROM keystone.package_line WHERE tenant_id = $1 AND service_id = $2`,
      [tenantId, id]);
    const { rows: planRows } = await tx.query(
      `SELECT count(DISTINCT plan_id)::int AS n FROM keystone.plan_line WHERE tenant_id = $1 AND service_id = $2`,
      [tenantId, id]);
    usedIn = { packages: pkgRows[0]?.n ?? 0, plans: planRows[0]?.n ?? 0 };
  }

  // ── host_ids — service only. ★ the maintainer, 29 Sep 2026: "Who delivers a saved service can't be changed
  //   ... build it" — the editor can't offer to CHANGE the host list without first reading what it
  //   currently is; `duplicateService` already reads this same table, this is the read side the
  //   editor screen itself was missing.
  let hostIds = [];
  if (subjectType === "service") {
    const { rows: hostRows } = await run(tx, db
      .selectFrom("keystone.service_host")
      .select(["app_user_id"])
      .where("tenant_id", "=", tenantId)
      .where("service_id", "=", id));
    hostIds = hostRows.map((r) => r.app_user_id);
  }

  // ── codes — promotion_code rows (coupon only) ──────────────────────────────────────────────────
  let codes = [];
  if (subjectType === "coupon") {
    const { rows: codeRows } = await run(tx, db
      .selectFrom("keystone.promotion_code")
      .select(["id", "code", "active", sql`0`.as("redemption_count")])
      .where("tenant_id", "=", tenantId)
      .where("coupon_id", "=", id)
      .orderBy("created_at", "desc"));
    codes = codeRows ?? [];
  }

  // ── lines — package_line rows (package only) ─────────────────────────────────────────────────
  // ★★★ FIX, 30 Sep 2026 ("Package editor shows what's inside" brief) — MEASURED: this function
  //   never selected `package_line` at all, so PackageEditor.jsx's own comment ("there is no read
  //   for an existing package's sessions in this build") was accurate, not a placeholder guess.
  //   `service.name`/`active` travel with each line so the editor can render and warn about a
  //   retired service the same way the NEW-package picker already does, without a second round trip.
  let lines = [];
  if (subjectType === "package") {
    const { rows: lineRows } = await run(tx, db
      .selectFrom("keystone.package_line as pl")
      .leftJoin("keystone.service as s", (join) => join
        .onRef("s.tenant_id", "=", "pl.tenant_id")
        .onRef("s.id", "=", "pl.service_id"))
      .select(["pl.service_id", "pl.quantity", "s.name as service_name", "s.active as service_active"])
      .where("pl.tenant_id", "=", tenantId)
      .where("pl.package_id", "=", id)
      .orderBy("s.name", "asc"));
    lines = lineRows;
  }

  // ── rail_defaults — getSettings subset: booking.* and items.* keys ──────────────────────────────
  const allSettings = await getSettings(tx);
  const railDefaults = {};
  for (const [k, v] of Object.entries(allSettings)) {
    if (k.startsWith("booking.") || k.startsWith("items.")) railDefaults[k] = v;
  }

  // ── stripe_sync {state, product_id} — presence + 14.26's last sync event, if any ───────────────
  const stripeIdColumn = STRIPE_ID_COLUMN[subjectType];
  const stripeId = item[stripeIdColumn] ?? null;
  const { rows: syncRows } = await run(tx, db
    .selectFrom("keystone.event")
    .select(["payload"])
    .where("tenant_id", "=", tenantId)
    .where("topic", "=", "items.catalogue.synced")
    .where("subject_type", "=", subjectType)
    .where("subject_id", "=", id)
    .orderBy("created_at", "desc")
    .limit(1));
  // ★ ITEM 16 FIX, 30 Sep 2026 — the maintainer found "One product, one price." showing for a package with no
  //   real Stripe product. A prior sync event's `state` was trusted even when `stripeId` is
  //   currently null (disconnected, or the product was later deleted on Stripe's side) — a stale
  //   "in_sync" from history outranked the current, empty `stripeId` column. Presence of a CURRENT
  //   product id is now checked FIRST; the last event's state only refines the message when a
  //   product actually exists today (in_sync vs. pending/failed), never resurrects one that doesn't.
  const lastSyncState = syncRows[0]?.payload?.state ?? null;
  const stripeSync = {
    state: stripeId ? (lastSyncState ?? "in_sync") : "never",
    product_id: stripeId,
  };

  // ── price_history — CT-F36 GATE, INLINE. Key absent entirely when the viewer may not see money. ─
  const { rows: mayRows } = await tx.query(
    `SELECT keystone.user_may($1,'invoice','view',NULL) AS ok`, [viewerId]);
  const result = {
    item, booking_policy: bookingPolicy, agreement, used_in: usedIn,
    rail_defaults: railDefaults, stripe_sync: stripeSync, codes, host_ids: hostIds, lines,
  };
  if (mayRows[0]?.ok) {
    const { rows: prices } = await run(tx, db
      .selectFrom("keystone.price")
      .select(["id", "amount_minor", "currency", "effective_from", "effective_to", "location_id", "delivery_mode"])
      .where("tenant_id", "=", tenantId)
      .where("subject_type", "=", subjectType)
      .where("subject_id", "=", id)
      .orderBy("effective_from", "desc"));
    result.price_history = prices;
  }
  return result;
}

// ★ F06 §8 — exactly the "item default" keys `src/settings/keys.mjs:500-532` names 14.21 as the
//   reader of, MEASURED against that file's own comment ("Readers: 14.20 ... and 14.21"). Fallbacks:
//   duration/price/bookable match 14.20's own `createService` fallbacks (60 / 0 / true); `delivery`
//   matches `service.delivery_modes`' DB DEFAULT (`{in_person}`, migration 0410); `warn_at_remaining`
//   matches `package.warn_at_remaining`'s DB DEFAULT (2, migration 0410); the rest have no natural
//   default and fall back to `null`.
const ITEM_DEFAULT_KEYS = Object.freeze([
  ["items.default_duration_minutes", 60],
  ["items.default_price_minor", 0],
  ["items.default_unit", null],
  ["items.default_delivery", "in_person"],
  ["items.default_bookable_online", true],
  ["items.default_tax_code", null],
  ["items.default_agreement_template_id", null],
  ["items.warn_at_remaining", 2],
]);

/** `GET /api/items/defaults` — object:"item", action:"view". */
export async function itemDefaults(tx, { tenantId }) {
  const out = {};
  for (const [key, fallback] of ITEM_DEFAULT_KEYS) {
    out[key] = await getSetting(tx, key, fallback);
  }

  const { rows } = await run(tx, db
    .selectFrom("keystone.tenant_intake")
    .select(["coaching_type"])
    .where("tenant_id", "=", tenantId));
  const coachingType = rows[0]?.coaching_type ?? null;
  out.starter_services = (coachingType && STARTER_SERVICE_NAMES[coachingType]) || [];

  return out;
}
