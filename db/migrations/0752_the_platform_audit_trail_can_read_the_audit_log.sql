-- 0752 · The platform operator's Audit screen answered "insufficient privilege" on every load.
--
-- ★★★ MEASURED 15 Oct 2026 (test/s11_20_platform_reads.test.mjs): GET /api/platform/audit with a live operator grant → 403
--   "insufficient privilege". The route reads keystone.platform_list_audit_events() (0363), a SECURITY DEFINER function owned by
--   auth_owner that UNIONs keystone.audit_entry with keystone_auth.operator_audit_entry. 0363 relied on auth_owner reading
--   keystone.audit_entry, but auth_owner holds NO privilege on it (has_table_privilege = false) and the table is ENABLE + FORCE row-level
--   security whose only SELECT policy is tenant-scoped — so the definer could never read a single row and the whole function failed.
--
-- ★ Same shape as 0017's tenant_health_read: a table privilege for auth_owner plus a policy that admits ONLY auth_owner and ONLY SELECT,
--   and here only while keystone.caller_is_platform() is true (a live, approved, unexpired operator grant on the session). A non-operator
--   calling the function, or reading the table through any other role, is unchanged. Additive and idempotent.
DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0752: must run as app_owner, running as %', current_user; END IF;
END $$;

GRANT SELECT ON keystone.audit_entry TO auth_owner;
-- keystone.audit_entry's own tenant_isolation policy calls keystone.viewer_may_read_audit(), and a policy is evaluated for EVERY role that
-- reads the table, auth_owner included: without EXECUTE the read fails "permission denied for function viewer_may_read_audit" before
-- platform_audit_read below is even consulted. (The function is SECURITY DEFINER and answers false for a caller with no tenant.)
GRANT EXECUTE ON FUNCTION keystone.viewer_may_read_audit() TO auth_owner;

DROP POLICY IF EXISTS platform_audit_read ON keystone.audit_entry;
CREATE POLICY platform_audit_read ON keystone.audit_entry
  FOR SELECT TO auth_owner USING (keystone.caller_is_platform());

COMMENT ON POLICY platform_audit_read ON keystone.audit_entry IS
  '0752. Admits ONLY auth_owner (the owner of keystone.platform_list_audit_events), ONLY for SELECT, ONLY while the session carries a live operator grant. The platform Audit screen reads every practice''s trail through that function.';

DO $$ BEGIN
  IF NOT has_table_privilege('auth_owner', 'keystone.audit_entry', 'SELECT') THEN
    RAISE EXCEPTION '0752: auth_owner still cannot SELECT keystone.audit_entry';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone' AND tablename='audit_entry' AND policyname='platform_audit_read') THEN
    RAISE EXCEPTION '0752: platform_audit_read was not created';
  END IF;
END $$;
