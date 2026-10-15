// @ts-check
// src/booking/practiceLinks.mjs — Stage 20 §4 (0496): the practice's named, SCOPED booking links.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A PAGE, NOT A PERSON. `keystone.booking_link` is "the recovery-coaching page" / "the
//     life-coaching page" — a shareable slug scoped to service categories, staff and locations.
//     The coach's own `/book/:coachSlug` (`bookingLinks.mjs`, 0312) is a different object and this
//     module never touches it.
// ★★ SCOPE SEMANTICS (0496's own rule, one place, here): each axis is an allow-list; an EMPTY axis
//    (no rows) means UNSCOPED on that axis. `updateLink` therefore treats an explicit `[]` as
//    "clear the axis" and `undefined` as "leave it alone" — two different intents, never merged.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { invalid, notFound, conflict } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";

// Same shape family as 0312`s coach slug and the practice subdomain — reused, not re-derived.`
const SLUG_SHAPE = /^[a-z0-9](-?[a-z0-9])*$/;

const AXES = Object.freeze([
  { field: "categoryIds", table: "booking_link_category", column: "category_id", what: "service category" },
  { field: "staffIds", table: "booking_link_staff", column: "app_user_id", what: "staff member" },
  { field: "locationIds", table: "booking_link_location", column: "location_id", what: "location" },
]);

function cleanIds(value, what) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw invalid(`${what} scope must be a list of ids`);
  const ids = [...new Set(value.map((v) => String(v ?? "").trim()).filter(Boolean))];
  return ids;
}

async function scopeOf(tx, tenantId, linkId) {
  const out = {};
  for (const axis of AXES) {
    const { rows } = await tx.query(
      `SELECT ${axis.column} AS id FROM keystone.${axis.table} WHERE tenant_id = $1 AND link_id = $2`,
      [tenantId, linkId]);
    out[axis.field] = rows.map((r) => r.id);
  }
  return out;
}

async function writeScope(tx, tenantId, linkId, axis, ids) {
  await tx.query(
    `DELETE FROM keystone.${axis.table} WHERE tenant_id = $1 AND link_id = $2`,
    [tenantId, linkId]);
  for (const id of ids) {
    try {
      await tx.query(
        `INSERT INTO keystone.${axis.table} (tenant_id, link_id, ${axis.column}) VALUES ($1, $2, $3)`,
        [tenantId, linkId, id]);
    } catch (e) {
      // ★ A scope id from another practice fails the composite FK — the same refusal shape a raw
      //   cross-tenant id gets everywhere else; never a distinguishable "exists elsewhere" answer.
      if (e.code === FK_VIOLATION || e.code === "22P02") {
        throw invalid(`that ${axis.what} does not exist in this practice`);
      }
      throw e;
    }
  }
}

function view(row, scope) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    active: row.active,
    archivedAt: row.archived_at,
    ...scope,
  };
}

export async function listLinks(tx, { tenantId }) {
  const { rows } = await run(tx, db
    .selectFrom("keystone.booking_link")
    .select(["id", "slug", "name", "active", "archived_at"])
    .where("tenant_id", "=", tenantId)
    .where("archived_at", "is", null)
    .orderBy("name"));
  const out = [];
  for (const row of rows) out.push(view(row, await scopeOf(tx, tenantId, row.id)));
  return out;
}

export async function createLink(tx, { tenantId, createdBy, slug, name, categoryIds, staffIds, locationIds }) {
  const trimmedSlug = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  if (!trimmedSlug) throw invalid("a booking link needs a link value");
  if (!SLUG_SHAPE.test(trimmedSlug)) {
    throw invalid("a booking link can only use lowercase letters, numbers and single hyphens");
  }
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) throw invalid("a booking link needs a name");

  let row;
  try {
    ({ rows: [row] } = await run(tx, db
      .insertInto("keystone.booking_link")
      .values({
        tenant_id: tenantId ?? null,
        slug: trimmedSlug ?? null,
        name: trimmedName ?? null,
        created_by: createdBy ?? null
      })
      .returning(["id", "slug", "name", "active", "archived_at"])));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) throw conflict("that link is already taken");
    throw e;
  }

  for (const axis of AXES) {
    const ids = cleanIds({ categoryIds, staffIds, locationIds }[axis.field], axis.what);
    if (ids !== undefined && ids.length > 0) await writeScope(tx, tenantId, row.id, axis, ids);
  }
  return view(row, await scopeOf(tx, tenantId, row.id));
}

export async function updateLink(tx, { tenantId, linkId, slug, name, active, categoryIds, staffIds, locationIds }) {
  const { rows: [before] } = await run(tx, db
    .selectFrom("keystone.booking_link")
    .select(["id", "slug", "name", "active", "archived_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", linkId)
    .where("archived_at", "is", null));
  if (!before) throw notFound("no such booking link");

  const sets = [];
  const params = [tenantId, linkId];
  if (slug !== undefined) {
    const trimmed = typeof slug === "string" ? slug.trim().toLowerCase() : "";
    if (!trimmed) throw invalid("a booking link needs a link value");
    if (!SLUG_SHAPE.test(trimmed)) {
      throw invalid("a booking link can only use lowercase letters, numbers and single hyphens");
    }
    params.push(trimmed);
    sets.push(`slug = $${params.length}`);
  }
  if (name !== undefined) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) throw invalid("a booking link needs a name");
    params.push(trimmed);
    sets.push(`name = $${params.length}`);
  }
  if (active !== undefined) {
    params.push(!!active);
    sets.push(`active = $${params.length}`);
  }
  if (sets.length > 0) {
    try {
      await tx.query(
        `UPDATE keystone.booking_link SET ${sets.join(", ")}, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        params);
    } catch (e) {
      if (e.code === UNIQUE_VIOLATION) throw conflict("that link is already taken");
      throw e;
    }
  }

  for (const axis of AXES) {
    const ids = cleanIds({ categoryIds, staffIds, locationIds }[axis.field], axis.what);
    if (ids !== undefined) await writeScope(tx, tenantId, linkId, axis, ids);
  }

  const { rows: [after] } = await run(tx, db
    .selectFrom("keystone.booking_link")
    .select(["id", "slug", "name", "active", "archived_at"])
    .where("tenant_id", "=", tenantId)
    .where("id", "=", linkId));
  return view(after, await scopeOf(tx, tenantId, linkId));
}

export async function archiveLink(tx, { tenantId, linkId }) {
  const { rowCount } = await run(tx, db
    .updateTable("keystone.booking_link")
    .set({
      archived_at: sql`now()`,
      active: false,
      updated_at: sql`now()`
    })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", linkId)
    .where("archived_at", "is", null));
  if (rowCount === 0) throw notFound("no such booking link");
  return { archived: true };
}
