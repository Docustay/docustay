-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P9.4 CORRECTION — THE SELLS TRIGGER IS RIGHT AND ITS RECORDED REASON WAS WRONG.
--
-- ★★★ WHY THIS IS A NEW MIGRATION AND NOT AN EDIT TO 0116. I edited 0116's comment in place after it
--     had been applied, and `db/migrate.mjs` refused to run:
--
--       FATAL: Migration 0116_a_template_that_sells_something_should_say_what has already been
--              applied but its file has CHANGED.
--
--     **The guard is right and the edit was wrong.** An applied migration is the record of what a
--     database was actually told; editing one makes the file a description of what somebody wishes
--     had happened. 0116 has been restored to the text that ran, and the correction ships here —
--     which is also how anybody reading the history will see that the reasoning changed, and when.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CORRECTION ITSELF. 0116 said the tenant clause was needed because *"RLS would never see
--     it, because this runs inside the trigger."* **That is false.** `sells_target_exists` is
--     SECURITY INVOKER: its `SELECT` runs as `app_rw` under FORCE ROW LEVEL SECURITY, so another
--     practice's service is already invisible on any request path.
--   ★★ [MEASURED 2026-09-15] removing the clause left the gate's cross-tenant assertion GREEN — it
--      was measuring RLS, not the clause. **A guard whose test is satisfied by a different guard is
--      a guard nobody is testing.**
--   ★★★ WHAT THE CLAUSE ACTUALLY PROTECTS is every path where RLS is NOT in the way: a migration, a
--        backfill script, an admin connection, a future SECURITY DEFINER wrapper. [EXECUTED as the
--        superuser, RLS bypassed] the insert is REFUSED with the clause and ACCEPTED without it.
--   ★ Written down because a guard whose recorded reason is wrong is a guard the next person removes
--     as redundant — taking with it the protection it really provides.
--
-- ★ THE FUNCTION BODY IS BYTE-FOR-BYTE WHAT 0116 INSTALLED. Only the comments differ. Re-running it
--   is a no-op against a database that already has 0116, and makes a fresh database identical either
--   way.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION keystone.sells_target_exists()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  found boolean;
BEGIN
  IF NEW.sells_type = 'none' THEN RETURN NEW; END IF;

  -- ★★ TENANT-SCOPED — AND THE REASON IS NOT THE OBVIOUS ONE. See this migration's header: a
  --    request-path insert is already blocked by RLS without it. What this stops is every path where
  --    RLS is not in the way — a migration, a backfill, an admin connection, a SECURITY DEFINER
  --    wrapper. Measured both directions.
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM keystone.%I WHERE id = $1 AND tenant_id = $2)', NEW.sells_type)
    INTO found USING NEW.sells_id, NEW.tenant_id;

  IF NOT found THEN
    RAISE EXCEPTION
      'this template says it sells the % %, and no such % exists in this practice. A template '
      'pointing at nothing refuses to send, and the coach who hits that has no way to tell why.',
      NEW.sells_type, NEW.sells_id, NEW.sells_type
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION keystone.sells_target_exists() IS
  'P9.4 (0116), reasoning corrected in 0117. sells_id must exist in the table sells_type names, IN THIS TENANT. The tenant clause is not what stops a request — RLS already does; it is what stops a migration, a backfill or an admin connection.';
