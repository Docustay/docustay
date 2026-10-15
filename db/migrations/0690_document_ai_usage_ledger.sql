-- 0690 · AI COST AND USAGE (specs/final-push/AI-COST-AND-USAGE-SPEC.md §4–§6). Additive. ONE row for every model call (and every refusal), so the usage bar, the monthly dollar cap, the request limits, the platform ceiling
-- and the platform AI-usage screen all read the same real numbers.
--  1 · document_ai_usage_event — the cost ledger, one workspace's rows each (forced row security like every tenant table). A failed or refused call is recorded and charges nothing.
--  2 · THE PLATFORM'S VIEW, in the pattern of 0631/0642: `auth_owner` (cannot log in) may read the non-personal columns of every workspace's rows, reachable ONLY through SECURITY DEFINER functions.
--      · document_ai_platform_spend(from)   — ONE number (dollars spent by workspaces on the platform's own key since a moment). No workspace, no person: the gateway of every workspace asks it to know whether the ceiling is reached.
--      · document_ai_platform_report / _top / _events — the platform screen and its CSV; they answer only when docustay_may_view() is true (the named platform viewers).
--  3 · THE PLATFORM'S CEILING AND PAUSE live as two settings of the platform organisation (`platform.ai_monthly_usd`, `platform.ai_paused`); document_ai_platform_state() reads them for any workspace (two values and the organisation's id, nothing else).
CREATE TABLE keystone.document_ai_usage_event (
  id                 uuid          PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid          NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  user_id            uuid          NULL,
  feature            text          NOT NULL CHECK (feature IN ('draft','edit','chat','file_read','detect','think_harder','review','summary','check','play','vision_check')),
  provider           text          NULL,
  model              text          NULL,
  effort             text          NULL,
  input_tokens       integer       NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens      integer       NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  integer       NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer       NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cost_micro_usd     bigint        NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  credits            numeric(8,3)  NOT NULL DEFAULT 0 CHECK (credits >= 0),
  status             text          NOT NULL CHECK (status IN ('ok','refused_limit','refused_ceiling','error')),
  own_key            boolean       NOT NULL DEFAULT false,
  plan_key           text          NULL,
  duration_ms        integer       NULL,
  request_id         text          NULL,
  code               text          NULL CHECK (code IS NULL OR char_length(code) <= 60),
  CONSTRAINT document_ai_usage_event_user_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (user_id)
);
CREATE UNIQUE INDEX document_ai_usage_event_tenant_id_key ON keystone.document_ai_usage_event (tenant_id, id);
CREATE INDEX document_ai_usage_event_tenant_at_idx ON keystone.document_ai_usage_event (tenant_id, created_at DESC);
CREATE INDEX document_ai_usage_event_ok_at_idx ON keystone.document_ai_usage_event (created_at) WHERE status = 'ok';

ALTER TABLE keystone.document_ai_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_ai_usage_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_ai_usage_event USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_ai_usage_event FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.document_ai_usage_event FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT ON keystone.document_ai_usage_event TO app_rw, app_worker;
GRANT SELECT ON keystone.document_ai_usage_event TO reference_guard;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER document_ai_usage_event_refuse_reference_delete_trg AFTER DELETE ON keystone.document_ai_usage_event
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_ai_usage_event ENABLE ALWAYS TRIGGER document_ai_usage_event_refuse_reference_delete_trg;
CREATE TRIGGER document_ai_usage_event_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_ai_usage_event
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();

-- the job row remembers a Think harder request (Pro) so the worker runs it on the dearer model and charges its weight
ALTER TABLE keystone.document_ai_job ADD COLUMN IF NOT EXISTS think_harder boolean NOT NULL DEFAULT false;

-- (2) the platform's view: the non-personal columns only, through definer functions
GRANT SELECT (id, tenant_id, created_at, feature, provider, model, effort, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, credits, status, own_key, plan_key, duration_ms, code) ON keystone.document_ai_usage_event TO auth_owner;
DROP POLICY IF EXISTS ai_platform_read ON keystone.document_ai_usage_event;
CREATE POLICY ai_platform_read ON keystone.document_ai_usage_event FOR SELECT TO auth_owner USING (true);
GRANT SELECT (id, name, is_platform) ON keystone.tenant TO auth_owner;

SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.document_ai_platform_spend(p_from timestamptz) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(e.cost_micro_usd), 0)::bigint FROM keystone.document_ai_usage_event e WHERE e.status IN ('ok', 'error') AND NOT e.own_key AND e.created_at >= p_from
$$;
CREATE OR REPLACE FUNCTION keystone.document_ai_platform_report(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (day date, plan_key text, feature text, model text, status text, calls integer, credits numeric, cost_micro_usd bigint, workspaces integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (e.created_at AT TIME ZONE 'UTC')::date, e.plan_key, e.feature, e.model, e.status, count(*)::int, COALESCE(sum(e.credits), 0), COALESCE(sum(e.cost_micro_usd), 0)::bigint, count(DISTINCT e.tenant_id)::int
    FROM keystone.document_ai_usage_event e
   WHERE e.created_at >= p_from AND e.created_at < p_to AND keystone.docustay_may_view()
   GROUP BY 1, 2, 3, 4, 5
$$;
CREATE OR REPLACE FUNCTION keystone.document_ai_platform_top(p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 10)
RETURNS TABLE (tenant_id uuid, workspace text, plan_key text, calls integer, credits numeric, cost_micro_usd bigint, errors integer, own_key boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.tenant_id, t.name, (array_agg(e.plan_key ORDER BY e.created_at DESC))[1], count(*) FILTER (WHERE e.status = 'ok')::int, COALESCE(sum(e.credits), 0), COALESCE(sum(e.cost_micro_usd), 0)::bigint,
         count(*) FILTER (WHERE e.status = 'error')::int, bool_or(e.own_key)
    FROM keystone.document_ai_usage_event e JOIN keystone.tenant t ON t.id = e.tenant_id
   WHERE e.created_at >= p_from AND e.created_at < p_to AND keystone.docustay_may_view()
   GROUP BY e.tenant_id, t.name ORDER BY 6 DESC LIMIT GREATEST(1, LEAST(p_limit, 200))
$$;
CREATE OR REPLACE FUNCTION keystone.document_ai_platform_events(p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 5000)
RETURNS TABLE (created_at timestamptz, tenant_id uuid, plan_key text, feature text, provider text, model text, effort text, input_tokens integer, output_tokens integer, cache_read_tokens integer, cache_write_tokens integer, cost_micro_usd bigint, credits numeric, status text, own_key boolean, duration_ms integer, code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.created_at, e.tenant_id, e.plan_key, e.feature, e.provider, e.model, e.effort, e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens, e.cost_micro_usd, e.credits, e.status, e.own_key, e.duration_ms, e.code
    FROM keystone.document_ai_usage_event e WHERE e.created_at >= p_from AND e.created_at < p_to AND keystone.docustay_may_view() ORDER BY e.created_at DESC LIMIT GREATEST(1, LEAST(p_limit, 20000))
$$;
REVOKE ALL ON FUNCTION keystone.document_ai_platform_spend(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.document_ai_platform_report(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.document_ai_platform_top(timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.document_ai_platform_events(timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_ai_platform_spend(timestamptz) TO app_rw, app_worker, app_owner;
GRANT EXECUTE ON FUNCTION keystone.document_ai_platform_report(timestamptz, timestamptz) TO app_rw, app_worker, app_owner;
GRANT EXECUTE ON FUNCTION keystone.document_ai_platform_top(timestamptz, timestamptz, integer) TO app_rw, app_worker, app_owner;
GRANT EXECUTE ON FUNCTION keystone.document_ai_platform_events(timestamptz, timestamptz, integer) TO app_rw, app_worker, app_owner;
SET LOCAL ROLE app_owner;

-- (3) the ceiling and the pause: two settings of the platform organisation, readable by ANY workspace's gateway through this one function (two values and the platform organisation's id, nothing else).
--     The write side is the platform screen, in the platform organisation's own session (the ordinary settings door; the keys are registered in src/settings/keys.mjs). The "alert sent" markers are kept the same way by the worker, inside that organisation.
DROP POLICY IF EXISTS ai_platform_state_read ON keystone.tenant_setting;
CREATE POLICY ai_platform_state_read ON keystone.tenant_setting FOR SELECT TO app_owner
  USING (key IN ('platform.ai_monthly_usd', 'platform.ai_paused') AND tenant_id IN (SELECT t.id FROM keystone.tenant t WHERE t.is_platform));
CREATE OR REPLACE FUNCTION keystone.document_ai_platform_state() RETURNS TABLE (platform_tenant_id uuid, monthly_usd numeric, paused boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT t.id FROM keystone.tenant t WHERE t.is_platform LIMIT 1),
         (SELECT (s.value #>> '{}')::numeric FROM keystone.tenant_setting s WHERE s.key = 'platform.ai_monthly_usd' AND s.tenant_id IN (SELECT t.id FROM keystone.tenant t WHERE t.is_platform) LIMIT 1),
         COALESCE((SELECT (s.value #>> '{}')::boolean FROM keystone.tenant_setting s WHERE s.key = 'platform.ai_paused' AND s.tenant_id IN (SELECT t.id FROM keystone.tenant t WHERE t.is_platform) LIMIT 1), false)
$$;
REVOKE ALL ON FUNCTION keystone.document_ai_platform_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_ai_platform_state() TO app_rw, app_worker;

-- the usage bar redraws when a call is recorded (the same 'ai' change message as a draft finishing; 0686/0687)
DROP TRIGGER IF EXISTS ks_notify_change ON keystone.document_ai_usage_event;
CREATE TRIGGER ks_notify_change AFTER INSERT ON keystone.document_ai_usage_event FOR EACH ROW EXECUTE FUNCTION keystone.ks_notify_change('ai');
