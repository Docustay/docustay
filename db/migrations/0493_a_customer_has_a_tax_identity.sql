-- 0493 — A CUSTOMER HAS A TAX IDENTITY (Stage 20 task 20.65)
--
-- ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES.
-- A payer account (account or business person) stores their VAT/EIN on the platform.
-- The practice's own tax IDs land in the invoice header via account_tax_ids param.
-- Nonprofit exempt status blocks tax calculation. Tax ID verification state is updated
-- via webhook (customer.tax_id.verification_succeeded / customer.tax_id.verification_failed).
--
-- tax_id TABLE: person|account scoped, RLS enforced, tenant-isolated.
-- app_user.tax_exempt: null|exempt|reverse — controls Stripe's tax_exempt flag on finalize.
--
-- WRITERS:
-- - src/money/taxIds.mjs::createTaxId / updateTaxId / deleteTaxId (CRUD)
-- - src/money/taxIds.mjs::pushTaxIdToStripe (creates Stripe tax_id)
-- - src/payments/webhook.mjs (on customer.tax_id.verification_succeeded|verification_failed)
-- - src/money/invoiceStripe.mjs (reads practice tax_ids on invoice create)

ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.app_user
  ADD COLUMN tax_exempt text NULL CHECK (tax_exempt IN ('exempt', 'reverse', 'none'))
    CONSTRAINT app_user_tax_exempt_null_default DEFAULT NULL;

ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;

-- ── Self-check: app_user.tax_exempt added ─────────────────────────────────────────
DO $check$
DECLARE n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'app_user'
     AND column_name = 'tax_exempt';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0493 self-check: expected tax_exempt column on app_user, found %', n_cols;
  END IF;
END
$check$;

-- ── The tax_id table ──────────────────────────────────────────────────────────────────
CREATE TABLE keystone.tax_id (
  id                   uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id            uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  subject_type         text        NOT NULL CHECK (subject_type IN ('person', 'account')),
  subject_id           uuid        NOT NULL,
  stripe_tax_id        text        NULL,                           -- Stripe tax_id object id
  type                 text        NOT NULL,                       -- us_ein, eu_vat, etc.
  value                text        NOT NULL,                       -- the actual EIN/VAT number
  verification_state   text        NULL,                           -- verified, unverified, unavailable
  created_by           uuid        NULL                            -- admin creating it
);

CREATE INDEX tax_id_subject_idx ON keystone.tax_id (tenant_id, subject_type, subject_id);
CREATE INDEX tax_id_stripe_idx ON keystone.tax_id (tenant_id, stripe_tax_id)
  WHERE stripe_tax_id IS NOT NULL;

ALTER TABLE keystone.tax_id ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.tax_id FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.tax_id USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.tax_id FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.tax_id FOR UPDATE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_delete    ON keystone.tax_id FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.tax_id TO app_rw;

-- ── Reference guard (CT-F52 §3.2) ─────────────────────────────────────
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER tax_id_refuse_reference_delete_trg AFTER DELETE ON keystone.tax_id
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.tax_id ENABLE ALWAYS TRIGGER tax_id_refuse_reference_delete_trg;
CREATE TRIGGER tax_id_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.tax_id
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.tax_id ENABLE ALWAYS TRIGGER tax_id_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.tax_id TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.tax_id FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ── Self-check: tax_id table structure ──────────────────────────────────────────────────
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.tax_id'::regclass) THEN
    RAISE EXCEPTION '0493: tax_id is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'tax_id'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','tenant_delete','reference_guard_read');
  IF n <> 5 THEN
    RAISE EXCEPTION '0493: expected 5 policies on tax_id, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.tax_id'::regclass
     AND tgname IN ('tax_id_refuse_reference_delete_trg','tax_id_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0493: both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS, found %', n;
  END IF;

  -- Positive controls
  IF NOT has_table_privilege('app_rw', 'keystone.tax_id', 'SELECT') THEN
    RAISE EXCEPTION '0493: app_rw is missing SELECT on tax_id';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.tax_id', 'INSERT') THEN
    RAISE EXCEPTION '0493: app_rw is missing INSERT on tax_id';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.tax_id', 'UPDATE') THEN
    RAISE EXCEPTION '0493: app_rw is missing UPDATE on tax_id';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.tax_id', 'DELETE') THEN
    RAISE EXCEPTION '0493: app_rw is missing DELETE on tax_id';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.tax_id', 'SELECT') THEN
    RAISE EXCEPTION '0493: reference_guard is missing SELECT on tax_id';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
