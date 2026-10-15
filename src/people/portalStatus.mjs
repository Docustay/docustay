// CT-104 / 12-signup-first-run-people.md §3.2 — PORTAL STATUS, COMPUTED ONCE, SHARED EVERYWHERE.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ A PURE FUNCTION OVER THREE ALREADY-RESOLVED FACTS, NOT A QUERY ITSELF. That is what CT-104
//     means by "reused, not re-derived": the CALLER resolves the three facts below and this
//     function is the ONE place the four-way decision (`invited | active | never_signed_in |
//     bounced`) is made, so PeopleAll, PeopleParents, PeopleLeads and FirstRunHome cannot each
//     spell the priority order slightly differently.
//
// ★★ `bounced` OUTRANKS `active`/`invited`, DELIBERATELY. A bounced address is a live problem even
//    for someone who has signed in before — by definition in the past, on an address that may no
//    longer work.
//
// The three facts, and where each comes from (§3.2):
//   - `emailBouncedAt` — `keystone.app_user.email_bounced_at` (migration 0230), set by
//     `src/routes/webhooks.mjs`'s existing `email.bounced` handler.
//   - `invitedAt` — `keystone.invite.created_at` for the matching email, already resolvable
//     (`src/records/lists/people.mjs:374-385` is the working precedent for reading this table).
//   - `hasEverSignedIn` — `keystone.person_ever_signed_in()` (migration 0230, SECURITY DEFINER —
//     `keystone_auth.session` carries no grant to `app_rw`).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function portalStatus({ hasEverSignedIn, invitedAt, emailBouncedAt }) {
  if (emailBouncedAt) return "bounced";
  if (hasEverSignedIn) return "active";
  if (invitedAt) return "invited";
  return "never_signed_in";
}
