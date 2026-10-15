-- 0456_run_managed_flag.sql — Stage 16 task 16.29
--
-- Seeds the run_managed feature flag into keystone.feature_flag (0213).
-- The practice is on the done-for-you tier: RunReceipt renders and the monthly write-up runs.
-- Defaults to OFF; operator can toggle per-practice via the feature_flag_practice override.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ★ REHEARSAL FIX (25 Sep 2026): feature_flag is FORCE RLS with no platform insert policy — the
--   insert needs 0433's own idiom: lift FORCE for the one statement, restore it, prove it.
ALTER TABLE keystone.feature_flag NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.feature_flag (key, description, default_on) VALUES
  ('run_managed', 'The practice is on the done-for-you tier: RunReceipt renders and the monthly write-up runs.', false)
ON CONFLICT (key) DO NOTHING;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)

ALTER TABLE keystone.feature_flag FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0456: FORCE ROW LEVEL SECURITY was not restored on keystone.feature_flag';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone.feature_flag WHERE key = 'run_managed') THEN
    RAISE EXCEPTION '0456: run_managed flag row missing';
  END IF;
END $$;
