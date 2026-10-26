-- 0485 · CAMPAIGN GROUPS — THE CONTAINER (F17 §3 — Ty, 25 Sep 2026)
--
-- The campaign_group table is the container: one group holds sends, landing pages, forms,
-- a segment and ads, and reports as one number. Existing tables (campaign, landing_page, segment)
-- gain nullable FKs so their rows may belong to a group. ON DELETE SET NULL: deleting a container
-- never touches its assets — the campaign, page and segment survive and become groupless.
--
-- STATUS values: 'planning' (draft, nothing sent), 'live' (sends in progress or done),
-- 'done' (all sends complete, archived).

CREATE TABLE keystone.campaign_group (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  status      text NOT NULL DEFAULT 'planning'
              CHECK (status IN ('planning', 'live', 'done')),
  goal        text NULL,
  starts_on   date NULL,
  ends_on     date NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaign_group_tenant_idx ON keystone.campaign_group (tenant_id);
CREATE INDEX campaign_group_status_idx ON keystone.campaign_group (tenant_id, status);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline (0334 idiom). ────────────────
ALTER TABLE keystone.campaign_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.campaign_group FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.campaign_group
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.campaign_group
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.campaign_group
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.campaign_group
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.campaign_group TO app_rw;

-- ── Foreign keys on existing tables (ON DELETE SET NULL — assets survive deletion). ──────────────
ALTER TABLE keystone.campaign NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.campaign
  ADD COLUMN campaign_group_id uuid NULL REFERENCES keystone.campaign_group(id) ON DELETE SET NULL;

CREATE INDEX campaign_group_id_idx ON keystone.campaign (campaign_group_id)
  WHERE campaign_group_id IS NOT NULL;

ALTER TABLE keystone.campaign FORCE ROW LEVEL SECURITY;

-- ── Self-check: campaign FK added. ────────────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'campaign'
     AND column_name = 'campaign_group_id';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0485 self-check: campaign.campaign_group_id not added';
  END IF;
END
$check$;

ALTER TABLE keystone.landing_page NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.landing_page
  ADD COLUMN campaign_group_id uuid NULL REFERENCES keystone.campaign_group(id) ON DELETE SET NULL;

CREATE INDEX landing_page_group_id_idx ON keystone.landing_page (campaign_group_id)
  WHERE campaign_group_id IS NOT NULL;

ALTER TABLE keystone.landing_page FORCE ROW LEVEL SECURITY;

-- ── Self-check: landing_page FK added. ───────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'landing_page'
     AND column_name = 'campaign_group_id';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0485 self-check: landing_page.campaign_group_id not added';
  END IF;
END
$check$;

ALTER TABLE keystone.segment NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.segment
  ADD COLUMN campaign_group_id uuid NULL REFERENCES keystone.campaign_group(id) ON DELETE SET NULL;

CREATE INDEX segment_group_id_idx ON keystone.segment (campaign_group_id)
  WHERE campaign_group_id IS NOT NULL;

ALTER TABLE keystone.segment FORCE ROW LEVEL SECURITY;

-- ── Self-check: segment FK added, and the table is still FORCED. ────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
  forced boolean;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'segment'
     AND column_name = 'campaign_group_id';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0485 self-check: segment.campaign_group_id not added';
  END IF;

  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'segment';
  IF NOT forced THEN
    RAISE EXCEPTION '0485 self-check: RLS is no longer FORCED on segment';
  END IF;
END
$check$;

COMMENT ON TABLE keystone.campaign_group IS
  'F17 §3: Campaign group container. Holds sends (campaign), landing pages, segments, and ads. '
  'Reports as one number (results rollup). Status: planning, live, done.';
COMMENT ON COLUMN keystone.campaign_group.status IS
  'planning (draft), live (sends in progress or done), done (archived)';
COMMENT ON COLUMN keystone.campaign_group.goal IS
  'Optional goal description (e.g., "Q4 onboarding blitz")';
