// THE SHARED DELETE — which record types a screen may delete, and which type a list path means. PLAIN JS (no DOM),
// so a gate can assert it. The server's own list is `DELETABLE` in src/records/delete.mjs; this is its mirror.
//
// ★★★ NO PER-SCREEN DELETE CODE. A list screen draws `RowActions`; `RowActions` asks `deleteTypeForPath(pathname)`
//     whether the current list holds a deletable type. A new deletable type is one entry in each of the two lists.

/** The server's DELETABLE keys (src/records/delete.mjs). */
export const DELETABLE_TYPES = Object.freeze([
  "person", "team_member", "account", "payer_group", "service", "package", "plan", "program", "modifier", "coupon", "gift_card",
  "unit", "location", "service_category", "booking", "booking_link", "document_template", "document", "clause",
  "email_template", "campaign", "landing_page", "segment", "automation", "network_party", "estimate",
  "payment", "refund", "credit_note", "dispute", "payout", "subscription",
]);

/** The server's ARCHIVABLE keys (src/records/archive.mjs) — the types a list can bulk-Archive / bulk-Restore. */
export const ARCHIVABLE_TYPES = Object.freeze(["person", "account", "network_party", "booking", "invoice", "service", "plan", "package", "subscription", "document"]);

/** A list that shows ARCHIVED rows (its own Restore is the only bulk-shaped action there). */
export const isArchivedPath = (path) => typeof path === "string" && /\/archived(\/|$)/.test(path);

/** list path → the record type its rows are. ★ EXACT paths (and `<path>/<record id>` for that path's own record/editor page) — never a prefix: a
 *  prefix mapped `/people/team/invites` to team_member, `/network/referrals` to network_party and `/accounts/monitoring` to account (audit F4). */
const BY_PATH = [
  ["/people/team", "team_member"],
  ...["active", "all", "clients", "adolescents", "parents", "leads", "paused", "former", "archived"].map((v) => [`/people/${v}`, "person"]),
  ["/accounts/all", "payer_group"],      // the Accounts screen lists PAYER GROUPS, not `account` rows
  ["/accounts", "payer_group"],
  ["/items/services", "service"],
  ["/items/packages", "package"],
  ["/items/plans", "plan"],
  ["/items/programs", "program"],
  ["/items/modifiers", "modifier"],
  ["/items/coupons", "coupon"],
  ["/items/gift-cards", "gift_card"],
  ["/items/categories", "service_category"],
  ["/items/units", "unit"],
  ["/engagements/sessions", "booking"],
  ["/documents", "document"],
  ["/documents/pipeline", "document"],
  ["/documents/templates", "document_template"],
  ["/documents/contracts/templates", "document_template"],
  ["/documents/forms/templates", "document_template"],
  ["/documents/clauses", "clause"],
  ["/run/pages", "landing_page"],
  ["/growth/pages", "landing_page"],
  ["/run/lists", "segment"],
  ["/growth/lists", "segment"],
  ["/run/campaigns", "campaign"],
  ["/growth/campaigns", "campaign"],
  ["/run/templates", "email_template"],
  ["/network", "network_party"],
  ["/money/estimates", "estimate"],
  ["/money/payments", "payment"],
  ["/money/subscriptions", "subscription"],
  ["/money/payouts", "payout"],
  ["/money/disputes", "dispute"],
];

/** money detail pages (bespoke screens): /money/<kind>/<uuid> → the deletable type and id */
const MONEY_DETAIL = { payments: "payment", subscriptions: "subscription", payouts: "payout", disputes: "dispute" };
export function deleteTargetForPath(path) {
  const m = typeof path === "string" ? path.match(/^\/money\/(payments|subscriptions|payouts|disputes)\/([0-9a-f-]{36})$/i) : null;
  return m ? { object: MONEY_DETAIL[m[1]], id: m[2] } : null;
}

export function deleteTypeForPath(path) {
  if (typeof path !== "string") return null;
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  for (const [p, type] of BY_PATH) {
    if (clean === p) return type;
    if (clean.startsWith(`${p}/`) && isUuid(clean.slice(p.length + 1))) return type;      // that list's own record/editor page
  }
  return null;
}

/** /record/<type>/<id> → the deletable type, or null. (record pages name the type themselves) */
const RECORD_TYPE_TO_DELETABLE = Object.freeze({
  person: "person", staff: "team_member", account: "account", service: "service", package: "package", plan: "plan",
  booking: "booking", document: "document", network_party: "network_party",
});
export function deleteTypeForRecord(recordType, role = null) {
  if (recordType === "person" && role === "staff") return "team_member";
  return RECORD_TYPE_TO_DELETABLE[recordType] ?? null;
}

export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Same gate as archive on the server (record.archive: Owner and Admin). The server is the boundary. */
export { mayArchiveByRank as mayDelete } from "@/lib/permissions/rank.js";
