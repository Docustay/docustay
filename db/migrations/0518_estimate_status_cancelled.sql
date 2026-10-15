-- 0518_estimate_status_cancelled — P3.S9 — Cancel an estimate (staff side).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS BUILDS. `keystone.estimate.status` widens to admit `cancelled` (same idiom 0309/0510
--     already use on other CHECKed status columns: every existing value carried forward, one value
--     added) and a new `cancelled_at timestamptz NULL` column, paired with a CHECK that keeps the two
--     in lockstep — `(status = 'cancelled') = (cancelled_at IS NOT NULL)`, the same shape the base
--     table (0428) already uses for `declined`/`declined_at`.
-- ★★ `estimate_status_check` is the live, auto-named constraint from 0428's inline
--    `CHECK (status IN (...))` on `keystone.estimate.status` (Postgres names an inline CHECK
--    `<table>_<column>_check` when it is not given an explicit name) — no other migration has
--    touched it since (grep across `db/migrations/*.sql` for the name turns up only 0428's create).
-- ★ Idempotent: the CHECK swap is guarded by a check for `cancelled` already being present in the
--   live constraint definition; the new column uses `ADD COLUMN IF NOT EXISTS`; the new CHECK is
--   guarded by a check for its own name already existing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- §a · the CHECK swap on `status`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.estimate'::regclass
       AND conname  = 'estimate_status_check'
       AND pg_get_constraintdef(oid) LIKE '%cancelled%'
  ) THEN
    ALTER TABLE keystone.estimate DROP CONSTRAINT IF EXISTS estimate_status_check;
    ALTER TABLE keystone.estimate ADD CONSTRAINT estimate_status_check
      CHECK (status = ANY (ARRAY['draft','sent','opened','accepted','declined','expired',
                                  'converted','cancelled']));
  END IF;
END
$$;

-- §b · the new column.
ALTER TABLE keystone.estimate
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL;

-- §c · the lockstep CHECK, added only if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.estimate'::regclass
       AND conname  = 'estimate_cancelled_at_check'
  ) THEN
    ALTER TABLE keystone.estimate ADD CONSTRAINT estimate_cancelled_at_check
      CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL));
  END IF;
END
$$;

COMMENT ON COLUMN keystone.estimate.cancelled_at IS
  'P3.S9 — set only when status = cancelled: the moment a staff cancel (or its Stripe Quote
   cancellation) took effect. NULL otherwise. src/money/estimates.mjs cancelEstimate sets both
   together inside the same UPDATE.';

-- §d · shape check, with positive controls.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'estimate' AND column_name = 'cancelled_at'
  ) THEN
    RAISE EXCEPTION '0518: keystone.estimate.cancelled_at missing after ALTER';
  END IF;

  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'keystone.estimate'::regclass AND conname = 'estimate_status_check')
     NOT LIKE '%cancelled%' THEN
    RAISE EXCEPTION '0518: estimate_status_check does not admit cancelled';
  END IF;

  -- ★ Positive control: the ORIGINAL values are still legal too — a widening, not a replacement.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'keystone.estimate'::regclass AND conname = 'estimate_status_check')
     NOT LIKE '%accepted%' THEN
    RAISE EXCEPTION '0518: estimate_status_check lost an existing value — this must be a widening';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.estimate'::regclass AND conname = 'estimate_cancelled_at_check'
  ) THEN
    RAISE EXCEPTION '0518: estimate_cancelled_at_check is missing';
  END IF;

  RAISE NOTICE '0518: estimate.status admits cancelled; cancelled_at + its lockstep CHECK present.';
END
$$;


-- Written, not applied.
