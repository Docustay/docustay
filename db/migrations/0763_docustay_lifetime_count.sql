-- 0763 · Docustay v1 item 17: how many workspaces hold Lifetime. Lifetime is for the first 200 workspaces; checkout reads this number (one count, no names, across all workspaces).
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.docustay_lifetime_count() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::int FROM keystone.workbench_subscription WHERE plan_key = 'docustay_lifetime'
$$;
REVOKE ALL ON FUNCTION keystone.docustay_lifetime_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_lifetime_count() TO app_rw, app_worker;
SET LOCAL ROLE app_owner;
DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0763 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
