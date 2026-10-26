-- 0806 · Usage billing follow-up (25 Oct 2026, found proving the early-invoice threshold on beta): 0762 and 0764 granted the two usage lists to app_worker only, but the worker's tick reads them through the
-- application pool (withCredentialLookup, the app_rw role), exactly as 0748 found for the plan reconcile. Every minute the flush was refused ("permission denied for function list_docustay_usage_pending"),
-- so billable units were never reported to Stripe and Pay as you go usage was never invoiced; the period summary list had the same refusal. Grant both to app_rw.
SET LOCAL ROLE auth_owner;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_usage_pending(integer) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_usage_tenants(timestamptz, timestamptz, integer) TO app_rw;
SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0806 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
