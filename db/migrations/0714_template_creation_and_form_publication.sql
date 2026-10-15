-- 0714 · Run 8 (the maintainer, 11 Oct 2026): THE FREE PLAN'S MONTHLY TEMPLATE CAP AND A FORM COUNTING AS A DOCUMENT.
-- (1) keystone.document_template_creation — one line each time a NEW template (a new family: version 1 with no earlier version) is made, however it is made. The Free plan's
--     "5 new templates a month" counts these lines over the UTC calendar month. INSERT and SELECT only: nothing updates or deletes a line, and there is no foreign key to the
--     template, so deleting a template never gives one back (a monthly allowance, not a standing cap — specs/proofs/stage-t/run8/TEMPLATE-CAP.md).
-- (2) keystone.document_form_publication — one row per form family, the first time it is published. A form counts as one of the Free plan's 15 documents a month in the month
--     it is first published (the maintainer: "a form, and every form response, counts"); reopening, editing or publishing a new version does not count again.
-- Both: forced row-level security on the tenant, the reference-row guard, insert/read grants only. Backfilled so the counts are true on the day this ships. Idempotent, additive.
CREATE TABLE IF NOT EXISTS keystone.document_template_creation (
  id            uuid          PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid          NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  template_id   uuid          NOT NULL,
  kind          text          NOT NULL DEFAULT 'document' CHECK (kind IN ('document','form')),
  how           text          NULL CHECK (how IS NULL OR char_length(how) <= 40),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_id)
);
CREATE INDEX IF NOT EXISTS document_template_creation_tenant_at_idx ON keystone.document_template_creation (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS keystone.document_form_publication (
  tenant_id          uuid          NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  family_id          uuid          NOT NULL,
  first_published_at timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, family_id)
);
CREATE INDEX IF NOT EXISTS document_form_publication_tenant_at_idx ON keystone.document_form_publication (tenant_id, first_published_at DESC);

DO $p$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['document_template_creation', 'document_form_publication'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', r);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', r);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON keystone.%I', r);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON keystone.%I', r);
    EXECUTE format('DROP POLICY IF EXISTS reference_guard_read ON keystone.%I', r);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', r);
    EXECUTE format('CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', r);
    EXECUTE format('CREATE POLICY reference_guard_read ON keystone.%I FOR SELECT TO reference_guard USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference))', r);
    EXECUTE format('GRANT SELECT, INSERT ON keystone.%I TO app_rw, app_worker', r);
    EXECUTE format('GRANT SELECT ON keystone.%I TO reference_guard', r);
  END LOOP;
END $p$;

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;
DROP TRIGGER IF EXISTS document_template_creation_refuse_reference_delete_trg ON keystone.document_template_creation;
CREATE TRIGGER document_template_creation_refuse_reference_delete_trg AFTER DELETE ON keystone.document_template_creation
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_template_creation ENABLE ALWAYS TRIGGER document_template_creation_refuse_reference_delete_trg;
DROP TRIGGER IF EXISTS document_template_creation_refuse_reference_truncate_trg ON keystone.document_template_creation;
CREATE TRIGGER document_template_creation_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_template_creation
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
DROP TRIGGER IF EXISTS document_form_publication_refuse_reference_delete_trg ON keystone.document_form_publication;
CREATE TRIGGER document_form_publication_refuse_reference_delete_trg AFTER DELETE ON keystone.document_form_publication
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_form_publication ENABLE ALWAYS TRIGGER document_form_publication_refuse_reference_delete_trg;
DROP TRIGGER IF EXISTS document_form_publication_refuse_reference_truncate_trg ON keystone.document_form_publication;
CREATE TRIGGER document_form_publication_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_form_publication
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();

-- Backfill, one workspace at a time (document_template has FORCED row security: a bare statement sees no rows — see 0712).
--  · a creation line for every template family made this UTC month (its first version's time), so this month's count is right on the day this ships;
--  · a publication row for every form family that has ever had a public link (its earliest such version's time), so a form published before today never counts again.
DO $b$
DECLARE v_ids uuid[]; v_t uuid; v_month timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOREACH v_t IN ARRAY v_ids LOOP
    PERFORM set_config('keystone.tenant_id', v_t::text, true);
    INSERT INTO keystone.document_template_creation (tenant_id, template_id, kind, how, created_at)
      SELECT t.tenant_id, t.id, CASE WHEN t.kind = 'form' THEN 'form' ELSE 'document' END, 'backfill', t.created_at
        FROM keystone.document_template t
       WHERE t.tenant_id = v_t AND t.version = 1 AND t.previous_version_id IS NULL AND t.created_at >= v_month
      ON CONFLICT (tenant_id, template_id) DO NOTHING;
    INSERT INTO keystone.document_form_publication (tenant_id, family_id, first_published_at)
      SELECT t.tenant_id, coalesce(t.family_id, t.id), min(t.created_at)
        FROM keystone.document_template t
       WHERE t.tenant_id = v_t AND t.kind = 'form' AND t.self_serve_slug IS NOT NULL
       GROUP BY t.tenant_id, coalesce(t.family_id, t.id)
      ON CONFLICT (tenant_id, family_id) DO NOTHING;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $b$;

DO $c$
BEGIN
  IF to_regclass('keystone.document_template_creation') IS NULL OR to_regclass('keystone.document_form_publication') IS NULL THEN
    RAISE EXCEPTION '0714 self-check: a table was not created';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_template_creation'::regclass) THEN RAISE EXCEPTION '0714 self-check: row security not forced'; END IF;
  IF has_table_privilege('app_rw', 'keystone.document_template_creation', 'DELETE') OR has_table_privilege('app_rw', 'keystone.document_template_creation', 'UPDATE') THEN
    RAISE EXCEPTION '0714 self-check: the template ledger must be insert-only for the application';
  END IF;
END $c$;
