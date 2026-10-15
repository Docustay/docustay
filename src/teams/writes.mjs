// P1.3 — THE TEAM WRITE PATHS. createTeam · reparentTeam · addTeamMember · removeTeamMember.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A DOMAIN WRITER, AND IT EMITS — the same argument as `src/permissions/writes.mjs` and the
//     opposite of `src/settings/writes.mjs`. **Moving somebody between teams changes what they can
//     SEE**, because the `team` scope reads this table. That is an occurrence, not a state, and
//     "who moved the new coach into the team that can see every location" has to be answerable.
//   ★ Under `people.`, not a new section: 0064 established that a new `emitted_by` value costs a
//     migration, and a team is a fact about people.
//
// ★★ RE-PARENTING IS ITS OWN VERB WITH ITS OWN EVENT. It is the single most consequential edit in
//    this table — one UPDATE can hand a team sight of half the practice — and folding it into a
//    generic "team updated" would make the audit log unable to distinguish it from a rename.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit } from "../events/outbox.mjs";

/**
 * ★★ DELIBERATELY NOT EXPORTED — YET. The wiring gate caught it as an export with no consumer the
 *    moment it was written, and it was right: nothing catches this type today. **P7 is where it gets
 *    one**, when the team routes map it to a 400 with the operator-facing message; it is exported
 *    then, with its caller.
 *  ★ Exporting it now and letting the GATE be its only importer is `F133` exactly — knip's "used"
 *    has never meant "production-reachable", and a test-only importer would make this look wired.
 *    Until then a caller that needs to distinguish it can read `err.name`.
 *  ★★ Same decision, same week, as `OWNERLESS_OBJECTS` in src/permissions/objects.mjs.
 */
class TeamViolation extends Error {
  constructor(message) { super(message); this.name = "TeamViolation"; }
}

const KEY_SHAPE = /^[a-z][a-z0-9_]*$/;

/** Create a team, optionally beneath a parent. */
export async function createTeam(tx, { tenantId, key, name, parentTeamId = null, actorId = null }) {
  if (!tenantId) throw new TeamViolation("createTeam requires a tenantId");
  // ★★ VALIDATE BEFORE THE DATABASE DOES, for the readable message — same reasoning as
  //    setRolePermission. A 23514 naming `team_key_shape` is a message for an engineer.
  if (!KEY_SHAPE.test(key ?? "")) {
    throw new TeamViolation(
      `"${key}" is not a team key — use lowercase letters, digits and underscores, starting with a letter`);
  }
  if (!name || !String(name).trim()) throw new TeamViolation("a team needs a name");

  const { rows } = await tx.query(
    `INSERT INTO keystone.team (tenant_id, key, name, parent_team_id)
     VALUES ($1,$2,$3,$4)
     RETURNING id, key, name, parent_team_id`,
    [tenantId, key, name, parentTeamId]);

  // ★★★ ZERO ROWS IS A REFUSAL, NOT A SUCCESS — F52's shape, and under FORCE RLS this is what a
  //     cross-tenant write looks like: no row, no error.
  if (rows.length === 0) {
    throw new TeamViolation(
      `team "${key}" was not created — row-level security refused it, which means the transaction's ` +
      `tenant does not match the tenantId passed in`);
  }

  await emit(tx, {
    tenantId,
    topic: "people.team.created",
    emittedBy: "people",
    subjectType: "team",
    subjectId: rows[0].id,
    // ★★★ STAGE 3 TASK 3 — `name` DROPPED (§2.4). `key` stays: it is validated against `KEY_SHAPE`
    //   above (lowercase letters/digits/underscore) and is exactly the enum shape the payload rule
    //   allows, unlike the team's free-text display name.
    payload: { key, parentTeamId, actorId },
  });
  return rows[0];
}

/**
 * Move a team under a different parent (or to the root with `null`).
 * ★ A cycle is refused by `team_no_cycles_trg` (0070); this surfaces it as a readable error rather
 *   than letting a `check_violation` reach the operator.
 */
export async function reparentTeam(tx, { tenantId, teamId, parentTeamId, actorId = null }) {
  if (!tenantId || !teamId) throw new TeamViolation("reparentTeam requires tenantId and teamId");

  let rows;
  try {
    ({ rows } = await tx.query(
      `UPDATE keystone.team SET parent_team_id = $3
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, key, parent_team_id`,
      [tenantId, teamId, parentTeamId]));
  } catch (err) {
    if (err.code === "23514") {
      throw new TeamViolation(
        `that move would put a team inside itself — team hierarchies must stay a tree, because every ` +
        `visibility query walks them`);
    }
    throw err;
  }

  // ★ Nothing matched → the team is not in this tenant, or does not exist. Either way it is a
  //   refusal and not a silent no-op; D-17.19's whole lesson is that an UPDATE matching zero rows
  //   raises nothing on its own.
  if (rows.length === 0) {
    throw new TeamViolation(`team ${teamId} was not moved — no such team in this tenant`);
  }

  await emit(tx, {
    tenantId,
    topic: "people.team.reparented",
    emittedBy: "people",
    subjectType: "team",
    subjectId: teamId,
    payload: { parentTeamId, actorId },
  });
  return rows[0];
}

/** Put a person in a team. */
export async function addTeamMember(tx, { tenantId, teamId, userId, actorId = null }) {
  if (!tenantId || !teamId || !userId) {
    throw new TeamViolation("addTeamMember requires tenantId, teamId and userId");
  }
  const { rows } = await tx.query(
    `INSERT INTO keystone.team_member (tenant_id, team_id, user_id, added_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, team_id, user_id) DO NOTHING
     RETURNING user_id`,
    [tenantId, teamId, userId, actorId]);

  // ★ ALREADY A MEMBER IS NOT AN ERROR, AND NOT AN EVENT. An audit log full of changes that did not
  //   happen is an audit log nobody reads — same rule as grantRole.
  if (rows.length === 0) return { alreadyMember: true };

  await emit(tx, {
    tenantId,
    topic: "people.team.member_added",
    emittedBy: "people",
    subjectType: "person",
    subjectId: userId,
    payload: { teamId, actorId },
  });
  return { alreadyMember: false };
}

/** Take a person out of a team. */
export async function removeTeamMember(tx, { tenantId, teamId, userId, actorId = null }) {
  if (!tenantId || !teamId || !userId) {
    throw new TeamViolation("removeTeamMember requires tenantId, teamId and userId");
  }
  const { rows } = await tx.query(
    `DELETE FROM keystone.team_member
      WHERE tenant_id = $1 AND team_id = $2 AND user_id = $3
      RETURNING user_id`,
    [tenantId, teamId, userId]);

  if (rows.length === 0) return { wasMember: false };

  await emit(tx, {
    tenantId,
    topic: "people.team.member_removed",
    emittedBy: "people",
    subjectType: "person",
    subjectId: userId,
    payload: { teamId, actorId },
  });
  return { wasMember: true };
}
