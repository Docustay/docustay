-- 0362_support_access_schema
-- Support access grants: platform operators granted scoped access to tenants with time-bound expiry.
--
-- ★★ TENANT-SCOPED WITH FORCE ROW LEVEL SECURITY, following every other table in the schema.
--    A grant is tied to a practice (tenant_id), not a platform operator directly.
--
-- ★★★ "A GRANT NEVER OUTLIVES ITS EXPIRY" — enforced at READ time via supportAccess.mjs, not just
--     at write time. Any function checking whether a grant is currently active must verify both
--     expires_at > now() AND revoked_at IS NULL.

CREATE TABLE keystone.support_access (
  id                   uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id            uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  operator_user_id     uuid        NOT NULL,
  granted_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  allow_changes        boolean     NOT NULL DEFAULT false,
  allow_private_notes  boolean     NOT NULL DEFAULT false,
  revoked_at           timestamptz,
  CONSTRAINT expires_after_grant CHECK (expires_at > granted_at)
);

CREATE INDEX support_access_tenant_idx ON keystone.support_access (tenant_id);
CREATE INDEX support_access_operator_idx ON keystone.support_access (operator_user_id);
-- ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): Postgres refused the original predicate
--   `WHERE revoked_at IS NULL AND expires_at > now()` — "functions in index predicate must be
--   marked IMMUTABLE" — now() is STABLE, not IMMUTABLE, so it can't define a static partial index.
--   `revoked_at IS NULL` alone (immutable) still narrows the index to non-revoked grants; the
--   `expires_at > now()` half of "currently active" is checked at query/application time instead
--   (src/platform/supportAccess.mjs's isGrantActive() already does this correctly — it was only
--   the INDEX predicate that over-reached, not the actual enforcement logic).
CREATE INDEX support_access_tenant_active_idx ON keystone.support_access (tenant_id, expires_at)
  WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.support_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.support_access FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.support_access
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.support_access
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE ON keystone.support_access TO app_rw;

-- ★ Prove FORCE RLS is on (same safety check as every other table).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.support_access'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0362: FORCE ROW LEVEL SECURITY was not enabled on keystone.support_access';
  END IF;
END
$$;
