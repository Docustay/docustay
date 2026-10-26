-- 0078 — P1.7 FIX · THE TRANSITIONAL FALLBACK IS A FACT ABOUT THE **TENANT**, NOT ABOUT THE PERSON.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ FOUND BY THE P1 ADVERSARIAL REVIEW, AND IT FALSIFIES 0075's CENTRAL CLAIM.
--     0075 said the fallback "fires ONLY when the viewer holds no role at all — which, after the
--     backfill, is nobody", and that it "cannot widen anything". **Both are false, for the same
--     reason: nothing in the product ever grants a role.**
--
--   [EXECUTED] `grep -rn "grantRole(" src/` outside its own module → **ZERO production call sites.**
--     `seed_builtin_roles` runs once per tenant, for the founder alone. `createPerson()` inserts an
--     `app_user` and grants nothing. So:
--       · **every staff member hired after signup holds no role, forever** — and therefore reads
--         the entire tenant. A new hire is MORE privileged than a configured coach.
--       · **revoking a coach's roles PROMOTES them** from their caseload to the whole practice —
--         and "remove this person's access" is exactly the gesture an operator makes when
--         offboarding somebody.
--     [EXECUTED] `/people/all as coach2 AFTER every role was revoked = 10 rows` (2 before).
--
-- ★★★ THE FIX: ASK WHETHER THE **TENANT** HAS BEEN CONFIGURED, NOT WHETHER THE PERSON HAS.
--     "This database has not been backfilled" is a property of the deployment, and that is the only
--     thing the fallback was ever meant to cover. Keyed that way:
--       · an un-backfilled tenant → everyone falls back, exactly as before P1.7. Status quo.
--       · a configured tenant     → **nobody** falls back. A new hire with no role sees NOTHING,
--                                   which is fail-CLOSED and is the correct answer.
--       · revoking somebody's roles → the tenant still has others, so no promotion. **The gesture
--                                     that means "less" now means less.**
--
-- ★★ AND THE OTHER HALF OF THE HOLE IS CLOSED IN CODE, NOT HERE: `createPerson()` now grants a new
--    staff member the role their rank maps to, so "a person nothing can grant a role to" stops
--    existing. Without that, this migration would lock every new hire out instead of over-admitting
--    them — trading a leak for an outage.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION keystone.scope_not_yet_configured(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM keystone.app_user u
                  WHERE u.id = p_user_id AND u.role = 'staff')
     -- ★★★ THE TENANT, NOT THE PERSON. `user_role` is tenant-isolated by RLS, so this asks "has
     --     ANYBODY in this tenant been given a role?" — i.e. "has this deployment been backfilled?"
     --   ★ An individual holding no role is NOT the question, and asking it that way is what let a
     --     revocation widen access.
     AND NOT EXISTS (SELECT 1 FROM keystone.user_role);
$$;

COMMENT ON FUNCTION keystone.scope_not_yet_configured(uuid) IS
  'P1.7 / 0078 — TRANSITIONAL. True for a STAFF member only while the TENANT has no role grants at '
  'all. ★★★ 0075 keyed this on the PERSON and that was a live fail-open: a new hire held no role '
  '(nothing grants roles) and read the whole tenant, and REVOKING somebody''s roles PROMOTED them. '
  'Keyed on the tenant, a revocation narrows and a new hire is fail-closed. ★ DELETE IT (body → '
  'SELECT false) once every deployment is backfilled.';
