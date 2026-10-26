-- 0403_app_user_calendar_preferences — Stage 13 task 13.46 · R-13.10 (per person, not per practice)
ALTER TABLE keystone.app_user
  ADD COLUMN calendar_week_starts text NOT NULL DEFAULT 'monday'
    CONSTRAINT app_user_calendar_week_starts_check CHECK (calendar_week_starts IN ('monday', 'sunday')),
  ADD COLUMN calendar_day_from_minute integer NOT NULL DEFAULT 420
    CONSTRAINT app_user_calendar_day_from_check CHECK (calendar_day_from_minute BETWEEN 0 AND 1440),
  ADD COLUMN calendar_day_to_minute integer NOT NULL DEFAULT 1200
    CONSTRAINT app_user_calendar_day_to_check CHECK (calendar_day_to_minute BETWEEN 0 AND 1440),
  ADD COLUMN calendar_slot_minutes integer NOT NULL DEFAULT 30
    CONSTRAINT app_user_calendar_slot_check CHECK (calendar_slot_minutes IN (15, 30, 60)),
  ADD COLUMN calendar_show_cancelled_days integer NOT NULL DEFAULT 7
    CONSTRAINT app_user_calendar_cancelled_check CHECK (calendar_show_cancelled_days IN (0, 7)),
  ADD COLUMN calendar_colour_by text NOT NULL DEFAULT 'service'
    CONSTRAINT app_user_calendar_colour_check CHECK (calendar_colour_by IN ('service', 'staff', 'state')),
  ADD CONSTRAINT app_user_calendar_day_window CHECK (calendar_day_to_minute > calendar_day_from_minute);
COMMENT ON COLUMN keystone.app_user.calendar_week_starts IS
  'Stage 13 / R-13.10. A DISPLAY preference, per person — the same category as sidebar_collapsed (0345) and density (0346), written through src/people/preferences.mjs, never an event. Defaults are the CalendarSettings frame''s own (Monday, 7:00am–8:00pm, 30 minutes, cancelled greyed for a week, colour by service).';
