-- 0701 · TWO SMALL GAPS IN THE SEALED COPY (Round 3, 10 Oct 2026). Additive.
--   · The worker's per-minute sweep may now SEE an executed uploaded document that still has no sealed copy fifteen minutes after it was executed (object storage or the renderer was down longer than the retry ladder lasts), so it can queue the archive again.
--     Same shape as 0606: no viewer, this workspace only, those rows only.
--   · The audit trail learns 'seal_untimestamped': the sealed copy carries our signature but the independent timestamp authority did not answer, so the copy has no trusted timestamp. It is recorded, never silent.
CREATE POLICY system_unarchived_read ON keystone.document_instance FOR SELECT USING (
  tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL AND builder = 'pdf' AND state = 'executed' AND archived_at IS NULL
  AND executed_at IS NOT NULL AND executed_at <= now() - interval '15 minutes'
  AND NOT EXISTS (SELECT 1 FROM keystone.document_pdf p WHERE p.instance_id = document_instance.id));

DO $r3_audit_kind$
DECLARE v_def text; v_name text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def FROM pg_constraint WHERE conrelid = 'keystone.document_audit_event'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind = ANY%';
  IF v_name IS NULL THEN RAISE EXCEPTION '0701: the document_audit_event kind check was not found'; END IF;
  IF v_def LIKE '%seal_untimestamped%' THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE keystone.document_audit_event DROP CONSTRAINT %I', v_name);
  EXECUTE format('ALTER TABLE keystone.document_audit_event ADD CONSTRAINT %I %s', v_name, replace(v_def, ']', ', ''seal_untimestamped''::text]'));
END
$r3_audit_kind$;

DO $r3_self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'keystone.document_instance'::regclass AND polname = 'system_unarchived_read') THEN RAISE EXCEPTION '0701: system_unarchived_read is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'keystone.document_audit_event'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%seal_untimestamped%') THEN RAISE EXCEPTION '0701: the audit kind seal_untimestamped was not added'; END IF;
END
$r3_self_check$;
