// ═══════════════════════════════════════════════════════════════════════════════════════════════
// can.js — THE UI'S PERMISSION QUESTION, ANSWERED WITH THE SERVER'S OWN RULE (REACT-PLAN §4.5, R-29).
//
// ★★★ NOTHING HERE IS A SECOND COPY OF THE LADDER. `allows()` and `scopeAllows()` are imported from
//     src/permissions/resolve.mjs — the same functions assertMay's callers use — and the grants are
//     exactly `effectiveGrants()`' shape, shipped on /api/nav (RP.1). A dotted action ("invoice.refund")
//     is a named role_action, exactly as assertMay.mjs decides; view/edit/delete are grant questions.
// ★★ UX ONLY. The route still decides (assertMay, guarded, user_may, RLS). This can hide a button; it can
//    never grant anything. A UI that disagrees with the server shows a control the server then refuses —
//    which is why these answers come from the server's payload and function, not from a rank.
// ★ lib/permissions/ is the ONE place ranks are compared (gate db/gates/react_code_rules.mjs K6b).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { allows } from "@keystone/permissions/resolve.mjs";
import { verbRank } from "@keystone/permissions/objects.mjs";
import { authoriseSection } from "@keystone/nav/authorise.mjs";

const RANK_ORDER = ["member", "admin", "owner"]; // rank ladder (src/nav/authorise.mjs), least → most

/** @param permissions app.permissions (from /api/nav) — null before load and for clients. */
export function rankAtLeast(permissions, rank) {
  if (!permissions?.rank) return false;
  return RANK_ORDER.indexOf(permissions.rank) >= RANK_ORDER.indexOf(rank);
}

export function canAct(permissions, action) {
  return Array.isArray(permissions?.actions) && permissions.actions.includes(action);
}

/**
 * May the viewer do `verbOrAction` on `object`?
 * @param opts.ownerId  pass the row's owner (or null for an unowned row) to ask about ONE row — the
 *                      scope is then applied exactly as the server applies it. OMIT it to ask "may they
 *                      do this to anything at all?" (list-level controls): true when some grant carries
 *                      the verb at any scope other than none.
 * @param opts.viewerId defaults to permissions' owner (me) — the caller passes app.me.appUserId.
 */
export function can(permissions, object, verbOrAction, { ownerId, viewerId } = {}) {
  if (!permissions) return false;
  if (verbOrAction.includes(".")) return canAct(permissions, verbOrAction);
  const grants = permissions.grants ?? {};
  if (ownerId === undefined) {
    const need = verbRank(verbOrAction);
    return (grants[object] ?? []).some((g) => verbRank(g.verb) >= need && g.scope !== "none");
  }
  return allows(grants, object, verbOrAction, {
    ownerId, viewerId: viewerId ?? null, teamVisibleOwnerIds: new Set(permissions.teamVisibleUserIds ?? []),
  });
}

/**
 * May this viewer reach a nav section path? The server's own `authoriseSection` — the check the write
 * dispatcher runs before assertMay on every WRITE_ROUTES row (src/routes/writes.mjs:1211). A section
 * refusal is a PERMISSION (render nothing), never a prerequisite.
 */
function sectionAllowed(permissions, section) {
  if (!permissions?.rank) return false;
  return authoriseSection({ role: "staff", staff_role: permissions.rank }, section, { tenantIsPlatform: false }).allowed;
}

/**
 * Is a route (a routePermissions.json declaration) usable by this viewer? The answer to "render it?".
 * Kinds the viewer cannot be refused by the UI (self, section, handler, staff) answer true: the server
 * decides and the control shows its error if refused.
 */
export function routeAllowed(permissions, decl, { ownerId, viewerId } = {}) {
  if (!decl) throw new Error("routeAllowed: no declaration — every write route is declared (RP.9)");
  // ★ F775: a grant row ALSO passes its section first, on the server. Without this the UI drew controls
  //   the section floor then refused (a Team member's own notification mark-read).
  if (decl.section && decl.kind !== "public" && decl.kind !== "client" && !sectionAllowed(permissions, decl.section)) return false;
  switch (decl.kind) {
    case "grant": return can(permissions, decl.object, decl.action, { ownerId, viewerId });
    case "action": return canAct(permissions, decl.action);
    case "rank": return rankAtLeast(permissions, decl.rank);
    case "platform": return false; // operator routes are never rendered in the practice app
    case "public": case "client": case "webhook": return true;
    default: return permissions != null; // self · section · staff · handler — the server decides
  }
}

/**
 * May this viewer see money on a record (invoices, payments, subscriptions)? The grant decides when the
 * viewer's permissions are known; a caller that only has the rank (a gate mounting RecordPage with
 * `rank`) gets the rank rule the Svelte RecordPage used: the third built-in role sees none.
 */
export function canSeeMoney({ permissions = null, rank = null } = {}) {
  if (permissions) return can(permissions, "invoice", "view");
  return rank != null && rank !== RANK_ORDER[0];
}
