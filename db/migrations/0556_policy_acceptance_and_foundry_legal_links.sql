-- 0556_policy_acceptance_and_foundry_legal_links
--
-- Site-readiness brief, Part 3, 1 Oct 2026 — "store which version each practice/user accepted" for
-- the platform's own Privacy Policy / Terms of Service / Data Processing Addendum (src/legal/policies.mjs),
-- plus the configurable per-practice policy link used by the client portal footer and the
-- document-signing page (src/records/shell.mjs equivalent for the portal — PortalProfile.jsx).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.policy_acceptance. An append-only AUDIT LOG, not a reference/catalogue table, so
--     this does NOT follow the full CT-F52 eight-point checklist (0543's own template) — there are
--     no reference rows to protect here, and nothing is ever updated or deleted once written. What
--     it DOES follow, exactly: FORCE ROW LEVEL SECURITY (every table in this schema gets it,
--     CLAUDE.md's own opening line), and the `app_signup`-specific INSERT policy modelled on 0025
--     (migration 0025_signup_boundary.sql) — signup is the ONE caller that writes this table before
--     an ordinary `app_rw` session exists, from inside `runCriticalPrefix`'s own transaction
--     (src/provisioning/prefix.mjs), in the same all-or-nothing commit as the tenant and admin user
--     rows it already writes. `app_signup` gets INSERT only, no SELECT — same minimal-privilege
--     posture 0025 already established for that role on every other table it can write.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.policy_acceptance (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  policy_type text        NOT NULL CHECK (policy_type IN ('terms', 'privacy', 'dpa')),
  version     text        NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address  text,
  user_agent  text
);
CREATE INDEX policy_acceptance_tenant_id_idx ON keystone.policy_acceptance (tenant_id);
CREATE INDEX policy_acceptance_user_policy_idx ON keystone.policy_acceptance (user_id, policy_type, accepted_at DESC);

ALTER TABLE keystone.policy_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.policy_acceptance FORCE  ROW LEVEL SECURITY;

-- ordinary tenant-scoped read/write, for the staff app (an owner viewing their own practice's
-- acceptance record) and for the backfill/report tooling any later task might need.
CREATE POLICY tenant_isolation ON keystone.policy_acceptance
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.policy_acceptance
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★ No UPDATE/DELETE policy at all, for anyone, including app_rw — an acceptance record is written
--   once and never edited. That is enforced here, not just by convention in application code.
GRANT SELECT, INSERT ON keystone.policy_acceptance TO app_rw;

-- the signup path: INSERT only, immediately after the tenant row exists and the GUC is set to it
-- (prefix.mjs already does this for the tenant and admin-user inserts; same transaction, same GUC).
CREATE POLICY signup_insert_policy_acceptance ON keystone.policy_acceptance
  FOR INSERT TO app_signup
  WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT INSERT ON keystone.policy_acceptance TO app_signup;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — Docustay's own policy links. `practice.privacy_url`/`practice.terms_url` (src/settings/keys.mjs)
--     are new, unset-by-default settings; Docustay is the one practice whose own site (built and
--     deployed in Part 1-2 of this same brief) actually has these pages. Same shape as 0547's
--     practice.name seed — a data migration because this session has no authenticated Docustay
--     session to click through Settings with, matched by slug, no-op elsewhere.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT keystone.resolve_tenant_by_slug('foundry') INTO v_tenant_id;
  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '0556: no tenant with slug ''foundry'' — nothing to set';
    RETURN;
  END IF;
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'practice.privacy_url', '"https://example.com/privacy"'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = '"https://example.com/privacy"'::jsonb;

  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_tenant_id, 'practice.terms_url', '"https://example.com/terms"'::jsonb)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = '"https://example.com/terms"'::jsonb;

  RAISE NOTICE '0556: practice.privacy_url / practice.terms_url set for foundry';
END $$;

-- ── self-check ───────────────────────────────────────────────────────────────────────────────────
DO $self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema='keystone' AND table_name='policy_acceptance') THEN
    RAISE EXCEPTION '0556: keystone.policy_acceptance was not created';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.policy_acceptance'::regclass) THEN
    RAISE EXCEPTION '0556: keystone.policy_acceptance does not have FORCE ROW LEVEL SECURITY';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'keystone.policy_acceptance'::regclass) < 3 THEN
    RAISE EXCEPTION '0556: keystone.policy_acceptance is missing one or more of its three policies';
  END IF;
  RAISE NOTICE '0556: policy_acceptance created with FORCE RLS and three policies';
END
$self_check$;
