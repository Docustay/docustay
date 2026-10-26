-- 0483 — USAGE METERS ARE STRIPE'S (Task 20.13 — Stripe Billing Meters).
--
-- ★★★ THE LOCAL TABLES PERSIST DURING METER CUTOVER. Reporting to Stripe Billing Meters begins
--     (fire-and-forget via `src/billing/meters.mjs`); local counters remain the recovery source.
--     Retirement of the local metering subsystem (when Stripe meter events become the source of
--     truth) is a later stage after cutover proof.
--
-- ★ SCHEMA: add `meter_reported_at` to track when each event was successfully reported to Stripe
--   (nullable — a null value means not yet reported or reporting was never attempted). This is
--   metadata only; the local ledger row is written regardless of meter success (fire-and-forget).
--
-- ★ WRITER: `src/billing/meters.mjs` (`reportUsage`), fire-and-forget call from `recordUsage`.
--   READERS: usage screens and reports (basis flag indicates if reading from 'meter' or 'local').

ALTER TABLE keystone.mainstay_usage_event NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.mainstay_usage_event
  ADD COLUMN meter_reported_at timestamptz NULL;

-- ── Self-check, run while NO FORCE is still in effect (the migration role owns the table, so the
--    probe reaches the new column instead of being stopped by a forced RLS policy first). ─────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'mainstay_usage_event'
     AND column_name = 'meter_reported_at';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0483 self-check: expected meter_reported_at column, found %', n_cols;
  END IF;

  -- ★ Positive control: a meter_reported_at value must be a valid timestamp.
  BEGIN
    INSERT INTO keystone.mainstay_usage_event
      (tenant_id, metric, units, provider, meter_reported_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'ai_draft', 1, 'internal',
       '2026-09-25T00:00:00Z');
    RAISE EXCEPTION '0483 self-check: a row was inserted despite non-existent tenant FK';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;      -- the tenant FK refused it: correct
  END;
END
$check$;

ALTER TABLE keystone.mainstay_usage_event FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTER — the 0458 discipline outlives this migration. ──────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'mainstay_usage_event';
  IF NOT forced THEN
    RAISE EXCEPTION '0483 self-check: RLS is no longer FORCED on mainstay_usage_event';
  END IF;
END
$rls$;

COMMENT ON COLUMN keystone.mainstay_usage_event.meter_reported_at IS
  'Task 20.13: timestamp when this event was successfully reported to Stripe Billing Meters '
  '(nullable — metadata only; the local ledger row is written regardless of meter success).';
