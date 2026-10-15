-- 0410_catalogue_editor_columns
-- Stage 14 task 14.3 — the editors' fields get somewhere to live: columns on the five existing
-- catalogue tables (`service`, `package`, `plan`, `discount`, `item_agreement_requirement`), plus
-- the one new join table `keystone.service_host` that names who on the team delivers a service
-- (§0.4 A minus touch trigger — empty = anyone on the team, F06 §2.2).
--
-- ADD COLUMN only against the five existing tables: they already carry RLS, tenant policies and
-- table-level grants (confirmed below in the precondition block), and a new column inherits every
-- one of those automatically. No re-grant, no re-policy, no second `refuse_touch_reference_rows`
-- trigger — CT-F52 does not apply to a column added to a table that already has it.
--
-- R-14.7 is RULED IN, not conditional: every column below ships, including the former "marked
-- block" (description/internal_notes/tax_code/delivery_modes/capacity/unit_id/service_host).
--
-- FK direction/delete behaviour follows 14.1's ruling: an image delete is a real DELETE, allowed
-- while unreferenced, and the FKs added here that point AT `keystone.image` are `ON DELETE SET
-- NULL` (the route refuses the delete while still referenced — that refusal is application code,
-- not this migration).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS (§0.4 A shape, 0194:27-44) — the two dependencies this migration reads from
-- (0408 `keystone.image`, 0409 `keystone.service_category` / `keystone.unit`) must already exist,
-- and the five target tables must exist with table-level (not column-level) app_rw grants.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0410: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  IF to_regclass('keystone.service_category') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.service_category does not exist — 0409 must run first';
  END IF;
  IF to_regclass('keystone.image') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.image does not exist — 0408 must run first';
  END IF;
  IF to_regclass('keystone.unit') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.unit does not exist — 0409 must run first';
  END IF;
  IF to_regclass('keystone.document_template') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.document_template does not exist';
  END IF;

  IF to_regclass('keystone.service') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.service does not exist';
  END IF;
  IF to_regclass('keystone.package') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.package does not exist';
  END IF;
  IF to_regclass('keystone.plan') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.plan does not exist';
  END IF;
  IF to_regclass('keystone.discount') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.discount does not exist';
  END IF;
  IF to_regclass('keystone.item_agreement_requirement') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.item_agreement_requirement does not exist';
  END IF;

  -- None of the columns this migration is about to add may already exist (catches a duplicate run
  -- or a plan that names a column that is already there, rather than silently doubling up).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE (table_schema, table_name, column_name) IN (
       ('keystone','service','category_id'), ('keystone','service','image_id'),
       ('keystone','service','colour'), ('keystone','service','sku'),
       ('keystone','service','invoice_wording'), ('keystone','service','addon_only'),
       ('keystone','service','intake_form_id'), ('keystone','service','description'),
       ('keystone','service','internal_notes'), ('keystone','service','tax_code'),
       ('keystone','service','delivery_modes'), ('keystone','service','capacity'),
       ('keystone','service','unit_id'),
       ('keystone','package','description'), ('keystone','package','image_id'),
       ('keystone','package','expiry_months'), ('keystone','package','warn_at_remaining'),
       ('keystone','package','portal_sellable'), ('keystone','package','public_sellable'),
       ('keystone','plan','description'), ('keystone','plan','billing_day'),
       ('keystone','plan','allow_client_pause'), ('keystone','plan','max_pauses_per_year'),
       ('keystone','plan','max_pause_months'), ('keystone','plan','dunning_retries'),
       ('keystone','plan','dunning_days'), ('keystone','plan','dunning_pause_after'),
       ('keystone','discount','description_client'), ('keystone','discount','max_discount_minor'),
       ('keystone','discount','first_purchase_only'), ('keystone','discount','per_person_limit'),
       ('keystone','discount','target_ids'), ('keystone','discount','stripe_coupon_id'),
       ('keystone','discount','stripe_promotion_code_id'),
       ('keystone','item_agreement_requirement','first_booking_only'),
       ('keystone','item_agreement_requirement','hold_until_signed'),
       ('keystone','item_agreement_requirement','teen_template_id')
     )
  ) THEN
    RAISE EXCEPTION '0410: at least one of the columns this migration adds already exists — check for a duplicate run';
  END IF;

  IF to_regclass('keystone.service_host') IS NOT NULL THEN
    RAISE EXCEPTION '0410: keystone.service_host already exists';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · service — F06 §3.2, plus the R-14.7 block (ruled in, not conditional)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.service
  ADD COLUMN category_id       uuid NULL,
  ADD COLUMN image_id          uuid NULL,
  ADD COLUMN colour            text NULL CHECK (colour ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN sku               text NULL,
  ADD COLUMN invoice_wording   text NULL,
  ADD COLUMN addon_only        boolean NOT NULL DEFAULT false,
  ADD COLUMN intake_form_id    uuid NULL REFERENCES keystone.document_template(id) ON DELETE SET NULL,
  -- R-14.7 block:
  ADD COLUMN description       text NULL,
  ADD COLUMN internal_notes    text NULL,
  ADD COLUMN tax_code          text NULL,
  ADD COLUMN delivery_modes    text[] NOT NULL DEFAULT '{in_person}'
                 CHECK (cardinality(delivery_modes) >= 1
                        AND delivery_modes <@ ARRAY['in_person','video','at_client']),
  ADD COLUMN capacity          integer NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  ADD COLUMN unit_id           uuid NULL;

ALTER TABLE keystone.service
  ADD CONSTRAINT service_category_id_fkey FOREIGN KEY (tenant_id, category_id)
    REFERENCES keystone.service_category (tenant_id, id) ON DELETE SET NULL (category_id);
ALTER TABLE keystone.service
  ADD CONSTRAINT service_image_id_fkey FOREIGN KEY (tenant_id, image_id)
    REFERENCES keystone.image (tenant_id, id) ON DELETE SET NULL (image_id);
ALTER TABLE keystone.service
  ADD CONSTRAINT service_unit_id_fkey FOREIGN KEY (tenant_id, unit_id)
    REFERENCES keystone.unit (tenant_id, id) ON DELETE RESTRICT;

COMMENT ON COLUMN keystone.service.bookable IS
  '§A4 — turning this off removes the SLOT and leaves existing appointments alone. Never cascade.';
COMMENT ON COLUMN keystone.service.delivery_modes IS
  '14.3 (R-14.7) — at least one of in_person/video/at_client; MOCKUPS-drawn editor field.';

-- ─────────────────────────────────────────────────────────────────────────────
-- keystone.service_host — §0.4 A minus touch trigger. Empty = anyone on the team (F06 §2.2).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.service_host (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  service_id    uuid        NOT NULL,
  app_user_id   uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_host_service_id_fkey FOREIGN KEY (tenant_id, service_id)
    REFERENCES keystone.service (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT service_host_app_user_id_fkey FOREIGN KEY (tenant_id, app_user_id)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT service_host_unique UNIQUE (tenant_id, service_id, app_user_id)
);
CREATE INDEX service_host_tenant_idx ON keystone.service_host (tenant_id);

ALTER TABLE keystone.service_host ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.service_host FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.service_host USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.service_host FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ `tenant_update` AND `tenant_delete` — ADDED 25 Sep 2026, AND THEIR ABSENCE WAS A REAL BUG,
--     NOT A MISSING FORMALITY. 14.3 built this table to the literal "§0.4 A minus touch trigger"
--     shape its own field 4 gave, and flagged that the rest of CT-F52 might be owed — it was.
--   ★★ THE CONSEQUENCE WITHOUT THEM: `app_rw` is granted UPDATE and DELETE on the line below, but
--      under FORCE ROW LEVEL SECURITY **a command with no matching policy matches no rows** — it
--      does not error, it silently affects nothing. So a practice could assign a coach to a service
--      and then **never un-assign them**: the DELETE would return "0 rows" and the screen would
--      report success. A grant without a policy is a door with no handle on the inside.
--   ★ `tenant_delete` is included precisely BECAUSE a delete path exists here (CT-F52 point 2 adds
--     it "wherever a delete path exists") — un-assigning a host is an ordinary, reversible act on a
--     join row, unlike the tables in this schema that are deliberately transition-only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY tenant_update    ON keystone.service_host FOR UPDATE
  USING      (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.service_host FOR DELETE
  USING      (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.service_host TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ CT-F52 POINTS 3, 4b AND 5 — THE REFERENCE-PRACTICE GUARD HALF, ALSO ADDED 25 Sep 2026.
--     `catalog-conformance.mjs:186-195` fails any table that "has a tenant_id column and no
--     refuse_touch_reference_rows trigger, and is not on the EXEMPT list with a reason", and
--     `db/gates/p21a_cross_tenant_fuzz.mjs` enumerates tables straight from `pg_class` — so a new
--     tenant table is picked up automatically whether or not its task's field 4 mentioned the gate.
--   ★★★ THE EXECUTE LEND IS NOT OPTIONAL — see CONTRACTS.md CT-F52 point 4b, corrected tonight.
--     `CREATE TRIGGER` checks EXECUTE on the trigger function AT CREATE TIME; `0099:83` revoked ALL
--     on it FROM PUBLIC, `0144:245` made `reference_guard` its owner, every borrower revokes again,
--     and `db/migrate.mjs:179` runs as `app_owner`, not superuser. Five pending migrations were
--     written without this bracket tonight and none of them could have applied.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER service_host_refuse_reference_delete_trg AFTER DELETE ON keystone.service_host
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.service_host ENABLE ALWAYS TRIGGER service_host_refuse_reference_delete_trg;
CREATE TRIGGER service_host_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.service_host
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.service_host ENABLE ALWAYS TRIGGER service_host_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.service_host TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.service_host FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

COMMENT ON TABLE keystone.service_host IS
  '14.3 (§0.4 A minus touch trigger) — who on the team may deliver a service. Empty = anyone on the team (F06 §2.2).';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · package
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.package
  ADD COLUMN description       text NULL,
  ADD COLUMN image_id          uuid NULL,
  ADD COLUMN expiry_months     integer NULL CHECK (expiry_months BETWEEN 1 AND 120),
  ADD COLUMN warn_at_remaining integer NOT NULL DEFAULT 2 CHECK (warn_at_remaining >= 0),
  ADD COLUMN portal_sellable   boolean NOT NULL DEFAULT false,
  ADD COLUMN public_sellable   boolean NOT NULL DEFAULT false;

ALTER TABLE keystone.package
  ADD CONSTRAINT package_image_id_fkey FOREIGN KEY (tenant_id, image_id)
    REFERENCES keystone.image (tenant_id, id) ON DELETE SET NULL (image_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §3 · plan
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.plan
  ADD COLUMN description          text NULL,
  ADD COLUMN billing_day          integer NULL CHECK (billing_day BETWEEN 1 AND 28),
  ADD COLUMN allow_client_pause   boolean NOT NULL DEFAULT false,
  ADD COLUMN max_pauses_per_year  integer NULL CHECK (max_pauses_per_year >= 0),
  ADD COLUMN max_pause_months     integer NULL CHECK (max_pause_months >= 1),
  ADD COLUMN dunning_retries      integer NULL CHECK (dunning_retries >= 0),
  ADD COLUMN dunning_days         integer NULL CHECK (dunning_days >= 1),
  ADD COLUMN dunning_pause_after  integer NULL CHECK (dunning_pause_after >= 0);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §4 · discount
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.discount
  ADD COLUMN description_client       text NULL,
  ADD COLUMN max_discount_minor       integer NULL CHECK (max_discount_minor > 0),
  ADD COLUMN first_purchase_only      boolean NOT NULL DEFAULT false,
  ADD COLUMN per_person_limit         integer NULL CHECK (per_person_limit > 0),
  ADD COLUMN target_ids               uuid[] NULL,
  ADD COLUMN stripe_coupon_id         text NULL,
  ADD COLUMN stripe_promotion_code_id text NULL;

ALTER TABLE keystone.discount
  ADD CONSTRAINT discount_cap_is_percent_only CHECK (max_discount_minor IS NULL OR kind = 'percent');

COMMENT ON CONSTRAINT discount_cap_is_percent_only ON keystone.discount IS
  '14.3 — "Only for percentage discounts": max_discount_minor caps a percent discount''s payout; a fixed discount has no cap to name.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §5 · item_agreement_requirement
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.item_agreement_requirement
  ADD COLUMN first_booking_only boolean NOT NULL DEFAULT true,
  ADD COLUMN hold_until_signed  boolean NOT NULL DEFAULT false,
  ADD COLUMN teen_template_id   uuid NULL REFERENCES keystone.document_template(id) ON DELETE RESTRICT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §b · SHAPE CHECK (§0.4 A shape, 0194:209-242) — every column exists with the right type/
-- nullability/default, every named FK/CHECK constraint exists, and service_host carries FORCE RLS,
-- its two tenant policies and app_rw's table-level grants (with a POSITIVE CONTROL alongside the
-- negative one, so a check made only of negative assertions cannot pass on an empty database).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $shape_check$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected.table_name || '.' || expected.column_name, ', ')
    INTO v_missing
    FROM (VALUES
      ('service','category_id'), ('service','image_id'), ('service','colour'), ('service','sku'),
      ('service','invoice_wording'), ('service','addon_only'), ('service','intake_form_id'),
      ('service','description'), ('service','internal_notes'), ('service','tax_code'),
      ('service','delivery_modes'), ('service','capacity'), ('service','unit_id'),
      ('package','description'), ('package','image_id'), ('package','expiry_months'),
      ('package','warn_at_remaining'), ('package','portal_sellable'), ('package','public_sellable'),
      ('plan','description'), ('plan','billing_day'), ('plan','allow_client_pause'),
      ('plan','max_pauses_per_year'), ('plan','max_pause_months'), ('plan','dunning_retries'),
      ('plan','dunning_days'), ('plan','dunning_pause_after'),
      ('discount','description_client'), ('discount','max_discount_minor'),
      ('discount','first_purchase_only'), ('discount','per_person_limit'),
      ('discount','target_ids'), ('discount','stripe_coupon_id'), ('discount','stripe_promotion_code_id'),
      ('item_agreement_requirement','first_booking_only'), ('item_agreement_requirement','hold_until_signed'),
      ('item_agreement_requirement','teen_template_id')
    ) AS expected(table_name, column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'keystone' AND c.table_name = expected.table_name
        AND c.column_name = expected.column_name
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0410: missing column(s) after ALTER: %', v_missing;
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('service_category_id_fkey','service_image_id_fkey','service_unit_id_fkey',
                          'package_image_id_fkey','discount_cap_is_percent_only',
                          'service_host_service_id_fkey','service_host_app_user_id_fkey',
                          'service_host_unique')) <> 8 THEN
    RAISE EXCEPTION '0410: one or more named constraints did not get created';
  END IF;

  IF to_regclass('keystone.service_host') IS NULL THEN
    RAISE EXCEPTION '0410: keystone.service_host does not exist after CREATE TABLE';
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.service_host'::regclass) THEN
    RAISE EXCEPTION '0410: keystone.service_host does not have FORCE ROW LEVEL SECURITY';
  END IF;
  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'keystone.service_host'::regclass
         AND polname IN ('tenant_isolation','tenant_insert')) <> 2 THEN
    RAISE EXCEPTION '0410: keystone.service_host does not carry both tenant policies';
  END IF;

  -- Positive controls alongside the negatives: app_rw DOES hold these privileges, on the new table
  -- and on the five existing ones (the whole point of "a column inherits the table's grant").
  IF NOT has_table_privilege('app_rw', 'keystone.service_host', 'SELECT') THEN
    RAISE EXCEPTION '0410: app_rw is missing SELECT on keystone.service_host';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.service_host', 'INSERT') THEN
    RAISE EXCEPTION '0410: app_rw is missing INSERT on keystone.service_host';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.service', 'SELECT') THEN
    RAISE EXCEPTION '0410: app_rw is missing SELECT on keystone.service (table-level grant should already cover the new columns)';
  END IF;
  IF NOT has_column_privilege('app_rw', 'keystone.service', 'category_id', 'SELECT') THEN
    RAISE EXCEPTION '0410: app_rw cannot SELECT keystone.service.category_id — the table-level grant did not extend to the new column';
  END IF;
  IF NOT has_column_privilege('app_rw', 'keystone.discount', 'max_discount_minor', 'UPDATE') THEN
    RAISE EXCEPTION '0410: app_rw cannot UPDATE keystone.discount.max_discount_minor — the table-level grant did not extend to the new column';
  END IF;

  RAISE NOTICE '0410: all catalogue editor columns present, all named constraints present, keystone.service_host carries FORCE RLS + tenant policies + app_rw grants.';
END
$shape_check$;

-- Written, not applied.
