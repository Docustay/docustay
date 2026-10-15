-- 0337_a_data_export_is_a_promise_before_it_is_a_file
-- Spec 06 (Settings) §3, task 6.4.
--
-- keystone.data_export — one row per requested export, `everything` (owner only, MOCKUPS §13:420
-- "owner only, logged") or `one_person` (a client's own data request, §2.6). The row is queued
-- immediately and written to as the background job (§7) works: 'queued' → 'processing' →
-- 'ready'/'failed'. `object_key` is the storage key the finished file lands at (src/storage/s3.mjs,
-- same object-store convention every other stored artefact in this codebase uses) — null until the
-- job succeeds.
CREATE TABLE keystone.data_export (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  requested_by  uuid NOT NULL REFERENCES keystone.app_user(id),
  scope         text NOT NULL CHECK (scope IN ('everything','one_person')),
  person_id     uuid REFERENCES keystone.app_user(id),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed')),
  object_key    text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  emailed_at    timestamptz,
  CONSTRAINT data_export_person_scope_check
    CHECK ((scope = 'one_person') = (person_id IS NOT NULL))
);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265). No backfill: an export request for an existing
--    tenant is legitimately absent until someone asks for one. ─────────────────────────────────
ALTER TABLE keystone.data_export ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.data_export FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.data_export
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.data_export
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.data_export
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.data_export TO app_rw;

COMMENT ON TABLE keystone.data_export IS
  'Spec 06 §3 (task 6.4). One row per requested export — everything (owner only) or one_person '
  '(a client data request, §2.6). status moves queued -> processing -> ready/failed as the '
  'background job (§7) works; object_key is the storage key of the finished file.';
