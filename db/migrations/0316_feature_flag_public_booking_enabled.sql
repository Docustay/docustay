-- 0316_feature_flag_public_booking_enabled
-- Spec 03b task 3b.1 · CT-108 (CONTRACTS-FEATURES.md — new feature_flag rows this stage adds).
--
-- The one kill-switch for the entire unauthenticated public-booking door (spec 03b §13): off makes
-- `/api/public/book` and every `EngPublic*` route answer the same generic 404 an unresolvable slug
-- produces — no code path distinguishes "flag off" from "no such practice" (same enumeration-oracle
-- discipline as everywhere else in that spec).
--
-- ★★ SAME BRACKET IDIOM AS 0218 (`0218_feature_flag_seed.sql`): keystone.feature_flag (0213) is
--    ENABLE+FORCE with exactly one policy, `feature_flag_read` (SELECT only) — "the flag vocabulary
--    must be migration-only" is 0213's own stated design, so there is deliberately no INSERT policy
--    and no INSERT grant for anyone but the migration role. A bare INSERT here fails with "new row
--    violates row-level security policy for table feature_flag" — suspend FORCE, seed, restore
--    FORCE, and assert it came back, exactly as 0189/0194/0195/0196/0197/0218 already do for this
--    same situation.
--
-- ★ `description` is NOT NULL on keystone.feature_flag (0213:41) — spec 03b §3's shorthand
--   `(key, default_on)` omits it, but "same bracket idiom as 0218" means matching that file's own
--   actual shape, which always supplies one; filled in here rather than left to fail NOT NULL.

ALTER TABLE keystone.feature_flag NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.feature_flag (key, description, default_on) VALUES
  ('public_booking_enabled', 'The entire unauthenticated public-booking door: /api/public/book, /book, /book/:coachSlug, and the waitlist-claim public routes (spec 03b §13). Off makes every one of them answer the same generic 404 an unresolvable slug produces.', true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.feature_flag FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    "the flag vocabulary must be migration-only" and every later migration/gate would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0316: FORCE ROW LEVEL SECURITY was not restored on keystone.feature_flag';
  END IF;
END $$;
