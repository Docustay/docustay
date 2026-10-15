-- 0563_tenant_count_sanity_check_read_only
--
-- 0561/0562 (this same session, minutes earlier) reported "no Docustay tenant found" / zero tenants
-- listed, which cannot be true in production (the live example.com site has been
-- submitting real leads against a real Docustay tenant all night). The deploy log's own timestamps for
-- 0560/0561/0562's output were all clustered within a ~400-microsecond window in an order that
-- cannot reflect true sequential execution ("applied 3 migration(s)" printed before the individual
-- "applying 0560/0561/0562" lines) — strongly suggesting a log-aggregation/interleaving artifact
-- from two overlapping pre-deploy runs, not a real empty `keystone.tenant` table. This migration
-- settles it cleanly: a trivial, unambiguous count, with its own fresh timestamp, nothing else.
-- ★ READ-ONLY — changes nothing.

DO $diag$
DECLARE
  v_count int;
  v_role text;
BEGIN
  SELECT current_user INTO v_role;
  SELECT count(*) INTO v_count FROM keystone.tenant;
  RAISE NOTICE '0563 SANITY: connected as % — keystone.tenant has % row(s) total', v_role, v_count;
END
$diag$;
