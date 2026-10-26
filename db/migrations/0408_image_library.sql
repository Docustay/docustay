-- 0408_image_library — Stage 14 task 14.1 · CT-F52
--
-- One row per uploaded image so services, packages and the booking page can reference a picture
-- (F06/D-vocab §0.4 A shape). `bytes` is decoded size, capped at 700 KiB (716800 bytes) — the
-- browser resizes before upload; anything larger uses 14.77's presigned door instead (R-14.12).
-- Delete of an image is a real DELETE (F06 §3.5: allowed while unreferenced; the referencing FKs
-- added in 0410 are ON DELETE SET NULL and the route refuses the delete while still referenced) —
-- so app_rw gets DELETE and this table carries a tenant_delete policy.
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points.

CREATE TABLE keystone.image (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name          text        NOT NULL CHECK (btrim(name) <> ''),
  s3_key        text        NOT NULL,
  content_type  text        NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  bytes         integer     NOT NULL CHECK (bytes > 0 AND bytes <= 716800),
  width         integer     CHECK (width > 0),
  height        integer     CHECK (height > 0),
  created_by    uuid        NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT image_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX image_tenant_id_id_key   ON keystone.image (tenant_id, id);
CREATE UNIQUE INDEX image_tenant_s3_key_key  ON keystone.image (tenant_id, s3_key);
CREATE INDEX        image_tenant_created_idx ON keystone.image (tenant_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 1 — ENABLE and FORCE ROW LEVEL SECURITY. ENABLE alone leaves the table owner exempt.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.image ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.image FORCE  ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 2 — the tenant policies. A delete path exists (see header), so tenant_delete too.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY tenant_isolation ON keystone.image USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.image FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.image FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                  WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.image FOR DELETE USING (tenant_id = keystone.current_tenant_id());

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 3 — the reference guard. Without it catalog-conformance's SET-EQUALITY check fails.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY reference_guard_read ON keystone.image FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 4 — grants.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.image TO app_rw;
GRANT SELECT ON keystone.image TO reference_guard;

-- CT-F52 point 4b, bullet 1: the reference_guard_read policy above is the PLAIN form (point 3) —
-- its USING clause calls no function — so there is nothing for a GRANT EXECUTE to name.
-- Bullet 2: THE EXECUTE LEND IS NOT OPTIONAL for the trigger functions below.
-- `keystone.refuse_touch_reference_rows()` is owned BY `reference_guard` (0144:245) and 0099:83
-- revoked ALL on it FROM PUBLIC (0151:91-110 verbatim; 0402's pattern).
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers, each ENABLE ALWAYS.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TRIGGER image_refuse_reference_delete_trg AFTER DELETE ON keystone.image
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.image ENABLE ALWAYS TRIGGER image_refuse_reference_delete_trg;
CREATE TRIGGER image_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.image
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.image ENABLE ALWAYS TRIGGER image_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- §0.4 A base shape's touch trigger (updated_at).
CREATE TRIGGER image_touch BEFORE UPDATE ON keystone.image
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

COMMENT ON TABLE keystone.image IS '14.1 — one row per uploaded image so services, packages and the booking page can reference a picture. bytes capped at 716800 (700 KiB decoded); large binaries use 14.77''s presigned door.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 6 — the closing self-check, WITH ITS POSITIVE CONTROL INSIDE THE SQL (0369/0370's
-- template; 0382/0385/0402's form).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.image'::regclass) THEN
    RAISE EXCEPTION '0408: keystone.image does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.image'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION '0408: keystone.image does not carry exactly the five expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.image'::regclass
     AND tgname IN ('image_refuse_reference_delete_trg', 'image_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0408: keystone.image does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  -- CT-F52 point 4b, bullet 3 / 0144 §e's end state: reference_guard_read on this table is exactly
  -- (TO reference_guard, FOR SELECT, PERMISSIVE) and nothing else.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.image'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0408: reference_guard_read on keystone.image is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.image', 'SELECT') THEN
    RAISE EXCEPTION '0408: app_rw is missing SELECT on keystone.image';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.image', 'INSERT') THEN
    RAISE EXCEPTION '0408: app_rw is missing INSERT on keystone.image';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.image', 'UPDATE') THEN
    RAISE EXCEPTION '0408: app_rw is missing UPDATE on keystone.image';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.image', 'DELETE') THEN
    RAISE EXCEPTION '0408: app_rw is missing DELETE on keystone.image';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.image', 'SELECT') THEN
    RAISE EXCEPTION '0408: reference_guard is missing SELECT on keystone.image';
  END IF;

  -- The EXECUTE lend was temporary (SET LOCAL scopes it to this transaction regardless, but assert
  -- the REVOKE took effect rather than relying on that alone).
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0408: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the lend was not revoked';
  END IF;
END
$ct_f52_self_check$;

-- Written, not applied.
