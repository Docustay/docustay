-- 0586 · RETIRE THE LEGACY CREDIT TABLES (QUEUE §12.3 ledger hardening, specs/CREDITS-PIPELINE.md defect 24).
-- `package_balance` / `package_credit` (0013) were the first credit design. Nothing in src/ reads or writes them (privileges revoked in 0370);
-- `entitlement` + `entitlement_credit` (+ the permanent `credit_event` ledger) are the one system. They are dropped ONLY if both are empty —
-- real rows would be migrated by a person first, so a non-empty table is kept and reported, and the deploy still succeeds.
DO $m$
DECLARE n_bal bigint := 0; n_cred bigint := 0;
BEGIN
  IF to_regclass('keystone.package_credit') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM keystone.package_credit' INTO n_cred; END IF;
  IF to_regclass('keystone.package_balance') IS NOT NULL THEN EXECUTE 'SELECT count(*) FROM keystone.package_balance' INTO n_bal; END IF;
  IF n_cred = 0 AND n_bal = 0 THEN
    DROP TABLE IF EXISTS keystone.package_credit;
    DROP TABLE IF EXISTS keystone.package_balance;
  ELSE
    RAISE NOTICE '0586: legacy credit tables kept — package_balance % row(s), package_credit % row(s). Migrate them to entitlement_credit, then drop.', n_bal, n_cred;
  END IF;
END
$m$;
