-- 0636 · PART 30 item 8 — TEAMS. A team is a named group of people in a workspace. A document or a template can belong to one team; when the workspace turns on "limit documents to their teams"
-- (island setting teams.restrict_visibility), a member who is not an owner or admin sees only the documents and templates of their own teams, ones they made, and ones that belong to no team.
--  · document_team / document_team_member — the island's own tables. The person is an opaque id (user_ref, no foreign key), as everywhere in the island; a person who leaves simply stops matching.
--  · document_instance.team_id / document_template.team_id — nullable; a deleted team leaves its documents unassigned (ON DELETE SET NULL), never deleted.
--  · keystone.document_team_visible(viewer, team, creator) — the ONE rule, used by the document list, the template list and every staff read of one document.
-- Additive only. Row-level security FORCED on both new tables.
CREATE TABLE keystone.document_team (
  id         uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name       text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_by uuid        NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_team_name_unique ON keystone.document_team (tenant_id, lower(btrim(name)));
CREATE TABLE keystone.document_team_member (
  tenant_id uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  team_id   uuid        NOT NULL REFERENCES keystone.document_team(id) ON DELETE CASCADE,
  user_ref  uuid        NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_ref)
);
CREATE INDEX document_team_member_by_user ON keystone.document_team_member (tenant_id, user_ref);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_team','document_team_member'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_update ON keystone.%I FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_delete ON keystone.%I FOR DELETE USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
    EXECUTE format('GRANT SELECT ON keystone.%I TO app_worker', t);
  END LOOP;
END $$;

ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS team_id uuid NULL REFERENCES keystone.document_team(id) ON DELETE SET NULL;
ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS team_id uuid NULL REFERENCES keystone.document_team(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS document_instance_by_team ON keystone.document_instance (tenant_id, team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS document_template_by_team ON keystone.document_template (tenant_id, team_id) WHERE team_id IS NOT NULL;

-- Who may see a team's document. TRUE when: nobody is asking (the worker), the document belongs to no team, the workspace has not limited visibility, the viewer made it, the viewer is on the team,
-- or the viewer is an owner or admin. A viewer who is not staff of this workspace (a signer) is never asked this question — signers reach their own document by their party row.
CREATE FUNCTION keystone.document_team_visible(viewer uuid, team uuid, creator uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN viewer IS NULL OR team IS NULL THEN true
    WHEN NOT coalesce((SELECT s.value = 'true'::jsonb FROM keystone.document_setting s WHERE s.tenant_id = keystone.current_tenant_id() AND s.key = 'teams.restrict_visibility'), false) THEN true
    WHEN creator IS NOT DISTINCT FROM viewer THEN true
    WHEN EXISTS (SELECT 1 FROM keystone.document_team_member m WHERE m.team_id = team AND m.user_ref = viewer) THEN true
    WHEN EXISTS (SELECT 1 FROM keystone.app_user u WHERE u.id = viewer AND u.staff_role IN ('owner','admin')) THEN true
    ELSE false END
$$;
GRANT EXECUTE ON FUNCTION keystone.document_team_visible(uuid, uuid, uuid) TO app_rw, app_worker;
