-- 0492 · DISCOUNTS ARE PLURAL (Task 20.64 — Stage 20, 25 Sep 2026)
--
-- ★★★ THE VOCABULARY (F20 §3): An invoice/subscription may have multiple coupons applied
--     (via invoice_discount and subscription_discounts arrays). A coupon may be applied
--     to a PERSON (app_user.applied_coupon_id), applies_to product restrictions are pushed
--     to Stripe on coupon create, and promotion_code restrictions (first_time, minimum_amount)
--     are pushed on code create.
--
-- SCHEMA CHANGES:
--   · NEW: keystone.invoice_discount(id, tenant_id, invoice_id FK, coupon_id FK, position)
--          with UNIQUE(invoice_id, coupon_id)
--   · NEW: app_user.applied_coupon_id uuid NULL FK to coupon
--   · NEW: subscription.subscription_discounts jsonb NULL (array of coupon IDs)
--   · REFRESH: coupon.applies_to (SERVICE LINKS via 0410's target_ids → Stripe product IDs)
--   · REFRESH: promotion_code.restrictions (first_time_transaction, minimum_amount)

ALTER TABLE keystone.invoice NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.mainstay_subscription NO FORCE ROW LEVEL SECURITY;

-- Step 1: Create the invoice_discount table
CREATE TABLE keystone.invoice_discount (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  invoice_id  uuid NOT NULL REFERENCES keystone.invoice(id) ON DELETE CASCADE,
  coupon_id   uuid NOT NULL REFERENCES keystone.coupon(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, coupon_id)
);

CREATE INDEX invoice_discount_tenant_idx ON keystone.invoice_discount (tenant_id);
CREATE INDEX invoice_discount_invoice_idx ON keystone.invoice_discount (tenant_id, invoice_id);
CREATE INDEX invoice_discount_coupon_idx ON keystone.invoice_discount (tenant_id, coupon_id);

ALTER TABLE keystone.invoice_discount ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.invoice_discount FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.invoice_discount
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.invoice_discount
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.invoice_discount
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.invoice_discount
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.invoice_discount TO app_rw;

-- ★ REHEARSAL FIX: CT-F52 points 3 and 5 for invoice_discount (catalog-conformance requires both).
CREATE POLICY reference_guard_read ON keystone.invoice_discount FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT ON keystone.invoice_discount TO reference_guard;
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER invoice_discount_refuse_reference_delete_trg AFTER DELETE ON keystone.invoice_discount
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.invoice_discount ENABLE ALWAYS TRIGGER invoice_discount_refuse_reference_delete_trg;
CREATE TRIGGER invoice_discount_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.invoice_discount
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.invoice_discount ENABLE ALWAYS TRIGGER invoice_discount_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- Step 2: Add applied_coupon_id to app_user
ALTER TABLE keystone.app_user
  ADD COLUMN applied_coupon_id uuid NULL REFERENCES keystone.coupon(id) ON DELETE SET NULL;

-- Step 3: Add subscription_discounts to mainstay_subscription
ALTER TABLE keystone.mainstay_subscription
  ADD COLUMN subscription_discounts jsonb NULL
    CHECK (subscription_discounts IS NULL OR jsonb_typeof(subscription_discounts) = 'array');

-- ── Self-check (run while NO FORCE is still in effect, the migration role owns the tables). ──
DO $check$
DECLARE
  n_inv_cols integer;
  n_user_cols integer;
  n_sub_cols integer;
BEGIN
  -- Check invoice_discount exists with expected columns
  SELECT count(*) INTO n_inv_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'invoice_discount'
     AND column_name IN ('id', 'tenant_id', 'invoice_id', 'coupon_id', 'position');
  IF n_inv_cols <> 5 THEN
    RAISE EXCEPTION '0492 self-check: expected 5 invoice_discount columns, found %', n_inv_cols;
  END IF;

  -- Check app_user has applied_coupon_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'app_user'
       AND column_name = 'applied_coupon_id'
  ) THEN
    RAISE EXCEPTION '0492 self-check: app_user.applied_coupon_id column not created';
  END IF;

  -- Check mainstay_subscription has subscription_discounts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'mainstay_subscription'
       AND column_name = 'subscription_discounts'
  ) THEN
    RAISE EXCEPTION '0492 self-check: mainstay_subscription.subscription_discounts column not created';
  END IF;

  -- ★ REHEARSAL FIX (25 Sep 2026): the first draft inserted invented ids (tenant 00000000-…),
  --   which fail the tenant/invoice/coupon FKs before the UNIQUE is ever reached — a control that
  --   could not fail for the reason it names. With no real invoice+coupon pair to exercise, the
  --   constraint's SHAPE is proved from the catalogue: a UNIQUE on exactly (invoice_id, coupon_id).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'keystone.invoice_discount'::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['coupon_id','invoice_id']
  ) THEN
    RAISE EXCEPTION '0492 self-check: invoice_discount has no UNIQUE (invoice_id, coupon_id)';
  END IF;
END
$check$;

ALTER TABLE keystone.invoice FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.mainstay_subscription FORCE ROW LEVEL SECURITY;

-- ── Prove FORCE survived the ALTERs. ──────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'invoice_discount';
  IF NOT forced THEN
    RAISE EXCEPTION '0492 self-check: RLS is no longer FORCED on invoice_discount';
  END IF;

  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'app_user';
  IF NOT forced THEN
    RAISE EXCEPTION '0492 self-check: RLS is no longer FORCED on app_user';
  END IF;

  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'mainstay_subscription';
  IF NOT forced THEN
    RAISE EXCEPTION '0492 self-check: RLS is no longer FORCED on mainstay_subscription';
  END IF;
END
$rls$;

COMMENT ON TABLE keystone.invoice_discount IS
  'F20 §3: Many coupons per invoice, each applied via the editor route. position: order in the discounts array.';
COMMENT ON COLUMN keystone.app_user.applied_coupon_id IS
  'F20 §3: A coupon applied to this person (coach → Stripe customer.discount). Appears on their next subscription create.';
COMMENT ON COLUMN keystone.mainstay_subscription.subscription_discounts IS
  'F20 §3: Array of coupon IDs applied at subscription create. Pushes as invoice_discount.coupon_id array.';
