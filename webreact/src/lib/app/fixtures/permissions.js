// Story/test permission presets — built from the REAL built-in roles (src/permissions/defaults.mjs), in
// exactly the shape /api/nav ships (effectiveGrants: { object: [ {verb, scope} ] }). Never hand-written:
// a preset that drifted from BUILTIN_ROLES would prove a story against a product nobody runs.
import { BUILTIN_ROLES } from "@keystone/permissions/defaults.mjs";
import { RANK } from "@/lib/permissions/vocab.js";

function fromRole(key) {
  const role = BUILTIN_ROLES.find((r) => r.key === key);
  if (!role) throw new Error(`no built-in role ${key}`);
  const grants = {};
  for (const [object, g] of Object.entries(role.permissions)) grants[object] = [{ verb: g.verb, scope: g.scope }];
  return { rank: key, grants, actions: [...(role.actions ?? [])], teamVisibleUserIds: [] };
}

export const PERMISSIONS = Object.freeze({
  owner: fromRole(RANK.owner),
  admin: fromRole(RANK.admin),
  member: fromRole(RANK.member),
});
export const ME_ID = "00000000-0000-4000-8000-00000000me01";
