-- 0748 · Billing audit follow-up (15 Oct 2026, found proving the renewal email): 0736 granted the Docustay reconcile list to app_worker only, but the worker's task code reads it through the application pool
-- (withCredentialLookup, the app_rw role), so every run was refused ("permission denied for function") and the daily plan reconcile and the renewal reminder never ran. Grant both list functions to app_rw.
SET LOCAL ROLE auth_owner;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_subscriptions(integer) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_subscriptions_after(uuid, integer) TO app_rw;
SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0748 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
