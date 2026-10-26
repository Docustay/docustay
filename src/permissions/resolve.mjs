// P1.2 — RESOLVING WHAT A PERSON MAY ACTUALLY DO.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ THE TRAP THIS MODULE EXISTS TO AVOID, AND IT IS A PRIVILEGE ESCALATION.
//
//     A person may hold more than one role — the front-desk manager who also coaches. The obvious
//     implementation of "combine their roles" is to take the strongest verb and the widest scope:
//
//         role A = (edit, owned)          →  max verb  = edit
//         role B = (view, everything)     →  max scope = everything
//         combined                        =  (edit, EVERYTHING)
//
//     ★★★ THAT COMBINATION WAS NEVER GRANTED BY ANYBODY. Role A said "edit, but only your own". Role
//     B said "look, but don't touch". Taking the maxima INDEPENDENTLY synthesises a third permission
//     strictly stronger than either — the holder may now edit every record in the practice. It is
//     silent, it looks like correct union semantics, and it is exactly the kind of thing that is
//     found months later.
//
// ★★★ SO A PERSON'S PERMISSION ON AN OBJECT IS **A SET OF (verb, scope) PAIRS, NOT A PAIR.** The
//     question "may they edit this row" is answered by asking whether ANY SINGLE GRANT allows it
//     BOTH ways at once:
//
//         allowed  ⟺  ∃ grant :  verbRank(grant.verb) ≥ verbRank(action)
//                             ∧  scope_allows(grant.scope, row.owner, viewer)
//
//     ★★ The two conditions must be satisfied by THE SAME GRANT. That single word — "same" — is the
//        whole fix, and it is why `summarise()` below is marked as display-only in capital letters.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { OBJECTS, verbRank, scopeRank, PermissionViolation } from "./objects.mjs";

/**
 * Every grant the given user holds, keyed by object.
 * @returns {Promise<Record<string, Array<{verb: string, scope: string}>>>}
 *
 * ★ Runs inside the caller's tenant transaction, so RLS scopes it. A user in another tenant simply
 *   has no rows — which is the correct answer, not an error.
 */
export async function effectiveGrants(tx, userId) {
  if (!userId) {
    // ★★ NO VIEWER → NO GRANTS, never "all grants". The webhook and worker paths pass no user; a
    //    question about what a person may do has no answer when there is no person, and the safe
    //    answer to an unanswerable authorisation question is "nothing".
    return {};
  }
  const { rows } = await tx.query(
    `SELECT rp.object, rp.verb, rp.scope
       FROM keystone.user_role ur
       JOIN keystone.role_permission rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = $1`,
    [userId]);

  const out = {};
  for (const r of rows) {
    // ★ A grant of `none` is carried, not dropped. It is a real statement ("this role says nothing
    //   about invoices") and dropping it would make an explicit denial indistinguishable from a
    //   missing row when a settings screen renders the role back.
    (out[r.object] ??= []).push({ verb: r.verb, scope: r.scope });
  }
  return out;
}

/**
 * ★★★ THE AUTHORISATION QUESTION. May this person do `action` to a row of `object` owned by
 *     `ownerId`? One grant must satisfy both halves.
 *
 * @param grants   from `effectiveGrants()`
 * @param ownerId  the row's owner, or `null` for an unowned row (an unassigned lead)
 * @param viewerId the person asking
 */
export function allows(grants, object, action,
                      { ownerId = null, viewerId = null, teamVisibleOwnerIds = null } = {}) {
  if (!OBJECTS.includes(object)) {
    throw new PermissionViolation(`"${object}" is not a permission object`);
  }
  const need = verbRank(action);
  if (need < 1) {
    throw new PermissionViolation(
      `allows() was asked about "${action}" — ask about view, edit or delete. ` +
      `"none" is not an action anybody performs, and answering it true would be a silent grant`);
  }
  for (const g of grants[object] ?? []) {
    if (verbRank(g.verb) < need) continue;
    if (!scopeAllows(g.scope, ownerId, viewerId, { teamVisibleOwnerIds })) continue;
    return true;   // ★ the SAME grant satisfied both halves
  }
  return false;
}

/**
 * The JS mirror of `keystone.scope_allows()`. ★★ `db/gates/p1_scope_axis.mjs` and
 * `db/gates/p1_teams.mjs` assert the two agree on every combination rather than trusting that they
 * were written from the same idea — two copies of one rule is the `DUPLICATE-TRUTH` class, and the
 * only defence is a test that compares them.
 *
 * ★★★ P1.3 — `team` CANNOT BE ANSWERED FROM THREE ARGUMENTS. The SQL version walks the team tree
 *     with a recursive CTE; this one cannot reach the database, so the set of user ids the viewer
 *     can see through their teams is passed IN, resolved once per request by
 *     `teamVisibleUserIds()` below.
 *   ★★ AND THE DEFAULT IS AN EMPTY SET, WHICH MEANS `team` COLLAPSES TO `owned`. That is the
 *      fail-CLOSED direction and it is chosen deliberately: a caller who forgets to pass the set
 *      shows a coach too little, which they will report in an afternoon. The other default would
 *      show them the whole practice, which nobody reports.
 */
export function scopeAllows(scope, ownerId, viewerId, { teamVisibleOwnerIds = null } = {}) {
  switch (scope) {
    case "everything": return true;
    case "none": return false;
    case "owned":
      return ownerId != null && viewerId != null && ownerId === viewerId;
    case "team": {
      if (ownerId == null || viewerId == null) return false;
      // ★ `team` INCLUDES `owned` — membership only ever ADDS. Mirrors 0070's first disjunct; a
      //   coach in no team must not lose their own caseload when their role widens to "Team only".
      if (ownerId === viewerId) return true;
      return teamVisibleOwnerIds instanceof Set && teamVisibleOwnerIds.has(ownerId);
    }
    default: return false;
  }
}

/**
 * Every user id the viewer can see through their team subtree — the JS-side input `scopeAllows`
 * needs for `team`. ★ Resolve it ONCE per request and pass it down; it is one query regardless of
 * how many rows are being filtered.
 *
 * ★★ THE SUBTREE WALK LIVES IN SQL AND IS NOT REIMPLEMENTED HERE. There is exactly one recursive
 *    descent of the team tree in this system (0070's `keystone.team_sees`), and this reuses its
 *    shape rather than growing a second one that could disagree about direction.
 */
export async function teamVisibleUserIds(tx, viewerId) {
  if (!viewerId) return new Set();
  const { rows } = await tx.query(
    `WITH RECURSIVE subtree AS (
       SELECT t.id FROM keystone.team t
         JOIN keystone.team_member m ON m.team_id = t.id
        WHERE m.user_id = $1
       UNION
       SELECT c.id FROM keystone.team c JOIN subtree s ON c.parent_team_id = s.id
     )
     SELECT DISTINCT m.user_id FROM keystone.team_member m
      WHERE m.team_id IN (SELECT id FROM subtree)`,
    [viewerId]);
  return new Set(rows.map((r) => r.user_id));
}

/**
 * ★★★ RP.1 (specs/react-rebuild/REACT-PLAN.md §4.5) — WHAT THIS PERSON MAY DO, ONCE, FOR THE UI.
 *     Returned on `GET /api/nav` so the React app's `<Can>`/`useWrite` answer with the server's OWN
 *     rule: `grants` is exactly `effectiveGrants()`' shape and the client calls this module's pure
 *     `allows()`/`scopeAllows()` on it — the ladder is not reimplemented anywhere.
 *   ★ UX ONLY. Every route still decides for itself (assertMay, guarded, user_may, RLS). A UI that
 *     disagrees with this can hide or show a button; it can never grant anything.
 *   ★ `actions` — the named role_actions held through ANY of the person's roles (union, like grants).
 *   ★ `teamVisibleUserIds` — what the `team` scope needs on the client (`scopeAllows`' fourth input).
 */
export async function permissionSummary(tx, userId) {
  if (!userId) return { grants: {}, actions: [], teamVisibleUserIds: [] };
  const grants = await effectiveGrants(tx, userId);
  const { rows } = await tx.query(
    `SELECT DISTINCT ra.action
       FROM keystone.user_role ur
       JOIN keystone.role_action ra ON ra.role_id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY ra.action`,
    [userId]);
  const team = await teamVisibleUserIds(tx, userId);
  return { grants, actions: rows.map((r) => r.action), teamVisibleUserIds: [...team] };
}

/**
 * ★★★ FOR DISPLAY ONLY. NEVER FOR AUTHORISATION. NEVER.
 *
 * Collapses a person's grants on one object to the strongest verb and the widest scope so a settings
 * screen can print "Clients — Edit, Everything" in a table cell. ★★ Read the header: this is exactly
 * the combination that can describe a permission NOBODY GRANTED. It is safe to SHOW because the
 * server re-decides on every request through `allows()`; it would be a privilege escalation to
 * DECIDE with.
 */
export function summariseForDisplay(grants, object) {
  const gs = grants[object] ?? [];
  if (gs.length === 0) return { verb: "none", scope: "none", exact: true };
  let verb = "none"; let scope = "none";
  for (const g of gs) {
    if (verbRank(g.verb) > verbRank(verb)) verb = g.verb;
    if (scopeRank(g.scope) > scopeRank(scope)) scope = g.scope;
  }
  // ★ `exact:false` is the honest flag a UI needs: it says "this cell is a summary of more than one
  //   grant and the combination shown is wider than any single one of them."
  const exact = gs.some((g) => g.verb === verb && g.scope === scope);
  return { verb, scope, exact };
}
