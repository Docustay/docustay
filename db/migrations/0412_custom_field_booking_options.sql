-- 0412_custom_field_booking_options
-- Stage 14 task 14.5 — "Options" (questions at booking) reuse `keystone.custom_field` instead of a
-- new `booking_option` table. Answers keyed to a booking fit `custom_field_value(record_id = booking
-- id)` exactly, if the question is a `custom_field` row with `record_type = 'engagement'` — a
-- separate table would break the FK. Missing on `custom_field`: required, show-if, per-service
-- scope, report flag. This migration adds only those four columns, plus a CHECK that confines them
-- to `engagement` rows so the person-field layer (`src/fields/*`) cannot carry booking-only shape.
--
-- ADD COLUMN only against the one existing table: `keystone.custom_field` already carries RLS,
-- tenant policies and a TABLE-LEVEL app_rw grant (0079:88-110, confirmed below in the precondition
-- block), and a new column inherits that grant automatically. No re-grant, no re-policy, no new
-- `refuse_touch_reference_rows` trigger — CT-F52's full checklist is for NEW tables; this is columns
-- added to one that already exists.
--
-- Not touched: `keystone.custom_field_value`; `src/fields/*` — its one INSERT
-- (`src/fields/custom.mjs:50-54`) names its eight columns explicitly and does not touch any of the
-- four added here, so it is unaffected by this migration.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §a · PRECONDITIONS (§0.4 A shape, 0194:27-44)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0412: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;

  IF to_regclass('keystone.custom_field') IS NULL THEN
    RAISE EXCEPTION '0412: keystone.custom_field does not exist — 0079 must run first';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'custom_field'
       AND column_name IN ('required', 'show_if', 'applies_to_service_ids', 'feeds_reports')
  ) THEN
    RAISE EXCEPTION '0412: at least one of the columns this migration adds already exists on keystone.custom_field — check for a duplicate run';
  END IF;
END
$preconditions$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · keystone.custom_field — the four booking-option columns
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.custom_field
  ADD COLUMN required                boolean NOT NULL DEFAULT false,
  ADD COLUMN show_if                 jsonb   NULL,
  ADD COLUMN applies_to_service_ids  uuid[]  NULL,
  ADD COLUMN feeds_reports           boolean NOT NULL DEFAULT false;

ALTER TABLE keystone.custom_field
  ADD CONSTRAINT custom_field_booking_only_extras
    CHECK (record_type = 'engagement'
           OR (required = false AND show_if IS NULL
               AND applies_to_service_ids IS NULL AND feeds_reports = false));

COMMENT ON COLUMN keystone.custom_field.required IS
  '14.5 — booking-option only: an engagement field may require an answer at booking. Any other record_type must leave this false (custom_field_booking_only_extras).';
COMMENT ON COLUMN keystone.custom_field.show_if IS
  '14.5 — booking-option only: conditional display rule for the booking form. Any other record_type must leave this NULL (custom_field_booking_only_extras).';
COMMENT ON COLUMN keystone.custom_field.applies_to_service_ids IS
  '14.5 — booking-option only: the services this question is scoped to (NULL/empty = all). Any other record_type must leave this NULL (custom_field_booking_only_extras).';
COMMENT ON COLUMN keystone.custom_field.feeds_reports IS
  '14.5 — booking-option only: whether this question''s answers feed reporting. Any other record_type must leave this false (custom_field_booking_only_extras).';
COMMENT ON CONSTRAINT custom_field_booking_only_extras ON keystone.custom_field IS
  '14.5 — the four booking-option columns are for record_type = ''engagement'' only; every other record_type (person, account, network_party, document, invoice) must leave all four at their inert default.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §b · SHAPE CHECK (§0.4 A shape, 0194:209-242) — every column exists with the right type/
-- nullability/default, the named CHECK constraint exists, and app_rw's existing table-level grant
-- already covers the new columns (POSITIVE CONTROL alongside the negative existence checks).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $shape_check$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected.column_name, ', ')
    INTO v_missing
    FROM (VALUES ('required'), ('show_if'), ('applies_to_service_ids'), ('feeds_reports')) AS expected(column_name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'keystone' AND c.table_name = 'custom_field'
        AND c.column_name = expected.column_name
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0412: missing column(s) on keystone.custom_field after ALTER: %', v_missing;
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname = 'custom_field_booking_only_extras'
         AND conrelid = 'keystone.custom_field'::regclass) <> 1 THEN
    RAISE EXCEPTION '0412: custom_field_booking_only_extras was not created';
  END IF;

  -- Positive controls alongside the negatives: app_rw DOES hold these privileges on the new
  -- columns — the whole point of "a column inherits the table's existing grant".
  IF NOT has_table_privilege('app_rw', 'keystone.custom_field', 'SELECT') THEN
    RAISE EXCEPTION '0412: app_rw is missing SELECT on keystone.custom_field';
  END IF;
  IF NOT has_column_privilege('app_rw', 'keystone.custom_field', 'required', 'UPDATE') THEN
    RAISE EXCEPTION '0412: app_rw cannot UPDATE keystone.custom_field.required — the table-level grant did not extend to the new column';
  END IF;
  IF NOT has_column_privilege('app_rw', 'keystone.custom_field', 'show_if', 'SELECT') THEN
    RAISE EXCEPTION '0412: app_rw cannot SELECT keystone.custom_field.show_if — the table-level grant did not extend to the new column';
  END IF;

  RAISE NOTICE '0412: keystone.custom_field carries required/show_if/applies_to_service_ids/feeds_reports, custom_field_booking_only_extras exists, app_rw grants extend to the new columns.';
END
$shape_check$;

-- Written, not applied.
