-- 0519_plan_drops_single_service_columns — M2 (F805).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ A PLAN'S SESSIONS LIVE IN `plan_line` ONLY, NOW THAT THE READER IS REPOINTED.
-- 0267 gave `keystone.plan` a single `service_id`/`sessions_included` pair, meaning a plan could
-- only ever grant sessions of ONE service. 0514 added `keystone.plan_line` (one row per service,
-- `quantity_per_cycle` NULL = unlimited) and backfilled it from the old pair. This migration is the
-- other half of that move: the old pair is dropped from `plan` now that createPlan (src/items/
-- writes.mjs), the editor's "used in N plans" count (src/items/editors.mjs) and the cancel-refund
-- read (src/money/subscriptions.mjs) no longer write or read it.
-- ★★ `rollover_mode`/`rollover_cap` (also 0267) are UNCHANGED — they describe what happens to
--    UNUSED sessions across every line on the plan, not which service a line is for, and stay.
-- ★ Applied only at step 3 TEST, after 0514's backfill has already run (BUILD-PROCESS.md).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════


ALTER TABLE keystone.plan DROP CONSTRAINT IF EXISTS plan_sessions_need_service;
ALTER TABLE keystone.plan DROP COLUMN IF EXISTS service_id, DROP COLUMN IF EXISTS sessions_included;

-- §a · shape check — the two columns and the CHECK that named them are gone; rollover stays.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'plan'
       AND column_name IN ('service_id', 'sessions_included')
  ) THEN
    RAISE EXCEPTION '0519: keystone.plan still has service_id or sessions_included after DROP COLUMN';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.plan'::regclass AND conname = 'plan_sessions_need_service'
  ) THEN
    RAISE EXCEPTION '0519: plan_sessions_need_service still exists after DROP CONSTRAINT';
  END IF;

  -- ★ Positive control: rollover_mode/rollover_cap are untouched by this migration.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'plan'
       AND column_name IN ('rollover_mode', 'rollover_cap')
     HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION '0519: rollover_mode/rollover_cap must survive this migration — it drops the single-service pair only';
  END IF;

  RAISE NOTICE '0519: keystone.plan no longer carries service_id/sessions_included; rollover_mode/rollover_cap untouched.';
END
$$;


-- Written, not applied.
