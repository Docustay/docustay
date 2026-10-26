-- 0075 — P1.7 · THE TRANSITIONAL PREDICATE, SO A CUTOVER DOES NOT BLANK AN UN-BACKFILLED DATABASE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ P1.7 PUT `keystone.user_may()` INTO EVERY LIST AND EVERY RECORD PAGE. On a database where
--     `scripts/backfill-roles.mjs` has run that is exactly right. On one where it has NOT, **every
--     staff member holds no role, so every list returns nothing** — the product goes blank with no
--     error anywhere.
--
--   ★★★ I HAD ALREADY REASONED ABOUT THIS ONCE AND NOT APPLIED IT TWICE. `scopesGrantableBy()` was
--       given exactly this fallback, with exactly this argument, an hour earlier — and the read path
--       shipped without it. The gates caught it: `p13_auth` failed its POSITIVE CONTROL with
--       *"404 record not found"* on a user the fixture had always been able to read.
--       **A cutover moves the authority SOURCE. It must not change who has the authority.**
--
-- ★★ THIS CANNOT WIDEN ANYTHING, AND THAT IS THE WHOLE TEST OF A TRANSITIONAL FALLBACK.
--    It fires ONLY when the viewer holds **no role at all** — which, after the backfill, is nobody.
--    When it fires it returns what the system returned BEFORE P1.7: staff see their tenant. It is
--    bounded by `role = 'staff'`, so a client or a parent gains nothing from it ever.
--
-- ★★★ HOW TO DELETE IT, AND WHEN. Run `scripts/backfill-roles.mjs` against the deployment, confirm
--     `SELECT count(*) FROM keystone.app_user u WHERE u.role='staff' AND NOT EXISTS
--      (SELECT 1 FROM keystone.user_role r WHERE r.user_id = u.id)` is **0**, then replace this
--     function's body with `SELECT false`. ★ `db/gates/p1_scope_wired.mjs` already asserts that a
--     user WITH roles is answered from `role_permission` and never from this — which is the evidence
--     that deleting it is safe.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.scope_not_yet_configured(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM keystone.app_user u
                  WHERE u.id = p_user_id AND u.role = 'staff')
     -- ★ The condition is "holds NO role", not "holds a weak role". A staff member who has been
     --   given the Coach role and nothing else is CONFIGURED, and must be scoped.
     AND NOT EXISTS (SELECT 1 FROM keystone.user_role r WHERE r.user_id = p_user_id);
$$;

COMMENT ON FUNCTION keystone.scope_not_yet_configured(uuid) IS
  'P1.7 — TRANSITIONAL. True only for a STAFF member who holds no role at all, which after '
  'scripts/backfill-roles.mjs is nobody. It reproduces the pre-cutover answer exactly and can never '
  'exceed it. ★ DELETE IT (body → SELECT false) once every deployment is backfilled; '
  'db/gates/p1_scope_wired.mjs proves the role path is what answers when roles exist.';
