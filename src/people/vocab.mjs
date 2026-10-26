// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE PEOPLE VOCABULARIES. **THE CLOSED SETS, AND THE ONLY DECLARATION OF THEM.**
//
// ★★★ SPLIT OUT OF `writes.mjs` AT A3.2, FOR THE SAME REASON `events/topics.mjs` WAS SPLIT OUT OF
//     `outbox.mjs` AT A12.1 (F406): `writes.mjs` imports `emit`, which imports `assertTenantTx`,
//     which imports `pg` — so the whole module is unimportable from client code. The stage popover
//     and the rank dropdown have to offer these values, and the only two ways to give a browser a
//     server vocabulary are to import it or to hand-copy it.
//   ★★★ HAND-COPYING IS **DUPLICATE-TRUTH**, and on a closed set it fails in the worst direction:
//       a control offering a value the server refuses is a visible 400, but a control SILENTLY
//       MISSING one is a capability nobody can reach and nobody can see is gone.
//   ★★ SO THE VOCABULARY MOVES AND `writes.mjs` RE-EXPORTS IT. Every existing importer resolves
//      unchanged. **This is a move, not a fork.**
//
// ★ NOTHING IS IMPORTED HERE, ON PURPOSE. The moment this file imports anything with a node
//   dependency it stops being importable by the client and the copy comes back.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★ THE THREE RANKS, LEAST PRIVILEGED FIRST — MATCHES `keystone.app_user_staff_role_check`
 *    (0188) EXACTLY. `super_admin`/`super_admin_1` are gone: 0187/0188 (Stage 7, task 7.7)
 *    narrowed the CHECK to `('owner','admin','coach')` and being the operator is now a grant on
 *    the identity (0184/0186), not a rank. Being the practice Owner is enforced separately —
 *    `app_user_one_owner_per_tenant_idx` (at most one) and `keystone.enforce_last_owner()` (at
 *    least one) — neither of which is re-implemented here; this list is the vocabulary, not the
 *    policy.
 */
export const STAFF_ROLES = Object.freeze(["member", "admin", "owner"]);

/**
 * ★★★ THE PIPELINE. `lead → active → paused → former`, and the order is the order a person moves
 *     through, not an alphabetical accident — a stage picker renders it as written.
 *   ★ `paused` and `former` are DIFFERENT FACTS and both are kept: "taking a break" and "no longer
 *     working with you" are not the same thing, and collapsing them loses the one a practice needs
 *     when deciding who to contact.
 */
export const LIFECYCLE_STATUSES = Object.freeze(["lead", "active", "paused", "former"]);

/**
 * ★★★ TASK 12.4 (`12-signup-first-run-people.md` §3.3, migration 0231) — the standing guardian-
 *     consent status shown on PeopleAdolescents. `not_started` is the state a fresh adolescent row
 *     is in before any coach has asked; there is no ordering requirement between the other three —
 *     a coach may move any value to any other (a wrongly recorded `granted` can be corrected back to
 *     `waiting`), unlike `LIFECYCLE_STATUSES`' closed pipeline above.
 */
export const CONSENT_STATUSES = Object.freeze(["not_started", "waiting", "granted", "declined"]);
