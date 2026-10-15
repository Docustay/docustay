-- 0338_an_import_row_is_checked_before_it_is_believed
-- Spec 06 (Settings) §3, task 6.4.
--
-- keystone.import_run / keystone.import_row — the SetImport wizard's own state (§2.5): upload →
-- match columns → check (dry run, nothing written) → import (§7's background job writes the actual
-- people). `import_row` holds one row per CSV line, read back on the progress poll
-- (`GET /api/settings/import/:id`) so a practice can see exactly which rows failed and why.
CREATE TABLE keystone.import_run (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  created_by                 uuid NOT NULL REFERENCES keystone.app_user(id),
  status                     text NOT NULL DEFAULT 'uploaded'
                               CHECK (status IN ('uploaded','mapped','checked','importing','done','failed')),
  source_filename            text NOT NULL,
  column_mapping             jsonb,
  duplicate_policy           text CHECK (duplicate_policy IN ('skip','fill_blank')),
  marketing_consent_confirmed boolean NOT NULL DEFAULT false,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  completed_at               timestamptz
);

CREATE TABLE keystone.import_row (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id  uuid NOT NULL REFERENCES keystone.import_run(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  row_number     integer NOT NULL,
  raw            jsonb NOT NULL,
  outcome        text NOT NULL DEFAULT 'pending'
                    CHECK (outcome IN ('pending','created','skipped_duplicate','filled_blanks','error')),
  error          text
);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265). No backfill: neither table has a legitimate row
--    before this build's own upload flow exists. ───────────────────────────────────────────────
ALTER TABLE keystone.import_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.import_run FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.import_run
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.import_run
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.import_run
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.import_run TO app_rw;

ALTER TABLE keystone.import_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.import_row FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.import_row
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.import_row
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.import_row
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.import_row TO app_rw;

-- ★ Not an FK-column index in the usual sense — Postgres does not index a foreign key automatically,
--   and every read of a run's rows (the check step, the progress poll, the running job) filters on
--   `import_run_id`. Same reasoning `0122`'s `mobile_phone` index and every other lookup index in
--   this codebase gives: the column is read far more often than the table is written.
CREATE INDEX import_row_run_idx ON keystone.import_row (import_run_id);

COMMENT ON TABLE keystone.import_run IS
  'Spec 06 §3 (task 6.4). One row per SetImport wizard session: uploaded -> mapped -> checked -> '
  'importing -> done/failed. column_mapping is {csvColumn: fieldKey|null} (§2.5); the background '
  'import job (§7) is the only writer of status = importing/done/failed.';
COMMENT ON TABLE keystone.import_row IS
  'Spec 06 §3 (task 6.4). One row per CSV line of its import_run, carrying the raw parsed fields and '
  'the outcome the check/import steps gave it — read back by the progress poll so a practice can see '
  'exactly which rows failed and why.';
