-- 0289_outlook_calendar_enabled_flag
-- Spec 03a (calendar and sync) task 3a.1 · §3 — CT-108's new flag row, seeded exactly like the
-- existing eight (0218's bracket pattern — suspend FORCE, insert, restore FORCE).
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
--
-- ★★ Same reasoning as 0218: `keystone.feature_flag` (0213) is ENABLE+FORCE with exactly ONE
--    policy, `feature_flag_read` (SELECT only) — "the flag vocabulary must be migration-only" is
--    0213's own stated design, so there is deliberately no INSERT policy and no INSERT grant for
--    anyone, app_owner included (app_owner is NOBYPASSRLS). This uses the 0218 house pattern —
--    suspend FORCE, seed, restore FORCE, and assert it came back.

ALTER TABLE keystone.feature_flag NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.feature_flag (key, description, default_on) VALUES
  ('outlook_calendar_enabled',
   'Microsoft Graph calendar sync for a practice''s connected Outlook accounts. Off stops new sync attempts; existing bookings are unaffected.',
   true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.feature_flag FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's/0218's own reasoning, verbatim: leaving it off would silently
--    disable "the flag vocabulary must be migration-only" and every later migration/gate would
--    still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0289: FORCE ROW LEVEL SECURITY was not restored on keystone.feature_flag';
  END IF;
END $$;
