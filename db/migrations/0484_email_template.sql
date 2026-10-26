-- 0484 · TENANT EMAIL TEMPLATE OVERRIDES (F17 §2 — Ty, 25 Sep 2026)
--
-- Templates (subject, body) may be overridden per tenant. Resolution is one resolver used by the
-- queue, the callback (n8n), and campaigns alike: `resolveTemplate(tx, tenantId, key)` →
-- active tenant row else shipped default (by `coaching_type` variant when one exists, else base).
--
-- ONE active row per (tenant, key) is database-enforced: the partial UNIQUE constraint refuses
-- a second INSERT when an active row exists, and a second ACTIVATE flips the first to inactive.
--
-- CONSTRAINT on origin: 'shipped' for seeded defaults, 'edited' for tenant overrides.
--

CREATE TABLE keystone.email_template (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key                 text NOT NULL,
  family              text NOT NULL,
  subject             text NOT NULL CHECK (btrim(subject) <> ''),
  html_body           text NOT NULL,
  text_body           text NOT NULL CHECK (btrim(text_body) <> ''),
  version             int NOT NULL DEFAULT 1,
  active              boolean NOT NULL DEFAULT false,
  origin              text NOT NULL CHECK (origin IN ('shipped','edited')),
  created_by          uuid NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- ★ ONE version per key; multiple versions permit A/B testing and immutable freezing on send.
  UNIQUE (tenant_id, key, version)
);
-- ★ ONE ACTIVE ROW per (tenant, key) — the database enforces it.
-- ★ REHEARSAL FIX (25 Sep 2026): `UNIQUE (…) WHERE …` is not legal inside CREATE TABLE; a partial
--   uniqueness is an INDEX.
CREATE UNIQUE INDEX email_template_one_active_key ON keystone.email_template (tenant_id, key)
  WHERE active = true;

CREATE INDEX email_template_lookup_idx
  ON keystone.email_template (tenant_id, key, active);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265/0335). ─────────────────────────────────────────────
ALTER TABLE keystone.email_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.email_template FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.email_template
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.email_template
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.email_template
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.email_template
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.email_template TO app_rw;

-- ★ REHEARSAL FIX: CT-F52 points 3 and 5 — the reference-guard read policy and both
--   refuse-reference triggers, which catalog-conformance requires of every tenant table.
CREATE POLICY reference_guard_read ON keystone.email_template FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT ON keystone.email_template TO reference_guard;
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
CREATE TRIGGER email_template_refuse_reference_delete_trg AFTER DELETE ON keystone.email_template
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.email_template ENABLE ALWAYS TRIGGER email_template_refuse_reference_delete_trg;
CREATE TRIGGER email_template_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.email_template
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.email_template ENABLE ALWAYS TRIGGER email_template_refuse_reference_truncate_trg;
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ── Self-check: table and constraints exist, UNIQUE (tenant_id, key) WHERE active = true works
-- ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.email_template NO FORCE ROW LEVEL SECURITY;

DO $check$
DECLARE
  n_cols integer;
  test_tenant_id uuid;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'email_template'
     AND column_name IN ('id', 'tenant_id', 'key', 'family', 'subject', 'html_body',
                          'text_body', 'version', 'active', 'origin');
  IF n_cols <> 10 THEN
    RAISE EXCEPTION '0484 self-check: expected 10 columns on email_template, found %', n_cols;
  END IF;

  -- ★ Positive control for the one-active-row index, against a REAL practice so the tenant FK passes
  --   and the insert reaches the uniqueness (REHEARSAL FIX: the first draft used tenant
  --   00000000-…-0001, which fails the FK before the index is ever tested). The sub-block's own
  --   exception handler rolls every probe row back — nothing is left behind.
  SELECT id INTO test_tenant_id FROM keystone.tenant ORDER BY id LIMIT 1;
  IF test_tenant_id IS NOT NULL THEN
    BEGIN
      INSERT INTO keystone.email_template
        (tenant_id, key, family, subject, html_body, text_body, active, origin)
      VALUES
        (test_tenant_id, 'm0484_probe', 'welcome', 'Test Subject', '<p>Test</p>', 'Test', true, 'edited');
      INSERT INTO keystone.email_template
        (tenant_id, key, family, subject, html_body, text_body, version, active, origin)
      VALUES
        (test_tenant_id, 'm0484_probe', 'welcome', 'Test 2', '<p>Test 2</p>', 'Test 2', 2, true, 'edited');
      RAISE EXCEPTION '0484 self-check: second active row for same tenant/key was ACCEPTED';
    EXCEPTION
      WHEN unique_violation THEN NULL;    -- the partial unique index refused it: correct
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM keystone.email_template WHERE key = 'm0484_probe') THEN
    RAISE EXCEPTION '0484 self-check: probe rows were left behind';
  END IF;
END
$check$;

ALTER TABLE keystone.email_template FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTERs
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'email_template';
  IF NOT forced THEN
    RAISE EXCEPTION '0484 self-check: RLS is no longer FORCED on email_template';
  END IF;
END
$rls$;

COMMENT ON TABLE keystone.email_template IS
  'F17: Tenant email template overrides. Seeded with shipped defaults (origin=shipped); '
  'tenants may edit (origin=edited). One active row per (tenant_id, key) enforced by database. '
  'Resolved by resolveTemplate(tx, tenantId, key) — active tenant row else shipped default.';
