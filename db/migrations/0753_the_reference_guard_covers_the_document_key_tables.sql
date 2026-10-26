-- 0753 · The three draft-only-key tables (0683) were created without the reference-practice delete/truncate guard.
--
-- ★★★ MEASURED 15 Oct 2026 (SU-001, test/s1_bootstrap_fresh_database.test.mjs): 0683 gave document_key_policy, document_key_usage_day and
--   document_send_approval the reference_guard_read POLICY but not the two refuse_touch_reference_rows TRIGGERS every other tenant-scoped table has
--   (CT-F52 point 5, as 0651 and 0670 do it). Without them a DELETE or TRUNCATE of the reference practice's rows in these tables is not refused.
--   Additive and idempotent: the lend/give-back of EXECUTE and the triggers are exactly 0651's; a trigger that already exists is left alone.
--   The two credit-note tables (Mainstay, 0491) had the opposite gap: both guard triggers but no reference_guard_read POLICY, so the guard could not see the
--   reference practice's rows there and never fired. They get the same policy every other guarded table has.
DROP POLICY IF EXISTS reference_guard_read ON keystone.credit_note;
CREATE POLICY reference_guard_read ON keystone.credit_note FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT ON keystone.credit_note TO reference_guard;
DROP POLICY IF EXISTS reference_guard_read ON keystone.credit_note_line;
CREATE POLICY reference_guard_read ON keystone.credit_note_line FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT ON keystone.credit_note_line TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

DO $reference_guard_document_key_tables$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_key_policy', 'document_key_usage_day', 'document_send_approval'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('keystone.%I', t)::regclass AND tgname = t || '_refuse_reference_delete_trg') THEN
      EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON keystone.%I REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()',
                     t || '_refuse_reference_delete_trg', t);
    END IF;
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', t, t || '_refuse_reference_delete_trg');
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('keystone.%I', t)::regclass AND tgname = t || '_refuse_reference_truncate_trg') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON keystone.%I FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows()',
                     t || '_refuse_reference_truncate_trg', t);
    END IF;
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ALWAYS TRIGGER %I', t, t || '_refuse_reference_truncate_trg');
  END LOOP;
END
$reference_guard_document_key_tables$;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

DO $reference_guard_document_key_tables_self_check$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_key_policy', 'document_key_usage_day', 'document_send_approval'] LOOP
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = format('keystone.%I', t)::regclass AND tgname IN (t || '_refuse_reference_delete_trg', t || '_refuse_reference_truncate_trg') AND tgenabled = 'A') <> 2 THEN
      RAISE EXCEPTION '0753: keystone.% does not carry both reference-guard triggers (ENABLE ALWAYS)', t;
    END IF;
  END LOOP;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0753: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the lend was not revoked';
  END IF;
END
$reference_guard_document_key_tables_self_check$;
