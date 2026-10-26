-- 0264_packages_never_expire
-- Spec 02 (Items) §3, task 2.1 — C2. Retires keystone.package.validity_days.
--
-- MOCKUPS §0:35 — "Field hidden and ignored. CLI must check no existing package has a value set."
-- Nulling first (rather than refusing on a non-null find) is correct here specifically because
-- CLAUDE.md's PRODUCTION STATE (22 Sep 2026) records that GLRS and test practices are the only real
-- tenants and there is no real client data to lose — a null validity was already this column's
-- "never expires" state, so any non-null value was already wrong under the new rule, not a fact
-- worth preserving.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM keystone.package WHERE validity_days IS NOT NULL;
  IF n > 0 THEN
    RAISE NOTICE '% package row(s) carried validity_days before this migration — nulled before drop, per MOCKUPS §0:35', n;
    UPDATE keystone.package SET validity_days = NULL WHERE validity_days IS NOT NULL;
  END IF;
END $$;

ALTER TABLE keystone.package DROP COLUMN validity_days;
-- the column's own CHECK (validity_days IS NULL OR validity_days > 0) drops with it.
