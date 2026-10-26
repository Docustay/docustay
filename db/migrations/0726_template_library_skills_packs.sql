-- Run 9 Part 4R (Ty, 12 Oct 2026, final) — THE TEMPLATE LIBRARY, PLAYS AS SKILLS, PLAYBOOKS AS PACKS.
--
-- 1 · BUILT-IN TEMPLATES. The 54 ready-made templates (src/documents/starters) are now the workspace's built-in Document and Form templates: read-only masters, seeded into each workspace
--     (src/documents/library.mjs) without counting toward the monthly cap. A built-in row carries the library slug it came from and the fingerprint of the version it was printed from;
--     the seed makes a new version when the library changes. Nothing may change a built-in's content except that seed (a person "Customizes" it into their own copy instead).
ALTER TABLE keystone.document_template
  ADD COLUMN IF NOT EXISTS builtin_slug text NULL CHECK (builtin_slug IS NULL OR builtin_slug ~ '^[a-z][a-z0-9-]{1,60}$'),
  ADD COLUMN IF NOT EXISTS builtin_sha  text NULL CHECK (builtin_sha IS NULL OR builtin_sha ~ '^[0-9a-f]{16,64}$');
ALTER TABLE keystone.document_template DROP CONSTRAINT IF EXISTS document_template_builtin_shape;
ALTER TABLE keystone.document_template ADD CONSTRAINT document_template_builtin_shape CHECK ((builtin_slug IS NULL) = (builtin_sha IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS document_template_builtin_once ON keystone.document_template (tenant_id, builtin_slug) WHERE builtin_slug IS NOT NULL AND active;
COMMENT ON COLUMN keystone.document_template.builtin_slug IS 'Run 9 (4R): this row is the workspace''s copy of the built-in template with this library slug — a read-only master. NULL for the workspace''s own templates.';

CREATE OR REPLACE FUNCTION keystone.document_template_builtin_readonly() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.builtin_slug IS NOT NULL AND current_setting('keystone.library_seed', true) IS DISTINCT FROM 'on'
     AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.source IS DISTINCT FROM OLD.source OR NEW.name IS DISTINCT FROM OLD.name
          OR NEW.builtin_slug IS DISTINCT FROM OLD.builtin_slug OR NEW.builtin_sha IS DISTINCT FROM OLD.builtin_sha OR NEW.kind IS DISTINCT FROM OLD.kind
          OR (NEW.active IS DISTINCT FROM OLD.active)) THEN
    RAISE EXCEPTION 'a built-in template is read-only: customize it to make your own copy' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS document_template_builtin_readonly_trg ON keystone.document_template;
CREATE TRIGGER document_template_builtin_readonly_trg BEFORE UPDATE ON keystone.document_template FOR EACH ROW EXECUTE FUNCTION keystone.document_template_builtin_readonly();

-- 2 · PLAYS ARE SKILLS. The document and form kinds are gone (their knowledge is now each template's own guidance); a workspace's own document or form play becomes a SKILL. A play version is
--     immutable (0676), so the converted words are a NEW version — kind: skill, no starter line — and a play whose newest version was the published one stays published, on the new version.
ALTER TABLE keystone.document_play DROP CONSTRAINT IF EXISTS document_play_kind_check;
--     As the runner's own connection (RESET ROLE, as 0710 does for its checks): under the migration role (app_owner) FORCED row security hides even keystone.tenant without a tenant set,
--     so a loop over workspaces would find none (MEASURED locally, 12 Oct 2026). Data only here; the role is set back before any object is made.
RESET ROLE;
DO $$
DECLARE r record; src text; v int; v_ids uuid[]; v_t uuid;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  FOREACH v_t IN ARRAY v_ids LOOP
  PERFORM set_config('keystone.tenant_id', v_t::text, true);
  FOR r IN SELECT p.id, p.tenant_id, p.current_version, (SELECT max(x.version) FROM keystone.document_play_version x WHERE x.play_id = p.id) AS newest FROM keystone.document_play p WHERE p.tenant_id = v_t AND p.kind IN ('document', 'form') LOOP
    IF r.newest IS NOT NULL THEN
      SELECT x.source INTO src FROM keystone.document_play_version x WHERE x.play_id = r.id AND x.version = r.newest;
      src := regexp_replace(src, '^kind:[ \t]*(document|form)[ \t]*$', 'kind: skill', 'n');
      src := regexp_replace(src, '^starter:[^\n]*\n', '', 'gn');
      v := r.newest + 1;
      INSERT INTO keystone.document_play_version (tenant_id, play_id, version, source, hash)
        VALUES (r.tenant_id, r.id, v, src, encode(sha256(convert_to(btrim(replace(src, E'\r\n', E'\n'), E' \t\r\n'), 'UTF8')), 'hex'));
      UPDATE keystone.document_play SET kind = 'skill', current_version = CASE WHEN r.current_version = r.newest THEN v ELSE current_version END, updated_at = now() WHERE id = r.id;
    ELSE
      UPDATE keystone.document_play SET kind = 'skill', updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $$;
SET ROLE app_owner;
ALTER TABLE keystone.document_play ADD CONSTRAINT document_play_kind_check CHECK (kind IN ('addon', 'house_style', 'skill'));

-- 3 · PLAYBOOKS ARE PACKS. A pack (a playbook with no flow) bundles skills AND templates for one job; switched on, its templates and skills are offered first. Templates are named as
--     `builtin:<slug>` or by the workspace template's family id. A row WITH a flow is an AUTOMATION (Run 9 Part 3.6, renamed): it stays in this table (Ruling, PLAN.md Part 4R) — every name a
--     person or a developer sees says automation; `enabled` means "running" for an automation and "switched on" for a pack.
ALTER TABLE keystone.document_playbook ADD COLUMN IF NOT EXISTS templates text[] NOT NULL DEFAULT '{}';
ALTER TABLE keystone.document_playbook DROP CONSTRAINT IF EXISTS document_playbook_templates_shape;
ALTER TABLE keystone.document_playbook ADD CONSTRAINT document_playbook_templates_shape CHECK (cardinality(templates) <= 24 AND (flow IS NULL OR cardinality(templates) = 0));
ALTER TABLE keystone.document_playbook DROP CONSTRAINT IF EXISTS document_playbook_enabled_needs_flow;
COMMENT ON COLUMN keystone.document_playbook.templates IS 'Run 9 (4R): the templates a pack brings: builtin:<slug> or a workspace template family id. Empty for an automation (a row with a flow).';
