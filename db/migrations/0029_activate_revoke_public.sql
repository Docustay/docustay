-- 0029_activate_revoke_public
-- P17.9 — D-17.25. ★★★ MY OWN MIGRATION 0028 SHIPPED THE HOLE ITS COMMENT CLAIMED TO CLOSE.
--
-- 0028 ends with `GRANT EXECUTE … TO app_signup, app_rw` and a comment stating that the signup role
-- "gains one verb, not a surface". ★★ THAT WAS FALSE AS WRITTEN: Postgres grants EXECUTE on every
-- new function to PUBLIC by default, so the explicit grant added nothing and EVERY role in the
-- cluster — including `app_ro`, `app_signup`, `app_embed` and any future read-only identity — could
-- call it. The named grant made it LOOK deliberate and scoped.
--
-- ★★★ IT WAS CAUGHT BY `db/gates/catalog-conformance.mjs`, WHICH ALREADY KNEW ABOUT THIS TRAP:
--       ✗ keystone.activate_provisioning_tenant: EXECUTE is granted to PUBLIC. Postgres does this
--         BY DEFAULT on every new function — REVOKE ALL ON FUNCTION … FROM PUBLIC;
--     [EXECUTED 2026-09-13] the full suite went 30/30 → 29/30 on exactly this, one run after the
--     migration was applied. ★ Worth recording plainly: the default-grant trap was already known and
--     already guarded, and I still walked into it — which is the argument for the gate, not against
--     the author. A rule you have read is not a rule you have applied.
--
-- ★ WHY THIS IS A NEW FILE AND NOT AN EDIT TO 0028: 0028 is applied, and `db/migrate.mjs` refuses a
--   changed checksum — "An applied migration is immutable. Write a NEW migration instead." Appending
--   to a shipped migration is how two databases silently stop matching.
--
-- ★★ AND THE PRACTICAL CONSEQUENCE OF THE HOLE, SO THE SEVERITY IS NOT GUESSED AT: the function's
--    own WHERE clause still limited it to provisioning → active, and RLS still applied (it is a
--    definer owned by a NOBYPASSRLS role against a FORCE-RLS table), so a caller had to already hold
--    the tenant GUC for the tenant in question. So this was a defence-in-depth failure rather than a
--    directly exploitable one — which is exactly the kind that survives review by sounding minor.

REVOKE ALL ON FUNCTION keystone.activate_provisioning_tenant(uuid) FROM PUBLIC;

-- ★ Re-stated explicitly so this file alone says who may call it. The grants in 0028 survive the
--   REVOKE above (PUBLIC and a named role are separate grants), and repeating them is idempotent.
GRANT EXECUTE ON FUNCTION keystone.activate_provisioning_tenant(uuid) TO app_signup, app_rw;
