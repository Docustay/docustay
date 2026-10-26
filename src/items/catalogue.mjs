// @ts-check
// Stage 14 task 14.16 — CATEGORIES AND UNITS.
//
// Categories group services (`keystone.service_category`); units say what a service is sold by
// (`keystone.unit`). Both tables and `keystone.seed_units()` are migration 0409 (task 14.2) — read
// there, not here, for the shapes (columns, CHECKs, grants). This module is the write/read
// primitives; `src/routes/itemsCatalogue.mjs` is the wire.
//
// ★★★ RESOLVED 25 Sep 2026 — 0409 WAS FIXED. THE CONTRADICTION BELOW NO LONGER EXISTS.
//     `deleteCategory` works: `db/migrations/0409_service_category_and_unit.sql:46` creates the
//     `tenant_delete` policy and `:50` is `GRANT SELECT, INSERT, UPDATE, DELETE ON
//     keystone.service_category TO app_rw`. The self-check was inverted with it and now RAISEs when
//     app_rw is MISSING delete ("14.16's deleteCategory would fail with insufficient_privilege on
//     every call"), and expects five policies including `tenant_delete`. [MEASURED, this file's own
//     migration, 25 Sep 2026.]
//
//     ★★ KEPT, NOT DELETED, BECAUSE IT WAS RIGHT WHEN IT WAS WRITTEN — and because of what it cost
//     after it stopped being right. The original text:
//
//       > 0409's self-check RAISEs if `app_rw` ever holds DELETE on `keystone.service_category` —
//       > "no delete path this stage" — and the migration's GRANT line is `GRANT SELECT, INSERT,
//       > UPDATE …` (no DELETE) … the DELETE statement itself will be refused by Postgres with an
//       > insufficient-privilege error, mapped by the central error handler to a plain 500.
//
//     0409 forbade the delete path that this very stage builds; that was a real defect and flagging
//     it here was the right call. It was fixed hours later — and this comment was not, so a builder
//     reading it reported the screen's delete broken when the migration had said otherwise since
//     before they started.
//     ★★★ A COMMENT IS HISTORY, NOT A MEASUREMENT. Open the file it names before believing it.

import { emit, userActor } from "../events/outbox.mjs";
import { invalid, notFound, conflict } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const SECTION = "items";
const UNIQUE_VIOLATION = "23505";

// ★ 0409's CHECK on `service_category.visibility`.
const CATEGORY_VISIBILITIES = Object.freeze(["first", "shown", "hidden", "last"]);

/** ★ 0409's CHECK on `unit.key` — lower-case letters and underscores, starting with a letter. */
function slugifyUnitKey(name) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return base || "unit";
}

/**
 * Categories, with counts. ★ MEASURED: `keystone.service_category` is the only catalogue table 0410
 * gave a `category_id` column — `package` and `plan` were not (grep of 0410's ADD COLUMN list). So
 * "counts services/packages/plans via `service.category_id`" (field 4's phrasing) can only mean the
 * services count; there is no package/plan join to make. `booked_this_year` is confirmed bookings
 * (`confirmed`/`completed`) whose `starts_at` falls in the current calendar year, joined through
 * those same services.
 */
export async function listCategories(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT c.id, c.name, c.position, c.visibility,
            count(DISTINCT s.id) AS services_count,
            count(DISTINCT b.id) FILTER (
              WHERE b.state IN ('confirmed','completed')
                AND b.starts_at >= date_trunc('year', now())
                AND b.starts_at <  date_trunc('year', now()) + interval '1 year'
            ) AS booked_this_year
       FROM keystone.service_category c
       LEFT JOIN keystone.service s ON s.tenant_id = c.tenant_id AND s.category_id = c.id
       LEFT JOIN keystone.booking b ON b.tenant_id = c.tenant_id AND b.service_id = s.id
      WHERE c.tenant_id = $1
      GROUP BY c.id, c.name, c.position, c.visibility
      ORDER BY c.position, c.name`,
    [tenantId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, position: r.position, visibility: r.visibility,
    services_count: Number(r.services_count), booked_this_year: Number(r.booked_this_year),
  }));
}

/** Create a category, appended at the end of the practice's own ordering. */
export async function createCategory(tx, { tenantId, name, visibility = "shown", actorUserId = null }) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a category needs a name");
  if (!CATEGORY_VISIBILITIES.includes(visibility)) {
    throw invalid(`visibility must be one of ${CATEGORY_VISIBILITIES.join(", ")} — got ${JSON.stringify(visibility)}`);
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const { rows: posRows } = await tx.query(
    `SELECT coalesce(max(position) + 1, 0) AS next FROM keystone.service_category WHERE tenant_id = $1`,
    [tenantId]);
  const position = posRows[0].next;

  try {
    await run(tx, db
      .insertInto("keystone.service_category")
      .values({ id, tenant_id: tenantId, name: name.trim(), position, visibility }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have a category called ${name.trim()}.`, { field: "name" });
    }
    throw e;
  }

  // ★ 14.15 registers this topic in `src/events/topics.mjs`'s `items` array — not landed on disk as
  //   of this task (MEASURED: 0 hits for "items.category" in topics.mjs today). Field 10 names 14.15
  //   as a dependency; until it lands, `emit()`'s closed-catalogue check refuses this topic.
  await emit(tx, {
    tenantId, topic: "items.category.created", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    // ★ `name` dropped from the payload (§2.4 — no text keys). Already on the record
    //   (`keystone.service_category.name`, INSERTed above); no consumer of
    //   `items.category.created` reads `payload.name` (grepped src/, n8n/workflows/) — the
    //   listener reads the category's own name from the current row by `id`.
    payload: { id, position, visibility },
  });

  return { id, name: name.trim(), position, visibility };
}

/** Partial update — rename, re-show/hide, or reposition. */
export async function updateCategory(tx, { tenantId, id, name, visibility, position, actorUserId = null }) {
  const sets = [];
  const args = [tenantId, id];
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("a category name cannot be blank");
    args.push(name.trim()); sets.push(`name = $${args.length}`);
  }
  if (visibility !== undefined) {
    if (!CATEGORY_VISIBILITIES.includes(visibility)) {
      throw invalid(`visibility must be one of ${CATEGORY_VISIBILITIES.join(", ")} — got ${JSON.stringify(visibility)}`);
    }
    args.push(visibility); sets.push(`visibility = $${args.length}`);
  }
  if (position !== undefined) {
    if (!Number.isInteger(position) || position < 0) {
      throw invalid(`position must be a non-negative integer — got ${JSON.stringify(position)}`);
    }
    args.push(position); sets.push(`position = $${args.length}`);
  }
  if (sets.length === 0) throw invalid("nothing to update");

  let r;
  try {
    r = await tx.query(
      `UPDATE keystone.service_category SET ${sets.join(", ")}, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      args);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have a category called ${name?.trim() ?? ""}.`, { field: "name" });
    }
    throw e;
  }
  // ★ Zero rows is 404, not success — under RLS a cross-tenant id looks exactly like a missing one.
  if (r.rowCount === 0) throw notFound("no such category in this organisation");

  return { id };
}

/**
 * Real DELETE, refused with a 409 while any service still points at it.
 *
 * ★ This used to warn that Postgres refused the statement outright because 0409 granted `app_rw`
 * no DELETE. **That was fixed on 25 Sep 2026** — `0409_service_category_and_unit.sql:46` adds the
 * `tenant_delete` policy and `:50` grants DELETE. The path works. See this file's header for what
 * the stale version of this note cost.
 */
export async function deleteCategory(tx, { tenantId, id }) {
  const { rows } = await tx.query(
    `SELECT c.id, count(s.id) AS n
       FROM keystone.service_category c
       LEFT JOIN keystone.service s ON s.tenant_id = c.tenant_id AND s.category_id = c.id
      WHERE c.tenant_id = $1 AND c.id = $2
      GROUP BY c.id`,
    [tenantId, id]);
  if (rows.length === 0) throw notFound("no such category in this organisation");

  const n = Number(rows[0].n);
  if (n > 0) {
    throw conflict(`It has ${n} services in it — move them first.`);
  }

  const del = await run(tx, db
    .deleteFrom("keystone.service_category")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (del.rowCount === 0) throw notFound("no such category in this organisation");

  return { id };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRAMS — Follow-up brief Part 1 (30 Sep 2026), migration 0543 (pending). A Program is the
// real, editable replacement for `coaching_group` (0536's two-value CHECK): which line of business
// a service/package/plan belongs to. Same shape as a Category one level up — named, ordered,
// delete-not-archive — so this mirrors listCategories/createCategory/updateCategory/deleteCategory
// exactly, counting across all three catalogue tables (a category only ever counted services).
// ═══════════════════════════════════════════════════════════════════════════════
const PROGRAM_VISIBILITIES = Object.freeze(["first", "shown", "hidden", "last"]);

/** Programs, with counts across all three catalogue subjects. */
export async function listPrograms(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT p.id, p.name, p.position, p.visibility, p.colour,
            count(DISTINCT s.id) AS services_count,
            count(DISTINCT pk.id) AS packages_count,
            count(DISTINCT pl.id) AS plans_count,
            count(DISTINCT pp.person_id) FILTER (WHERE u.staff_role IS NULL) AS clients_count,
            count(DISTINCT pp.person_id) FILTER (WHERE u.staff_role IS NOT NULL) AS team_count
       FROM keystone.program p
       LEFT JOIN keystone.service s  ON s.tenant_id  = p.tenant_id AND s.program_id  = p.id
       LEFT JOIN keystone.package pk ON pk.tenant_id = p.tenant_id AND pk.program_id = p.id
       LEFT JOIN keystone.plan    pl ON pl.tenant_id = p.tenant_id AND pl.program_id = p.id
       LEFT JOIN keystone.person_program pp ON pp.tenant_id = p.tenant_id AND pp.program_id = p.id
       LEFT JOIN keystone.app_user u ON u.tenant_id = pp.tenant_id AND u.id = pp.person_id
      WHERE p.tenant_id = $1
      GROUP BY p.id, p.name, p.position, p.visibility, p.colour
      ORDER BY p.position, p.name`,
    [tenantId]);
  return rows.map((r) => ({
    id: r.id, name: r.name, position: r.position, visibility: r.visibility, colour: r.colour,
    services_count: Number(r.services_count), packages_count: Number(r.packages_count),
    plans_count: Number(r.plans_count), clients_count: Number(r.clients_count), team_count: Number(r.team_count),
  }));
}

/** One program's detail — the row plus every service/package/plan in it, for Part 3's detail page. */
export async function getProgram(tx, { tenantId, id }) {
  const { rows } = await tx.query(
    `SELECT id, name, position, visibility, colour FROM keystone.program WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]);
  if (!rows[0]) throw notFound("no such program in this practice");

  const { rows: services } = await tx.query(
    `SELECT id, name, active, archived_at IS NOT NULL AS archived FROM keystone.service
      WHERE tenant_id = $1 AND program_id = $2 ORDER BY name`, [tenantId, id]);
  const { rows: packages } = await tx.query(
    `SELECT id, name, active FROM keystone.package
      WHERE tenant_id = $1 AND program_id = $2 ORDER BY name`, [tenantId, id]);
  const { rows: plans } = await tx.query(
    `SELECT id, name, active, archived_at IS NOT NULL AS archived FROM keystone.plan
      WHERE tenant_id = $1 AND program_id = $2 ORDER BY name`, [tenantId, id]);

  return { ...rows[0], services, packages, plans };
}

/** Create a program, appended at the end of the practice's own ordering. */
const PROGRAM_COLOUR = /^#[0-9a-fA-F]{6}$/;
const checkColour = (colour) => {
  if (colour !== null && colour !== undefined && !PROGRAM_COLOUR.test(colour)) throw invalid(`colour must look like #1a2b3c — got ${JSON.stringify(colour)}`);
};

export async function createProgram(tx, { tenantId, name, visibility = "shown", colour = null, actorUserId = null }) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a program needs a name");
  checkColour(colour);
  if (!PROGRAM_VISIBILITIES.includes(visibility)) {
    throw invalid(`visibility must be one of ${PROGRAM_VISIBILITIES.join(", ")} — got ${JSON.stringify(visibility)}`);
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  const { rows: posRows } = await tx.query(
    `SELECT coalesce(max(position) + 1, 0) AS next FROM keystone.program WHERE tenant_id = $1`,
    [tenantId]);
  const position = posRows[0].next;

  try {
    await run(tx, db
      .insertInto("keystone.program")
      .values({ id, tenant_id: tenantId, name: name.trim(), position, visibility }));
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have a program called ${name.trim()}.`, { field: "name" });
    }
    throw e;
  }

  await emit(tx, {
    tenantId, topic: "items.program.created", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id, position, visibility },
  });

  return { id, name: name.trim(), position, visibility };
}

/** Partial update — rename, re-show/hide, or reposition. */
export async function updateProgram(tx, { tenantId, id, name, visibility, position, colour, actorUserId = null }) {
  const sets = [];
  const args = [tenantId, id];
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) throw invalid("a program name cannot be blank");
    args.push(name.trim()); sets.push(`name = $${args.length}`);
  }
  if (visibility !== undefined) {
    if (!PROGRAM_VISIBILITIES.includes(visibility)) {
      throw invalid(`visibility must be one of ${PROGRAM_VISIBILITIES.join(", ")} — got ${JSON.stringify(visibility)}`);
    }
    args.push(visibility); sets.push(`visibility = $${args.length}`);
  }
  if (position !== undefined) {
    if (!Number.isInteger(position) || position < 0) {
      throw invalid(`position must be a non-negative integer — got ${JSON.stringify(position)}`);
    }
    args.push(position); sets.push(`position = $${args.length}`);
  }
  if (colour !== undefined) {
    checkColour(colour);
    args.push(colour); sets.push(`colour = $${args.length}`);
  }
  if (sets.length === 0) throw invalid("nothing to update");

  let r;
  try {
    r = await tx.query(
      `UPDATE keystone.program SET ${sets.join(", ")}, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      args);
  } catch (e) {
    if (e.code === UNIQUE_VIOLATION) {
      throw conflict(`You already have a program called ${name?.trim() ?? ""}.`, { field: "name" });
    }
    throw e;
  }
  if (r.rowCount === 0) throw notFound("no such program in this practice");

  await emit(tx, {
    tenantId, topic: "items.program.updated", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id },
  });

  return { id };
}

/** Real DELETE, refused with a 409 while any service/package/plan still points at it. */
export async function deleteProgram(tx, { tenantId, id, actorUserId = null }) {
  const { rows } = await tx.query(
    `SELECT p.id,
            (SELECT count(*) FROM keystone.service  WHERE tenant_id = p.tenant_id AND program_id = p.id) +
            (SELECT count(*) FROM keystone.package   WHERE tenant_id = p.tenant_id AND program_id = p.id) +
            (SELECT count(*) FROM keystone.plan      WHERE tenant_id = p.tenant_id AND program_id = p.id) AS n
       FROM keystone.program p
      WHERE p.tenant_id = $1 AND p.id = $2`,
    [tenantId, id]);
  if (rows.length === 0) throw notFound("no such program in this practice");

  const n = Number(rows[0].n);
  if (n > 0) {
    throw conflict(`It has ${n} item(s) in it — move them first.`);
  }

  const del = await run(tx, db
    .deleteFrom("keystone.program")
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (del.rowCount === 0) throw notFound("no such program in this practice");

  await emit(tx, {
    tenantId, topic: "items.program.deleted", emittedBy: SECTION,
    subjectType: null, subjectId: null,
    actor: userActor(actorUserId),
    payload: { id },
  });

  return { id };
}

/** Reorder: `ids` is the whole list in its new order; positions are rewritten 0..n-1 in one go. */
export async function reorderPrograms(tx, { tenantId, ids, actorUserId = null }) {
  if (!Array.isArray(ids) || ids.length === 0) throw invalid("ids must be the programs in their new order");
  const { rows } = await tx.query(`SELECT id FROM keystone.program WHERE tenant_id = $1`, [tenantId]);
  const known = new Set(rows.map((r) => r.id));
  if (ids.length !== known.size || ids.some((i) => !known.has(i)) || new Set(ids).size !== ids.length) {
    throw invalid("ids must name every program in this practice exactly once");
  }
  for (let i = 0; i < ids.length; i += 1) {
    await tx.query(`UPDATE keystone.program SET position = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, ids[i], i]);
  }
  await emit(tx, { tenantId, topic: "items.program.updated", emittedBy: SECTION, subjectType: null, subjectId: null, actor: userActor(actorUserId), payload: { reordered: ids.length } });
  return { ids };
}

/** A person's programs (clients AND team members) — SET semantics: the list given is the whole list. */
export async function setPersonPrograms(tx, { tenantId, personId, programIds, actorUserId = null }) {
  if (typeof personId !== "string") throw invalid("personId is required");
  if (!Array.isArray(programIds)) throw invalid("programIds must be a list (empty to clear)");
  const want = [...new Set(programIds)];
  const { rows: person } = await tx.query(`SELECT 1 FROM keystone.app_user WHERE tenant_id = $1 AND id = $2`, [tenantId, personId]);
  if (!person[0]) throw notFound("no such person in this practice");
  if (want.length) {
    const { rows } = await tx.query(`SELECT id FROM keystone.program WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, want]);
    if (rows.length !== want.length) throw invalid("one of those programs does not exist in this practice");
  }
  await tx.query(`DELETE FROM keystone.person_program WHERE tenant_id = $1 AND person_id = $2 AND NOT (program_id = ANY($3::uuid[]))`, [tenantId, personId, want]);
  if (want.length) {
    await tx.query(
      `INSERT INTO keystone.person_program (tenant_id, person_id, program_id)
       SELECT $1, $2, x FROM unnest($3::uuid[]) x ON CONFLICT DO NOTHING`, [tenantId, personId, want]);
  }
  await emit(tx, { tenantId, topic: "items.program.assigned", emittedBy: SECTION, subjectType: "person", subjectId: personId, actor: userActor(actorUserId), payload: { programIds: want } });
  return { personId, programIds: want };
}

/** The programs of one person, for the record header and the editor. */
export async function personPrograms(tx, { tenantId, personId }) {
  const { rows } = await tx.query(
    `SELECT p.id, p.name, p.colour FROM keystone.person_program pp
       JOIN keystone.program p ON p.tenant_id = pp.tenant_id AND p.id = pp.program_id
      WHERE pp.tenant_id = $1 AND pp.person_id = $2 ORDER BY p.position, p.name`, [tenantId, personId]);
  return rows;
}

/** Units, with the count of services currently sold by each. */
export async function listUnits(tx, { tenantId }) {
  const { rows } = await tx.query(
    `SELECT u.id, u.key, u.name, u.plural, u.active, u.is_default, u.is_seeded,
            count(s.id) AS in_use
       FROM keystone.unit u
       LEFT JOIN keystone.service s ON s.tenant_id = u.tenant_id AND s.unit_id = u.id
      WHERE u.tenant_id = $1
      GROUP BY u.id, u.key, u.name, u.plural, u.active, u.is_default, u.is_seeded
      ORDER BY u.name`,
    [tenantId]);
  return rows.map((r) => ({
    id: r.id, key: r.key, name: r.name, plural: r.plural,
    active: r.active, is_default: r.is_default, is_seeded: r.is_seeded,
    in_use: Number(r.in_use),
  }));
}

/** Turn a unit on or off. Refused while it is in use and the caller is turning it off. */
export async function setUnitActive(tx, { tenantId, id, active }) {
  if (typeof active !== "boolean") throw invalid("active must be a boolean");

  const { rows } = await tx.query(
    `SELECT u.name, count(s.id) AS in_use
       FROM keystone.unit u
       LEFT JOIN keystone.service s ON s.tenant_id = u.tenant_id AND s.unit_id = u.id
      WHERE u.tenant_id = $1 AND u.id = $2
      GROUP BY u.id, u.name`,
    [tenantId, id]);
  if (rows.length === 0) throw notFound("no such unit in this organisation");

  const n = Number(rows[0].in_use);
  if (active === false && n > 0) {
    throw conflict(`${n} services sell by the ${rows[0].name} — change them first.`);
  }

  const r = await run(tx, db
    .updateTable("keystone.unit")
    .set({ active, updated_at: sql`now()` })
    .where("tenant_id", "=", tenantId)
    .where("id", "=", id));
  if (r.rowCount === 0) throw notFound("no such unit in this organisation");

  return { id, active };
}

/**
 * Create a custom unit. `key` is derived from `name` (0409's CHECK: lower-case letters and
 * underscores, starting with a letter) and de-duplicated per tenant with a numeric suffix — not
 * specified by field 4's signature, so written down here rather than left implicit.
 */
export async function createUnit(tx, { tenantId, name, plural }) {
  if (typeof name !== "string" || !name.trim()) throw invalid("a unit needs a name");
  if (typeof plural !== "string" || !plural.trim()) throw invalid("a unit needs a plural form");

  const base = slugifyUnitKey(name);
  const { rows: clashes } = await tx.query(
    `SELECT key FROM keystone.unit WHERE tenant_id = $1 AND (key = $2 OR key ~ $3)`,
    [tenantId, base, `^${base}_[0-9]+$`]);
  const existingKeys = new Set(clashes.map((r) => r.key));
  let key = base;
  if (existingKeys.has(key)) {
    let n = 2;
    while (existingKeys.has(`${base}_${n}`)) n++;
    key = `${base}_${n}`;
  }

  const id = (await tx.query(`SELECT keystone.uuid_generate_v7() AS id`)).rows[0].id;
  await run(tx, db
    .insertInto("keystone.unit")
    .values({ id, tenant_id: tenantId, key, name: name.trim(), plural: plural.trim(), active: true, is_default: false, is_seeded: false }));

  return { id, key, name: name.trim(), plural: plural.trim(), active: true };
}
