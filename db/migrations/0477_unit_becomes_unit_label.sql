-- 0477 — SERVICE.UNIT BECOMES SERVICE.UNIT_LABEL (Stage 20 Task 20.5)
--
-- ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES. Migration 0409 added
--     `service.unit` to name the unit of service (e.g., "session", "hour"). That name travels to
--     Stripe in the price's `unit_label` field (the label shown on invoices). Task 20.5 syncs
--     modifiers as separate Price rows and sends unit_label in the Price params. This migration
--     renames the column to match Stripe's own terminology and improve clarity.
--
-- DATA: `keystone.service` rows exist only for Ty's build tenants (Mainstay is not live); the
-- column's values are present in every row (all services have a unit). No UPDATE needed.

ALTER TABLE keystone.service NO FORCE ROW LEVEL SECURITY;

-- ★★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production): there is no
--    `service.unit` column to rename — 0409 added `unit_id`, a FK to `keystone.unit` (key, name,
--    plural), not a text column. The fact Stripe wants (the invoice's unit label) is that unit's
--    NAME. So `unit_label` is ADDED and backfilled from the linked unit; `src/money/catalogue.mjs`
--    reads it as before. `unit_id` stays the source of truth for which unit a service uses.
ALTER TABLE keystone.service ADD COLUMN unit_label text NULL
  CHECK (unit_label IS NULL OR btrim(unit_label) <> '');
UPDATE keystone.service s SET unit_label = u.name
  FROM keystone.unit u
 WHERE u.tenant_id = s.tenant_id AND u.id = s.unit_id;

-- ── Self-check, run while NO FORCE is still in effect (the migration role owns the table, so the
--    probe reaches any constraint instead of being stopped by a forced RLS policy first). ──────
DO $check$
DECLARE
  n_old integer;
  n_new integer;
BEGIN
  SELECT count(*) INTO n_old
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'service' AND column_name = 'unit';
  SELECT count(*) INTO n_new
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'service' AND column_name = 'unit_label';

  IF n_old <> 0 THEN
    RAISE EXCEPTION '0477 self-check: old column "unit" still exists (expected 0, found %)' , n_old;
  END IF;

  IF n_new <> 1 THEN
    RAISE EXCEPTION '0477 self-check: new column "unit_label" missing or duplicated (expected 1, found %)', n_new;
  END IF;
END
$check$;

ALTER TABLE keystone.service FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTERs — the 0334 discipline outlives this migration. ──────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'service';
  IF NOT forced THEN
    RAISE EXCEPTION '0477 self-check: RLS is no longer FORCED on service';
  END IF;
END
$rls$;
