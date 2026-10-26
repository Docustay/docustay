-- 0287_calendar_subscribe_token
-- Spec 03a (calendar and sync) task 3a.1 · §3 — THE FREE `.ics` SUBSCRIBE LINK (MOCKUPS:287,
-- "subscribe link with Copy and Reset"). Reset replaces the token outright (old link stops working
-- immediately, matching the screen's own verb).
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ STOP-AND-REPORT NOTE, LEFT IN PLACE RATHER THAN GUESSED AWAY. §3's own text for this table's
--     RLS reads (verbatim): "Deny-all RLS except a SECURITY DEFINER lookup function
--     `calendar_subscribe_token_resolve(token)` — the .ics route is UNAUTHENTICATED (no session, no
--     tenant context to scope a normal RLS read), same shape family as link_token's existing
--     unauthenticated-reachable design (CT-090)." That is a DESCRIPTION of a shape, not the exact
--     SQL §3 gives everywhere else in this migration block (contrast 0290's fully-spelled-out
--     ALTER/ADD CONSTRAINT text, or 0285's literal reuse of 0013's own DO $$ loop). Replicating
--     link_token's shape (`0169_link_token.sql` + `0170`'s definer functions) for THIS table means
--     deciding, with no exact SQL given for any of it: the resolve function's exact signature/return
--     columns, which role owns it, and — since task 3a.2 (routes, a DIFFERENT task, no migration of
--     its own per FEATURES-COMBINED-PLAN.md) is the one that mints this token on first
--     `CalendarSettings` load and resets it on demand — whether app_rw gets any grant at all for
--     that write path, or whether mint/reset also need their own SECURITY DEFINER functions that no
--     part of §3 names. Inventing a security-sensitive function body/grant set for a token that
--     gates read access to a coach's calendar is exactly the guessing BUILD-PROCESS.md forbids.
--   ★★ WHAT IS BUILT BELOW: the table exactly as §3 gives it, plus ENABLE + FORCE ROW LEVEL
--      SECURITY with NO policies at all — which IS "deny-all" (FORCE means even the table owner
--      sees nothing without an explicit policy; no policy for any role, including app_rw, is
--      granted here). That is a safe, valid stopping point: nobody can read or write this table
--      through the normal application role until the resolve (and any mint/reset) function is
--      designed and added. Flagged in this task's report for Opus/Ty to resolve — either give the
--      exact function SQL in §3 and re-dispatch, or fold it into task 3a.2 (routes) which is the
--      only task that actually calls it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.calendar_subscribe_token (
  id         uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id    uuid NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  token      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  UNIQUE (host_id),
  UNIQUE (token)
);

ALTER TABLE keystone.calendar_subscribe_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.calendar_subscribe_token FORCE  ROW LEVEL SECURITY;
-- ★ Deliberately NO policy and NO grant here — see the STOP-AND-REPORT note above. FORCE with zero
--   policies is deny-all to every role, app_rw included, until the resolve (and mint/reset) access
--   path is designed with real SQL rather than guessed.

COMMENT ON TABLE keystone.calendar_subscribe_token IS
  'Spec 03a §3, task 3a.1. One `.ics` subscribe token per coach (UNIQUE host_id) for the free, '
  'unauthenticated calendar-subscribe feed (MOCKUPS:287). Reset REPLACES the token outright — the '
  'old link 404s immediately. Deny-all RLS on purpose: the read/write access path (a SECURITY '
  'DEFINER resolve function for the unauthenticated .ics fetch, and whatever mint/reset needs) is '
  'NOT yet built — see this migration''s own STOP-AND-REPORT note. UNIQUE(token) is the credential '
  'itself; never log it.';
