-- 0494 — CUSTOMER CREDIT IS A LEDGER (Stage 20 task 20.66)
--
-- keystone.customer_credit_entry is an APPEND-ONLY LEDGER. Balance is the running
-- SUM(amount_minor), never a stored counter. Types: adjustment, applied_to_invoice,
-- credit_note, unapplied_from_invoice, gift_card. The webhook fold inserts balance
-- deltas on invoice finalize/paid; the adjust route creates adjustment rows with a
-- required note.
--
-- APPEND-ONLY ENFORCED BY GRANTS, NOT CONVENTION. The table carries no UPDATE/DELETE
-- grants to app_rw — a rewrite is a violation, not a convention to follow. The test
-- proves it: UPDATE and DELETE as the app role are REFUSED with insufficient_privilege;
-- INSERT is allowed (the positive control).
--
-- Shape follows CT-F52 (0414/0415 pattern) with NO second table: one ledger table only.
-- RLS ENABLE+FORCE, tenant policies, reference_guard read, refuse_touch_reference_rows
-- triggers (ENABLE ALWAYS, with EXECUTE lend), and a self-check with positive controls.

CREATE TABLE keystone.customer_credit_entry (
  id                   uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id            uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),

  subject_type         text        NOT NULL CHECK (subject_type IN ('person', 'account')),
  subject_id           uuid        NOT NULL,
  amount_minor         integer     NOT NULL,                   -- signed: positive credit, negative debit
  type                 text        NOT NULL CHECK (
    type IN ('adjustment', 'applied_to_invoice', 'credit_note', 'unapplied_from_invoice', 'gift_card')
  ),

  stripe_balance_txn_id uuid       NULL,                        -- Stripe CBT id for idempotency
  invoice_id           uuid        NULL,                        -- for applied_to_invoice / unapplied_from_invoice
  credit_note_id       uuid        NULL,                        -- for credit_note type
  note                 text        NULL,                        -- required for adjustment type
  created_by           uuid        NULL                         -- admin adjusting; null for webhook folds
);

CREATE INDEX customer_credit_entry_subject_idx ON keystone.customer_credit_entry (tenant_id, subject_type, subject_id);
CREATE INDEX customer_credit_entry_stripe_txn_idx ON keystone.customer_credit_entry (tenant_id, stripe_balance_txn_id)
  WHERE stripe_balance_txn_id IS NOT NULL;

ALTER TABLE keystone.customer_credit_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.customer_credit_entry FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.customer_credit_entry USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.customer_credit_entry FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_update, no tenant_delete: append-only ledger.
GRANT SELECT, INSERT ON keystone.customer_credit_entry TO app_rw;   -- SELECT, INSERT only — no UPDATE, no DELETE

-- ── Reference guard (CT-F52 §3.2 points 3-5) ─────────────────────────────────────
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER customer_credit_entry_refuse_reference_delete_trg AFTER DELETE ON keystone.customer_credit_entry
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.customer_credit_entry ENABLE ALWAYS TRIGGER customer_credit_entry_refuse_reference_delete_trg;
CREATE TRIGGER customer_credit_entry_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.customer_credit_entry
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.customer_credit_entry ENABLE ALWAYS TRIGGER customer_credit_entry_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.customer_credit_entry TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.customer_credit_entry FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ── Self-check: CT-F52 point 6, with positive controls ──────────────────────────
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.customer_credit_entry'::regclass) THEN
    RAISE EXCEPTION '0494: customer_credit_entry is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'customer_credit_entry'
     AND policyname IN ('tenant_isolation','tenant_insert','reference_guard_read');
  IF n <> 3 THEN
    RAISE EXCEPTION '0494: expected 3 policies on customer_credit_entry, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='customer_credit_entry' AND policyname IN ('tenant_update','tenant_delete')) THEN
    RAISE EXCEPTION '0494: customer_credit_entry must carry no tenant_update/tenant_delete policy — it is append-only';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.customer_credit_entry'::regclass
     AND tgname IN ('customer_credit_entry_refuse_reference_delete_trg','customer_credit_entry_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0494: both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.customer_credit_entry'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0494: reference_guard_read on customer_credit_entry must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE';
  END IF;

  -- Positive controls
  IF NOT has_table_privilege('app_rw', 'keystone.customer_credit_entry', 'SELECT') THEN
    RAISE EXCEPTION '0494: app_rw is missing SELECT on customer_credit_entry';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.customer_credit_entry', 'INSERT') THEN
    RAISE EXCEPTION '0494: app_rw is missing INSERT on customer_credit_entry';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.customer_credit_entry', 'UPDATE') THEN
    RAISE EXCEPTION '0494: app_rw must NOT hold UPDATE on customer_credit_entry — it is append-only';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.customer_credit_entry', 'DELETE') THEN
    RAISE EXCEPTION '0494: app_rw must NOT hold DELETE on customer_credit_entry — it is append-only';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.customer_credit_entry', 'SELECT') THEN
    RAISE EXCEPTION '0494: reference_guard is missing SELECT on customer_credit_entry';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0494: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the lend was not revoked';
  END IF;
END $ct_f52_self_check$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────────
-- § 2 · PAYMENT MIRROR TABLE — APPLICATION FEE COLUMN (Task 20.73 ruling)
-- ──────────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ THE FEE LINE FINALLY READS REAL FEES. The accountant report's fee line sums the MIRRORED
-- `application_fee_minor` for the period. It is never computed from a rate and never estimated.
--
-- ★ Migration 0425 added 17 columns to `keystone.payment` but NOT `application_fee_minor` — that
-- column's name was chosen but the field was not written at the time. This migration adds it now,
-- following 0425's own pattern: NOT NULL DEFAULT with a CHECK for non-negative, idempotent
-- closing self-check with positive controls (the column exists, it is unsigned integer, it has the
-- right constraint).

-- ★★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production): the premise above is
--    wrong — 0425 (line 54) DID add `application_fee_minor`, as `integer NULL CHECK (>= 0)`, and the
--    ADD COLUMN here failed with "already exists". RULING: keep 0425's column. NULL means "Stripe has
--    not told us the fee yet", which is a different fact from a zero fee; a NOT NULL DEFAULT 0 would
--    make every unmirrored payment read as fee-free on the accountant report. Readers COALESCE.
--    This section now proves 0425's column is present and guarded. Cost if wrong: one ALTER later.

DO $confirm_fees$
BEGIN
  -- POSITIVE: the column exists on keystone.payment, as an integer
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'payment'
       AND column_name = 'application_fee_minor' AND data_type = 'integer'
  ) THEN
    RAISE EXCEPTION '0494 §2: integer application_fee_minor does not exist on keystone.payment';
  END IF;

  -- POSITIVE: a CHECK on keystone.payment refuses a negative fee
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'keystone.payment'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%application_fee_minor >= 0%'
  ) THEN
    RAISE EXCEPTION '0494 §2: CHECK (application_fee_minor >= 0) is missing on keystone.payment';
  END IF;

  RAISE NOTICE '0494 §2: application_fee_minor (from 0425) present on keystone.payment with its non-negative CHECK.';
END $confirm_fees$;

-- Written, not applied.
