-- 0733 · Launch step 3 fix (13 Oct 2026): the FIRST welcome email must not depend on the web process reaching the job queue (it cannot: the app role has no queue access, measured on the sandbox).
-- The worker's global tick asks this function which workspaces have an owner whose welcome has not gone out yet, and runs the series for each. Additive, idempotent, reads only.
-- the registry read for the one caller with no workspace in hand (same ownership shape as 0730's demo registry): ids and state only, never an address
GRANT SELECT (tenant_id, user_id, started_at, step, opted_out_at, finished_at) ON keystone.docustay_welcome TO auth_owner;
DROP POLICY IF EXISTS welcome_pending_read ON keystone.docustay_welcome;
CREATE POLICY welcome_pending_read ON keystone.docustay_welcome FOR SELECT TO auth_owner USING (true);

SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone_auth.list_pending_welcomes(p_limit integer DEFAULT 25)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT DISTINCT w.tenant_id FROM keystone.docustay_welcome w
   WHERE w.step = -1 AND w.opted_out_at IS NULL AND w.finished_at IS NULL
     AND w.started_at <= now() - interval '45 seconds' AND w.started_at > now() - interval '2 days'
   LIMIT greatest(1, least(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_pending_welcomes(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_pending_welcomes(integer) TO app_worker, app_rw;

SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0733 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
