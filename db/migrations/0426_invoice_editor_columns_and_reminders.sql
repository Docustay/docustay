-- 0426_invoice_editor_columns_and_reminders — Stage 15 task 15.5
--
-- keystone.invoice additions for draft editing (title, message, custom_fields) and reminder tracking,
-- plus reminders configuration, stripe sync columns, and viewing tracking.
-- keystone.line_item position column for ordered display.
-- keystone.invoice_reminder table for per-invoice reminder scheduling (new tenant table).

ALTER TABLE keystone.invoice
  ADD COLUMN title text NULL CHECK (title IS NULL OR char_length(title) <= 120),
  ADD COLUMN message text NULL CHECK (message IS NULL OR char_length(message) <= 2000),
  ADD COLUMN issued_at timestamptz NULL,
  ADD COLUMN tip_minor integer NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  ADD COLUMN paid_minor integer NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  ADD COLUMN viewed_at timestamptz NULL,
  ADD COLUMN view_count integer NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  ADD COLUMN source text NOT NULL DEFAULT 'staff' CHECK (source IN
    ('staff','booking','estimate','document','subscription','payment_plan','payment_link','no_show','import')),
  ADD COLUMN save_card_offered boolean NOT NULL DEFAULT false,
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN hosted_invoice_url text NULL,
  ADD COLUMN overdue_at timestamptz NULL,
  ADD COLUMN stripe_state text NULL CHECK (stripe_state IS NULL OR stripe_state IN
    ('draft','finalized','held_charges_off','failed'));

ALTER TABLE keystone.line_item
  ADD COLUMN position integer NULL CHECK (position IS NULL OR position >= 0);

CREATE TABLE keystone.invoice_reminder (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  offset_days integer NOT NULL CHECK (offset_days BETWEEN -30 AND 60),
  sent_at timestamptz NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES keystone.invoice(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (invoice_id, offset_days)
);
CREATE INDEX ON keystone.invoice_reminder (tenant_id, sent_at) WHERE sent_at IS NULL AND deleted_at IS NULL;

ALTER TABLE keystone.invoice_reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.invoice_reminder FORCE  ROW LEVEL SECURITY;

-- ★★ SELECT is money-gated, same shape as keystone.invoice's tenant_isolation (0196:99-107).
--    No owning-coach argument: a reminder is practice-wide infrastructure, not owned by one client's coach.
CREATE POLICY tenant_isolation ON keystone.invoice_reminder
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND keystone.user_may(keystone.current_user_id(), 'invoice', 'view', NULL)
  );

CREATE POLICY tenant_insert ON keystone.invoice_reminder
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.invoice_reminder
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: reminders are soft-deleted (deleted_at), never removed (field 6: no DELETE grant).
GRANT SELECT, INSERT, UPDATE ON keystone.invoice_reminder TO app_rw;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER invoice_reminder_refuse_reference_delete_trg AFTER DELETE ON keystone.invoice_reminder
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.invoice_reminder ENABLE ALWAYS TRIGGER invoice_reminder_refuse_reference_delete_trg;
CREATE TRIGGER invoice_reminder_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.invoice_reminder
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.invoice_reminder ENABLE ALWAYS TRIGGER invoice_reminder_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.invoice_reminder TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.invoice_reminder FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ══════════════════════════════
DO $check_invoice_reminder$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.invoice_reminder'::regclass) THEN
    RAISE EXCEPTION '0426 — keystone.invoice_reminder is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'invoice_reminder'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0426 — expected 4 policies on invoice_reminder, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='invoice_reminder' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0426 — invoice_reminder has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  -- ★ the SELECT policy must be money-gated, not bare tenant_id — the whole point of this table's
  --   access shape. A qual that lost `user_may` would silently widen visibility to every tenant
  --   member regardless of the invoice.view grant.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'keystone' AND tablename = 'invoice_reminder' AND policyname = 'tenant_isolation'
       AND qual LIKE '%user_may%' AND qual LIKE '%current_tenant_id%'
  ) THEN
    RAISE EXCEPTION '0426 — tenant_isolation on invoice_reminder must read both current_tenant_id() and user_may(...)';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.invoice_reminder'::regclass
     AND tgname IN ('invoice_reminder_refuse_reference_delete_trg','invoice_reminder_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0426 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on invoice_reminder, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.invoice_reminder'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0426 — reference_guard_read on invoice_reminder must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE';
  END IF;

  -- ★ Positive controls: assert what SHOULD be true, not merely what should be absent.
  IF NOT has_table_privilege('app_rw', 'keystone.invoice_reminder', 'SELECT') THEN
    RAISE EXCEPTION '0426 — app_rw is missing SELECT on invoice_reminder';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.invoice_reminder', 'INSERT') THEN
    RAISE EXCEPTION '0426 — app_rw is missing INSERT on invoice_reminder';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.invoice_reminder', 'UPDATE') THEN
    RAISE EXCEPTION '0426 — app_rw is missing UPDATE on invoice_reminder';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.invoice_reminder', 'SELECT') THEN
    RAISE EXCEPTION '0426 — reference_guard has no SELECT on invoice_reminder';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.invoice_reminder', 'DELETE') THEN
    RAISE EXCEPTION '0426 — app_rw must NOT hold DELETE on invoice_reminder (soft-deleted via deleted_at)';
  END IF;
END $check_invoice_reminder$;

-- Written, not applied.
