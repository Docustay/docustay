// P1.2 — THE FOUR SHIPPED ROLES.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A STARTING POINT, NOT A FIXED SET (KS-11, and [TY, RULED] on Q7: *"roles are editable in
//     Settings; defaults do not matter"*). Every role below is editable and deletable by the tenant
//     through `/settings/roles` (P6.62). `is_builtin` exists so the settings screen can say "this
//     came with Keystone" and so re-seeding is idempotent — it NEVER refuses an edit.
//
// ★★ EVERY ROLE STATES EVERY OBJECT. All eleven, explicitly, including the ones it is denied. An
//    absent row and a `none` row would otherwise be the same thing on screen, and "we never decided"
//    would be indistinguishable from "we decided no" — which is the argument for `scope NOT NULL`
//    applied one level up.
//
// ★★★ `front_desk` LEFT THE PRODUCT IN STAGE 7 (task 7.8, `db/migrations/0189_front_desk_leaves.sql`)
//     — RULED by the maintainer, 21 Sep 2026, plan's recommendation taken, Q0-13 settled. EXECUTED against
//     production: `keystone.role` held 0 rows at the time, so the count reported to the maintainer was zero
//     holders, zero role rows, in three practices — nothing converted to another role because nobody
//     held this one. A practice may still create its own custom role named "Front desk"; only the
//     BUILT-IN entry is gone, so the next reader does not re-derive the question.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { OBJECTS } from "./objects.mjs";

/** Fill in every object not named, so a role is always a complete statement. */
function complete(named, fallback) {
  const out = {};
  for (const o of OBJECTS) out[o] = named[o] ?? fallback;
  return out;
}

const ALL = { verb: "delete", scope: "everything" };
const NONE = { verb: "none", scope: "none" };
const VIEW_ALL = { verb: "view", scope: "everything" };
const EDIT_ALL = { verb: "edit", scope: "everything" };
const VIEW_OWN = { verb: "view", scope: "owned" };
const EDIT_OWN = { verb: "edit", scope: "owned" };

// ★★★ THE 05 §4 + §5 GRANT MATRIX (Stage 7 task 7.9), WRITTEN ONCE IN `db/migrations/0190…sql` AND
//     MIRRORED HERE — `db/gates/…` (7.19) asserts the two are identical, object by object.
// ★★★ THE OWNERLESS RULE (RULED 21 Sep 2026, F584/F575). Ten of the 21 objects are `ownable: false`
//     (`ownership.mjs`): `network_party`, `item`, `note`, `report`, `setting`, `discount`,
//     `automation`, `campaign`, `site`, `audit`. For those ten the only two legal scopes are `none`
//     and `everything` — `objects.mjs`'s `validateGrant` and the database trigger
//     `keystone.enforce_scope_is_offered()` (0182) both refuse `owned`/`team` on them. `note``s Coach`
//     AND Admin cells are `none/none`: a Coach's real access to their own caseload's notes arrives
//     through 7.14`s writer/assigned-coach disjuncts, never through this grant (05 §6 — "no role or`
//     grid can override"), and granting `everything` here would let a Coach read every note in the
//     practice through the third disjunct. `report`'s three cells are all `view/everything` — reports
//     are computed, not stored, and the money figures inside them are narrowed by the Coach's
//     `invoice: none/none` grant below, not by `report`'s own scope.
// ★★★ THE `actions` FIELD, PER ROLE (added Task 1.3, TeamRoles/TeamRolesAdvanced). Mirrors
//     `db/migrations/0190_every_practice_has_the_three_roles.sql`'s `_s7_role_actions` seed data
//     verbatim, object for object — the same "written once, mirrored here" relationship
//     `permissions` above already has with that migration's `role_permission` seed. Owner holds
//     all 15 `NAMED_ACTIONS` (the original 13 plus `loyalty.manage`/`gift_card.manage`, Stage 14
//     task 14.15); Admin holds all 15 except `setting.billing` (Owner-only, 05 §4) and
//     `invoice.refund` (Owner-only BY DEFAULT, F08 §4.2, Stage 15 task 15.12/migration 0435 — a
//     practice can grant it back); Coach holds the three named actions a caseload-scoped coach
//     exercises directly: `person.create`, `template.author`, `document.sign`.
const OWNER_ACTIONS = Object.freeze([
  "person.create", "team.invite", "team.remove", "staff_role.change",
  "document.sign", "document.execute", "template.author",
  "record.archive", "record.restore",
  "booking.waive_charge", "discount.apply", "invoice.refund", "setting.billing",
  // ★ NEW at Stage 14 task 14.15 (migration 0416, task 14.9 — backfills these two onto every
  //   OWNER and ADMIN built-in role; a NEW practice gets them the normal way, through
  //   `seed_builtin_roles`, once this array carries them). ADMIN derives below and keeps both
  //   (neither `loyalty.manage` nor `gift_card.manage` is `setting.billing` or `invoice.refund`,
  //   the two actions ADMIN is filtered out of as of Stage 15 task 15.12).
  "loyalty.manage", "gift_card.manage",
]);
// ★★★ STAGE 15 TASK 15.12 (D6, F08 §4.2, migration 0435) — `invoice.refund` ALSO LEAVES ADMIN BY
//     DEFAULT. A DEFAULT, not a hard-coded refusal: a practice can grant it back to its Admin role
//     through `POST /api/settings/roles/action`, and `assertMay` answers a re-granted Admin yes —
//     nothing tests a role KEY. OWNER_ACTIONS (above, owned by Stage 14 task 14.15) is untouched:
//     the Owner keeps every one of its 15 actions, `invoice.refund` included, in every practice.
const ADMIN_ACTIONS = Object.freeze(
  OWNER_ACTIONS.filter((a) => a !== "setting.billing" && a !== "invoice.refund"));
const COACH_ACTIONS = Object.freeze(["person.create", "template.author", "document.sign"]);

export const BUILTIN_ROLES = Object.freeze([
  {
    key: "owner",
    label: "Owner",
    description: "Full access to everything in the practice, including settings and billing.",
    // ★ `note`, `report`, `message`, `goal` and `audit` are ownerless: `view/everything`, not
    //   `delete/everything` — an Owner may see every note, report, message, goal and audit row in
    //   the practice, but "delete" answers a question these five have no per-row concept of.
    permissions: complete({
      note: VIEW_ALL, report: VIEW_ALL, message: VIEW_ALL, goal: VIEW_ALL, audit: VIEW_ALL,
    }, ALL),
    actions: OWNER_ACTIONS,
  },
  {
    key: "admin",
    label: "Admin",
    description: "Runs the practice day to day. Everything except changing practice settings.",
    // ★ An admin may EDIT settings — running the practice day to day includes the booking policy —
    //   but `setting` is ownerless so the only two legal scopes are everything and none (0066's
    //   `role_permission_setting_scope`, generalised by 0182's trigger).
    // ★ `note`, `message` and `goal` are `none/none` (05 §5: an Admin loses note/message/goal read).
    //   `report` is `view/everything`, and `audit` is `view/everything` — both ownerless and both
    //   read-only for everyone, Owner included.
    permissions: complete({
      setting: EDIT_ALL,
      note: NONE, message: NONE, goal: NONE,
      report: VIEW_ALL, audit: VIEW_ALL,
    }, ALL),
    actions: ADMIN_ACTIONS,
  },
  {
    key: "member",
    label: `Coach`,
    description: "Sees and works their own caseload. The practice's catalogue is visible but read-only.",
    actions: COACH_ACTIONS,
    permissions: complete({
      person: EDIT_OWN,
      engagement: EDIT_OWN,
      task: EDIT_OWN,
      document: EDIT_OWN,
      message: EDIT_OWN,
      goal: EDIT_OWN,
      referral: EDIT_OWN,
      // ★ RULED 21 Sep 2026 (F584/F575) — `note` is ownerless; `owned` is illegal for it, and
      //   `everything` would hand a Coach every note in the practice. `none/none` refuses nothing the
      //   Coach needs: their own caseload's notes arrive through 7.14's writer/assigned-coach
      //   disjuncts, which never read this grant. See the ownerless-rule note above.
      note: NONE,
      // ★ 05 §4 — coaches never see money. Ownable, but the practice rule is "none at all", not "own".
      invoice: NONE,
      // ★ RULED 21 Sep 2026 (F584/F575) — ownerless; `everything` because a Coach's legitimate reach
      //   IS practice-wide (reports are computed, not stored) and the MONEY inside them is narrowed
      //   by `invoice: none/none` above, not by this grant.
      report: VIEW_ALL,
      // ★ The catalogue and the referral network are the practice's, not a caseload's — a coach must
      //   be able to see what they are booking and who referred the client.
      item: VIEW_ALL,
      account: VIEW_OWN,
      network_party: VIEW_ALL,
    }, NONE),
  },
]);

/**
 * ★ The staff_role a person already carries, mapped to the role they should be given. Used once, at
 *   seeding, so an existing practice does not wake up with nobody holding anything.
 *
 * ★★★ THE RANK VOCABULARY IS NOW THE ROLE VOCABULARY (Stage 7, task 7.7 — RULED by the maintainer, 21 Sep 2026,
 *     Q7-1). `db/migrations/0188_one_owner_per_practice_not_one_per_database.sql` narrows
 *     `keystone.app_user.staff_role` to `('owner','admin','coach')`, so the two sides of this map
 *     are the same three words and it is an identity map today. ★ It is KEPT, not deleted: it is the
 *     one place that states the correspondence, and `src/people/writes.mjs` and
 *     `src/provisioning/prefix.mjs` both read it. A later vertical that renames a rank changes this
 *     map, not its callers.
 *
 * ★★ `super_admin_1` and `super_admin` ARE GONE. `super_admin_1` was the platform's founder rank and
 *    the thing that made it different — `keystone.enforce_super_admin_1`, one per DATABASE — was
 *    dropped in 0188. Being the operator is now a GRANT ON THE IDENTITY (0184/0186), not a rank, and
 *    being the Owner is per practice: `app_user_one_owner_per_tenant_idx` (at most one) and
 *    `keystone.enforce_last_owner()` (at least one).
 */
export const STAFF_ROLE_TO_ROLE_KEY = Object.freeze({
  owner: "owner",
  admin: "admin",
  member: "member",
});
