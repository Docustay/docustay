-- 0454_run_competitor_watch — Stage 16 task 16.13
--
-- Adds keystone.run_competitor_watch — a log of operator-entered observations about
-- competitor activity (e.g. "they run ads on your name"). Source is 'manual' (the table's
-- only allowed source); the card is honest that this is not an automated ad-spend integration.
-- Append-only: no UPDATE, no DELETE — this is an audit log.
--
-- GRANT SELECT, INSERT TO app_rw (no UPDATE, no DELETE).
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
CREATE TABLE keystone.run_competitor_watch (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  competitor_name text NOT NULL CHECK (btrim(competitor_name) <> '' AND char_length(competitor_name) <= 120),
  kind text NOT NULL CHECK (kind IN ('ads_on_your_name')),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
  entered_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE keystone.run_competitor_watch ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.run_competitor_watch FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.run_competitor_watch
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.run_competitor_watch
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT ON keystone.run_competitor_watch TO app_rw;

COMMENT ON TABLE keystone.run_competitor_watch IS
  'Stage 16 task 16.13 — operator-entered observations about competitor activity. '
  'Kind is "ads_on_your_name" (your brand used in their ad spend). Append-only audit log: '
  'no UPDATE, no DELETE. Source is always "manual" — not an automated ad-spend integration.';
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)