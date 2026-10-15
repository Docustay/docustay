// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ROLE WORD, IN ONE PLACE (REACT-PLAN R-46).
// The third built-in role's KEY is still `coach` in the database until the RN rename runs (after the
// harness refactor). React code never writes the literal: it reads RANK.member and TERM.member. RN
// flips these two lines and nothing else in webreact changes.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export const RANK = Object.freeze({ owner: "owner", admin: "admin", member: "member" });
export const TERM = Object.freeze({ member: "userType.member", admin: "userType.admin", client: "userType.client", clientPlural: "userType.clientPlural", parent: "userType.parent", parentPlural: "userType.parentPlural", session: "noun.session", sessionPlural: "noun.sessionPlural" });
// ★ There is no plural key for the role today (src/terminology/keys.mjs has userType.coach only). RN adds
//   userType.member + userType.memberPlural; until then a plural is written as the singular term + "s"
//   nowhere — screens that need the plural say "your team" (the ruled on-screen noun, REACT-PLAN §7).

/** The word for a rank, as a person reads it: Owner · the practice's term for Admin · for a Team member. */
import { term } from "@/lib/terminology/terms.js";
export function rankLabel(role) {
  if (role === RANK.owner) return "Owner";
  if (role === RANK.admin) return term(TERM.admin);
  if (role === RANK.member) return term(TERM.member);
  return role;
}
