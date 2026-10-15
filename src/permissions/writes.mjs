// P1.2 — THE PERMISSION WRITE PATHS. seedBuiltinRoles · setRolePermission · grantRole · revokeRole.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ EVERY WRITE HERE EMITS. This is not an infrastructure writer like `src/settings/writes.mjs`,
//     and the distinction is the one `db/gates/write-census.mjs` demands an argument for:
//     **a permission change is an OCCURRENCE, not a state.** `Who gave the new coach access to`
//     everybody's invoices, and when" is the first question asked after something goes wrong, and it
//     is unanswerable from a table that only holds the current answer.
//   ★ `people.*` is the emitter, not a new `permissions` namespace: 0064 taught that a new
//     `emitted_by` value is a migration, and these events are about a PERSON's access. They belong
//     to the section that already owns people.
//
// ★★ `seedBuiltinRoles` DELIBERATELY DOES NOT EMIT. It is not something somebody did — it is the
//    shape a tenant is born with, and it runs inside the signup transaction as `app_signup`, which
//    has no policy permitting it to write the outbox. An event per tenant-creation already exists.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit, userActor } from "../events/outbox.mjs";
import { BUILTIN_ROLES } from "./defaults.mjs";
import { validateGrant, PermissionViolation } from "./objects.mjs";
import { NAMED_ACTIONS } from "./assertMay.mjs";
import { conflict, notFound } from "../http/errors.mjs";

/**
 * Give a tenant its four starting roles, and put one person in one of them.
 *
 * ★★ Goes through `keystone.seed_builtin_roles()` — a SECURITY DEFINER — because the signup path
 *    runs as `app_signup`, which has no SELECT policy on anything and so cannot read back the id of
 *    the role it just created. See 0067/0068: the privilege moved into a function rather than onto
 *    the role.
 * ★ The role CONTENT travels as an argument, so `defaults.mjs` stays the only place the four
 *   shipped roles are written down.
 */
export async function seedBuiltinRoles(tx, { tenantId, grantUserId = null, grantRoleKey = null }) {
  if (!tenantId) throw new PermissionViolation("seedBuiltinRoles requires a tenantId");
  if ((grantUserId === null) !== (grantRoleKey === null)) {
    // ★ Half a grant is a lockout waiting to happen: a user id with no role key silently grants
    //   nothing, and a role key with no user is a no-op that reads as success.
    throw new PermissionViolation(
      "seedBuiltinRoles: grantUserId and grantRoleKey must be given together or not at all");
  }
  const { rows } = await tx.query(
    `SELECT keystone.seed_builtin_roles($1, $2::jsonb, $3, $4) AS seeded`,
    [tenantId, JSON.stringify(BUILTIN_ROLES), grantUserId, grantRoleKey]);
  return rows[0].seeded;
}

/**
 * Set one role's permission on one object. ★ UPSERT: a role has exactly one row per object (0066's
 * unique index), so `change the coach's access to invoices` is one statement, not read-then-write.
 */
export async function setRolePermission(tx, { tenantId, roleId, object, verb, scope, actorId = null }) {
  // ★★ VALIDATE BEFORE TOUCHING THE DATABASE, same argument as src/settings/writes.mjs: the CHECK
  //    violation is real and correct, but `role_permission_coherent` is a message for an engineer,
  //    not for the person who just chose "View" and "None" from two dropdowns.
  const problem = validateGrant({ object, verb, scope });
  if (problem) throw new PermissionViolation(problem);
  if (!tenantId || !roleId) throw new PermissionViolation("setRolePermission requires tenantId and roleId");

  const { rows } = await tx.query(
    `INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (tenant_id, role_id, object)
       DO UPDATE SET verb = EXCLUDED.verb, scope = EXCLUDED.scope
     RETURNING id, object, verb, scope`,
    [tenantId, roleId, object, verb, scope]);

  // ★★★ ZERO ROWS IS A REFUSAL, NOT A SUCCESS — F52's shape. Under FORCE RLS a write aimed at
  //     another tenant returns no row rather than raising, so a caller that ignored this would
  //     report "saved" for a permission change that never happened.
  if (rows.length === 0) {
    throw new PermissionViolation(
      `the permission on "${object}" was not written — row-level security refused it, which means ` +
      `the transaction's tenant does not match the tenantId passed in`);
  }

  // ★ RP.2 — propagate this cell to personal roles based on this role, unless overridden.
  await propagateToPersonalRoles(tx, { tenantId, baseRoleId: roleId, object, verb, scope });

  // ★ STAGE 3 TASK 1 — `keystone.event` now has an `actor` column (migration 0134); the payload's
  //   own `actorId` field stays as-is (a later task owns payload contents) and the envelope carries
  //   the same fact.
  await emit(tx, {
    tenantId,
    topic: "people.role.permission_changed",
    emittedBy: "people",
    subjectType: "role",
    subjectId: roleId,
    actor: userActor(actorId),
    payload: { object, verb, scope, actorId },
  });
  return rows[0];
}

// src/permissions/writes.mjs — new export, beside setRolePermission.
export async function setRoleAction(tx, { tenantId, roleId, action, granted, actorId = null }) {
  if (!NAMED_ACTIONS.includes(action)) throw new PermissionViolation(`"${action}" is not a named action`);
  if (!tenantId || !roleId) throw new PermissionViolation("setRoleAction requires tenantId and roleId");
  if (granted) {
    await tx.query(
      `INSERT INTO keystone.role_action (tenant_id, role_id, action) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, role_id, action) DO NOTHING`, [tenantId, roleId, action]);
  } else {
    await tx.query(
      `DELETE FROM keystone.role_action WHERE tenant_id=$1 AND role_id=$2 AND action=$3`,
      [tenantId, roleId, action]);
  }
  await emit(tx, {
    tenantId, topic: "people.role.permission_changed", emittedBy: "people",
    subjectType: "role", subjectId: roleId, actor: userActor(actorId),
    payload: { action, granted, actorId },
  });
  return { action, granted };
}

/**
 * Reset ONE built-in role back to its shipped preset — every `role_permission` row and every
 * `role_action` row, overwritten to match `BUILTIN_ROLES` (defaults.mjs) exactly. Refuses a
 * custom (non-built-in) role: there is no preset to reset it TO.
 */
export async function resetRoleToPreset(tx, { tenantId, roleId, actorId = null }) {
  if (!tenantId || !roleId) throw new PermissionViolation("resetRoleToPreset requires tenantId and roleId");
  const { rows: roleRows } = await tx.query(
    `SELECT id, key, is_builtin FROM keystone.role WHERE tenant_id = $1 AND id = $2`,
    [tenantId, roleId]);
  const role = roleRows[0];
  if (!role) throw new PermissionViolation(`no role "${roleId}" in this practice`);
  if (!role.is_builtin) {
    throw new PermissionViolation(`"${role.key}" is not a built-in role — there is no preset to reset it to`);
  }
  const preset = BUILTIN_ROLES.find((r) => r.key === role.key);
  if (!preset) throw new PermissionViolation(`"${role.key}" has no shipped preset`);

  for (const [object, grant] of Object.entries(preset.permissions)) {
    await tx.query(
      `INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, role_id, object)
         DO UPDATE SET verb = EXCLUDED.verb, scope = EXCLUDED.scope`,
      [tenantId, roleId, object, grant.verb, grant.scope]);
  }

  await tx.query(`DELETE FROM keystone.role_action WHERE tenant_id = $1 AND role_id = $2`, [tenantId, roleId]);
  for (const action of preset.actions ?? []) {
    await tx.query(
      `INSERT INTO keystone.role_action (tenant_id, role_id, action) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id, role_id, action) DO NOTHING`,
      [tenantId, roleId, action]);
  }

  await emit(tx, {
    tenantId, topic: "people.role.permission_changed", emittedBy: "people",
    subjectType: "role", subjectId: roleId, actor: userActor(actorId),
    payload: { reset: true, key: role.key, actorId },
  });

  const { rows: grants } = await tx.query(
    `SELECT object, verb, scope FROM keystone.role_permission
      WHERE tenant_id = $1 AND role_id = $2 ORDER BY object`,
    [tenantId, roleId]);
  const { rows: actionRows } = await tx.query(
    `SELECT action FROM keystone.role_action WHERE tenant_id = $1 AND role_id = $2 ORDER BY action`,
    [tenantId, roleId]);
  return { id: role.id, key: role.key, grants, actions: actionRows.map((a) => a.action) };
}

/** Put a person in a role. */
export async function grantRole(tx, { tenantId, userId, roleId, actorId = null }) {
  if (!tenantId || !userId || !roleId) {
    throw new PermissionViolation("grantRole requires tenantId, userId and roleId");
  }
  const { rows } = await tx.query(
    `INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
     RETURNING user_id, role_id`,
    [tenantId, userId, roleId, actorId]);

  // ★ ALREADY-HELD IS NOT AN ERROR, and it is also not an event. Emitting on a no-op would fill the
  //   audit log with grants that changed nothing, which is how an audit log stops being read.
  if (rows.length === 0) return { alreadyHeld: true };

  await emit(tx, {
    tenantId,
    topic: "people.role.granted",
    emittedBy: "people",
    subjectType: "person",
    subjectId: userId,
    actor: userActor(actorId),
    payload: { roleId, actorId },
  });
  return { alreadyHeld: false };
}

/** Take a person out of a role. */
export async function revokeRole(tx, { tenantId, userId, roleId, actorId = null }) {
  if (!tenantId || !userId || !roleId) {
    throw new PermissionViolation("revokeRole requires tenantId, userId and roleId");
  }
  const { rows } = await tx.query(
    `DELETE FROM keystone.user_role
      WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3
      RETURNING user_id`,
    [tenantId, userId, roleId]);

  // ★ Nothing removed → nothing happened → no event. Same argument as grantRole.
  if (rows.length === 0) return { wasHeld: false };

  await emit(tx, {
    tenantId,
    topic: "people.role.revoked",
    emittedBy: "people",
    subjectType: "person",
    subjectId: userId,
    actor: userActor(actorId),
    payload: { roleId, actorId },
  });
  return { wasHeld: true };
}

// ★ RP.2 — personal + custom roles. Every function here assumes the CALLER already ran
//   guarded("/settings/roles", "admin") + refuseSelfEscalation (src/routes/settings.mjs) — none of
//   these re-checks rank; they are the WRITE, not the gate.

/** slug("Front Desk") → "front-desk". Collision → the caller's own 409, not this function's job. */
function slug(label) {
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function createCustomRole(tx, { tenantId, label, basedOn, actorUserId }) {
  if (!["admin", "member"].includes(basedOn)) {
    throw conflict("A custom role can only start from Admin or Team member.");
  }
  const key = slug(label);
  if (!key) throw conflict("Name is required.");
  const { rows: clash } = await tx.query(
    `SELECT 1 FROM keystone.role WHERE tenant_id = $1 AND key = $2`, [tenantId, key]);
  if (clash.length) throw conflict(`A role named "${label}" already exists.`);
  const { rows: baseRows } = await tx.query(
    `SELECT id FROM keystone.role WHERE tenant_id = $1 AND key = $2 AND is_builtin`, [tenantId, basedOn]);
  const baseRoleId = baseRows[0]?.id;
  if (!baseRoleId) throw notFound(`no built-in "${basedOn}" role in this practice — has it been seeded?`);
  const { rows } = await tx.query(
    `INSERT INTO keystone.role (tenant_id, key, label, rank, is_builtin)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [tenantId, key, label, basedOn]);
  const newRoleId = rows[0].id;
  await tx.query(
    `INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope, overridden)
       SELECT $1, $2, object, verb, scope, false FROM keystone.role_permission
        WHERE tenant_id = $1 AND role_id = $3`,
    [tenantId, newRoleId, baseRoleId]);
  await tx.query(
    `INSERT INTO keystone.role_action (tenant_id, role_id, action, granted, overridden)
       SELECT $1, $2, action, granted, false FROM keystone.role_action
        WHERE tenant_id = $1 AND role_id = $3`,
    [tenantId, newRoleId, baseRoleId]);
  return { id: newRoleId, key, label };
}

export async function renameCustomRole(tx, { tenantId, roleId, label }) {
  const { rows } = await tx.query(
    `UPDATE keystone.role SET label = $3 WHERE tenant_id = $1 AND id = $2 AND is_builtin = false AND personal_for_user_id IS NULL
     RETURNING id`, [tenantId, roleId, label]);
  if (!rows.length) throw conflict("Only a custom role can be renamed.");
  return { id: roleId, label };
}

export async function deleteCustomRole(tx, { tenantId, roleId }) {
  const { rows: memberRows } = await tx.query(
    `SELECT count(*)::int AS n FROM keystone.user_role WHERE tenant_id = $1 AND role_id = $2`,
    [tenantId, roleId]);
  if (memberRows[0].n > 0) {
    throw conflict(`${memberRows[0].n} people still have this role — give them another role first.`);
  }
  const { rows } = await tx.query(
    `DELETE FROM keystone.role WHERE tenant_id = $1 AND id = $2 AND is_builtin = false AND personal_for_user_id IS NULL
     RETURNING id`, [tenantId, roleId]);
  if (!rows.length) throw conflict("Only a custom role with nobody holding it can be deleted.");
  return { id: roleId };
}

/** Ensure `userId` holds a PERSONAL role (creating one, copied from their current role, on first
 *  call) and return its id. Idempotent: a second call for the same user returns the existing one. */
async function ensurePersonalRole(tx, { tenantId, userId }) {
  const { rows: existing } = await tx.query(
    `SELECT id FROM keystone.role WHERE tenant_id = $1 AND personal_for_user_id = $2`, [tenantId, userId]);
  if (existing.length) return existing[0].id;
  const { rows: baseRows } = await tx.query(
    `SELECT r.id, r.key, r.label, r.rank FROM keystone.user_role ur
       JOIN keystone.role r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
      WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND r.personal_for_user_id IS NULL`, [tenantId, userId]);
  const base = baseRows[0];
  if (!base) throw notFound("this person holds no role to base a personal one on");
  const { rows: newRole } = await tx.query(
    `INSERT INTO keystone.role (tenant_id, key, label, rank, is_builtin, personal_for_user_id, based_on_role_id)
     VALUES ($1, $2 || '-personal-' || substr(gen_random_uuid()::text, 1, 8), $3, $4, false, $5, $2::uuid)
     RETURNING id`,
    [tenantId, base.id, base.label, base.rank, userId]);
  // ★ key above embeds base.id (a uuid) only to keep the tenant-unique `key` column collision-free;
  //   it is never rendered — the label is what a screen shows.
  const personalRoleId = newRole[0].id;
  await tx.query(
    `INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope, overridden)
       SELECT $1, $2, object, verb, scope, false FROM keystone.role_permission
        WHERE tenant_id = $1 AND role_id = $3`,
    [tenantId, personalRoleId, base.id]);
  await tx.query(
    `INSERT INTO keystone.role_action (tenant_id, role_id, action, granted, overridden)
       SELECT $1, $2, action, granted, false FROM keystone.role_action
        WHERE tenant_id = $1 AND role_id = $3`,
    [tenantId, personalRoleId, base.id]);
  await tx.query(
    `UPDATE keystone.user_role SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2 AND role_id = $4`,
    [tenantId, userId, personalRoleId, base.id]);
  return personalRoleId;
}

export async function setMemberPermission(tx, { tenantId, userId, object, verb, scope }) {
  const roleId = await ensurePersonalRole(tx, { tenantId, userId });
  await tx.query(
    `INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope, overridden)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (tenant_id, role_id, object) DO UPDATE SET verb = $4, scope = $5, overridden = true`,
    [tenantId, roleId, object, verb, scope]);
  return { roleId };
}

export async function setMemberAction(tx, { tenantId, userId, action, granted }) {
  const roleId = await ensurePersonalRole(tx, { tenantId, userId });
  await tx.query(
    `INSERT INTO keystone.role_action (tenant_id, role_id, action, granted, overridden)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (tenant_id, role_id, action) DO UPDATE SET granted = $4, overridden = true`,
    [tenantId, roleId, action, granted]);
  return { roleId };
}

export async function resetMemberPermissions(tx, { tenantId, userId }) {
  const { rows: personal } = await tx.query(
    `SELECT id, based_on_role_id FROM keystone.role WHERE tenant_id = $1 AND personal_for_user_id = $2`,
    [tenantId, userId]);
  if (!personal.length) return { reset: false };
  const { id: personalRoleId, based_on_role_id: baseRoleId } = personal[0];
  await tx.query(
    `UPDATE keystone.user_role SET role_id = $3 WHERE tenant_id = $1 AND user_id = $2 AND role_id = $4`,
    [tenantId, userId, baseRoleId, personalRoleId]);
  await tx.query(`DELETE FROM keystone.role WHERE tenant_id = $1 AND id = $2`, [tenantId, personalRoleId]);
  return { reset: true };
}

/** Called from setRolePermission/the role-action writer on a BASE (non-personal) role, in the same
 *  transaction: propagate the new cell to every personal role based on it, UNLESS that specific
 *  cell was itself overridden on that personal role. */
export async function propagateToPersonalRoles(tx, { tenantId, baseRoleId, object, verb, scope }) {
  await tx.query(
    `UPDATE keystone.role_permission rp
        SET verb = $3, scope = $4
       FROM keystone.role r
      WHERE rp.tenant_id = $1 AND rp.role_id = r.id
        AND r.tenant_id = $1 AND r.based_on_role_id = $2
        AND rp.object = $5 AND rp.overridden = false`,
    [tenantId, baseRoleId, verb, scope, object]);
}
