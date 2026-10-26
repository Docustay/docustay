-- 0350_telemetry_event_table
-- Instrumentation: screen-view and flow-step events for evidence-based analysis.
--
-- ★★ NEW TABLE, SEPARATE FROM THE OUTBOX. The outbox (`keystone.event`) records auditable
--    business facts — payments, permissions, documents signed — with full subject/actor/topic
--    validation. Telemetry tracks UI navigation and flow steps, is HIGH-VOLUME, and needs to be
--    CHEAP and FAIL-SILENT (a telemetry write failure must never interrupt user work).
--    Reusing `keystone.event` for every screen view would flood the audit trail with noise and
--    add validation overhead to every navigation; a purpose-built table keeps both concerns separate.
--
-- ★ TENANT-SCOPED WITH FORCE ROW LEVEL SECURITY, following every other table in the schema.

CREATE TABLE keystone.telemetry_event (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id  uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  kind         text        NOT NULL CHECK (kind IN ('screen_view', 'flow_step')),
  path         text        NOT NULL,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX telemetry_event_tenant_idx ON keystone.telemetry_event (tenant_id);
CREATE INDEX telemetry_event_tenant_created_idx ON keystone.telemetry_event (tenant_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.telemetry_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.telemetry_event FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.telemetry_event
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.telemetry_event
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON keystone.telemetry_event TO app_rw;

-- ★ Prove FORCE RLS is on (same safety check as every other table).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.telemetry_event'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0350: FORCE ROW LEVEL SECURITY was not enabled on keystone.telemetry_event';
  END IF;
END
$$;
