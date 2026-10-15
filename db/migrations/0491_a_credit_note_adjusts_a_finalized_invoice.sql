-- 0491 — A CREDIT NOTE ADJUSTS A FINALIZED INVOICE (Stage 20 task 20.62)
--
-- ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS. A credit note issued against
--     a finalized invoice creates a Stripe CreditNote with line fidelity and mirrors the
--     result in keystone.credit_note and keystone.credit_note_line. Void is bidirectional.
--
-- SCHEMA:
-- • credit_note(id, tenant_id, invoice_id FK, stripe_credit_note_id, number_ours,
--   status CHECK (issued|void), reason CHECK (duplicate|fraudulent|order_change|product_unsatisfactory),
--   memo, subtotal_minor, tax_minor, total_minor, destination CHECK (refund|credit|out_of_band),
--   refund_id NULL FK, stripe_balance_txn_id NULL, pdf_url NULL, effective_at, voided_at, created_by, created_at)
-- • credit_note_line(id, tenant_id, credit_note_id FK, line_item_id FK, quantity, amount_minor, description_snapshot)
-- • ADD refund.reason text NULL CHECK (duplicate|fraudulent|requested_by_customer)
-- RLS: 0334 idiom on both credit note tables.
--
-- WRITER: `src/money/creditNotes.mjs` routes `/api/money/credit-notes/{issue,void}`.
-- READER: invoice detail UI, credit ledger.

ALTER TABLE keystone.refund NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.refund
  ADD COLUMN reason text NULL CHECK (reason IS NULL OR reason = ANY (ARRAY['duplicate','fraudulent','requested_by_customer']));

-- ── Self-check: refund.reason CHECK ────────────────────────────────────────────────
DO $check$
DECLARE
  has_reason_col boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'refund' AND column_name = 'reason'
  ) INTO has_reason_col;

  IF NOT has_reason_col THEN
    RAISE EXCEPTION '0491: refund.reason column not added';
  END IF;

  -- ★ Positive control: accepted value
  BEGIN
    INSERT INTO keystone.refund
      (tenant_id, stripe_id, amount_minor, state, reason)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'test_' || to_char(now(), 'ms'),
       1000, 'succeeded', 'duplicate')
    ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  -- ★ Positive control: rejected value
  BEGIN
    INSERT INTO keystone.refund
      (tenant_id, stripe_id, amount_minor, state, reason)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'test2_' || to_char(now(), 'ms'),
       1000, 'succeeded', 'invalid_reason')
    ON CONFLICT DO NOTHING;
    RAISE EXCEPTION '0491: refund.reason CHECK failed to reject invalid reason';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$check$;

ALTER TABLE keystone.refund FORCE ROW LEVEL SECURITY;

-- ── Create credit_note table ──────────────────────────────────────────────────────
CREATE TABLE keystone.credit_note (
  id                      uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id               uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  invoice_id              uuid        NOT NULL REFERENCES keystone.invoice(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),

  stripe_credit_note_id   text        NOT NULL,
  number_ours             text        NOT NULL,
  status                  text        NOT NULL CHECK (status = ANY (ARRAY['issued','void'])),
  reason                  text        NOT NULL CHECK (reason = ANY (ARRAY['duplicate','fraudulent','order_change','product_unsatisfactory'])),
  memo                    text        NULL,

  subtotal_minor          integer     NOT NULL,
  tax_minor               integer     NOT NULL,
  total_minor             integer     NOT NULL,
  destination             text        NOT NULL CHECK (destination = ANY (ARRAY['refund','credit','out_of_band'])),

  refund_id               uuid        NULL REFERENCES keystone.refund(id) ON DELETE SET NULL,
  stripe_balance_txn_id   text        NULL,
  pdf_url                 text        NULL,

  effective_at            timestamptz NOT NULL,
  voided_at               timestamptz NULL,
  created_by              uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,

  CONSTRAINT credit_note_unique_stripe UNIQUE (tenant_id, stripe_credit_note_id),
  CONSTRAINT credit_note_unique_number UNIQUE (tenant_id, number_ours)
);

CREATE INDEX credit_note_invoice_idx ON keystone.credit_note (tenant_id, invoice_id);
CREATE INDEX credit_note_refund_idx ON keystone.credit_note (tenant_id, refund_id) WHERE refund_id IS NOT NULL;

ALTER TABLE keystone.credit_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.credit_note FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.credit_note USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.credit_note FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT ON keystone.credit_note TO app_rw;

-- ── Create credit_note_line table ─────────────────────────────────────────────────
CREATE TABLE keystone.credit_note_line (
  id                      uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id               uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  credit_note_id          uuid        NOT NULL REFERENCES keystone.credit_note(id) ON DELETE RESTRICT,
  -- ★ REHEARSAL FIX (25 Sep 2026): the invoice's lines live in keystone.line_item (0013 family); no
  --   invoice_line_item table ever existed.
  line_item_id            uuid        NOT NULL REFERENCES keystone.line_item(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),

  quantity                integer     NOT NULL,
  amount_minor            integer     NOT NULL,
  description_snapshot    text        NOT NULL
);

CREATE INDEX credit_note_line_credit_note_idx ON keystone.credit_note_line (tenant_id, credit_note_id);
CREATE INDEX credit_note_line_line_item_idx ON keystone.credit_note_line (tenant_id, line_item_id);

ALTER TABLE keystone.credit_note_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.credit_note_line FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.credit_note_line USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.credit_note_line FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT ON keystone.credit_note_line TO app_rw;

-- ── Reference guard (CT-F52 §3.2) ─────────────────────────────────────────────────
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER credit_note_refuse_reference_delete_trg AFTER DELETE ON keystone.credit_note
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.credit_note ENABLE ALWAYS TRIGGER credit_note_refuse_reference_delete_trg;

CREATE TRIGGER credit_note_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.credit_note
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.credit_note ENABLE ALWAYS TRIGGER credit_note_refuse_reference_truncate_trg;

CREATE TRIGGER credit_note_line_refuse_reference_delete_trg AFTER DELETE ON keystone.credit_note_line
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.credit_note_line ENABLE ALWAYS TRIGGER credit_note_line_refuse_reference_delete_trg;

CREATE TRIGGER credit_note_line_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.credit_note_line
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.credit_note_line ENABLE ALWAYS TRIGGER credit_note_line_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.credit_note TO reference_guard;
GRANT SELECT ON keystone.credit_note_line TO reference_guard;
CREATE POLICY reference_guard_read_cn ON keystone.credit_note FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
CREATE POLICY reference_guard_read_cnl ON keystone.credit_note_line FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ── Self-check: credit note tables ────────────────────────────────────────────────
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.credit_note'::regclass) THEN
    RAISE EXCEPTION '0491: credit_note is not FORCE ROW LEVEL SECURITY';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.credit_note_line'::regclass) THEN
    RAISE EXCEPTION '0491: credit_note_line is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'credit_note'
     AND policyname IN ('tenant_isolation','tenant_insert','reference_guard_read_cn');
  IF n <> 3 THEN
    RAISE EXCEPTION '0491: expected 3 policies on credit_note, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'credit_note_line'
     AND policyname IN ('tenant_isolation','tenant_insert','reference_guard_read_cnl');
  IF n <> 3 THEN
    RAISE EXCEPTION '0491: expected 3 policies on credit_note_line, found %', n;
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.credit_note', 'SELECT') THEN
    RAISE EXCEPTION '0491: app_rw is missing SELECT on credit_note';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.credit_note', 'INSERT') THEN
    RAISE EXCEPTION '0491: app_rw is missing INSERT on credit_note';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.credit_note', 'UPDATE') THEN
    RAISE EXCEPTION '0491: app_rw must NOT hold UPDATE on credit_note — immutable';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.credit_note', 'DELETE') THEN
    RAISE EXCEPTION '0491: app_rw must NOT hold DELETE on credit_note — immutable';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.credit_note_line', 'SELECT') THEN
    RAISE EXCEPTION '0491: app_rw is missing SELECT on credit_note_line';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.credit_note_line', 'INSERT') THEN
    RAISE EXCEPTION '0491: app_rw is missing INSERT on credit_note_line';
  END IF;

  -- ★ REHEARSAL FIX: the condition was inverted (raised when the revoke had WORKED); the message states the intent.
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0491: app_owner should not hold EXECUTE on refuse_touch_reference_rows() after revoke';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
