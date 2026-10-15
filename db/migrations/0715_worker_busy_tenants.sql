-- 0715 · Run 8 (F962) — THE WORKER'S PER-MINUTE SWEEP MUST NOT GROW WITH EVERY EMPTY FREE WORKSPACE.
-- MEASURED (local, 1478 workspaces, concurrency 5): sweep_tenants queues ~14 per-workspace jobs a minute for EVERY active workspace; the worker
-- processed ~90 jobs/s, the runnable backlog held at ~19 000 and the oldest runnable job was 35 minutes old — so a document's deadline, a reminder,
-- a scheduled send or a webhook retry ran tens of minutes late. Docustay is self-serve: every Free sign-up is one more workspace on that sweep.
-- keystone_auth.list_busy_tenant_ids() names the workspaces that need the per-minute sweep: every non-Docustay workspace (the platform keeps its cadence:
-- a booking reminder must not be late), and a Docustay workspace only when it did anything in the last day, or has a scheduled send or a signing
-- deadline coming up. The worker sweeps every other Docustay workspace once every 15 minutes, spread across the quarter hour (src/queue/tasks.mjs).
-- Additive: an index, a column-level read for auth_owner (four columns: who, state and two times — no content), a policy for that role, one function.
-- Same ownership shape as 0044 and 0145: the function is created AS auth_owner (it reads keystone.tenant through tenant_health_read and keystone.event
-- through event_health_read, both existing) and the migration hands back to app_owner.

CREATE INDEX IF NOT EXISTS event_tenant_created ON keystone.event (tenant_id, created_at DESC);

-- auth_owner may see WHEN a workspace has a scheduled send or a deadline, and nothing else about any document
GRANT SELECT (tenant_id, state, scheduled_send_at, expires_at) ON keystone.document_instance TO auth_owner;
DROP POLICY IF EXISTS busy_probe_read ON keystone.document_instance;
CREATE POLICY busy_probe_read ON keystone.document_instance FOR SELECT TO auth_owner USING (true);
COMMENT ON POLICY busy_probe_read ON keystone.document_instance IS
  'Run 8 (F962) — auth_owner (owner of keystone_auth.list_busy_tenant_ids) reads which workspaces have a scheduled send or a deadline coming up. Its column grant is tenant_id, state, scheduled_send_at and expires_at only.';

SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone_auth.list_busy_tenant_ids(p_since interval DEFAULT interval '1 day', p_ahead interval DEFAULT interval '20 minutes')
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT t.id FROM keystone.tenant t
   WHERE t.status = 'active'
     AND (t.product IS DISTINCT FROM 'docustay'
          OR EXISTS (SELECT 1 FROM keystone.event e WHERE e.tenant_id = t.id AND e.created_at > now() - p_since)
          OR EXISTS (SELECT 1 FROM keystone.document_instance i
                      WHERE i.tenant_id = t.id
                        AND ((i.state = 'draft' AND i.scheduled_send_at IS NOT NULL AND i.scheduled_send_at <= now() + p_ahead)
                          OR (i.state IN ('sent', 'partially_signed') AND i.expires_at IS NOT NULL AND i.expires_at <= now() + p_ahead))))
   ORDER BY t.id;
$$;

REVOKE ALL ON FUNCTION keystone_auth.list_busy_tenant_ids(interval, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_busy_tenant_ids(interval, interval) TO app_worker;

COMMENT ON FUNCTION keystone_auth.list_busy_tenant_ids(interval, interval) IS
  'Run 8 (F962) — the active workspaces that need the per-minute sweep: every non-Docustay one, and a Docustay one with an event in the last p_since, '
  'or a scheduled send or a signing deadline within p_ahead. SECURITY DEFINER, owned by auth_owner (FORCE RLS, as list_active_tenant_ids); EXECUTE to app_worker only. '
  'Returns ids only.';

SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0715 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
