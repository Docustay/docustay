-- 0487 — TIER-GATED CAPABILITIES FOR GROWTH PRODUCTS (F17 task 20.38)
--
-- ★★★ CAPABILITIES ARE PLATFORM-OWNED, LIKE SITE_TIER. tier_capability mirrors the RLS treatment
--     of site_tier (0361): platform-level catalogue (no tenant_id), readable by all via USING (true),
--     writable only by platform operators via caller_is_platform() check in application code.
--
-- ★ THE RESOLUTION CHAIN (ABSOLUTE, lived in src/platform/capabilities.mjs's tenantHasCapability):
--   (1) tenant's site_tier_id from tenant_site_tier, OR DEFAULT tier (lowest display_order)
--   (2) tier_capability.allowed for (tier, capability_key)
--   (3) feature_flag_practice override — WINS in either direction
--   (4) return boolean
--
-- ★★ SEEDING: every existing tier × every capability = allowed. This means applying the migration
--    switches NOTHING off — a tier starts with all capabilities enabled by default, and operators
--    can then turn them off per cell via the PUT route.
--
-- ★ AUDIT: platform.tier_capability.changed is added to keystone.audit_action. The PUT route
--   writes one keystone.audit_entry per CHANGED cell (unchanged cells audit zero rows).

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · ADD THE AUDIT ACTION (platform.tier_capability.changed)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★ REHEARSAL FIX (25 Sep 2026): audit_action is FORCE RLS — the 0249/0468 pattern verbatim.
ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;
INSERT INTO keystone.audit_action (key) VALUES ('platform.tier_capability.changed') ON CONFLICT (key) DO NOTHING;
ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.audit_action'::regclass) THEN
    RAISE EXCEPTION '0487: FORCE ROW LEVEL SECURITY was not restored on keystone.audit_action';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · CREATE tier_capability TABLE (PLATFORM-LEVEL, RLS LIKE site_tier)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.tier_capability (
  tier_id          uuid        NOT NULL REFERENCES keystone.site_tier(id) ON DELETE CASCADE,
  capability_key   text        NOT NULL,
  allowed          boolean     NOT NULL,
  PRIMARY KEY (tier_id, capability_key)
);

CREATE INDEX tier_capability_capability_idx ON keystone.tier_capability (capability_key);

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · RLS: ENABLE + FORCE (mirror of site_tier, 0361)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.tier_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.tier_capability FORCE  ROW LEVEL SECURITY;

-- ★ Everyone can read the capability grid (USING (true)), but only platform operators can modify it.
CREATE POLICY tier_capability_read ON keystone.tier_capability
  AS PERMISSIVE FOR SELECT USING (true);

CREATE POLICY tier_capability_insert ON keystone.tier_capability
  AS PERMISSIVE FOR INSERT WITH CHECK (keystone.caller_is_platform());

CREATE POLICY tier_capability_update ON keystone.tier_capability
  AS PERMISSIVE FOR UPDATE
  USING (keystone.caller_is_platform())
  WITH CHECK (keystone.caller_is_platform());

CREATE POLICY tier_capability_delete ON keystone.tier_capability
  AS PERMISSIVE FOR DELETE USING (keystone.caller_is_platform());

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4 · GRANTS (platform-writable by operators only, readable by all)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.tier_capability TO app_rw;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 5 · SEED: EVERY EXISTING TIER × EVERY CAPABILITY = ALLOWED
--     The ~15 capabilities from F17 §4. Must match CAPABILITIES in src/platform/capabilities.mjs.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- ★★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production): production holds ZERO
--    site_tier rows, so this seed raised "no site_tier rows exist" — and, worse, at runtime
--    `tenantHasCapability` (src/platform/capabilities.mjs:90) THROWS when no tier exists, so every
--    capability-gated surface would 500. RULING: when the catalogue is empty, seed ONE "Default"
--    tier (placeholder $0, no Stripe price, lowest display order) — the tier every practice lands on
--    by the resolver's own "lowest display_order" rule — and grant it every capability, exactly this
--    seed's stated intent. Ty renames and prices it in Platform › Tiers. Cost if wrong: one row.
ALTER TABLE keystone.site_tier NO FORCE ROW LEVEL SECURITY;
INSERT INTO keystone.site_tier (name, placeholder_price_minor, stripe_price_id, display_order)
SELECT 'Default', 0, NULL, 0
 WHERE NOT EXISTS (SELECT 1 FROM keystone.site_tier);
ALTER TABLE keystone.site_tier FORCE ROW LEVEL SECURITY;

-- ★ NO FORCE while we seed (the migration role owns the table)
ALTER TABLE keystone.tier_capability NO FORCE ROW LEVEL SECURITY;

DO $seed$
DECLARE
  tier_rec RECORD;
  cap_key TEXT;
  n_tiers INTEGER;
  n_caps_per_tier INTEGER;
  n_total_seeded INTEGER := 0;
  cap_keys TEXT[] := ARRAY[
    'growth.campaigns',
    'growth.templates',
    'growth.sequences',
    'growth.sms',
    'growth.landing_pages',
    'growth.forms',
    'growth.lead_scoring',
    'run.presence',
    'run.signals',
    'run.reviews',
    'run.listings',
    'run.ads',
    'run.calls',
    'run.competitors',
    'run.ai_visibility'
  ];
BEGIN
  -- ── For each existing tier, insert all capabilities as allowed ──────────────────────────────
  FOR tier_rec IN SELECT id FROM keystone.site_tier ORDER BY display_order ASC LOOP
    n_caps_per_tier := 0;
    FOREACH cap_key IN ARRAY cap_keys LOOP
      INSERT INTO keystone.tier_capability (tier_id, capability_key, allowed)
        VALUES (tier_rec.id, cap_key, true)
        ON CONFLICT DO NOTHING;
      n_caps_per_tier := n_caps_per_tier + 1;
      n_total_seeded := n_total_seeded + 1;
    END LOOP;
  END LOOP;

  -- ── Self-checks: seeding happened ──────────────────────────────────────────────────────────
  SELECT COUNT(*) INTO n_tiers FROM keystone.site_tier;
  SELECT COUNT(*) INTO n_caps_per_tier FROM (
    SELECT DISTINCT capability_key FROM keystone.tier_capability
  ) t;

  IF n_tiers = 0 THEN
    RAISE EXCEPTION '0487 seed: no site_tier rows exist — cannot seed tier_capability';
  END IF;

  IF n_caps_per_tier <> array_length(cap_keys, 1) THEN
    RAISE EXCEPTION '0487 seed: seeded % capability keys, expected %', n_caps_per_tier, array_length(cap_keys, 1);
  END IF;

  -- ── Positive control: all seeded cells are true ──────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM keystone.tier_capability WHERE allowed = false) THEN
    RAISE EXCEPTION '0487 seed: found tier_capability rows with allowed=false — seeding should set all to true';
  END IF;

  RAISE NOTICE '0487 seed: seeded % tier × capability pairs, all allowed=true', n_total_seeded;
END
$seed$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 6 · FORCE ROW LEVEL SECURITY BACK ON
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.tier_capability FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived ──────────────────────────────────────────────────────────────────
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tier_capability'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0487: FORCE ROW LEVEL SECURITY was not enabled on keystone.tier_capability';
  END IF;
END
$$;

-- ── Prove audit action was seeded ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM keystone.audit_action WHERE key = 'platform.tier_capability.changed';
  IF n <> 1 THEN
    RAISE EXCEPTION '0487: platform.tier_capability.changed audit action was not seeded (found % rows)', n;
  END IF;
END
$$;
