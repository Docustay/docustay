// @ts-check
// 12.2 — THE LOCATION MODEL. listLocations · createLocation · updateLocation.
//
// OQ-12.1 (RULED): Stage 12 owns `keystone.location` (migration 0381); every later stage consumes
// the same table through CT-F22 and may add a column, never a second table.
//
// ★ `listLocations` carries no explicit `tenant_id` predicate — RLS (`tenant_isolation`,
//   0381) is the only scoping, same house rule as `src/records/lists/_shared.mjs:25-27`: a
//   hand-written second predicate is the copy that drifts.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, conflict, notFound } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "settings";

const UNIQUE_VIOLATION = "23505";

// ★ Computed once at module load — the closed set of IANA zone names this runtime knows about.
const IANA_ZONES = new Set(Intl.supportedValuesOf("timeZone"));

/**
 * List every non-archived location in this practice, ordered by name then id.
 */
export async function listLocations(tx) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.location")
    .select(["id", "name", "timezone", "city", "archived_at"])
    .where("archived_at", "is", null)
    .orderBy("name", "asc")
    .orderBy("id", "asc"));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    city: r.city,
    archivedAt: r.archived_at,
  }));
}

/**
 * Create a location.
 * ★ `name` trimmed, 1-120 chars. `timezone` must be a real IANA zone. Duplicate (case-insensitive)
 *   name within the practice is a conflict.
 */
export async function createLocation(tx, {
  tenantId, name, timezone,
  addressLine1 = null, addressLine2 = null, city = null, stateRegion = null,
  postcode = null, country = null, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (trimmedName === "" || trimmedName.length > 120) {
    throw invalid("a location needs a name");
  }
  if (typeof timezone !== "string" || !IANA_ZONES.has(timezone)) {
    throw invalid("timezone must be an IANA zone like America/Los_Angeles");
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  try {
    await run(tx, db
      .insertInto("keystone.location")
      .values({
        id,
        tenant_id: tenantId ?? null,
        name: trimmedName ?? null,
        timezone: timezone ?? null,
        address_line1: addressLine1 ?? null,
        address_line2: addressLine2 ?? null,
        city: city ?? null,
        state_region: stateRegion ?? null,
        postcode: postcode ?? null,
        country: country ?? null,
        created_by: actorUserId ?? null,
      }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict("a location with this name already exists", { field: "name" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "settings.location.created", emittedBy: SECTION,
    subjectType: "location", subjectId: id,
    actor: userActor(actorUserId),
    payload: {},
  });
  return { id, name: trimmedName };
}

/**
 * Update a location. Every field is optional — omitted (`undefined`) means unchanged.
 * ★ `archived: true` sets `archived_at = now()`; `archived: false` clears it. There is no delete
 *   path and no DELETE grant on the table — a location is archived, never removed.
 */
export async function updateLocation(tx, {
  tenantId, locationId, name, timezone,
  addressLine1, addressLine2, city, stateRegion, postcode, country,
  archived, actorUserId = null,
}) {
  if (!tenantId) throw invalid("tenantId is required");
  if (!locationId) throw invalid("locationId is required");

  const sets = [];
  const args = [locationId];
  const changed = [];

  const setField = (column, value, label) => {
    args.push(value);
    sets.push(`${column} = $${args.length}`);
    changed.push(label ?? column);
  };

  if (name !== undefined) {
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (trimmedName === "" || trimmedName.length > 120) throw invalid("a location needs a name");
    setField("name", trimmedName);
  }
  if (timezone !== undefined) {
    if (typeof timezone !== "string" || !IANA_ZONES.has(timezone)) {
      throw invalid("timezone must be an IANA zone like America/Los_Angeles");
    }
    setField("timezone", timezone);
  }
  if (addressLine1 !== undefined) setField("address_line1", addressLine1);
  if (addressLine2 !== undefined) setField("address_line2", addressLine2);
  if (city !== undefined) setField("city", city);
  if (stateRegion !== undefined) setField("state_region", stateRegion);
  if (postcode !== undefined) setField("postcode", postcode);
  if (country !== undefined) setField("country", country);
  if (archived !== undefined) {
    if (archived === true) {
      sets.push("archived_at = now()");
      changed.push("archived");
    } else if (archived === false) {
      sets.push("archived_at = NULL");
      changed.push("archived");
    } else {
      throw invalid("archived must be true or false");
    }
  }

  if (sets.length === 0) throw invalid("nothing to update");

  let r;
  try {
    r = await tx.query(
      `UPDATE keystone.location SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, args);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict("a location with this name already exists", { field: "name" });
    }
    throw e;
  }
  // ★ Zero rows is 404, not success — under RLS a cross-tenant id looks exactly like a missing one.
  if (r.rowCount === 0) throw notFound("no such location in this practice");

  await emit(tx, {
    tenantId, topic: "settings.location.updated", emittedBy: SECTION,
    subjectType: "location", subjectId: locationId,
    actor: userActor(actorUserId),
    payload: { fields: changed },
  });
  return { id: locationId, fields: changed };
}
