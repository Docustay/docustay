-- 0755_metrics_views_for_posthog — PH1 (Dashboard, 16 Oct 2026; specs/POSTHOG-WIRING-PLAN.md §2 source 4, OPERATION-LIVE §24).
-- A `metrics` schema of VIEWS that PostHog's warehouse and the docustay-metrics service read through the read-only login `posthog_reader`.
-- ★★★ DOCUSTAY ONLY. The production database is shared with Mainstay (GLRS). The views are owned by the NOLOGIN role `metrics_owner`, and
--     `metrics_owner`'s ONLY way into the base tables is the SELECT policies below, each of which admits Docustay rows only
--     (tenant.product = 'docustay'). So a Mainstay row cannot appear even if a view's own WHERE were wrong: the database refuses it.
--     docustay_install / docustay_license are Docustay's own self-host records (their tenant_id is the platform tenant, 0633), so their
--     policies admit every row; they hold no Mainstay customer data.
-- ★★ NO PERSONAL DATA. Ids, dates, states, plans, counts and versions only. Never a name, an email, a workspace name, a document title or
--    content, a signer, a file name, an IP, a key name, or a licence note. api_call_log paths have ids replaced by ':id'.
-- ★ ROLES ARE BOOTSTRAP, NOT MIGRATION (same reason as 0025/0044/0572: migrations run as app_owner, which has no CREATEROLE).
--   Run ops/posthog/bootstrap-metrics-roles.sh as a SUPERUSER once per environment BEFORE this migration; it creates metrics_owner,
--   posthog_reader (password from Secret Manager) and makes app_owner a member of metrics_owner. This file fails loudly without them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metrics_owner') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'posthog_reader') THEN
    RAISE EXCEPTION 'roles metrics_owner and posthog_reader do not exist. They are ROLE BOOTSTRAP: run ops/posthog/bootstrap-metrics-roles.sh as a superuser for this environment, then re-run the migration.';
  END IF;
  IF NOT pg_has_role('app_owner', 'metrics_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'app_owner must be a member of metrics_owner (bootstrap: GRANT metrics_owner TO app_owner).';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS metrics;
REVOKE ALL ON SCHEMA metrics FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA metrics TO metrics_owner;   -- the views' owner must be able to own objects here (it is NOLOGIN)

-- metrics_owner reads the base tables through these policies only (RLS is FORCEd on every one of them).
GRANT USAGE ON SCHEMA keystone TO metrics_owner;
GRANT SELECT ON keystone.tenant, keystone.app_user, keystone.mainstay_subscription, keystone.docustay_demo, keystone.document_instance,
  keystone.billing_event, keystone.docustay_billing_record, keystone.docustay_install, keystone.docustay_license, keystone.api_call_log TO metrics_owner;

CREATE POLICY metrics_docustay_read ON keystone.tenant FOR SELECT TO metrics_owner USING (product = 'docustay');
CREATE POLICY metrics_docustay_read ON keystone.app_user FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.mainstay_subscription FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.docustay_demo FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.document_instance FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.billing_event FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.docustay_billing_record FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.api_call_log FOR SELECT TO metrics_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE product = 'docustay'));
CREATE POLICY metrics_docustay_read ON keystone.docustay_install FOR SELECT TO metrics_owner USING (true);
CREATE POLICY metrics_docustay_read ON keystone.docustay_license FOR SELECT TO metrics_owner USING (true);

CREATE VIEW metrics.workspace AS
  SELECT t.id AS workspace_id, t.created_at, t.status,
         CASE s.plan_key WHEN 'docustay_pro' THEN 'pro' WHEN 'docustay_free' THEN 'free' ELSE s.plan_key END AS plan,
         s.status AS plan_status, s.billing_interval, s.founders_price, s.cancel_at, s.past_due_since,
         (d.tenant_id IS NOT NULL) AS is_demo, d.created_at AS demo_started_at, d.converted_at AS demo_converted_at
    FROM keystone.tenant t
    LEFT JOIN keystone.mainstay_subscription s ON s.tenant_id = t.id
    LEFT JOIN keystone.docustay_demo d ON d.tenant_id = t.id
   WHERE t.product = 'docustay';

CREATE VIEW metrics.account AS
  SELECT u.id AS account_id, u.tenant_id AS workspace_id, u.created_at, u.role, u.staff_role, u.country
    FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id
   WHERE t.product = 'docustay';

CREATE VIEW metrics.document_daily AS
  SELECT d.tenant_id AS workspace_id, (d.sent_at AT TIME ZONE 'UTC')::date AS day,
         count(*) AS sent,
         count(*) FILTER (WHERE d.executed_at IS NOT NULL) AS completed,
         count(*) FILTER (WHERE d.declined_at IS NOT NULL) AS declined,
         count(*) FILTER (WHERE d.voided_at IS NOT NULL) AS voided,
         round(avg(extract(epoch FROM d.executed_at - d.sent_at) / 3600)::numeric, 1) AS avg_hours_to_complete
    FROM keystone.document_instance d JOIN keystone.tenant t ON t.id = d.tenant_id
   WHERE t.product = 'docustay' AND d.sent_at IS NOT NULL AND NOT d.is_test
   GROUP BY 1, 2;

CREATE VIEW metrics.billing_event AS
  SELECT b.event_id, b.tenant_id AS workspace_id, b.type, b.received_at
    FROM keystone.billing_event b JOIN keystone.tenant t ON t.id = b.tenant_id
   WHERE t.product = 'docustay';

CREATE VIEW metrics.billing_record AS
  SELECT r.id, r.tenant_id AS workspace_id, r.kind, r.at
    FROM keystone.docustay_billing_record r JOIN keystone.tenant t ON t.id = r.tenant_id
   WHERE t.product = 'docustay';

CREATE VIEW metrics.selfhost_install AS
  SELECT i.install_id, i.version, i.first_seen_at, i.last_seen_at, i.pings,
         (i.counts->>'workspaces')::int AS workspaces, (i.counts->>'users')::int AS users,
         (i.counts->>'documentsSentThisMonth')::int AS documents_sent_this_month, (i.counts->>'documentsSigned')::int AS documents_signed,
         (i.counts->>'uptimeDays')::int AS uptime_days
    FROM keystone.docustay_install i;

CREATE VIEW metrics.selfhost_license AS
  SELECT l.install_id, l.plan, l.created_at, l.expires_at, l.last_seen_at, l.revoked_at
    FROM keystone.docustay_license l;

CREATE VIEW metrics.api_usage_daily AS
  SELECT (a.at AT TIME ZONE 'UTC')::date AS day, a.tenant_id AS workspace_id,
         a.method || ' ' || regexp_replace(regexp_replace(split_part(a.path, '?', 1), '[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}', ':id', 'g'), '/[0-9A-HJKMNP-TV-Z]{26}', '/:id', 'g') AS endpoint,
         NULL::text AS sdk,   -- api_call_log keeps no user agent today; filled when it does
         (a.status / 100)::text || 'xx' AS status_class,
         count(*) AS calls, count(*) FILTER (WHERE a.status >= 400) AS errors
    FROM keystone.api_call_log a JOIN keystone.tenant t ON t.id = a.tenant_id
   WHERE t.product = 'docustay'
   GROUP BY 1, 2, 3, 5;

-- granted while app_owner still owns the views; the grants carry over to the new owner
GRANT USAGE ON SCHEMA metrics TO posthog_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA metrics TO posthog_reader;

ALTER VIEW metrics.workspace OWNER TO metrics_owner;
ALTER VIEW metrics.account OWNER TO metrics_owner;
ALTER VIEW metrics.document_daily OWNER TO metrics_owner;
ALTER VIEW metrics.billing_event OWNER TO metrics_owner;
ALTER VIEW metrics.billing_record OWNER TO metrics_owner;
ALTER VIEW metrics.selfhost_install OWNER TO metrics_owner;
ALTER VIEW metrics.selfhost_license OWNER TO metrics_owner;
ALTER VIEW metrics.api_usage_daily OWNER TO metrics_owner;

