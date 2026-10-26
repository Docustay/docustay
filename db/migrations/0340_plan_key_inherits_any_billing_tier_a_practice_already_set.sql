-- 0340_plan_key_inherits_any_billing_tier_a_practice_already_set
-- Spec 06 (Settings) §3, task 6.1. Ty's ruling, 22 Sep 2026: "plan_key wins over billing.tier,
-- everywhere." Added 22 Sep 2026, closes CT-111's open reconciliation question
-- (CONTRACTS-FEATURES.md) and references/gap-list.md FINDING 6 of 9 (Option A — plan_key replaces
-- billing.tier outright, with a backfill).
--
-- Runs after 0334 has seeded every tenant with its default plan_key ('solo' for everyone except
-- GLRS, already 'founder'): for any tenant that already held an explicit 'billing.tier'
-- tenant_setting row (src/settings/keys.mjs:282, its only reader/writer today — retired by this
-- ruling for this purpose), that value overwrites the seeded default. 'billing.tier''s own
-- vocabulary has no 'founder' member, so no existing row can accidentally downgrade GLRS's seeded
-- 'founder' plan — the WHERE ts.value #>> '{}' IN (...) list is billing.tier's exact four-value
-- CHECK, not plan_key's wider five-value one, on purpose. The tenant_setting row itself is
-- untouched — not deleted, not marked read — it simply stops being read for this purpose from this
-- point forward (§11). One-time reconciliation, not an ongoing sync (CT-110's "mirror written once,
-- on success, never computed live" discipline).
--
-- ★★★ F490/F143 — same bracket pattern as 0334/0010: db/migrate.mjs runs every migration as
--     app_owner with no tenant GUC set, and both tables touched here (mainstay_subscription,
--     tenant_setting) are FORCE ROW LEVEL SECURITY — a bare cross-tenant UPDATE would match zero
--     rows and commit silently. Suspend FORCE on both for the statement, restore both in the same
--     transaction, and prove both came back.
ALTER TABLE keystone.mainstay_subscription NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_setting        NO FORCE ROW LEVEL SECURITY;

-- ★ The UPDATE runs INSIDE this block (not as a separate top-level statement) so that
--   GET DIAGNOSTICS ... = ROW_COUNT, immediately after it, reflects THIS statement's row count —
--   GET DIAGNOSTICS reads the most recently executed command within the SAME PL/pgSQL block, not
--   an earlier top-level statement outside it.
DO $$
DECLARE v_updated integer;
BEGIN
  UPDATE keystone.mainstay_subscription ms
  SET plan_key = ts.value #>> '{}'
  FROM keystone.tenant_setting ts
  WHERE ts.tenant_id = ms.tenant_id
    AND ts.key = 'billing.tier'
    AND ts.value #>> '{}' IN ('solo', 'practice', 'group', 'enterprise')
    AND ms.plan_key IS DISTINCT FROM ts.value #>> '{}';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '0340: % mainstay_subscription row(s) had plan_key overwritten by a pre-existing billing.tier tenant_setting value', v_updated;
END
$$;

ALTER TABLE keystone.mainstay_subscription FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_setting        FORCE ROW LEVEL SECURITY;

-- ★★ Prove FORCE is back on for both tables before going any further — leaving either off would
-- silently disable tenant isolation and every later migration and gate would still pass.
DO $$
DECLARE forced_sub boolean; forced_ts boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced_sub FROM pg_class WHERE oid = 'keystone.mainstay_subscription'::regclass;
  SELECT relforcerowsecurity INTO forced_ts  FROM pg_class WHERE oid = 'keystone.tenant_setting'::regclass;
  IF NOT forced_sub THEN
    RAISE EXCEPTION '0340: FORCE ROW LEVEL SECURITY was not restored on keystone.mainstay_subscription';
  END IF;
  IF NOT forced_ts THEN
    RAISE EXCEPTION '0340: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant_setting';
  END IF;
END
$$;
