-- 0762 · Docustay v1 item 20/21/25: usage billing. Two small tables.
--  · docustay_usage_event: one row per BILLABLE unit (a document sent past the plan's included amount, an AI draft past it). The `identifier` is the Stripe meter event identifier, so a retry can never bill twice.
--    status pending → sent (or failed after many tries; the worker keeps retrying pending rows). Also the ledger the budget and the usage screens read. Ids and numbers only, no names, no addresses.
--  · docustay_budget: the workspace's monthly spending budget (cents; default set in code) and the alert/pause state for the month. Stored as cents, never a float.
CREATE TABLE IF NOT EXISTS keystone.docustay_usage_event (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('document','ai_draft')),
  identifier   text        NOT NULL CHECK (length(identifier) BETWEEN 1 AND 100),
  units        integer     NOT NULL DEFAULT 1 CHECK (units > 0),
  unit_minor   integer     NOT NULL CHECK (unit_minor >= 0),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts     integer     NOT NULL DEFAULT 0,
  last_error   text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  UNIQUE (tenant_id, identifier)
);
CREATE INDEX IF NOT EXISTS docustay_usage_event_period ON keystone.docustay_usage_event (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS docustay_usage_event_pending ON keystone.docustay_usage_event (status, occurred_at) WHERE status <> 'sent';
ALTER TABLE keystone.docustay_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_usage_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_usage_event;
CREATE POLICY tenant_isolation ON keystone.docustay_usage_event USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
DROP POLICY IF EXISTS workspace_deletion ON keystone.docustay_usage_event;
CREATE POLICY workspace_deletion ON keystone.docustay_usage_event FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT, UPDATE ON keystone.docustay_usage_event TO app_rw, app_worker;
GRANT SELECT (tenant_id, status, occurred_at) ON keystone.docustay_usage_event TO auth_owner;
DROP POLICY IF EXISTS docustay_usage_pending_read ON keystone.docustay_usage_event;
CREATE POLICY docustay_usage_pending_read ON keystone.docustay_usage_event FOR SELECT TO auth_owner USING (status <> 'sent');

CREATE TABLE IF NOT EXISTS keystone.docustay_budget (
  tenant_id     uuid        PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  budget_minor  integer     CHECK (budget_minor IS NULL OR budget_minor >= 0),   -- NULL = the default from the price list
  period_start  timestamptz,                                                    -- the month the alert flags below belong to
  alerts_sent   jsonb       NOT NULL DEFAULT '[]'::jsonb,                       -- percents already announced this period: [50, 80, 100]
  paused_at     timestamptz,                                                    -- set when unbilled usage reached the budget; cleared when the budget is raised or the month turns
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.docustay_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_budget FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_budget;
CREATE POLICY tenant_isolation ON keystone.docustay_budget USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
DROP POLICY IF EXISTS workspace_deletion ON keystone.docustay_budget;
CREATE POLICY workspace_deletion ON keystone.docustay_budget FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT, UPDATE ON keystone.docustay_budget TO app_rw, app_worker;

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone_auth.list_docustay_usage_pending(p_limit integer DEFAULT 200)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT DISTINCT u.tenant_id FROM keystone.docustay_usage_event u WHERE u.status <> 'sent' ORDER BY u.tenant_id LIMIT greatest(1, least(p_limit, 1000));
$$;
REVOKE ALL ON FUNCTION keystone_auth.list_docustay_usage_pending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone_auth.list_docustay_usage_pending(integer) TO app_worker;
SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0762 finished as % — it must hand back to app_owner', current_user; END IF;
END $$;
