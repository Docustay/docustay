-- 0708 · TEMPLATE FAMILIES AND TYPES (Run 7, part 2 foundations). Additive and idempotent.
-- Before: every version of a template, a form's link and its responses were matched by the template's NAME (lower(name)), so a rename could split a template from its own
-- versions and responses, and nothing said whether a template is a document template or a form.
--   · document_template.family_id — one id shared by every version of a template (the first version's id). A trigger fills it from previous_version_id, so every insert path
--     (uploaded, written, AI, a copy) gets it without code having to remember.
--   · document_template.kind — 'document' or 'form', decided where the template is made.
--   · document_instance.form_id — the family id of the form a response came from.

ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'document';
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_template_kind_check') THEN
    ALTER TABLE keystone.document_template ADD CONSTRAINT document_template_kind_check CHECK (kind IN ('document', 'form'));
  END IF;
END $c$;
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS form_id uuid;

-- the family of a new or re-pointed row: the previous version's family, else its own id
CREATE OR REPLACE FUNCTION keystone.document_template_family() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.previous_version_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id) THEN
    SELECT coalesce(p.family_id, p.id), p.kind INTO NEW.family_id, NEW.kind FROM keystone.document_template p WHERE p.id = NEW.previous_version_id;
  END IF;
  IF NEW.family_id IS NULL THEN NEW.family_id := NEW.id; END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS document_template_family ON keystone.document_template;
CREATE TRIGGER document_template_family BEFORE INSERT OR UPDATE OF previous_version_id ON keystone.document_template
  FOR EACH ROW EXECUTE FUNCTION keystone.document_template_family();

-- BACKFILLS, one workspace at a time: document_template is under FORCED row security keyed on keystone.tenant_id, so the migration role sees nothing without it (measured:
-- the first draft of this file ran "ok" and changed zero rows). Workspaces are enumerated as auth_owner, the way 0168 does (F490).
DO $b$
DECLARE v_ids uuid[]; v_t uuid;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOREACH v_t IN ARRAY v_ids LOOP
    PERFORM set_config('keystone.tenant_id', v_t::text, true);
    -- 1: each previous_version_id chain gets its root's id
    WITH RECURSIVE chain AS (
      SELECT id, id AS root FROM keystone.document_template WHERE tenant_id = v_t AND previous_version_id IS NULL
      UNION ALL
      SELECT t.id, c.root FROM keystone.document_template t JOIN chain c ON t.previous_version_id = c.id
    )
    UPDATE keystone.document_template t SET family_id = c.root FROM chain c WHERE t.id = c.id AND t.family_id IS NULL;
    UPDATE keystone.document_template SET family_id = id WHERE tenant_id = v_t AND family_id IS NULL;
    -- 2: versions made before previous_version_id existed share (builder, lower(name)) — the unique key (tenant, builder, lower(name), version) makes one name one template,
    --    and a rename has always renamed every version together — so the whole name joins the oldest version's family
    WITH firsts AS (
      SELECT DISTINCT ON (builder, lower(name)) builder, lower(name) AS n, family_id
        FROM keystone.document_template WHERE tenant_id = v_t ORDER BY builder, lower(name), version, created_at
    )
    UPDATE keystone.document_template t SET family_id = f.family_id
      FROM firsts f WHERE t.tenant_id = v_t AND t.builder = f.builder AND lower(t.name) = f.n AND t.family_id IS DISTINCT FROM f.family_id;
    -- 3: every family that was ever a form is a form template
    UPDATE keystone.document_template t SET kind = 'form'
     WHERE t.tenant_id = v_t AND t.kind <> 'form' AND EXISTS (SELECT 1 FROM keystone.document_template f WHERE f.tenant_id = v_t AND f.family_id = t.family_id AND f.collects_many);
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $b$;
-- Responses made before this migration keep form_id NULL: the code matches them through their template's FAMILY (template_id or the file's from_template note), not its name,
-- so a rename can no longer lose them; new responses carry form_id from the start.

CREATE INDEX IF NOT EXISTS document_template_family_idx ON keystone.document_template (tenant_id, family_id);
CREATE INDEX IF NOT EXISTS document_instance_form_idx ON keystone.document_instance (tenant_id, form_id) WHERE form_id IS NOT NULL;

DO $check$
DECLARE v_ids uuid[]; v_t uuid; v_bad int := 0; v_rows int := 0; v_forms int := 0;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOREACH v_t IN ARRAY v_ids LOOP
    PERFORM set_config('keystone.tenant_id', v_t::text, true);
    v_bad := v_bad + (SELECT count(*) FROM keystone.document_template WHERE tenant_id = v_t AND family_id IS NULL)
                   + (SELECT count(*) FROM keystone.document_template t JOIN keystone.document_template p ON p.id = t.previous_version_id WHERE t.tenant_id = v_t AND p.family_id <> t.family_id);
    v_rows := v_rows + (SELECT count(*) FROM keystone.document_template WHERE tenant_id = v_t);
    v_forms := v_forms + (SELECT count(DISTINCT family_id) FROM keystone.document_template WHERE tenant_id = v_t AND kind = 'form');
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
  IF v_bad > 0 THEN RAISE EXCEPTION '0708: % template row(s) without a family or in a different family from their previous version', v_bad; END IF;
  RAISE NOTICE '0708: % template rows checked across % workspaces, % form families', v_rows, array_length(v_ids, 1), v_forms;
END
$check$;
