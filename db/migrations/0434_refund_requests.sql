-- 0434_refund_requests — Stage 15 task 15.15 · CT-F40/CT-F41
--
-- keystone.refund_request — a request for a refund, which may require approval from the practice Owner
-- before execution. When an Admin attempts to refund, the request is created and an approval task is
-- opened; when an Owner attempts to refund, it executes immediately.
--
-- ★★★ THE COMPOSITE FK TO refund (tenant_id, refund_id) IS REQUIRED BY THE DESIGN.
--     A single-column `REFERENCES keystone.refund(id)` would allow a refund_request in tenant A
--     to point at a refund in tenant B — a tenant hole in a FORCE-RLS schema. This migration's
--     first statement creates the `refund (tenant_id, id)` unique index that this composite FK requires.

CREATE UNIQUE INDEX IF NOT EXISTS refund_tenant_id_id_key
  ON keystone.refund (tenant_id, id);

CREATE TABLE keystone.refund_request (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  reason text NOT NULL CHECK (reason IN ('requested_by_customer','duplicate','service_not_delivered','goodwill','other')),
  receipt_line text NULL CHECK (receipt_line IS NULL OR char_length(receipt_line) <= 200),
  return_credit boolean NOT NULL DEFAULT false,
  requested_by uuid NULL,
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested','executed','declined','failed')),
  decided_by uuid NULL,
  decided_at timestamptz NULL,
  refund_id uuid NULL,
  failure_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ★ REHEARSAL FIX (25 Sep 2026): named — the self-check below looks these up by name, and an
  --   unnamed FK lands as refund_request_tenant_id_payment_id_fkey.
  CONSTRAINT refund_request_payment_id_fkey FOREIGN KEY (tenant_id, payment_id) REFERENCES keystone.payment(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT refund_request_refund_id_fkey  FOREIGN KEY (tenant_id, refund_id)  REFERENCES keystone.refund(tenant_id, id)  ON DELETE RESTRICT,
  CHECK ((state = 'requested') = (decided_at IS NULL))
);

ALTER TABLE keystone.refund_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.refund_request FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.refund_request
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND keystone.user_may(keystone.current_user_id(), 'invoice', 'view', NULL)
  );

CREATE POLICY tenant_insert ON keystone.refund_request
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.refund_request
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.refund_request TO app_rw;

CREATE TRIGGER refund_request_touch BEFORE UPDATE ON keystone.refund_request
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER refund_request_refuse_reference_delete_trg AFTER DELETE ON keystone.refund_request
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.refund_request ENABLE ALWAYS TRIGGER refund_request_refuse_reference_delete_trg;
CREATE TRIGGER refund_request_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.refund_request
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.refund_request ENABLE ALWAYS TRIGGER refund_request_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.refund_request TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.refund_request FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ══════════════════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.refund_request'::regclass) THEN
    RAISE EXCEPTION '0434 — keystone.refund_request is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'refund_request'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0434 — expected 4 policies on refund_request, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='refund_request' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0434 — refund_request has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.refund_request', 'SELECT') THEN
    RAISE EXCEPTION '0434 — app_rw is missing SELECT on refund_request';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.refund_request', 'INSERT') THEN
    RAISE EXCEPTION '0434 — app_rw is missing INSERT on refund_request';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.refund_request', 'UPDATE') THEN
    RAISE EXCEPTION '0434 — app_rw lost UPDATE on refund_request; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.refund_request', 'SELECT') THEN
    RAISE EXCEPTION '0434 — reference_guard has no SELECT on refund_request; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.refund_request', 'DELETE') THEN
    RAISE EXCEPTION '0434 — app_rw must NOT hold DELETE on refund_request (requests are never deleted)';
  END IF;

  -- ★★★ COMPOSITE FK GUARANTEE: both FKs exist by name and reference the composite index
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'keystone' AND table_name = 'refund_request'
       AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'refund_request_payment_id_fkey'
  ) THEN
    RAISE EXCEPTION '0434 — refund_request_payment_id_fkey composite FK does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = 'keystone' AND table_name = 'refund_request'
       AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'refund_request_refund_id_fkey'
  ) THEN
    RAISE EXCEPTION '0434 — refund_request_refund_id_fkey composite FK does not exist';
  END IF;

  -- ★ Positive controls for the two composite FKs
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'refund_request_payment_id_fkey' AND confrelid = 'keystone.payment'::regclass
  ) THEN
    RAISE EXCEPTION '0434 — refund_request_payment_id_fkey does not reference keystone.payment';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'refund_request_refund_id_fkey' AND confrelid = 'keystone.refund'::regclass
  ) THEN
    RAISE EXCEPTION '0434 — refund_request_refund_id_fkey does not reference keystone.refund';
  END IF;

  -- ★ refund (tenant_id, id) index exists and is UNIQUE
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'refund_tenant_id_id_key' AND i.indisunique
  ) THEN
    RAISE EXCEPTION '0434 — refund_tenant_id_id_key does not exist or is not UNIQUE';
  END IF;

  -- ★ Both refuse_touch_reference_rows triggers exist and are ENABLE ALWAYS
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.refund_request'::regclass
     AND tgname IN ('refund_request_refuse_reference_delete_trg','refund_request_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0434 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on refund_request, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.refund_request'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0434 — reference_guard_read on refund_request must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  RAISE NOTICE '0434: refund_request table, RLS, policies, grants, composite FKs to payment and refund, and reference guard all present and correct.';
END
$ct_f52_self_check$;

-- Written, not applied.
