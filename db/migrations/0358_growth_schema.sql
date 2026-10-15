-- 0358_growth_schema
-- Growth module schema: consent records, landing pages, funnel events, AI requests, campaign batches.
--
-- ★ TENANT-SCOPED WITH FORCE ROW LEVEL SECURITY, following every other table in the schema.
--   Every table carries tenant_id and RLS isolation. funnel_event is append-only (no UPDATE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · CONSENT_RECORD — who gave consent, for what, when, how, and current status
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.consent_record (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  person_id        uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  consent_type     text        NOT NULL CHECK (consent_type IN ('marketing', 'terms_of_service', 'privacy_policy')),
  ip_address       text,
  user_agent       text,
  consent_method   text        NOT NULL CHECK (consent_method IN ('web_form', 'api', 'import', 'manual')),
  detail           text,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz
);

CREATE INDEX consent_record_tenant_idx ON keystone.consent_record (tenant_id);
CREATE INDEX consent_record_person_idx ON keystone.consent_record (person_id, consent_type);
CREATE INDEX consent_record_active_idx ON keystone.consent_record (tenant_id, is_active);

ALTER TABLE keystone.consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.consent_record FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.consent_record
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.consent_record
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.consent_record TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · LANDING_PAGE — publishable marketing pages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.landing_page (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  slug             text        NOT NULL,
  title            text        NOT NULL,
  body             text,
  is_published     boolean     NOT NULL DEFAULT false,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX landing_page_slug ON keystone.landing_page (tenant_id, slug);
CREATE INDEX landing_page_tenant_idx ON keystone.landing_page (tenant_id);
CREATE INDEX landing_page_published_idx ON keystone.landing_page (tenant_id, is_published);

ALTER TABLE keystone.landing_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.landing_page FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.landing_page
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.landing_page
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.landing_page TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · FUNNEL_EVENT — append-only page views and conversion events
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.funnel_event (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  landing_page_id  uuid        REFERENCES keystone.landing_page(id) ON DELETE SET NULL,
  campaign_id      uuid,
  event_type       text        NOT NULL CHECK (event_type IN ('page_view', 'conversion', 'booking', 'client_created')),
  session_id       text,
  visitor_id       text,
  person_id        uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  utm_source       text,
  utm_medium       text,
  utm_campaign     text,
  source_tag       text,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX funnel_event_tenant_idx ON keystone.funnel_event (tenant_id);
CREATE INDEX funnel_event_landing_page_idx ON keystone.funnel_event (landing_page_id, created_at DESC);
CREATE INDEX funnel_event_session_idx ON keystone.funnel_event (session_id);
CREATE INDEX funnel_event_visitor_idx ON keystone.funnel_event (tenant_id, visitor_id);
CREATE INDEX funnel_event_created_idx ON keystone.funnel_event (tenant_id, created_at DESC);

ALTER TABLE keystone.funnel_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.funnel_event FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.funnel_event
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.funnel_event
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT ON keystone.funnel_event TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · GROWTH_AI_REQUEST — AI draft request history
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.growth_ai_request (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  landing_page_id  uuid        REFERENCES keystone.landing_page(id) ON DELETE SET NULL,
  requested_by     uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  prompt           text        NOT NULL,
  response_text    text,
  request_status   text        NOT NULL CHECK (request_status IN ('pending', 'completed', 'failed')),
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE INDEX growth_ai_request_tenant_idx ON keystone.growth_ai_request (tenant_id);
CREATE INDEX growth_ai_request_landing_page_idx ON keystone.growth_ai_request (landing_page_id);
CREATE INDEX growth_ai_request_created_idx ON keystone.growth_ai_request (tenant_id, created_at DESC);

ALTER TABLE keystone.growth_ai_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.growth_ai_request FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.growth_ai_request
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.growth_ai_request
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.growth_ai_request TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · CAMPAIGN_SEND_BATCH — resumable bulk-send job progress
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE keystone.campaign_send_batch (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  campaign_id      uuid        NOT NULL,
  total_count      integer     NOT NULL CHECK (total_count > 0),
  sent_count       integer     NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count     integer     NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  batch_status     text        NOT NULL CHECK (batch_status IN ('pending', 'in_progress', 'completed', 'failed', 'paused')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

CREATE INDEX campaign_send_batch_tenant_idx ON keystone.campaign_send_batch (tenant_id);
CREATE INDEX campaign_send_batch_campaign_idx ON keystone.campaign_send_batch (campaign_id);
CREATE INDEX campaign_send_batch_status_idx ON keystone.campaign_send_batch (tenant_id, batch_status);

ALTER TABLE keystone.campaign_send_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.campaign_send_batch FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.campaign_send_batch
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.campaign_send_batch
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.campaign_send_batch TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: Verify FORCE is on for all five tables
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.consent_record'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0358: FORCE ROW LEVEL SECURITY was not enabled on keystone.consent_record';
  END IF;

  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.landing_page'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0358: FORCE ROW LEVEL SECURITY was not enabled on keystone.landing_page';
  END IF;

  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.funnel_event'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0358: FORCE ROW LEVEL SECURITY was not enabled on keystone.funnel_event';
  END IF;

  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.growth_ai_request'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0358: FORCE ROW LEVEL SECURITY was not enabled on keystone.growth_ai_request';
  END IF;

  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.campaign_send_batch'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0358: FORCE ROW LEVEL SECURITY was not enabled on keystone.campaign_send_batch';
  END IF;
END
$$;
