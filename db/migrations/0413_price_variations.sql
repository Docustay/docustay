-- 0413_price_variations — Stage 14 task 14.6 · CT-F22 (R-14.6)
--
-- A price row may apply to one location and/or one delivery mode; the most-specific active row
-- wins. `keystone.location` was built by Stage 12's task 12.2 (migration 0381).
--
-- ★ ADD COLUMN only, against `keystone.price`, which already carries RLS, tenant policies and a
--   TABLE-LEVEL app_rw grant (`GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.price TO app_rw`,
--   0015 §8) — a new column inherits it. No re-grant, no re-policy, no CT-F52 checklist: that
--   checklist is for a NEW table, and this migration creates none.
--
-- ★★★ §Z4 STANDING RULE, UNCHANGED BY THIS MIGRATION: a definition carries no price, a new price
--     is a NEW ROW, and the old row is never edited (0024's `price_is_append_only` trigger, which
--     this migration does not touch). Both new columns are NULLable, added to a table whose 6
--     production rows are all `active` and open (§0.3) — the widening is metadata-only and no
--     existing row's amount, currency, subject or window changes.

DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0413: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
  IF to_regclass('keystone.price') IS NULL THEN
    RAISE EXCEPTION '0413: keystone.price does not exist';
  END IF;
  IF to_regclass('keystone.location') IS NULL THEN
    RAISE EXCEPTION '0413: keystone.location does not exist — Stage 12''s 12.2 (migration 0381) must run first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'price'
       AND column_name IN ('location_id', 'delivery_mode')
  ) THEN
    RAISE EXCEPTION '0413: keystone.price already carries location_id or delivery_mode — check for a duplicate run';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · the two columns
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.price
  ADD COLUMN location_id   uuid NULL,
  ADD COLUMN delivery_mode text NULL
    CONSTRAINT price_delivery_mode_check
      CHECK (delivery_mode IS NULL OR delivery_mode IN ('in_person', 'video', 'at_client'));

ALTER TABLE keystone.price
  ADD CONSTRAINT price_location_id_fkey FOREIGN KEY (tenant_id, location_id)
    REFERENCES keystone.location (tenant_id, id) ON DELETE RESTRICT;

COMMENT ON COLUMN keystone.price.location_id IS
  '14.6 — optional: this price row applies only when the booking is at this location. NULL = every location. FK target keystone.location(tenant_id,id) — the location_tenant_id_key unique index 12.2 (0381) creates.';
COMMENT ON COLUMN keystone.price.delivery_mode IS
  '14.6 — optional: this price row applies only to this delivery mode. NULL = every mode.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · ONE OPEN ROW PER (subject, location, mode) COMBINATION — not one per subject.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ A base price, a per-location override and a per-mode override may all be open on the same
--   subject at once — that IS the feature (field 1: "most-specific active row wins"). NULLs are
--   coalesced to sentinels because two NULLs are never equal to a UNIQUE index, so without the
--   coalesce this index would allow unlimited base (NULL, NULL) rows open at once instead of one.
CREATE UNIQUE INDEX price_variation_one_open
  ON keystone.price (
    tenant_id, subject_type, subject_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(delivery_mode, '')
  )
  WHERE active AND effective_to IS NULL;

COMMENT ON INDEX keystone.price_variation_one_open IS
  '14.6 — exactly one OPEN active price row per (subject, location, mode) combination. NULL location/mode coalesced to a sentinel so the base (NULL, NULL) combination is bounded too.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · current_price — resolution widened, existing callers unchanged
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ (location AND mode) > location > mode > base. `p_location`/`p_mode` default NULL, which only
--    ever matches tier 4 (base) — the exact, unchanged behaviour every existing caller
--    (`src/records/lists/items.mjs:101-114`) already relies on.
CREATE OR REPLACE FUNCTION keystone.current_price(
  p_subject_type text, p_subject_id uuid, p_at timestamptz DEFAULT now(),
  p_location uuid DEFAULT NULL, p_mode text DEFAULT NULL
) RETURNS TABLE (amount_minor integer, currency text, price_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT ranked.amount_minor, ranked.currency, ranked.id
    FROM (
      SELECT p.amount_minor, p.currency, p.id, p.effective_from,
             CASE
               WHEN p_location IS NOT NULL AND p_mode IS NOT NULL
                    AND p.location_id = p_location AND p.delivery_mode = p_mode THEN 1
               WHEN p_location IS NOT NULL
                    AND p.location_id = p_location AND p.delivery_mode IS NULL THEN 2
               WHEN p_mode IS NOT NULL
                    AND p.location_id IS NULL AND p.delivery_mode = p_mode THEN 3
               WHEN p.location_id IS NULL AND p.delivery_mode IS NULL THEN 4
             END AS specificity
        FROM keystone.price p
       WHERE p.tenant_id = keystone.current_tenant_id()
         AND p.subject_type = p_subject_type
         AND p.subject_id   = p_subject_id
         AND p.active
         AND p.effective_from <= p_at
         AND (p.effective_to IS NULL OR p.effective_to > p_at)
    ) ranked
   WHERE ranked.specificity IS NOT NULL
   ORDER BY ranked.specificity ASC, ranked.effective_from DESC
   LIMIT 1
$$;

COMMENT ON FUNCTION keystone.current_price(text, uuid, timestamptz, uuid, text) IS
  '§Z4, widened by 14.6 — "what does this cost right now?", optionally at a location and/or delivery mode. Resolution: (location AND mode) > location > mode > base. Existing 3-arg callers are unaffected: p_location/p_mode default NULL and only ever match the base tier.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · SHAPE CHECK — positive controls alongside the negatives (0410's pattern).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $shape_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'price' AND column_name = 'location_id'
  ) THEN
    RAISE EXCEPTION '0413: keystone.price.location_id does not exist after ALTER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'price' AND column_name = 'delivery_mode'
  ) THEN
    RAISE EXCEPTION '0413: keystone.price.delivery_mode does not exist after ALTER';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('price_delivery_mode_check', 'price_location_id_fkey')) <> 2 THEN
    RAISE EXCEPTION '0413: one or both named constraints did not get created';
  END IF;

  IF to_regclass('keystone.price_variation_one_open') IS NULL THEN
    RAISE EXCEPTION '0413: keystone.price_variation_one_open index does not exist';
  END IF;

  -- Positive control alongside the negative: app_rw DOES hold UPDATE on the new columns — the
  -- table-level grant extends to them automatically, no re-grant needed.
  IF NOT has_column_privilege('app_rw', 'keystone.price', 'location_id', 'SELECT') THEN
    RAISE EXCEPTION '0413: app_rw cannot SELECT keystone.price.location_id — the table-level grant did not extend to the new column';
  END IF;
  IF NOT has_column_privilege('app_rw', 'keystone.price', 'delivery_mode', 'UPDATE') THEN
    RAISE EXCEPTION '0413: app_rw cannot UPDATE keystone.price.delivery_mode — the table-level grant did not extend to the new column';
  END IF;

  RAISE NOTICE '0413: keystone.price carries location_id + delivery_mode, price_variation_one_open exists, current_price() resolves (location AND mode) > location > mode > base.';
END
$shape_check$;

-- Written, not applied.
