-- 0559_lead_best_time_days
--
-- Lead-form rebuild (the maintainer's ruling, 2 Oct 2026) — "remove the specific-date chips and the half-hour
-- time picker... replace 'Best time to call' with: days (Weekdays / Weekends / Any day) and time of
-- day (Morning / Afternoon / Evening)." Nothing here depends on today's date or a timezone, unlike
-- 0540's lead_best_time_date (a specific calendar date) — that column and 0549's lead_best_time_time
-- (the half-hour slot) are TOLERATED for history (old leads keep their old values, never rewritten)
-- but the new site no longer sends either. lead_best_time_window (0540) is REUSED as-is for "time of
-- day" — it already stores exactly morning/afternoon/evening with the same meaning.
--
-- One new column, additive, nullable, no existing row affected.

ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_best_time_days text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_user_lead_best_time_days_check'
  ) THEN
    ALTER TABLE keystone.app_user
      ADD CONSTRAINT app_user_lead_best_time_days_check
      CHECK (lead_best_time_days IS NULL OR lead_best_time_days IN ('weekdays', 'weekends', 'any'));
  END IF;
END $$;

COMMENT ON COLUMN keystone.app_user.lead_best_time_days IS
  '0559: weekdays|weekends|any — the day-type preference from the rebuilt lead form. NULL means no preference was given. Replaces lead_best_time_date (0540) for new submissions; that column is kept, untouched, for leads captured before this change.';

DO $self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='keystone' AND table_name='app_user' AND column_name='lead_best_time_days') THEN
    RAISE EXCEPTION '0559: keystone.app_user.lead_best_time_days was not created';
  END IF;
  RAISE NOTICE '0559: app_user.lead_best_time_days created';
END
$self_check$;
