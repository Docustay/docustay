-- 0732 · Launch (13 Oct 2026): four Run 9 tables carry a tenant_id but not the workspace-deletion policy every tenant table must have (0695's rule, enforced by test/workspace_deletion.test.mjs):
-- document_template_creation, document_form_publication, document_access_event, workspace_file_key. Without it the workspace owner's "delete workspace" cannot remove their rows (the delete would be
-- refused or leave rows behind). Additive and idempotent: only the missing policy is added, nothing else about the tables changes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_template_creation', 'document_form_publication', 'document_access_event', 'workspace_file_key'] LOOP
    IF to_regclass(format('keystone.%I', t)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS workspace_deletion ON keystone.%I', t);
      EXECUTE format('CREATE POLICY workspace_deletion ON keystone.%I FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id))', t);
    END IF;
  END LOOP;
END $$;
DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0732 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
