-- 0361_site_tiers
-- Tier catalogue: Starter/Pro/Enterprise tiers available across the whole product.
-- Per-account tier assignment with RLS.
--
-- ★★★ TWO TABLES, DIFFERENT RLS PATTERNS:
--   · `keystone.site_tier` — platform-level catalogue (no tenant_id). Tiers like Starter/Pro/Enterprise
--     exist across the whole product. Platform operators manage tiers and edit placeholder prices;
--     each tier records which Stripe price it mirrors. Readable by all (USING (true)), writable only
--     by platform operators (caller_is_platform() check).
--   · `keystone.tenant_site_tier` — per-tenant/per-account assignment. Which tier each practice is on.
--     A practice can read its own tier assignment; only platform operators can write it (INSERT/UPDATE/DELETE
--     gated on caller_is_platform()).

CREATE TABLE keystone.site_tier (
  id                        uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  name                      text        NOT NULL UNIQUE,
  placeholder_price_minor   integer     NOT NULL,
  stripe_price_id           text,
  display_order             integer     NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX site_tier_display_order_idx ON keystone.site_tier (display_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.site_tier ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.site_tier FORCE  ROW LEVEL SECURITY;

-- ★ Everyone can read the tier catalogue (USING (true)), but only platform operators can modify it.
CREATE POLICY site_tier_read ON keystone.site_tier
  AS PERMISSIVE FOR SELECT USING (true);

CREATE POLICY site_tier_insert ON keystone.site_tier
  AS PERMISSIVE FOR INSERT WITH CHECK (keystone.caller_is_platform());

CREATE POLICY site_tier_update ON keystone.site_tier
  AS PERMISSIVE FOR UPDATE
  USING (keystone.caller_is_platform())
  WITH CHECK (keystone.caller_is_platform());

CREATE POLICY site_tier_delete ON keystone.site_tier
  AS PERMISSIVE FOR DELETE USING (keystone.caller_is_platform());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.site_tier TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ tenant_site_tier — per-account tier assignment, tenant-scoped
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.tenant_site_tier (
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  site_tier_id uuid        NOT NULL REFERENCES keystone.site_tier(id) ON DELETE RESTRICT,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id)
);

CREATE INDEX tenant_site_tier_tier_idx ON keystone.tenant_site_tier (site_tier_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.tenant_site_tier ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_site_tier FORCE  ROW LEVEL SECURITY;

-- ★ A tenant can read its own tier assignment; only platform operators can write.
CREATE POLICY tenant_isolation ON keystone.tenant_site_tier
  FOR SELECT USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.tenant_site_tier
  FOR INSERT WITH CHECK (keystone.caller_is_platform());

CREATE POLICY tenant_update ON keystone.tenant_site_tier
  FOR UPDATE
  USING (keystone.caller_is_platform())
  WITH CHECK (keystone.caller_is_platform());

CREATE POLICY tenant_delete ON keystone.tenant_site_tier
  FOR DELETE USING (keystone.caller_is_platform());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.tenant_site_tier TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★ Prove FORCE RLS is on (same safety check as every other table).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.site_tier'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0361: FORCE ROW LEVEL SECURITY was not enabled on keystone.site_tier';
  END IF;
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant_site_tier'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0361: FORCE ROW LEVEL SECURITY was not enabled on keystone.tenant_site_tier';
  END IF;
END
$$;
