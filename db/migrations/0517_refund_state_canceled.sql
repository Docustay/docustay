-- 0517_refund_state_canceled — P3.S10 — Cancel a pending refund.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS BUILDS. `keystone.refund.state` widens to admit `canceled` (same idiom 0518 uses
--     on `keystone.estimate.status`: every existing value carried forward, one value added).
--     `refund_state_check` is the live, auto-named constraint from 0352's inline
--     `CHECK (state IN ('pending', 'succeeded', 'failed'))` on `keystone.refund.state` (Postgres
--     names an inline CHECK `<table>_<column>_check` when it is not given an explicit name) — no
--     other migration has touched it since (grep across `db/migrations/*.sql` for the name turns
--     up only 0352's create).
-- ★ Idempotent: the CHECK swap is guarded by a check for `canceled` already being present in the
--   live constraint definition; the DROP is `IF EXISTS`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.refund'::regclass
       AND conname  = 'refund_state_check'
       AND pg_get_constraintdef(oid) LIKE '%canceled%'
  ) THEN
    ALTER TABLE keystone.refund DROP CONSTRAINT IF EXISTS refund_state_check;
    ALTER TABLE keystone.refund ADD CONSTRAINT refund_state_check
      CHECK (state = ANY (ARRAY['pending','succeeded','failed','canceled']));
  END IF;
END
$$;

-- §a · shape check, with a positive control.
DO $$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'keystone.refund'::regclass AND conname = 'refund_state_check')
     NOT LIKE '%canceled%' THEN
    RAISE EXCEPTION '0517: refund_state_check does not admit canceled';
  END IF;

  -- ★ Positive control: the ORIGINAL values are still legal too — a widening, not a replacement.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conrelid = 'keystone.refund'::regclass AND conname = 'refund_state_check')
     NOT LIKE '%pending%' THEN
    RAISE EXCEPTION '0517: refund_state_check lost an existing value — this must be a widening';
  END IF;

  RAISE NOTICE '0517: refund.state admits canceled.';
END
$$;


-- Written, not applied.
