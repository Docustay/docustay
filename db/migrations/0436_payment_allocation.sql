-- 0436_payment_allocation
-- Stage 15 task 15.65 — client-portal money: allocate client payments across multiple invoices.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT THIS BUILDS: a new `keystone.payment_allocation` table that maps a single Stripe
-- PaymentIntent (group_id) across multiple invoices a payer is settling in one action.
--
-- IDEMPOTENCY: The `UNIQUE (tenant_id, group_id, invoice_id)` constraint is THE IDEMPOTENCY
-- MECHANISM — a redelivered webhook cannot create a second allocation row for the same invoice
-- within a group, and a retried create cannot double-bill one invoice inside a group.
--
-- COMPOSITE FKs: ALL THREE FKs ARE COMPOSITE (tenant_id, X) — a single-column REFERENCES would
-- let a row in tenant A point at data in tenant B, a tenant isolation hole on a FORCE-RLS schema.
--
-- RLS: The `tenant_isolation` SELECT policy carries the 0196 money shape — a payer reads their
-- own allocations, staff read via the invoice grant.
--
-- 0423 IS THE STAGE'S FIRST MIGRATION AND IT CREATES THE `payment (tenant_id, id)` UNIQUE INDEX,
-- AS ITS OPENING STATEMENT. This migration repeats it IDEMPOTENTLY (IF NOT EXISTS, byte-identical
-- to 0423's and 0425's statement) because 0436 adds a composite FK to `payment`, and every
-- migration in this stage that depends on that index states the dependency rather than inheriting
-- it silently from an earlier file a reader may not have opened.
--
-- CT-F52 CHECKLIST (tenant table):
--   1. ENABLE ROW LEVEL SECURITY **and** FORCE ROW LEVEL SECURITY ✓
--   2. tenant_isolation SELECT policy ✓
--   3. tenant_insert WITH CHECK ✓
--   4. tenant_update USING + WITH CHECK ✓
--   5. NO tenant_delete policy (nothing ever deletes an allocation; abandoned is state='abandoned') ✓
--   6. reference_guard_read SELECT policy ✓
--   7. GRANT SELECT, INSERT, UPDATE (NO DELETE) to app_rw ✓
--   8. refuse_touch_reference_rows triggers (DELETE and TRUNCATE) with ENABLE ALWAYS ✓
--   9. Closing self-check with POSITIVE controls (INSERT true AND DELETE false) ✓
--
-- DATA: `payment_allocation` is a new table, 0 rows, so all rows pass validation trivially.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── IDEMPOTENT OPENING: `payment (tenant_id, id)` UNIQUE INDEX (from 0423, repeated here) ──────
CREATE UNIQUE INDEX IF NOT EXISTS payment_tenant_id_id_key
  ON keystone.payment (tenant_id, id);

-- ── CREATE TABLE WITH ALL CONSTRAINTS ────────────────────────────────────────────────────────
CREATE TABLE keystone.payment_allocation (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  group_id      uuid        NOT NULL,
  invoice_id    uuid        NOT NULL,
  payer_user_id uuid        NOT NULL,
  payment_id    uuid        NULL,
  amount_minor  integer     NOT NULL CHECK (amount_minor > 0),
  currency      text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  state         text        NOT NULL DEFAULT 'intended'
                  CHECK (state IN ('intended','applied','abandoned')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  applied_at    timestamptz NULL,
  FOREIGN KEY (tenant_id, invoice_id)    REFERENCES keystone.invoice(tenant_id, id)  ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payer_user_id) REFERENCES keystone.app_user(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, payment_id)    REFERENCES keystone.payment(tenant_id, id)  ON DELETE RESTRICT,
  CONSTRAINT payment_allocation_applied_shape
    CHECK ((state = 'applied') = (payment_id IS NOT NULL AND applied_at IS NOT NULL)),
  UNIQUE (tenant_id, group_id, invoice_id)
);

-- ── INDEXES ──────────────────────────────────────────────────────────────────────────────────
CREATE INDEX payment_allocation_group   ON keystone.payment_allocation (tenant_id, group_id);
CREATE INDEX payment_allocation_invoice ON keystone.payment_allocation (tenant_id, invoice_id);
CREATE INDEX payment_allocation_pending ON keystone.payment_allocation (tenant_id)
  WHERE state = 'intended';

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payment_allocation FORCE ROW LEVEL SECURITY;

-- ── POLICY: tenant_isolation (SELECT) ────────────────────────────────────────────────────────
-- A payer reads their own allocations, staff read via the invoice grant.
CREATE POLICY tenant_isolation ON keystone.payment_allocation FOR SELECT
  USING (
    tenant_id = keystone.current_tenant_id() AND
    (keystone.user_may(keystone.current_user_id(), 'invoice', 'view', NULL) OR
     payer_user_id = keystone.current_user_id())
  );

-- ── POLICY: tenant_insert ───────────────────────────────────────────────────────────────────
CREATE POLICY tenant_insert ON keystone.payment_allocation FOR INSERT
  WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ── POLICY: tenant_update ───────────────────────────────────────────────────────────────────
CREATE POLICY tenant_update ON keystone.payment_allocation FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ── POLICY: reference_guard_read ────────────────────────────────────────────────────────────
CREATE POLICY reference_guard_read ON keystone.payment_allocation FOR SELECT
  TO reference_guard
  USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE is_reference));

-- ── GRANTS ───────────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON keystone.payment_allocation TO app_rw;
GRANT SELECT ON keystone.payment_allocation TO reference_guard;

-- ── TRIGGERS: refuse_touch_reference_rows ─────────────────────────────────────────────────
-- ★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production): the first draft hand-rolled
--   two private guard functions, one with a schema-qualified transition table
--   (`REFERENCING OLD TABLE AS keystone.…` — a syntax error; transition tables are unqualified) and a
--   truncate guard that refused ANY truncate while any reference tenant existed. Every other table
--   uses the one shared `keystone.refuse_touch_reference_rows()` (0099), and catalog-conformance
--   looks for exactly that function — so this is now the standard CT-F52 idiom, with the lend.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER payment_allocation_refuse_reference_delete_trg
  AFTER DELETE ON keystone.payment_allocation
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_allocation
  ENABLE ALWAYS TRIGGER payment_allocation_refuse_reference_delete_trg;

CREATE TRIGGER payment_allocation_refuse_reference_truncate_trg
  BEFORE TRUNCATE ON keystone.payment_allocation
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_allocation
  ENABLE ALWAYS TRIGGER payment_allocation_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING SELF-CHECK — POSITIVE ASSERTIONS ONLY (what SHOULD be true)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $prove$
DECLARE
  v_force_rls boolean;
  v_can_insert boolean;
  v_can_delete boolean;
  v_has_table boolean;
  v_missing_cols text;
  v_missing_fks integer;
BEGIN
  -- POSITIVE: table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'keystone' AND table_name = 'payment_allocation'
  ) INTO v_has_table;
  IF NOT v_has_table THEN
    RAISE EXCEPTION '0436: payment_allocation table does not exist';
  END IF;

  -- POSITIVE: FORCE ROW LEVEL SECURITY is on
  SELECT relforcerowsecurity FROM pg_class
   WHERE oid = 'keystone.payment_allocation'::regclass
   INTO v_force_rls;
  IF NOT v_force_rls THEN
    RAISE EXCEPTION '0436: FORCE ROW LEVEL SECURITY is not enabled on keystone.payment_allocation';
  END IF;

  -- POSITIVE: all required columns exist
  SELECT string_agg(expected.col, ', ') INTO v_missing_cols
    FROM (VALUES
      ('id'), ('tenant_id'), ('group_id'), ('invoice_id'), ('payer_user_id'),
      ('payment_id'), ('amount_minor'), ('currency'), ('state'), ('created_at'), ('applied_at')
    ) AS expected(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'keystone' AND table_name = 'payment_allocation'
        AND column_name = expected.col
   );
  IF v_missing_cols IS NOT NULL THEN
    RAISE EXCEPTION '0436: missing expected column(s): %', v_missing_cols;
  END IF;

  -- POSITIVE: composite FKs exist (3 total)
  SELECT COUNT(*) INTO v_missing_fks
    FROM pg_constraint
   WHERE conrelid = 'keystone.payment_allocation'::regclass
     AND contype = 'f'
     -- ★ REHEARSAL FIX: count the COMPOSITE (tenant_id, x) FKs this comment names — the table also
     --   carries the single-column tenant_id → tenant FK every table has, which made the count 4.
     AND array_length(conkey, 1) = 2;
  IF v_missing_fks <> 3 THEN
    RAISE EXCEPTION '0436: expected 3 composite foreign keys, found %', v_missing_fks;
  END IF;

  -- POSITIVE: app_rw can INSERT
  SELECT has_table_privilege('app_rw', 'keystone.payment_allocation', 'INSERT')
   INTO v_can_insert;
  IF NOT v_can_insert THEN
    RAISE EXCEPTION '0436: app_rw cannot INSERT on keystone.payment_allocation';
  END IF;

  -- POSITIVE: app_rw CANNOT DELETE
  SELECT has_table_privilege('app_rw', 'keystone.payment_allocation', 'DELETE')
   INTO v_can_delete;
  IF v_can_delete THEN
    RAISE EXCEPTION '0436: app_rw should not be able to DELETE on keystone.payment_allocation';
  END IF;

  RAISE NOTICE '0436: payment_allocation table created; FORCE RLS enabled; all required columns present; 3 composite FKs verified; app_rw can INSERT but not DELETE.';
END
$prove$;
