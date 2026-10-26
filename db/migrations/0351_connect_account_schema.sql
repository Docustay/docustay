-- 0351_connect_account_schema
-- Stripe Connect: per-practice account connection state and metadata.
--
-- ★★ STRIPE CONNECT PATTERN. A practice connects THEIR OWN Stripe account to Mainstay, so
--    charges land on their account, not the platform's. This table records the state of that
--    connection: not connected, pending (waiting for the practice owner to complete OAuth),
--    live (connected and ready for charging), or restricted (Stripe's compliance checks failed).
--    ★ A practice may have only one connected account at a time.
--
-- ★ TENANT-SCOPED WITH FORCE ROW LEVEL SECURITY, following every other table in the schema.

CREATE TABLE keystone.connect_account (
  id                  uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id           uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  stripe_account_id   text        UNIQUE,
  state               text        NOT NULL DEFAULT 'not_connected'
                                  CHECK (state IN ('not_connected', 'pending', 'live', 'restricted')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX connect_account_tenant_idx ON keystone.connect_account (tenant_id);
CREATE INDEX connect_account_tenant_state_idx ON keystone.connect_account (tenant_id, state);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.connect_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.connect_account FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.connect_account
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.connect_account
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON keystone.connect_account TO app_rw;

-- ★ Prove FORCE RLS is on (same safety check as every other table).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.connect_account'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0351: FORCE ROW LEVEL SECURITY was not enabled on keystone.connect_account';
  END IF;
END
$$;
