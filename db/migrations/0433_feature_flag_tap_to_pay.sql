-- 0433_feature_flag_tap_to_pay
-- Stage 15 task 15.11 · CT-F09 (the platform switch for Tap to Pay).
--
-- Tap to Pay on a staff phone (Stripe Terminal, card-present) has its own platform-level kill
-- switch, off by default — 0433 does not enable a live charge on its own: `flagIsOn` returning
-- false hides the setup and refuses the tap route; even with the flag ON, the actual charge is
-- STILL refused while `KEYSTONE_STRIPE_CHARGES_ENABLED` is false (hard limit 1).
--
-- ★★★ SAME BRACKET IDIOM AS 0316 (`0316_feature_flag_public_booking_enabled.sql`), copied verbatim
--    in shape, not written from this description: `keystone.feature_flag` (0213) is ENABLE+FORCE
--    with exactly one policy, `feature_flag_read` (SELECT only) — 0213:163-164, "the flag
--    vocabulary must be migration-only" — so there is deliberately no INSERT policy and no INSERT
--    grant for anyone but the migration role. A bare INSERT here fails with "new row violates
--    row-level security policy for table feature_flag" — suspend FORCE, seed, restore FORCE, and
--    assert it came back, exactly as 0189/0194/0195/0196/0197/0218/0316 already do for this same
--    situation.
--
-- ★ `key` must match `^[a-z][a-z0-9_]*$` (0213:40, MEASURED) — `tap_to_pay_enabled` does.

ALTER TABLE keystone.feature_flag NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.feature_flag (key, description, default_on) VALUES
  ('tap_to_pay_enabled', 'Tap to Pay on a staff phone (Stripe Terminal, card-present). Off hides the setup and refuses the tap route; the charge itself is still refused while KEYSTONE_STRIPE_CHARGES_ENABLED is false.', false)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.feature_flag FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    "the flag vocabulary must be migration-only" and every later migration/gate would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0433: FORCE ROW LEVEL SECURITY was not restored on keystone.feature_flag';
  END IF;
END $$;

-- Written, not applied.
