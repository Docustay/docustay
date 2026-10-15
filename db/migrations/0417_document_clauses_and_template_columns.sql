-- 0417_document_clauses_and_template_columns
--
-- Stage 14 task 14.10 — reusable clauses (keystone.document_clause), the join table that lets a
-- contract template pull them in at a position (keystone.template_clause), starter/published/
-- retired columns on keystone.document_template, and a twelfth signer configuration —
-- CLIENT_AND_PARENT — on keystone.document_type.
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, for BOTH new tables. Shape copied from
-- the two most recent complete precedents named by the task (`0402_booking_block.sql`,
-- `0382_staff_shift_and_time_off.sql`) plus the mandatory EXECUTE lend/give-back this stage's
-- precedents (`0409`, `0414`, `0415`) establish as "not optional" for `refuse_touch_reference_rows`.
-- `db/gates/p21a_cross_tenant_fuzz.mjs` enumerates tables from `pg_class`, so both new tables are
-- picked up automatically and must pass independently.
--
-- `document_template` and `document_type` are pre-existing tables with TABLE-LEVEL app_rw grants
-- (0009:186 / 0011:245, both via a `FOREACH ... GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I
-- TO app_rw` loop, MEASURED) — a new column on either inherits that grant automatically. Neither
-- table uses `keystone.link_token`'s column-level grant style (CCR-16), so no per-column GRANT is
-- added here; the closing self-check proves the inheritance with a positive control instead of
-- assuming it.
--
-- Documents-as-instruments: this migration adds no way for an EXECUTED instance's terms to move.
-- `document_clause`/`template_clause` reach only the TEMPLATE layer (draft composition); an executed
-- instance already carries its own frozen `template_snapshot` (0009:151) untouched by this file.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS (§0.4 A shape, 0194:27-44 / 0410:25-95) — must run as app_owner, the tables this
-- migration alters must exist, and nothing it is about to create may already exist.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0417: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  IF to_regclass('keystone.document_template') IS NULL THEN
    RAISE EXCEPTION '0417: keystone.document_template does not exist';
  END IF;
  IF to_regclass('keystone.document_type') IS NULL THEN
    RAISE EXCEPTION '0417: keystone.document_type does not exist';
  END IF;
  IF to_regclass('keystone.plan') IS NULL THEN
    RAISE EXCEPTION '0417: keystone.plan does not exist';
  END IF;

  IF to_regclass('keystone.document_clause') IS NOT NULL THEN
    RAISE EXCEPTION '0417: keystone.document_clause already exists';
  END IF;
  IF to_regclass('keystone.template_clause') IS NOT NULL THEN
    RAISE EXCEPTION '0417: keystone.template_clause already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE (table_schema, table_name, column_name) IN (
       ('keystone','document_template','starter_key'),
       ('keystone','document_template','type_id'),
       ('keystone','document_template','requires_parent_under_18'),
       ('keystone','document_template','re_sign_months'),
       ('keystone','document_template','creates_subscription_plan_id'),
       ('keystone','document_template','published_at'),
       ('keystone','document_template','retired_at'),
       ('keystone','document_template','teen_template_id')
     )
  ) THEN
    RAISE EXCEPTION '0417: at least one of the columns this migration adds to document_template already exists — check for a duplicate run';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_type_signer_config_check'
       AND conrelid = 'keystone.document_type'::regclass
  ) THEN
    RAISE EXCEPTION '0417: document_type_signer_config_check does not exist to drop';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.document_clause (§0.4 A). A reusable contract section: `body` holds one section's
-- `blocks` array (validated in JS by 14.35, not here). `kind` distinguishes a firm-authored
-- ('standard') clause from a practice's own ('yours'), default 'yours'. Archived, never deleted —
-- `archived_at` is the soft-delete marker, so there is no tenant_delete policy and no DELETE grant.
-- `UNIQUE (tenant_id, id)` so `template_clause` can composite-FK to it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.document_clause (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name        text        NOT NULL,
  gist        text        NOT NULL,
  body        jsonb       NOT NULL,
  kind        text        NOT NULL DEFAULT 'yours' CHECK (kind IN ('standard','yours')),
  archived_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_clause_tenant_id_key   ON keystone.document_clause (tenant_id, id);
CREATE UNIQUE INDEX document_clause_tenant_name_key ON keystone.document_clause (tenant_id, lower(name));

ALTER TABLE keystone.document_clause ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_clause FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.document_clause USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.document_clause FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.document_clause FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
-- No tenant_delete: a clause is archived (archived_at), never deleted.

CREATE TRIGGER document_clause_touch BEFORE UPDATE ON keystone.document_clause
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON keystone.document_clause TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — keystone.template_clause (§0.4 A, no touch trigger). Which clauses a template pulls in, and
-- in what order. `template_id` is a PLAIN FK (cascades with the template); `clause_id` is a
-- COMPOSITE FK (RESTRICT — a clause in use cannot be removed out from under a template). Full CRUD:
-- adding/removing a clause from a template and reordering it (`position`) are all ordinary edits, so
-- unlike `document_clause` this table keeps a delete path and a tenant_delete policy.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.template_clause (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  template_id uuid        NOT NULL REFERENCES keystone.document_template(id) ON DELETE CASCADE,
  clause_id   uuid        NOT NULL,
  position    integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_clause_clause_id_fkey FOREIGN KEY (tenant_id, clause_id)
    REFERENCES keystone.document_clause (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT template_clause_unique UNIQUE (tenant_id, template_id, clause_id)
);
CREATE INDEX template_clause_template_idx ON keystone.template_clause (tenant_id, template_id, position);

ALTER TABLE keystone.template_clause ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.template_clause FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.template_clause USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.template_clause FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.template_clause FOR UPDATE
  USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.template_clause FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.template_clause TO app_rw;

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF, BOTH NEW TABLES ═══════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER document_clause_refuse_reference_delete_trg AFTER DELETE ON keystone.document_clause
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_clause ENABLE ALWAYS TRIGGER document_clause_refuse_reference_delete_trg;
CREATE TRIGGER document_clause_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.document_clause
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.document_clause ENABLE ALWAYS TRIGGER document_clause_refuse_reference_truncate_trg;

CREATE TRIGGER template_clause_refuse_reference_delete_trg AFTER DELETE ON keystone.template_clause
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.template_clause ENABLE ALWAYS TRIGGER template_clause_refuse_reference_delete_trg;
CREATE TRIGGER template_clause_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.template_clause
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.template_clause ENABLE ALWAYS TRIGGER template_clause_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.document_clause TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.document_clause FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

GRANT SELECT ON keystone.template_clause TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.template_clause FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §C — keystone.document_template ADD COLUMNs: starter/published/retired markers, the type link,
-- the teen-signer-order link, the plan a signed instrument creates a subscription to, and the
-- re-sign cadence. Draft semantics: `active = false AND published_at IS NULL` is a draft; existing
-- rows (`active = true`) stay live as-is — no backfill.
-- `document_template` carries a TABLE-LEVEL app_rw grant (0009:186); a new column inherits it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.document_template
  ADD COLUMN starter_key                text NULL CHECK (starter_key ~ '^[a-z][a-z0-9-]*$'),
  ADD COLUMN type_id                    uuid NULL REFERENCES keystone.document_type(id) ON DELETE SET NULL,
  ADD COLUMN requires_parent_under_18   boolean NOT NULL DEFAULT false,
  ADD COLUMN re_sign_months             integer NULL CHECK (re_sign_months BETWEEN 1 AND 60),
  ADD COLUMN creates_subscription_plan_id uuid NULL REFERENCES keystone.plan(id) ON DELETE SET NULL,
  ADD COLUMN published_at               timestamptz NULL,
  ADD COLUMN retired_at                 timestamptz NULL,
  ADD COLUMN teen_template_id           uuid NULL REFERENCES keystone.document_template(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX document_template_starter ON keystone.document_template (tenant_id, starter_key, version)
  WHERE starter_key IS NOT NULL;

COMMENT ON COLUMN keystone.document_template.starter_key IS
  '14.10 — which built-in starter this template was drafted from, if any; unique per (tenant, key, version) while set.';
COMMENT ON COLUMN keystone.document_template.published_at IS
  '14.10 — draft semantics: active=false AND published_at IS NULL is a draft. Existing rows (active=true) stay live, unbackfilled.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §D — keystone.document_type: the twelfth signer configuration, CLIENT_AND_PARENT, alongside the
-- existing eleven. Drop and re-add the CHECK constraint with the widened value list; the name is
-- unchanged (Postgres's own default name for the single inline CHECK on this column, confirmed
-- present by §a's precondition above).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.document_type DROP CONSTRAINT document_type_signer_config_check;
ALTER TABLE keystone.document_type ADD CONSTRAINT document_type_signer_config_check
  CHECK (signer_config IN (
    'PIR_ONLY','COACH_ONLY','CO_SIGNED','PARENT_ONLY','PARENT_AND_COACH','PIR_PARENT_COACH',
    'CLIENT_ONLY','CLIENT_AND_CONSULTANT','FAMILY_MEMBER_ONLY','RECIPIENT_ONLY','RECIPIENT_AND_COACH',
    'CLIENT_AND_PARENT'
  ));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, BOTH NEW TABLES, WITH POSITIVE CONTROLS ═════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  -- ── keystone.document_clause ──────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.document_clause'::regclass) THEN
    RAISE EXCEPTION '0417 — keystone.document_clause is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'document_clause'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0417 — expected 4 policies on document_clause, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='document_clause' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0417 — document_clause has a tenant_delete policy but no delete path (archived_at is the marker); remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.document_clause'::regclass
     AND tgname IN ('document_clause_refuse_reference_delete_trg','document_clause_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0417 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on document_clause, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.document_clause'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0417 — reference_guard_read on document_clause must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0417: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the lend was not revoked';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.document_clause', 'SELECT') THEN
    RAISE EXCEPTION '0417 — app_rw is missing SELECT on document_clause';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_clause', 'INSERT') THEN
    RAISE EXCEPTION '0417 — app_rw is missing INSERT on document_clause';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_clause', 'UPDATE') THEN
    RAISE EXCEPTION '0417 — app_rw lost UPDATE on document_clause; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.document_clause', 'SELECT') THEN
    RAISE EXCEPTION '0417 — reference_guard has no SELECT on document_clause; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.document_clause', 'DELETE') THEN
    RAISE EXCEPTION '0417 — app_rw must NOT hold DELETE on document_clause (a clause is archived, never deleted)';
  END IF;

  -- ── keystone.template_clause ──────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.template_clause'::regclass) THEN
    RAISE EXCEPTION '0417 — keystone.template_clause is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'template_clause'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','tenant_delete','reference_guard_read');
  IF n <> 5 THEN
    RAISE EXCEPTION '0417 — expected 5 policies on template_clause, found %', n;
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.template_clause'::regclass
     AND tgname IN ('template_clause_refuse_reference_delete_trg','template_clause_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0417 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on template_clause, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.template_clause'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0417 — reference_guard_read on template_clause must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block.
  IF NOT has_table_privilege('app_rw', 'keystone.template_clause', 'SELECT') THEN
    RAISE EXCEPTION '0417 — app_rw is missing SELECT on template_clause';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.template_clause', 'INSERT') THEN
    RAISE EXCEPTION '0417 — app_rw is missing INSERT on template_clause';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.template_clause', 'UPDATE') THEN
    RAISE EXCEPTION '0417 — app_rw is missing UPDATE on template_clause';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.template_clause', 'DELETE') THEN
    RAISE EXCEPTION '0417 — app_rw is missing DELETE on template_clause';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.template_clause', 'SELECT') THEN
    RAISE EXCEPTION '0417 — reference_guard has no SELECT on template_clause; its policy would have nothing underneath it';
  END IF;

  -- ── keystone.document_template new columns — shape + grant inheritance (table-level, 0009:186) ─
  IF (SELECT count(*)
        FROM information_schema.columns
       WHERE table_schema = 'keystone' AND table_name = 'document_template'
         AND column_name IN ('starter_key','type_id','requires_parent_under_18','re_sign_months',
                              'creates_subscription_plan_id','published_at','retired_at','teen_template_id')
     ) <> 8 THEN
    RAISE EXCEPTION '0417 — one or more document_template columns did not get added';
  END IF;

  IF to_regclass('keystone.document_template_starter') IS NULL THEN
    RAISE EXCEPTION '0417 — document_template_starter (partial UNIQUE on starter_key) was not created';
  END IF;

  -- Positive control: the table-level grant reaches the new column (mirrors 0410's model).
  IF NOT has_column_privilege('app_rw', 'keystone.document_template', 'starter_key', 'UPDATE') THEN
    RAISE EXCEPTION '0417 — app_rw cannot UPDATE keystone.document_template.starter_key — the table-level grant did not extend to the new column';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_template', 'SELECT') THEN
    RAISE EXCEPTION '0417 — app_rw lost SELECT on keystone.document_template';
  END IF;

  -- ── keystone.document_type — the widened CHECK, and the grant untouched by this ALTER ──────────
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint
                             WHERE conname = 'document_type_signer_config_check'
                               AND conrelid = 'keystone.document_type'::regclass))
     NOT LIKE '%CLIENT_AND_PARENT%' THEN
    RAISE EXCEPTION '0417 — document_type_signer_config_check does not carry CLIENT_AND_PARENT';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.document_type', 'INSERT') THEN
    RAISE EXCEPTION '0417 — app_rw lost INSERT on keystone.document_type';
  END IF;
END
$ct_f52_self_check$;

-- Written, not applied.
