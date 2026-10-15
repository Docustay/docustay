-- 0445 — unsubscribe_token table + landing_page additive columns. Stage 16 task 16.4.
--
-- Per-recipient unsubscribe tokens for email unsubscribe links, and additive landing-page
-- columns for service selection and page lifecycle.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · unsubscribe_token TABLE — one per (tenant, person) per token
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.unsubscribe_token (
  id           uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  person_id    uuid NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE UNIQUE INDEX unsubscribe_token_hash_key ON keystone.unsubscribe_token (tenant_id, token_hash);
CREATE INDEX unsubscribe_token_person ON keystone.unsubscribe_token (tenant_id, person_id);

-- ★★★ RLS — ENABLE **AND FORCE**, plus all THREE policies. See 0055 for the pattern.
ALTER TABLE keystone.unsubscribe_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.unsubscribe_token FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.unsubscribe_token
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.unsubscribe_token
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.unsubscribe_token
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.unsubscribe_token TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · landing_page COLUMNS — purpose, cta_type, booking_service_id, ended_at
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.landing_page
  ADD COLUMN purpose text CHECK (purpose IS NULL OR char_length(purpose) <= 200),
  ADD COLUMN cta_type text NOT NULL DEFAULT 'lead_form' CHECK (cta_type IN ('booking','lead_form')),
  ADD COLUMN booking_service_id uuid REFERENCES keystone.service(id) ON DELETE SET NULL,
  ADD COLUMN ended_at timestamptz,
  ADD CONSTRAINT landing_page_booking_needs_service CHECK (cta_type <> 'booking' OR booking_service_id IS NOT NULL);
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)