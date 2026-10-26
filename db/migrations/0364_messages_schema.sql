-- 0364_messages_schema
-- Messages: thread-based messaging between clients and staff, with read state tracking.
--
-- ★★ TWO TABLES, TENANT-SCOPED WITH FORCED ROW LEVEL SECURITY.
--    `message_thread` groups messages between a client and their practice.
--    `message` carries individual messages with optional read_at for tracking delivery and read state.

CREATE TABLE keystone.message_thread (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  person_id    uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_thread_tenant_idx ON keystone.message_thread (tenant_id);
CREATE INDEX message_thread_person_idx ON keystone.message_thread (tenant_id, person_id);
CREATE INDEX message_thread_updated_idx ON keystone.message_thread (tenant_id, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE on message_thread
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.message_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.message_thread FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.message_thread
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.message_thread
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Message table: individual messages within a thread
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.message (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  thread_id    uuid        NOT NULL REFERENCES keystone.message_thread(id) ON DELETE CASCADE,
  sender_type  text        NOT NULL CHECK (sender_type IN ('staff', 'client')),
  sender_id    uuid        NOT NULL,
  body         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz
);

CREATE INDEX message_tenant_idx ON keystone.message (tenant_id);
CREATE INDEX message_thread_idx ON keystone.message (tenant_id, thread_id);
CREATE INDEX message_thread_created_idx ON keystone.message (tenant_id, thread_id, created_at);
CREATE INDEX message_unread_idx ON keystone.message (tenant_id, thread_id) WHERE read_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE on message
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.message FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.message
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.message
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON keystone.message_thread TO app_rw;
GRANT SELECT, INSERT, UPDATE ON keystone.message TO app_rw;

-- ★ Prove FORCE RLS is on (same safety check as every other table).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.message_thread'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0364: FORCE ROW LEVEL SECURITY was not enabled on keystone.message_thread';
  END IF;
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.message'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0364: FORCE ROW LEVEL SECURITY was not enabled on keystone.message';
  END IF;
END
$$;
