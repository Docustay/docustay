-- 0342_a_filter_worth_keeping_is_worth_naming
-- TOUCH-UP GROUP A, WORKSTREAM 4 · LIST WORKSPACE, item 4.7 — saved views.
--
-- One row per saved filter/sort state for one `LIST_VIEWS` path. Personal by default (only its
-- own `owner_person_id` can see or use it); `shared_with_practice` opts it into being visible to
-- everybody in the tenant, the same "off by default, one flag turns it on for the whole practice"
-- shape `workbench_usage_counter` (0335) and other tenant-scoped tables in this file use.
--
-- ★ `owner_person_id`, NOT `owner_user_id` — every other person-shaped reference in this schema
--   (`app_user.owner_user_id`, `guardian.guardian_user_id`) points at `keystone.app_user(id)`, and
--   that is who SAVES a view: the signed-in staff member, i.e. an `app_user` row with `role =
--   'staff'`. Named `_person_id` here only to read plainly next to `list_path` — it is the same
--   `app_user` reference every other owner column in this schema is.
--
-- ★ VISIBILITY (own vs. shared-with-practice) IS AN APPLICATION-LAYER FILTER, NOT AN RLS POLICY —
--   the same split `scoped()` (`src/records/lists/_shared.mjs`) already draws for `person`/`item`/
--   etc: RLS enforces the TENANT boundary only (FORCE, three standard policies, exactly like
--   `workbench_usage_counter` above); "mine, or shared" is a business rule the READ ROUTE applies in
--   its own WHERE clause, same as every grant-scoped list already does.
CREATE TABLE keystone.saved_view (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  owner_person_id       uuid NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  list_path             text NOT NULL,
  name                  text NOT NULL CHECK (btrim(name) <> ''),
  filter_state          jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_state            jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared_with_practice  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- ★ One name per (owner, list) — matches the "personal by default" model: a person's own saved
  --   views on one screen are a short, named list, not an unbounded pile of near-duplicates.
  UNIQUE (tenant_id, owner_person_id, list_path, name)
);

CREATE INDEX saved_view_lookup_idx
  ON keystone.saved_view (tenant_id, list_path, owner_person_id);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265/0335). ─────────────────────────────────────────────
ALTER TABLE keystone.saved_view ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.saved_view FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.saved_view
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.saved_view
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.saved_view
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★ A saved view is DELETEd outright (not archived) — it is a personal convenience, not a business
--   record; nothing else in the schema references it (no FK points AT saved_view).
CREATE POLICY tenant_delete ON keystone.saved_view
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.saved_view TO app_rw;

COMMENT ON TABLE keystone.saved_view IS
  'Workstream 4.7 (touch-up group A) — a saved filter/sort state for one LIST_VIEWS path. Personal '
  'by default (owner_person_id only); shared_with_practice=true makes it visible tenant-wide. RLS '
  'enforces the tenant boundary only — own-vs-shared visibility is applied by the read route.';
