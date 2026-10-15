// P1.2 — THE THREE CLOSED SETS: OBJECTS · VERBS · SCOPES.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THESE ARE THE **SET**; `db/migrations/0066_roles_permissions.sql` IS THE **SHAPE**, AND THE
//     TWO ARE ASSERTED AGAINST EACH OTHER BY `db/gates/p1_scope_axis.mjs`.
//   ★★ Note the direction is the OPPOSITE of `src/settings/keys.mjs`. A setting's SET lives only in
//      JS because adding one is a code edit that nothing else has to react to. A permission object's
//      set is enumerated in the DATABASE TOO, because adding an object is a contract change every
//      role and every read query must answer for — the TOPIC pattern, not the SETTING pattern.
//   ★ So a new object costs a migration, on purpose. That is the brake.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★ `note` IS ITS OWN OBJECT [TY, RULED — Q7]. `Every coach sees every client; only the coach who`
 *    ran the session sees the note" is a real configuration, and it is unsayable if a note inherits
 *    the person's permission.
 * ★ `platform` IS DELIBERATELY ABSENT. Platform is its own namespace checked server-side against the
 *   tenant's own `is_platform` flag — never a permission a tenant could grant itself.
 */
// ★★★ 7.2 — TEN MORE OBJECTS, FROM 05 §5, IN THAT ORDER, AFTER THE ORIGINAL ELEVEN. The set is now
//     the one `keystone.permission_object` (0182, CT-091) also holds — the DATABASE is the single
//     source the other two (this array and `OWNERSHIP`) are checked against, not the other way
//     round. `db/gates/…` (7.19) asserts all three name the same 21 keys.
export const OBJECTS = Object.freeze([
  "person", "account", "network_party", "engagement", "item",
  "document", "invoice", "task", "note", "report", "setting",
  "message", "goal", "referral", "discount", "automation",
  "campaign", "site", "payout", "dispute", "audit",
]);

/**
 * ★ THE VERB LADDER, AND IT IS A LADDER: `delete` implies `edit` implies `view`. Ranked rather than
 *   a set of independent flags because "may delete but may not view" is not a rule anyone means, and
 *   allowing it to be expressed means every caller has to handle it.
 */
export const VERBS = Object.freeze(["none", "view", "edit", "delete"]);

/**
 * ★★ THE SCOPE LADDER. `team` sits between `owned` and `everything` — and until P1.3 ships teams it
 *    RESOLVES AS `owned`, both here and in `keystone.scope_allows()`. It is narrower than its name
 *    promises, never wider: a "Team only" role that silently meant the whole tenant would be wrong
 *    in the dangerous direction and invisible.
 */
export const SCOPES = Object.freeze(["none", "owned", "team", "everything"]);

/**
 * ★ Objects with no owner. A setting is tenant configuration, not a record with a coach attached.
 * ★★ DELIBERATELY NOT EXPORTED. It has exactly one caller — `validateGrant` below — and the wiring
 *    gate caught it as an export with no consumer the moment it was written. **P6.62 will need it**,
 *    to grey out the scope dropdown for `setting` on the roles screen; it gets exported THEN, with
 *    its caller, and not one phase early on the strength of an intention.
 */
// ★★★ P6.B12 — EXPORTED NOW, WITH ITS CALLER, EXACTLY AS THE NOTE ABOVE SAID IT WOULD BE.
//     `GET /api/settings/roles` (`src/routes/settings.mjs`) returns it in the screen's vocabulary
//     so the roles grid can grey out the scope control for `setting` instead of offering three
//     values the database will refuse. ★ The comment above is left intact rather than rewritten:
//     it is the record that this export waited for a consumer and did not arrive one phase early
//     on the strength of an intention.
// ★★★ 7.2 — THREE MORE OWNERLESS OBJECTS. `automation`, `site` and `audit` are configuration too — a
//     practice`s automations, its client site(s) and its audit log, not records with a coach`
//     attached (05 §5, §10). ★ `discount`, `campaign` and the rest of the practice-wide new objects
//     are also `ownable: false` in `OWNERSHIP` (below), but this array stays the smaller, historical
//     subset `validateGrant` has always checked — see `ownership.mjs` for the full picture.
export const OWNERLESS_OBJECTS = Object.freeze(["setting", "automation", "site", "audit"]);

export const verbRank = (v) => VERBS.indexOf(v);
export const scopeRank = (s) => SCOPES.indexOf(s);

export class PermissionViolation extends Error {
  constructor(message) { super(message); this.name = "PermissionViolation"; }
}

/**
 * Validate one grant. Returns a human-readable problem, or `null`.
 * ★★ EVERY RULE HERE IS ALSO A DATABASE CONSTRAINT IN 0066. That duplication is deliberate and the
 *    gate asserts both halves: the database is what makes the rule TRUE, and this is what makes the
 *    refusal READABLE — a 23514 naming `role_permission_coherent` is a message for an engineer.
 */
export function validateGrant({ object, verb, scope }) {
  if (!OBJECTS.includes(object)) {
    return `"${object}" is not a permission object — the eleven are ${OBJECTS.join(", ")}`;
  }
  if (!VERBS.includes(verb)) return `"${verb}" is not a verb — use one of ${VERBS.join(", ")}`;
  if (!SCOPES.includes(scope)) return `"${scope}" is not a scope — use one of ${SCOPES.join(", ")}`;

  // ★★★ THE COHERENCE RULE. `view` at scope `none` grants a verb that can never return a row — a
  //     menu item that opens an empty screen forever, which is the dead-control defect wearing a
  //     permission's clothes. `none` at any other scope says nothing at all.
  if ((verb === "none") !== (scope === "none")) {
    return `"${object}" grants ${verb} at scope ${scope}, which means nothing: ` +
      `a verb of "none" and a scope of "none" must be used together, and never apart`;
  }
  if (OWNERLESS_OBJECTS.includes(object) && !["none", "everything"].includes(scope)) {
    return `"${object}" has no owner, so scope "${scope}" resolves to no rows at all — ` +
      `use "everything" or "none"`;
  }
  return null;
}
