-- 0703 · RE-STAMP A SEALED COPY THAT WENT OUT WITHOUT A TRUSTED TIMESTAMP (Run 6, B-3). Additive.
--   · The audit trail learns 'seal_restamped': a trusted timestamp was added to the sealed copy after the fact. Both hashes are in its detail; the original seal's signature stays valid (the timestamp is an incremental update after it).
--   · The worker's per-minute sweep may see an executed uploaded document whose copy is still waiting for that timestamp (a 'seal_untimestamped' event and no 'seal_restamped' one), so it can queue the archive job, which re-stamps it. Same shape as 0701's system_unarchived_read: no viewer, this workspace only, those rows only.
DO $r6_audit_kind$
DECLARE v_def text; v_name text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def FROM pg_constraint WHERE conrelid = 'keystone.document_audit_event'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind = ANY%';
  IF v_name IS NULL THEN RAISE EXCEPTION '0703: the document_audit_event kind check was not found'; END IF;
  IF v_def LIKE '%seal_restamped%' THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE keystone.document_audit_event DROP CONSTRAINT %I', v_name);
  EXECUTE format('ALTER TABLE keystone.document_audit_event ADD CONSTRAINT %I %s', v_name, replace(v_def, ']', ', ''seal_restamped''::text]'));
END
$r6_audit_kind$;

DROP POLICY IF EXISTS system_untimestamped_read ON keystone.document_instance;
CREATE POLICY system_untimestamped_read ON keystone.document_instance FOR SELECT USING (
  tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL AND builder = 'pdf' AND state = 'executed'
  AND executed_at IS NOT NULL AND executed_at > now() - interval '30 days' AND executed_at <= now() - interval '15 minutes'
  AND EXISTS (SELECT 1 FROM keystone.document_audit_event a WHERE a.instance_id = document_instance.id AND a.kind = 'seal_untimestamped')
  AND NOT EXISTS (SELECT 1 FROM keystone.document_audit_event a WHERE a.instance_id = document_instance.id AND a.kind = 'seal_restamped'));

DO $r6_self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.document_instance'::regclass AND polname = 'system_untimestamped_read') THEN RAISE EXCEPTION '0703: system_untimestamped_read is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'keystone.document_audit_event'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%seal_restamped%') THEN RAISE EXCEPTION '0703: the audit kind seal_restamped was not added'; END IF;
END
$r6_self_check$;
