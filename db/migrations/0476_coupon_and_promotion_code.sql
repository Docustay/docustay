-- 0476 · DISCOUNT BECOMES COUPON + PROMOTION_CODE (Task 20.7 — F16 §3, 25 Sep 2026)
--
-- ★★★ THE VOCABULARY (F16 §2.3, §3): "A coupon is the rule. A code is what someone types."
--     One coupon may have many promotion codes (e.g., SPRING20, SPRING20_EMAIL, EARLY_SPRING).
--     The single `code` field on the old `discount` row becomes one promotion_code child row.
--     This migration renames the table and splits the one-code-per-discount assumption.
--
-- ★★★ BACKFILL ORDER IS THE WHOLE RISK: copy the columns into `promotion_code` FIRST,
--     verify the copied row count equals the source count INSIDE the migration,
--     and ONLY then DROP `coupon.code` and `coupon.stripe_promotion_code_id`.
--     A drop before a verified copy is unrecoverable data loss.

-- Step 1: Disable RLS so migration can work on the table
ALTER TABLE keystone.discount NO FORCE ROW LEVEL SECURITY;

-- Step 2: Rename the table from discount to coupon
ALTER TABLE keystone.discount RENAME TO coupon;

-- Step 3: Create the new promotion_code table with RLS
CREATE TABLE keystone.promotion_code (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  coupon_id                   uuid NOT NULL REFERENCES keystone.coupon(id) ON DELETE CASCADE,
  code                        text NOT NULL CHECK (btrim(code) <> ''),
  active                      boolean NOT NULL DEFAULT true,
  stripe_promotion_code_id    text NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX promotion_code_tenant_idx ON keystone.promotion_code (tenant_id);
CREATE INDEX promotion_code_coupon_idx ON keystone.promotion_code (tenant_id, coupon_id);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline (0334 idiom). ────────────────
ALTER TABLE keystone.promotion_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.promotion_code FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.promotion_code
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.promotion_code
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.promotion_code
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.promotion_code
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.promotion_code TO app_rw;

-- Step 4: Backfill promotion_code rows from coupon.code
--         ★ POSITIVE CONTROL INSIDE DO BLOCK: verify copied count = source count
DO $backfill$
DECLARE
  n_coupons integer;
  n_codes integer;
BEGIN
  -- Count coupons that have a code
  SELECT count(*) INTO n_coupons
    FROM keystone.coupon
   WHERE code IS NOT NULL AND code <> '';

  -- Insert one promotion_code row per coupon with a code
  INSERT INTO keystone.promotion_code
    (tenant_id, coupon_id, code, stripe_promotion_code_id, active)
  SELECT tenant_id, id, code, stripe_promotion_code_id, true
    FROM keystone.coupon
   WHERE code IS NOT NULL AND code <> '';

  -- Count what was actually inserted
  SELECT count(*) INTO n_codes
    FROM keystone.promotion_code;

  -- ★ SELF-CHECK: backfill count must equal source count
  IF n_codes <> n_coupons THEN
    RAISE EXCEPTION '0476 backfill self-check FAILED: expected % promotion_code rows, got %',
      n_coupons, n_codes;
  END IF;
END
$backfill$;

-- Step 5: Drop the old columns from coupon now that they are backed up
ALTER TABLE keystone.coupon DROP COLUMN code;
ALTER TABLE keystone.coupon DROP COLUMN stripe_promotion_code_id;

-- Step 6: Re-enable RLS on coupon (NO FORCE first, then FORCE)
ALTER TABLE keystone.coupon FORCE ROW LEVEL SECURITY;

-- Step 7: Final self-check — both tables exist with correct shapes
DO $final$
DECLARE
  n_coupon_cols integer;
  n_code_cols integer;
  forced boolean;
BEGIN
  -- Check coupon has expected columns
  SELECT count(*) INTO n_coupon_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'coupon'
     AND column_name IN ('id', 'tenant_id', 'name', 'kind', 'percent_bp', 'amount_minor', 'currency', 'valid_to', 'stripe_coupon_id', 'active', 'created_at', 'updated_at');
  IF n_coupon_cols < 10 THEN
    RAISE EXCEPTION '0476 self-check: coupon table missing expected columns (found %)', n_coupon_cols;
  END IF;

  -- Check promotion_code exists with expected columns
  SELECT count(*) INTO n_code_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'promotion_code'
     AND column_name IN ('id', 'tenant_id', 'coupon_id', 'code', 'active', 'stripe_promotion_code_id', 'created_at');
  IF n_code_cols < 7 THEN
    RAISE EXCEPTION '0476 self-check: promotion_code table missing expected columns (found %)', n_code_cols;
  END IF;

  -- Check coupon RLS is FORCED
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'coupon';
  IF NOT forced THEN
    RAISE EXCEPTION '0476 self-check: RLS is no longer FORCED on coupon';
  END IF;

  -- Check promotion_code RLS is FORCED
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'promotion_code';
  IF NOT forced THEN
    RAISE EXCEPTION '0476 self-check: RLS is no longer FORCED on promotion_code';
  END IF;
END
$final$;

COMMENT ON TABLE keystone.coupon IS
  'F16 §3: A coupon is the rule (percent_off or amount_off). Promotion codes are the codes customers type.';
COMMENT ON TABLE keystone.promotion_code IS
  'F16 §3: A promotion code is one of the codes a customer can type to redeem a coupon rule.';
COMMENT ON COLUMN keystone.promotion_code.coupon_id IS
  'The coupon rule this code redeems.';
