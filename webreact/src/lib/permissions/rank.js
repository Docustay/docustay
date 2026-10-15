// The three staff ranks, least to most privileged. Mirrors src/nav/authorise.mjs's RANK
// (server-side, already correct) and keystone.app_user_staff_role_check (0188, already correct).
export const RANK_ORDER = Object.freeze(["member", "admin", "owner"]);
export const RANK_LABEL = Object.freeze({ member: `Coach`, admin: "Admin", owner: "Owner" });

/** The rank-only archive rule the p7 gate asserts through gate-entry (`mayArchive`). ★ An unrecognised
 *  rank is a REFUSAL. Screens do NOT call this: ArchiveControl decides with useWrite("archiveRecord"),
 *  whose declaration is the `record.archive` action — the one the server checks. */
export function mayArchiveByRank(rank) {
  const i = RANK_ORDER.indexOf(rank);
  return i !== -1 && i >= RANK_ORDER.indexOf("admin");
}
