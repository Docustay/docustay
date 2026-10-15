// @ts-check
// 12.10 — THE STAFF-SIDE GOALS OBJECT (RecordGoals: Right now / Parked / Done, G18).
//
// ★★★ STAFF-ONLY, STAFF-WRITTEN, NEVER REACHES THE CLIENT APP. Goals and check-ins were cut from
//     the client app (GROUP-C-RECLUSTERED.md; G18, ruled by the B+C coordinator, 25 Sep 2026) —
//     this module is the record behind the staff-side `RecordGoals` panel only. Nothing under
//     `/app/**` ever imports this file.
//
// ★★ OQ-12.11's RULING, WRITTEN AS ONE PREDICATE (`mayGoal`, below): "the staff who own the
//    client, plus Admin and Owner" is exactly the set `person:edit` already grants — at
//    `everything` for the Owner and the Admin (`src/permissions/defaults.mjs:75,89`) and at
//    `owned` for the COACH WHO OWNS THE CLIENT (`:103`). So the first disjunct alone already
//    answers OQ-12.11 for every built-in role; the second disjunct (`goal:<verb>`) exists only so
//    a CUSTOM role can be configured to reach goals without being handed the wider `person:edit`
//    grant. A client, teen or parent holds neither grant, and cannot reach the staff-only route
//    that calls this module at all — two layers, per spec 05.
//
// ★ A goal is never deleted. `updateGoal` moves it to `state='done'`; there is no delete path and
//   no DELETE grant on `keystone.person_goal` (migration 0385).
//
// ★ Payloads never carry `title`/`detail` text — a goal's content is exactly the private clinical
//   detail the outbox is not the place for. `people.goal.created` carries only `{ person_id }`;
//   `people.goal.updated` carries only the names of the fields that changed.

import { emit, userActor } from "../events/outbox.mjs";
import { forbidden, invalid, notFound } from "../http/errors.mjs";
import { db, run } from "../db/kysely.mjs";
import { sql } from "kysely";

const STATES = Object.freeze(["now", "parked", "done"]);
const STATE_KEYS = Object.freeze({ now: "rightNow", parked: "parked", done: "done" });

/**
 * OQ-12.11's ruling as one predicate. `verb` parameterises only the `goal` object side (the
 * custom-role escape hatch) — the `person` side is always `edit`, per the ruling above.
 */
export async function mayGoal(tx, viewerId, personId, verb) {
  const { rows } = await tx.query(
    `SELECT (keystone.user_may($1,'person','edit',u.owner_user_id)
             OR keystone.user_may($1,'goal',$3,u.owner_user_id)) AS allowed
       FROM keystone.app_user u WHERE u.id = $2`,
    [viewerId, personId, verb]);
  return rows[0]?.allowed === true;
}

/** { rightNow, parked, done } — each an array of { id, title, detail, state, stateChangedAt }. */
export async function listGoals(tx, { viewerId, personId }) {
  if (!(await mayGoal(tx, viewerId, personId, "view"))) {
    throw forbidden("not permitted to view this person's goals");
  }

  const { rows } = await run(tx, db.selectFrom("keystone.person_goal").select(["id", "title", "detail", "state", "state_changed_at"]).where("person_id", "=", personId).orderBy("state_changed_at", "desc"));

  const result = { rightNow: [], parked: [], done: [] };
  for (const row of rows) {
    result[STATE_KEYS[row.state]].push({
      id: row.id,
      title: row.title,
      detail: row.detail,
      state: row.state,
      stateChangedAt: row.state_changed_at,
    });
  }
  return result;
}

export async function createGoal(tx, { tenantId, viewerId, personId, title, detail = null, actorUserId }) {
  if (!(await mayGoal(tx, viewerId, personId, "edit"))) {
    throw forbidden("not permitted to add a goal for this person");
  }
  if (typeof title !== "string" || !title.trim()) throw invalid("title is required");
  if (title.trim().length > 120) throw invalid("title must be 120 characters or fewer");
  if (detail != null && (typeof detail !== "string" || detail.length > 1000)) {
    throw invalid("detail must be 1000 characters or fewer");
  }

  const { rows } = await run(tx, db.insertInto("keystone.person_goal").values({ tenant_id: tenantId, person_id: personId, title: title.trim(), detail: detail ?? null, created_by: actorUserId ?? null }).returning(["id"]));
  const id = rows[0].id;

  await emit(tx, {
    tenantId,
    topic: "people.goal.created",
    emittedBy: "people",
    subjectType: "person_goal",
    subjectId: id,
    payload: { person_id: personId },
    actor: userActor(actorUserId),
  });

  return { id };
}

export async function updateGoal(tx, { tenantId, viewerId, goalId, title, detail, state }) {
  const { rows: current } = await run(tx, db.selectFrom("keystone.person_goal").select(["person_id"]).where("id", "=", goalId).where("tenant_id", "=", tenantId));
  if (current.length === 0) throw notFound("no goal with this id exists in this practice");
  const personId = current[0].person_id;

  if (!(await mayGoal(tx, viewerId, personId, "edit"))) {
    throw forbidden("not permitted to change this person's goal");
  }

  const fields = [];
  const sets = [];
  const params = [];
  let i = 1;

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) throw invalid("title is required");
    if (title.trim().length > 120) throw invalid("title must be 120 characters or fewer");
    sets.push(`title = $${i++}`);
    params.push(title.trim());
    fields.push("title");
  }
  if (detail !== undefined) {
    if (detail != null && (typeof detail !== "string" || detail.length > 1000)) {
      throw invalid("detail must be 1000 characters or fewer");
    }
    sets.push(`detail = $${i++}`);
    params.push(detail);
    fields.push("detail");
  }
  if (state !== undefined) {
    if (!STATES.includes(state)) throw invalid(`state must be one of ${STATES.join(", ")}`);
    sets.push(`state = $${i++}`);
    params.push(state);
    fields.push("state");
    sets.push(`state_changed_at = now()`);
  }

  if (sets.length === 0) throw invalid("nothing to update");
  sets.push(`updated_at = now()`);

  const idParamIndex = i++;
  const tenantParamIndex = i++;
  params.push(goalId, tenantId);

  await tx.query(
    `UPDATE keystone.person_goal SET ${sets.join(", ")} WHERE id = $${idParamIndex} AND tenant_id = $${tenantParamIndex}`,
    params);

  await emit(tx, {
    tenantId,
    topic: "people.goal.updated",
    emittedBy: "people",
    subjectType: "person_goal",
    subjectId: goalId,
    payload: { fields },
    actor: userActor(viewerId),
  });

  return { id: goalId, fields };
}
