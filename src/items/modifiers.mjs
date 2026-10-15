// @ts-check
// Stage 14 task 14.17 — MODIFIERS, THE STACK LIMIT AND THE QUOTE.
//
// A MODIFIER is a reusable priced/timed add-on (`keystone.modifier`, migration 0411 — task 14.4,
// read there for the exact columns/CHECKs/FKs, not repeated here). `keystone.modifier_service`
// (also 0411) is the join table an `applies:'list'` modifier uses to name which services it applies
// to. This module is the write/read primitives; `src/routes/itemsModifiers.mjs` is the wire.
//
// ★★★ MONEY: `quoteModifiers` below is ARITHMETIC A PERSON WILL BE CHARGED ON. `base_minor` is read
//     from `currentPrice()` (`src/items/writes.mjs`, the append-only price ledger) and
//     `price_delta_minor` is read from the stored `modifier` row — NEITHER figure is ever accepted
//     from the caller. `total_minor` is computed here, server-side, and returned; nothing in this
//     module writes a client-supplied amount into a stored row. There is no price EDIT anywhere in
//     this file — `createModifier`'s `priceDeltaMinor` is a NEW row's own delta, not a change to an
//     existing line's already-agreed amount.
//
// ★★ STATUS CODES — §0.4 C says error sentences are "thrown as `invalid(msg,{field})` (400/422 per
//    the existing `src/http/errors.mjs` kinds)". `invalid()` itself is ALWAYS 400 (VALIDATION,
//    `errors.mjs:28`) — there is no 422 path through it. Field 7/8/9 of 14.17 all state 422 for the
//    "both null" create refusal and the stack-limit refusal, so those two use `unprocessable()`
//    (UNPROCESSABLE, 422) instead — the helper that actually produces the stated status. Reported as
//    a citation drift, not silently reconciled by picking one without saying so.
//
// ★ `capacity` (used by the `one_to_one` applies check below) is migration 0410's column (task
//   14.3), which is NOT a declared dependency of this task (field 10 names only 14.4/14.15/CT-F02).
//   Field 4's own words — "when that column exists" — are read literally: this module checks
//   `information_schema.columns` at read time rather than assuming the column is there, so the
//   `one_to_one` capacity check degrades to "no capacity check" rather than erroring if 14.3 has not
//   landed in whatever database this runs against.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict, unprocessable } from "../http/errors.mjs";
import { getSetting } from "../settings/writes.mjs";
import { currentPrice } from "./writes.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "items";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

// ★ 0411's CHECK on `modifier.applies`.
const MODIFIER_APPLIES = Object.freeze(["all", "one_to_one", "list"]);

// ★ 0411's `modifier_changes_something` CHECK, mirrored at the application layer so a bad shape is
//   a named error naming the field, not a raw constraint violation — same idiom as
//   `assertDiscountShape` in `src/items/writes.mjs`.
const NEEDS_A_CHANGE_MESSAGE =
  "A modifier has to change the price or the length — otherwise it's an option.";

function assertDeltaOrNull(value, label) {
  if (value !== null && value !== undefined && !Number.isInteger(value)) {
    throw invalid(`${label} must be an integer, or null — got ${JSON.stringify(value)}`);
  }
}

/** Every modifier this practice has defined, with the services a `list` modifier applies to. */
export async function listModifiers(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT m.id, m.name, m.price_delta_minor, m.minutes_delta, m.applies, m.after_time, m.active,
            coalesce(array_remove(array_agg(DISTINCT ms.service_id), NULL), '{}') AS service_ids
       FROM keystone.modifier m
       LEFT JOIN keystone.modifier_service ms
         ON ms.tenant_id = m.tenant_id AND ms.modifier_id = m.id
      WHERE m.tenant_id = $1
      GROUP BY m.id, m.name, m.price_delta_minor, m.minutes_delta, m.applies, m.after_time, m.active
      ORDER BY m.name`,
    [tenantId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, price_delta_minor: r.price_delta_minor, minutes_delta: r.minutes_delta,
    applies: r.applies, after_time: r.after_time, active: r.active, service_ids: r.service_ids,
  }));
}

/**
 * Create a modifier. 422 (`unprocessable`) `NEEDS_A_CHANGE_MESSAGE` when both `priceDeltaMinor` and
 * `minutesDelta` are null — a modifier that changes neither the price nor the length is an OPTION
 * (14.18's booking options), not a modifier. Emits `items.modifier.created`.
 */
export async function createModifier(tx, {
  tenantId, name, priceDeltaMinor = null, minutesDelta = null, applies, serviceIds = null,
  afterTime = null, actorUserId = null,
}) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a modifier needs a name");
  if (!MODIFIER_APPLIES.includes(applies)) {
    throw invalid(`applies must be one of ${MODIFIER_APPLIES.join(", ")} — got ${JSON.stringify(applies)}`);
  }
  assertDeltaOrNull(priceDeltaMinor, "priceDeltaMinor");
  assertDeltaOrNull(minutesDelta, "minutesDelta");
  // ★★★ THE 422 THIS TASK NAMES. Checked here, before the INSERT, so the sentence names the field
  //     rather than the caller seeing a raw `modifier_changes_something` constraint violation.
  if (priceDeltaMinor === null && minutesDelta === null) {
    throw unprocessable(NEEDS_A_CHANGE_MESSAGE);
  }
  if (applies === "list" && (!Array.isArray(serviceIds) || serviceIds.length === 0)) {
    throw invalid("pick at least one service for this add-on to apply to");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.modifier")
      .values({
        id, tenant_id: tenantId, name: name.trim(), price_delta_minor: priceDeltaMinor ?? null,
        minutes_delta: minutesDelta ?? null, applies, after_time: afterTime ?? null,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have an add-on called ${name.trim()}.`, { field: "name" });
    }
    if (e.code === CHECK_VIOLATION) {
      if (e.constraint === "modifier_changes_something") throw unprocessable(NEEDS_A_CHANGE_MESSAGE);
      throw invalid(`the database refused this add-on: ${e.constraint ?? e.message}`);
    }
    throw e;
  }

  if (applies === "list") {
    for (const serviceId of serviceIds) {
      try {
        await run(tx, db
          .insertInto("keystone.modifier_service")
          .values({ tenant_id: tenantId, modifier_id: id, service_id: serviceId }));
      } catch (e) {
        if (e.code === FOREIGN_KEY_VIOLATION) {
          throw invalid(`no service ${serviceId} in this practice's catalogue`);
        }
        throw e;
      }
    }
  }

  // ★ `subjectType: null` — `modifier` is not in `SUBJECT_TYPES` (`src/events/topics.mjs`, and not
  //   added by 14.15 either — measured, that task's file list touches only the `items`/`documents`
  //   TOPIC arrays, never `SUBJECT_TYPES`). Same posture `createCategory` already takes for the same
  //   reason (`src/items/catalogue.mjs`). ★ `items.modifier.created` itself is 14.15's to register
  //   (field 10 names it as a dependency); until it lands, `emit()`'s closed-catalogue check refuses
  //   this topic — reported, not silently worked around.
  await emit(tx, {
    tenantId, topic: "items.modifier.created", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, applies, price_delta_minor: priceDeltaMinor, minutes_delta: minutesDelta },
  });

  return { id, name: name.trim(), applies, price_delta_minor: priceDeltaMinor, minutes_delta: minutesDelta };
}

/** Partial update. Same 422 as create if the update would leave both deltas null. */
export async function updateModifier(tx, {
  tenantId, id, name, priceDeltaMinor, minutesDelta, applies, serviceIds, afterTime,
  actorUserId = null,
}) {
  const { rows: existingRows } = await run(tx, db
    .selectFrom("keystone.modifier")
    .select(["price_delta_minor", "minutes_delta", "applies"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (!existingRows[0]) throw notFound("no such add-on in this practice's catalogue");
  const existing = existingRows[0];

  if (priceDeltaMinor !== undefined) assertDeltaOrNull(priceDeltaMinor, "priceDeltaMinor");
  if (minutesDelta !== undefined) assertDeltaOrNull(minutesDelta, "minutesDelta");
  const nextPriceDelta = priceDeltaMinor === undefined ? existing.price_delta_minor : priceDeltaMinor;
  const nextMinutesDelta = minutesDelta === undefined ? existing.minutes_delta : minutesDelta;
  if (nextPriceDelta === null && nextMinutesDelta === null) {
    throw unprocessable(NEEDS_A_CHANGE_MESSAGE);
  }
  if (applies !== undefined && !MODIFIER_APPLIES.includes(applies)) {
    throw invalid(`applies must be one of ${MODIFIER_APPLIES.join(", ")} — got ${JSON.stringify(applies)}`);
  }
  const nextApplies = applies === undefined ? existing.applies : applies;

  const sets = [];
  const args = [tenantId, id];
  const changed = [];
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("a modifier name cannot be blank");
    args.push(name.trim()); sets.push(`name = $${args.length}`); changed.push("name");
  }
  if (priceDeltaMinor !== undefined) {
    args.push(priceDeltaMinor); sets.push(`price_delta_minor = $${args.length}`); changed.push("price_delta_minor");
  }
  if (minutesDelta !== undefined) {
    args.push(minutesDelta); sets.push(`minutes_delta = $${args.length}`); changed.push("minutes_delta");
  }
  if (applies !== undefined) {
    args.push(applies); sets.push(`applies = $${args.length}`); changed.push("applies");
  }
  if (afterTime !== undefined) {
    args.push(afterTime); sets.push(`after_time = $${args.length}`); changed.push("after_time");
  }
  if (sets.length === 0 && serviceIds === undefined) throw invalid("nothing to update");

  if (sets.length > 0) {
    let r;
    try {
      r = await tx.query(
        `UPDATE keystone.modifier SET ${sets.join(", ")}, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        args);
    } catch (e) {
      if (e.code === UNIQUE_VIOLATION) {
        throw conflict(`You already have an add-on called ${name?.trim() ?? ""}.`, { field: "name" });
      }
      if (e.code === CHECK_VIOLATION) {
        if (e.constraint === "modifier_changes_something") throw unprocessable(NEEDS_A_CHANGE_MESSAGE);
        throw invalid(`the database refused this add-on: ${e.constraint ?? e.message}`);
      }
      throw e;
    }
    if (r.rowCount === 0) throw notFound("no such add-on in this practice's catalogue");
  }

  if (serviceIds !== undefined) {
    await run(tx, db
      .deleteFrom("keystone.modifier_service")
      .where("tenant_id", "=", tenantId)
      .where("modifier_id", "=", id));
    if (nextApplies === "list") {
      for (const serviceId of serviceIds ?? []) {
        try {
          await run(tx, db
            .insertInto("keystone.modifier_service")
            .values({ tenant_id: tenantId, modifier_id: id, service_id: serviceId }));
        } catch (e) {
          if (e.code === FOREIGN_KEY_VIOLATION) {
            throw invalid(`no service ${serviceId} in this practice's catalogue`);
          }
          throw e;
        }
      }
    }
    changed.push("service_ids");
  }

  // ★ Same `subjectType: null` / not-yet-registered-topic posture as `createModifier` above.
  await emit(tx, {
    tenantId, topic: "items.modifier.updated", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, changed },
  });

  return { id };
}

/** Turn a modifier on or off. Same no-op-refused idiom as `setDiscountActive`. */
export async function setModifierActive(tx, { tenantId, id, active, actorUserId = null }) {
  if (typeof active !== "boolean") throw invalid(`active must be a boolean — got ${JSON.stringify(active)}`);

  const { rows } = await run(tx, db
    .selectFrom("keystone.modifier")
    .select("active")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (!rows[0]) throw notFound("no such add-on in this practice's catalogue");
  if (rows[0].active === active) {
    throw conflict(active ? "This add-on is already offered" : "This add-on is already not offered");
  }

  await run(tx, db
    .updateTable("keystone.modifier")
    .set({ active, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));

  await emit(tx, {
    tenantId, topic: "items.modifier.active_changed", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, active },
  });

  return { id, active };
}

/**
 * ★★★ THE GUARD. `items.modifier_stack_limit` (Stage 11 CT-F02, `src/settings/keys.mjs:454`) is null
 *     by default (no cap); when set, more than `n` modifier ids is refused with the practice's own
 *     sentence. 422 (`unprocessable`) per field 7/8/9 — see this file's header note on status codes.
 * ★★ THE APPLICATION SUPPLIES THE CONDITION, NOT THE TEST: `getSetting` reads the SAME
 *    `keystone.tenant_setting` row the Settings screen writes through `setSetting`
 *    (`src/settings/writes.mjs`) — a real practice turning the dial is what this function reacts to,
 *    not a value only a fixture ever sets.
 */
export async function assertModifierStack(tx, { tenantId, modifierIds }) {
  if (!Array.isArray(modifierIds)) {
    throw invalid(`modifierIds must be an array — got ${JSON.stringify(modifierIds)}`);
  }
  const limit = await getSetting(tx, "items.modifier_stack_limit", null);
  if (limit === null) return { limit: null };
  if (modifierIds.length > limit) {
    throw unprocessable(`Your practice caps add-ons at ${limit}.`);
  }
  return { limit };
}

/**
 * Price and length a service would come to with a stack of modifiers applied, computed entirely
 * server-side. Calls `assertModifierStack` first (the stack-limit refusal takes priority over any
 * per-modifier applicability refusal — 14.17 field 9's own example: limit 1 with two modifierIds
 * refuses on the stack limit before either modifier is even looked up).
 *
 * Refuses a modifier that:
 *  - `applies:'list'` and carries no `modifier_service` row for this `serviceId`;
 *  - `applies:'one_to_one'` and the service's `capacity` (0410, when that column exists) is > 1;
 *  - has an `after_time` later than `at`'s local time-of-day in the practice's own timezone
 *    (`keystone.tenant.timezone`, the same `AT TIME ZONE` idiom `src/records/queries.mjs` and
 *    `src/money/invoiceNumbers.mjs` already use).
 *
 * @returns { base_minor, total_minor, minutes, lines:[{modifier_id, name, delta_minor, minutes_delta}] }
 */
export async function quoteModifiers(tx, { tenantId, serviceId, modifierIds, at = null }) {
  if (!Array.isArray(modifierIds)) {
    throw invalid(`modifierIds must be an array — got ${JSON.stringify(modifierIds)}`);
  }
  await assertModifierStack(tx, { tenantId, modifierIds });

  // ★ 0410's `capacity` column is not a declared dependency of this task — checked defensively.
  const { rows: colRows } = await run(tx, db
    .selectFrom("information_schema.columns")
    .select(sql`1`)
    .where("table_schema", "=", "keystone")
    .where("table_name", "=", "service")
    .where("column_name", "=", "capacity"));
  const hasCapacityColumn = colRows.length > 0;

  const { rows: serviceRows } = await tx.query(
    hasCapacityColumn
      ? `SELECT duration_minutes, capacity FROM keystone.service WHERE tenant_id = $1 AND id = $2`
      : `SELECT duration_minutes, NULL::integer AS capacity FROM keystone.service WHERE tenant_id = $1 AND id = $2`,
    [tenantId, serviceId]);
  if (!serviceRows[0]) throw notFound(`no service ${serviceId} in this practice's catalogue`);
  const service = serviceRows[0];

  // ★★★ THE BASE PRICE — read, never accepted from the caller. `currentPrice` is §Z4's own reader
  //     of the append-only `price` ledger (`src/items/writes.mjs`).
  const base = await currentPrice(tx, { tenantId, subjectType: "service", subjectId: serviceId });

  const { rows: tzRows } = await run(tx, db
    .selectFrom("keystone.tenant")
    .select("timezone")
    .where("id", "=", tenantId));
  const timezone = tzRows[0]?.timezone ?? "UTC";
  const { rows: atRows } = await tx.query(
    `SELECT (coalesce($1::timestamptz, now()) AT TIME ZONE $2)::time AS local_time`,
    [at, timezone]);
  const localTime = atRows[0].local_time;

  const lines = [];
  let totalMinor = base.amount_minor;
  let minutes = service.duration_minutes;

  for (const modifierId of modifierIds) {
    const { rows: modRows } = await run(tx, db
      .selectFrom("keystone.modifier")
      .select(["id", "name", "price_delta_minor", "minutes_delta", "applies", "after_time"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", modifierId));
    const modifier = modRows[0];
    if (!modifier) throw notFound(`no add-on ${modifierId} in this practice's catalogue`);

    if (modifier.applies === "list") {
      const { rows: linkRows } = await run(tx, db
        .selectFrom("keystone.modifier_service")
        .select(sql`1`)
        .where("tenant_id", "=", tenantId)
        .where("modifier_id", "=", modifierId)
        .where("service_id", "=", serviceId));
      if (!linkRows[0]) throw invalid(`${modifier.name} doesn't apply to this service`);
    }
    if (modifier.applies === "one_to_one" && hasCapacityColumn && service.capacity > 1) {
      throw invalid(`${modifier.name} only applies to one-to-one services`);
    }
    if (modifier.after_time !== null && modifier.after_time > localTime) {
      throw invalid(`${modifier.name} isn't available at that time yet`);
    }

    const deltaMinor = modifier.price_delta_minor ?? 0;
    const modifierMinutesDelta = modifier.minutes_delta ?? 0;
    totalMinor += deltaMinor;
    minutes += modifierMinutesDelta;
    lines.push({
      modifier_id: modifier.id, name: modifier.name,
      delta_minor: deltaMinor, minutes_delta: modifierMinutesDelta,
    });
  }

  return { base_minor: base.amount_minor, total_minor: totalMinor, minutes, lines };
}
