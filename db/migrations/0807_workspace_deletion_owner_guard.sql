-- 0807: deleting a workspace failed with "a practice must always have an Owner": 0803 (Make Owner) re-created enforce_last_owner() from the pre-0695 body and lost the early exit 0695 added, so removing the last Owner's row while keystone.delete_workspace() runs was refused again.
-- Same function as 0803 with that one line put back, first, so a hand-over and an ordinary removal behave as before and only a workspace being deleted (same transaction, set by delete_workspace) passes.
CREATE OR REPLACE FUNCTION keystone.enforce_last_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_tenant text;
  v_owners        integer;
BEGIN
  IF TG_OP = 'DELETE' AND keystone.workspace_deletion_active(OLD.tenant_id) THEN RETURN OLD; END IF;   -- 0695's exception, which 0803 dropped: the whole workspace is going
  IF OLD.staff_role IS DISTINCT FROM 'owner' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.staff_role IS NOT DISTINCT FROM 'owner' AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  -- a hand-over in progress (keystone.transfer_ownership) re-checks the whole rule itself before it returns
  IF TG_OP = 'UPDATE' AND current_setting('keystone.owner_transfer', true) = 'on' THEN RETURN NEW; END IF;
  v_caller_tenant := current_setting('keystone.tenant_id', true);
  BEGIN
    PERFORM set_config('keystone.tenant_id', OLD.tenant_id::text, true);
    SELECT count(*) INTO v_owners FROM keystone.app_user u WHERE u.tenant_id = OLD.tenant_id AND u.staff_role = 'owner' AND u.id <> OLD.id;
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
    RAISE;
  END;
  IF v_owners = 0 THEN
    RAISE EXCEPTION 'a practice must always have an Owner'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('app_user %s is the only person with staff_role = ''owner'' in practice %s', OLD.id, OLD.tenant_id),
            HINT    = 'Give the Owner rank to somebody else in this practice first, then change or remove this person.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

-- The second reason a scheduled workspace deletion failed ("violates foreign key constraint audit_entry_tenant_id_fkey"): the cooling-off job runs without a signed-in person, and a DELETE with a WHERE clause only removes rows the SELECT policies also let it see.
-- audit_entry's read policy asks "is the viewer allowed to read the audit log", which is false for the job, so its rows were skipped silently and the workspace row could not go. Every table that has the deletion policy now also gets a read policy for app_owner that is true ONLY while that workspace's deletion is in flight (same test as the delete policy).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS s, c.relname AS t FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE p.polname = 'workspace_deletion' AND c.relname <> 'tenant' LOOP
    EXECUTE format('DROP POLICY IF EXISTS workspace_deletion_read ON %I.%I', r.s, r.t);
    EXECUTE format('CREATE POLICY workspace_deletion_read ON %I.%I FOR SELECT TO app_owner USING (keystone.workspace_deletion_active(tenant_id))', r.s, r.t);
  END LOOP;
END $$;
