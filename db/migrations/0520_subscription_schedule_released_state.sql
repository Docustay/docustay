-- 0520_subscription_schedule_released_state — L5.3 — subscription_schedule.state admits 'released'.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS BUILDS. `keystone.subscription_schedule.state`'s CHECK constraint (0430:60, table
--     then named `payment_plan`; never widened by 0478's rename) admits five values —
--     'offered','agreed','completed','cancelled','defaulted' — and `releasePaymentPlan()`
--     (src/money/paymentPlans.mjs:474) already writes `state = 'released'`, a write that
--     constraint refuses today. This widens the CHECK, same idiom as 0518 on
--     `keystone.estimate.status`: every existing value carried forward, one value added, nothing
--     removed.
-- ★★ 'released' IS NOT 'cancelled'. Stripe's subscription_schedule `released` status means the
--    schedule stops managing the subscription and the SUBSCRIPTION CONTINUES; `cancelled` means the
--    subscription itself stopped. Collapsing the two would make `releasePaymentPlan` (and the
--    webhook mirror in src/money/paymentPlans.mjs, L5.3) lie about which one happened.
-- ★ THE REAL CONSTRAINT NAME IS LOOKED UP DYNAMICALLY, not hardcoded — 0478 renamed the TABLE
--   (`payment_plan` → `subscription_schedule`) but a table rename does not rename a table's own
--   constraints in Postgres, and 0478 never explicitly renamed this particular CHECK (it only
--   renamed the child-table FK and a column, 0478:21-30). So the live name may still carry the old
--   table's name. The lookup below finds it by its DEFINITION instead: the literal `'defaulted'`
--   value appears ONLY in this enum CHECK, never in the sibling `(state = 'offered') = (agreed_at
--   IS NULL)` lockstep CHECK also sitting on this column (0430:75) — that one never mentions
--   `defaulted` — so matching on the quoted literal disambiguates the two without assuming a name.
-- ★ Idempotent: the swap only runs if `released` is not already present in the live definition; the
--   replacement constraint is only added if a constraint of that name does not already exist.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- §a · find the real constraint by its definition (not by an assumed name) and widen it.
DO $$
DECLARE
  v_conname text;
  v_def     text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_conname, v_def
    FROM pg_constraint
   WHERE conrelid = 'keystone.subscription_schedule'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) LIKE '%''defaulted''%';

  IF v_conname IS NULL THEN
    RAISE EXCEPTION '0520: no CHECK constraint enumerating subscription_schedule.state values found (expected one mentioning ''defaulted'')';
  END IF;

  IF v_def NOT LIKE '%released%' THEN
    EXECUTE format('ALTER TABLE keystone.subscription_schedule DROP CONSTRAINT %I', v_conname);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'keystone.subscription_schedule'::regclass
         AND conname  = 'subscription_schedule_state_check'
    ) THEN
      ALTER TABLE keystone.subscription_schedule ADD CONSTRAINT subscription_schedule_state_check
        CHECK (state IN ('offered','agreed','completed','cancelled','defaulted','released'));
    END IF;
  END IF;
END
$$;

-- §b · self-check, with positive controls — a widening, not a replacement.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'keystone.subscription_schedule'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) LIKE '%''defaulted''%';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK constraint not found after the swap';
  END IF;

  IF v_def NOT LIKE '%released%' THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK does not admit released';
  END IF;

  -- ★ Positive controls: the ORIGINAL five values are still legal too.
  IF v_def NOT LIKE '%offered%' THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK lost offered — this must be a widening';
  END IF;
  IF v_def NOT LIKE '%agreed%' THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK lost agreed — this must be a widening';
  END IF;
  IF v_def NOT LIKE '%completed%' THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK lost completed — this must be a widening';
  END IF;
  IF v_def NOT LIKE '%cancelled%' THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK lost cancelled — this must be a widening';
  END IF;
  IF v_def NOT LIKE '%defaulted%' THEN
    RAISE EXCEPTION '0520: subscription_schedule.state CHECK lost defaulted — this must be a widening';
  END IF;

  RAISE NOTICE '0520: subscription_schedule.state admits released; the five original values remain.';
END
$$;


-- Written, not applied.
