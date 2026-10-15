-- 0495 · GROWTH FORM TEMPLATES (MARKETING FORMS PERSISTENCE)
--
-- A coach builds a form definition (title, slug, fields, consent requirement).
-- This table persists those definitions. The form may be published to a landing page
-- or standalone. Submitted responses are captured in the public forms.submitForm pipeline.
--
-- Fields are stored as JSON: [{key, label, type, required}, ...]
-- Types: text, email, phone, custom
-- ConsentRequired: always true for marketing forms (locked in UI).

CREATE TABLE keystone.growth_form_template (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  title               text NOT NULL CHECK (btrim(title) <> ''),
  slug                text NOT NULL CHECK (btrim(slug) <> ''),
  fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
  consent_required    boolean NOT NULL DEFAULT true,
  created_by          uuid NULL REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- ★ ONE (tenant_id, slug) pair: each tenant's form slugs must be unique.
  UNIQUE (tenant_id, slug)
);

CREATE INDEX growth_form_template_tenant_idx
  ON keystone.growth_form_template (tenant_id);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline as 0484 ──────────
ALTER TABLE keystone.growth_form_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.growth_form_template FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.growth_form_template
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.growth_form_template
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.growth_form_template
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.growth_form_template
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.growth_form_template TO app_rw;

-- ── Self-check with positive control ──────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.growth_form_template'::regclass) THEN
    RAISE EXCEPTION '0495 — keystone.growth_form_template is not FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'growth_form_template'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','tenant_delete');
  IF n <> 4 THEN
    RAISE EXCEPTION '0495 — expected 4 policies on growth_form_template, found %', n;
  END IF;
  -- ★ Positive controls: these must be TRUE
  IF NOT has_table_privilege('app_rw', 'keystone.growth_form_template', 'SELECT') THEN
    RAISE EXCEPTION '0495 — app_rw lost SELECT on growth_form_template; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.growth_form_template', 'INSERT') THEN
    RAISE EXCEPTION '0495 — app_rw lost INSERT on growth_form_template; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.growth_form_template', 'UPDATE') THEN
    RAISE EXCEPTION '0495 — app_rw lost UPDATE on growth_form_template; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.growth_form_template', 'DELETE') THEN
    RAISE EXCEPTION '0495 — app_rw lost DELETE on growth_form_template; this check is not merely asserting absences';
  END IF;
END $$;

COMMENT ON TABLE keystone.growth_form_template IS
  'F20/Task 20.47: Marketing form templates. Coaches build and persist form definitions '
  '(title, slug, fields, consent requirement). One (tenant_id, slug) enforced by database. '
  'Forms are published to landing pages or standalone; submissions flow to forms.submitForm.';
