-- 0334_a_subscription_is_one_row_per_practice
-- Spec 06 (Settings) §3, task 6.1. CT-111, verbatim shape.
--
-- ★★★ THIS MUST EXIST BEFORE ANYTHING ELSE IN SPEC 06'S OWN MIGRATION BLOCK (§10 point 1) — every
--     other migration and every route in §2.7/§9 reads it.
--
-- `plan_key` vocabulary: 'solo' | 'practice' | 'group' | 'enterprise' | 'founder' — the four MOCKUPS
-- §16 plan-table rows plus 'founder', the free internal plan MOCKUPS §16:493 names by name for GLRS.
-- Price points live in application code (src/billing/plans.mjs), not the CHECK — a price change is a
-- code deploy, not a migration.
--
-- ★★★ RESOLVED — Ty's ruling, 22 Sep 2026: "plan_key wins over billing.tier, everywhere."
-- mainstay_subscription.plan_key is the ONE column of record for a tenant's subscription tier, from
-- this stage's build forward. Migration 0340 (this same block) carries any pre-existing
-- 'billing.tier' tenant_setting value forward into plan_key once, overwriting the default this
-- migration's own backfill seeds below.
CREATE TABLE keystone.mainstay_subscription (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  stripe_customer_id       text,
  stripe_subscription_id   text,
  plan_key                 text NOT NULL,
  seat_count               integer NOT NULL DEFAULT 1,
  seat_limit               integer,
  trial_ends_at            timestamptz,
  status                   text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  CONSTRAINT mainstay_subscription_plan_key_check
    CHECK (plan_key IN ('solo','practice','group','enterprise','founder')),
  CONSTRAINT mainstay_subscription_status_check
    CHECK (status IN ('trialing','active','past_due','canceled'))
);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265). ─────────────────────────────────────────────────
ALTER TABLE keystone.mainstay_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.mainstay_subscription FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.mainstay_subscription
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.mainstay_subscription
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.mainstay_subscription
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.mainstay_subscription TO app_rw;

CREATE TRIGGER mainstay_subscription_touch BEFORE UPDATE ON keystone.mainstay_subscription
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL — every existing tenant except GLRS (is_reference = true, 0094:30) gets a row seeded
-- plan_key = 'solo', status = 'trialing', trial_ends_at = created_at + interval '30 days' (or
-- now() + interval '30 days' if that has already passed — a re-verified pre-existing tenant does
-- not lose access to its own data the moment this migration runs, §11). GLRS gets
-- plan_key = 'founder', status = 'active', trial_ends_at = NULL.
--
-- ★★★ F490/F143 — A MIGRATION CANNOT SEE THE ROWS IT IS BACKFILLING ACROSS TENANTS BY DEFAULT.
--     `db/migrate.mjs` runs every file as app_owner with no tenant GUC set, and this table is
--     FORCE ROW LEVEL SECURITY — a bare cross-tenant INSERT/UPDATE would touch nothing and commit
--     silently (0010's exact defect, re-discovered and fixed there). Same bracket pattern 0010
--     established: suspend FORCE for the backfill, act, restore it in the same transaction, and
--     prove it came back.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.mainstay_subscription NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.mainstay_subscription (tenant_id, plan_key, status, trial_ends_at)
SELECT
  t.id,
  CASE WHEN t.is_reference THEN 'founder' ELSE 'solo' END,
  CASE WHEN t.is_reference THEN 'active' ELSE 'trialing' END,
  CASE
    WHEN t.is_reference THEN NULL
    WHEN t.created_at + interval '30 days' > now() THEN t.created_at + interval '30 days'
    ELSE now() + interval '30 days'
  END
FROM keystone.tenant t;

DO $$
DECLARE
  v_tenants integer;
  v_subs    integer;
BEGIN
  SELECT count(*) INTO v_tenants FROM keystone.tenant;
  SELECT count(*) INTO v_subs    FROM keystone.mainstay_subscription;

  IF v_subs <> v_tenants THEN
    RAISE EXCEPTION '0334: backfilled % mainstay_subscription row(s) but keystone.tenant holds % — every tenant must get exactly one row',
      v_subs, v_tenants;
  END IF;

  IF v_tenants = 0 THEN
    RAISE NOTICE '0334: 0 tenants exist on this database — nothing to seed. Expected on a fresh database.';
  ELSE
    RAISE NOTICE '0334: % tenant(s), % mainstay_subscription row(s) seeded (the backfill guard can see them — positive control)',
      v_tenants, v_subs;
  END IF;
END
$$;

ALTER TABLE keystone.mainstay_subscription FORCE ROW LEVEL SECURITY;

-- ★★ Prove FORCE is back on before going any further — leaving it off would silently disable
-- tenant isolation on this table and every later migration and gate would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.mainstay_subscription'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0334: FORCE ROW LEVEL SECURITY was not restored on keystone.mainstay_subscription';
  END IF;
END
$$;

COMMENT ON TABLE keystone.mainstay_subscription IS
  'CT-111, verbatim shape. One row per tenant (UNIQUE (tenant_id)) — the Mainstay-billing subscription '
  'record, mirrored from Stripe (write Stripe-first-then-mirror, CT-110). plan_key is the ONE column of '
  'record for a tenant''s plan tier (Ty''s ruling, 22 Sep 2026) — migration 0340 in this same block '
  'carries any pre-existing billing.tier tenant_setting value forward into it once.';
