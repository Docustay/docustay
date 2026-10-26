-- 0430_payment_plans — Stage 15 (F08), task 15.8 — STAGE-15-PLAN.md §15.8 (line 831).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS BUILDS. `keystone.payment_plan` (the offer/agreement) and `keystone.payment_plan_row`
--     (its instalments). A payment plan's rows may move freely while the plan is `offered` — that is
--     what negotiation is — and are FROZEN the moment the plan is `agreed`: due date, amount and
--     instalment number can no longer change, and a row can no longer be deleted, ever, once the
--     plan has left `offered`.
--
-- ★★★ THE FREEZE IS A TRIGGER, NOT A FUNCTION. "Frozen at agreement" is a rule about every writer
--     that could ever touch `payment_plan_row`, not one function's discipline — the exact lesson this
--     project has paid for before (a GUC three policies read that nothing in the application ever
--     set; a check that lived in one call site and not the others). `keystone.payment_plan_row_frozen()`
--     is BEFORE UPDATE OR DELETE, invoker rights (NOT SECURITY DEFINER — it reads the parent plan's
--     state through the caller's own RLS-scoped privilege, the same reasoning `gift_card_never_
--     overdrawn` gives at `0415:109-113` for not needing SECURITY DEFINER), `SET search_path = ''`
--     so every identifier below is schema-qualified.
--   ★★ `state` MUST STILL BE CHANGEABLE on an agreed plan (`scheduled → invoiced` is 15.22's write as
--      Stripe invoices are drawn against the plan) — the trigger's condition names `due_date`,
--      `amount_minor` and `n` explicitly and never touches `state`, so a state-only UPDATE never
--      trips it. A trigger that froze the whole row would be the wrong shape (field 7).
--
-- ★ NOT TOUCHED: `keystone.entitlement` and its `installments_total`/`installments_paid` columns —
--   a different, per-entitlement concept (field 5).
--
-- ★★ CT-F52 SHAPE, copied from the two most recent complete precedents for the checklist itself
--    (`0415_gift_card.sql`, `0402_booking_block.sql`): tenant_id FK · ENABLE *and* FORCE RLS · the
--    tenant policies · a `reference_guard_read` policy and its grant · both guard triggers ENABLE
--    ALWAYS (with the temporary EXECUTE lend — 0402's header: not optional) · tenant-leading unique
--    indexes where a natural key exists · an `app_rw` grant limited to SELECT, INSERT, UPDATE — NO
--    DELETE, on both tables (a plan is cancelled, never deleted; a row is frozen, never deleted) ·
--    and a closing self-check DO block asserting positively what IS true, not merely what is absent.
--
-- ★★ TWO DIFFERENT SELECT SHAPES ON PURPOSE. `payment_plan` uses the `0196` shape on its person
--    column (`payer_user_id`) — copied verbatim from `0196_money_is_not_a_coachs_business_unless_it_
--    is.sql:99-107` (the `invoice` policy) with the column renamed: the payer can see their own plan
--    without an `invoice` grant of their own, and a coach holding `invoice: view/…` can see it too.
--    `payment_plan_row` carries no person column of its own — it rides on its parent plan — so its
--    SELECT is `tenant_id = current_tenant_id() AND user_may(current_user_id(), 'invoice', 'view',
--    NULL)`: the coarser "everything" question, same reasoning 0196's own header gives for `reports.
--    mjs` asking it (a row is not itself owned by one payer's grant chain the way the plan is).
--
-- DATA: new tables, no backfill.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.payment_plan (
  id                     uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id              uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  payer_user_id          uuid        NOT NULL,
  invoice_id             uuid        NULL,

  total_minor            integer     NOT NULL CHECK (total_minor > 0),
  currency               text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  installments           integer     NOT NULL CHECK (installments BETWEEN 2 AND 24),
  frequency              text        NOT NULL CHECK (frequency IN ('weekly','fortnightly','monthly')),
  first_due_on           date        NOT NULL,

  state                  text        NOT NULL DEFAULT 'offered'
                                      CHECK (state IN ('offered','agreed','completed','cancelled','defaulted')),

  offered_by             uuid        NULL,
  offered_at             timestamptz NOT NULL DEFAULT now(),
  agreed_at              timestamptz NULL,
  agreement_document_id  uuid        NULL REFERENCES keystone.document_instance(id) ON DELETE RESTRICT,
  frozen_terms           jsonb       NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, invoice_id)    REFERENCES keystone.invoice (tenant_id, id)  ON DELETE RESTRICT,

  CHECK ((state = 'offered') = (agreed_at IS NULL))
);

CREATE TABLE keystone.payment_plan_row (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  payment_plan_id   uuid        NOT NULL,
  n                 integer     NOT NULL CHECK (n >= 1),
  due_date          date        NOT NULL,
  amount_minor      integer     NOT NULL CHECK (amount_minor > 0),
  state             text        NOT NULL DEFAULT 'scheduled'
                                 CHECK (state IN ('scheduled','invoiced','paid','failed','cancelled')),

  invoice_id        uuid        NULL,
  stripe_invoice_id text        NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (payment_plan_id, n),
  FOREIGN KEY (tenant_id, payment_plan_id) REFERENCES keystone.payment_plan (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, invoice_id)      REFERENCES keystone.invoice (tenant_id, id)      ON DELETE RESTRICT
);

CREATE INDEX payment_plan_row_scheduled_idx ON keystone.payment_plan_row (tenant_id, due_date)
  WHERE state = 'scheduled';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FREEZE TRIGGER — the row's amount/date/instalment-number cannot change, and the row
--     cannot be deleted, once the parent plan has left `offered`. `state` is deliberately excluded
--     from the changed-columns test (field 7: `scheduled → invoiced` must still work on an agreed
--     plan).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.payment_plan_row_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_plan_state text;
BEGIN
  -- OLD exists on both UPDATE and DELETE; only NEW is DELETE-absent.
  SELECT state INTO v_plan_state FROM keystone.payment_plan WHERE id = OLD.payment_plan_id;

  IF v_plan_state IS DISTINCT FROM 'offered' AND (
       TG_OP = 'DELETE'
       OR NEW.due_date     IS DISTINCT FROM OLD.due_date
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
       OR NEW.n            IS DISTINCT FROM OLD.n
     ) THEN
    RAISE EXCEPTION 'payment plan % is agreed; its rows are frozen', OLD.payment_plan_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER payment_plan_row_frozen_trg
  BEFORE UPDATE OR DELETE ON keystone.payment_plan_row
  FOR EACH ROW EXECUTE FUNCTION keystone.payment_plan_row_frozen();
-- ★ REHEARSAL FIX (25 Sep 2026): the self-check below requires tgenabled = 'A' (fires under a
--   replica/forced session too); plain CREATE TRIGGER lands 'O'. The check encodes the intent.
ALTER TABLE keystone.payment_plan_row ENABLE ALWAYS TRIGGER payment_plan_row_frozen_trg;

-- ═══ RLS — keystone.payment_plan ══════════════════════════════════════════════════════════════
ALTER TABLE keystone.payment_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payment_plan FORCE  ROW LEVEL SECURITY;

-- ★★ 0196 shape, copied verbatim (0196:99-107) with the person column renamed to payer_user_id.
CREATE POLICY tenant_isolation ON keystone.payment_plan
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND (
      keystone.user_may(keystone.current_user_id(), 'invoice', 'view',
        (SELECT ao.owner_user_id FROM keystone.app_user ao WHERE ao.id = payment_plan.payer_user_id))
      OR payer_user_id = keystone.current_user_id()
    )
  );

CREATE POLICY tenant_insert ON keystone.payment_plan
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.payment_plan
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: a plan is cancelled/defaulted, never deleted.
GRANT SELECT, INSERT, UPDATE ON keystone.payment_plan TO app_rw;

-- ═══ RLS — keystone.payment_plan_row ══════════════════════════════════════════════════════════
ALTER TABLE keystone.payment_plan_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.payment_plan_row FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.payment_plan_row
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND keystone.user_may(keystone.current_user_id(), 'invoice', 'view', NULL)
  );

CREATE POLICY tenant_insert ON keystone.payment_plan_row
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.payment_plan_row
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: rows are frozen/cancelled, never deleted (the trigger above refuses DELETE too).
GRANT SELECT, INSERT, UPDATE ON keystone.payment_plan_row TO app_rw;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF, BOTH TABLES ══════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER payment_plan_refuse_reference_delete_trg AFTER DELETE ON keystone.payment_plan
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_plan ENABLE ALWAYS TRIGGER payment_plan_refuse_reference_delete_trg;
CREATE TRIGGER payment_plan_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.payment_plan
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_plan ENABLE ALWAYS TRIGGER payment_plan_refuse_reference_truncate_trg;

CREATE TRIGGER payment_plan_row_refuse_reference_delete_trg AFTER DELETE ON keystone.payment_plan_row
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_plan_row ENABLE ALWAYS TRIGGER payment_plan_row_refuse_reference_delete_trg;
CREATE TRIGGER payment_plan_row_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.payment_plan_row
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.payment_plan_row ENABLE ALWAYS TRIGGER payment_plan_row_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.payment_plan TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.payment_plan FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

GRANT SELECT ON keystone.payment_plan_row TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.payment_plan_row FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, BOTH TABLES, WITH POSITIVE CONTROLS ═════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  -- ── keystone.payment_plan ──────────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.payment_plan'::regclass) THEN
    RAISE EXCEPTION '0430 — keystone.payment_plan is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'payment_plan'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0430 — expected 4 policies on payment_plan, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='payment_plan' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0430 — payment_plan has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.payment_plan'::regclass
     AND tgname IN ('payment_plan_refuse_reference_delete_trg','payment_plan_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0430 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on payment_plan, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.payment_plan'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0430 — reference_guard_read on payment_plan must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.payment_plan', 'SELECT') THEN
    RAISE EXCEPTION '0430 — app_rw is missing SELECT on payment_plan';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.payment_plan', 'INSERT') THEN
    RAISE EXCEPTION '0430 — app_rw is missing INSERT on payment_plan';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.payment_plan', 'UPDATE') THEN
    RAISE EXCEPTION '0430 — app_rw lost UPDATE on payment_plan; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.payment_plan', 'SELECT') THEN
    RAISE EXCEPTION '0430 — reference_guard has no SELECT on payment_plan; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.payment_plan', 'DELETE') THEN
    RAISE EXCEPTION '0430 — app_rw must NOT hold DELETE on payment_plan';
  END IF;

  -- ── keystone.payment_plan_row ──────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.payment_plan_row'::regclass) THEN
    RAISE EXCEPTION '0430 — keystone.payment_plan_row is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'payment_plan_row'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0430 — expected 4 policies on payment_plan_row, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='payment_plan_row' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0430 — payment_plan_row has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.payment_plan_row'::regclass
     AND tgname IN ('payment_plan_row_refuse_reference_delete_trg','payment_plan_row_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0430 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on payment_plan_row, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.payment_plan_row'::regclass
     AND tgname = 'payment_plan_row_frozen_trg' AND tgenabled = 'A';
  IF n <> 1 THEN
    RAISE EXCEPTION '0430 — payment_plan_row_frozen_trg (BEFORE UPDATE OR DELETE) must be attached and enabled on payment_plan_row, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.payment_plan_row'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0430 — reference_guard_read on payment_plan_row must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.payment_plan_row', 'SELECT') THEN
    RAISE EXCEPTION '0430 — app_rw is missing SELECT on payment_plan_row';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.payment_plan_row', 'INSERT') THEN
    RAISE EXCEPTION '0430 — app_rw is missing INSERT on payment_plan_row';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.payment_plan_row', 'UPDATE') THEN
    RAISE EXCEPTION '0430 — app_rw lost UPDATE on payment_plan_row; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.payment_plan_row', 'SELECT') THEN
    RAISE EXCEPTION '0430 — reference_guard has no SELECT on payment_plan_row; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.payment_plan_row', 'DELETE') THEN
    RAISE EXCEPTION '0430 — app_rw must NOT hold DELETE on payment_plan_row';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
