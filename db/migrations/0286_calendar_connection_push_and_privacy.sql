-- 0286_calendar_connection_push_and_privacy
-- Spec 03a (calendar and sync) task 3a.1 · §3 — WHICH CALENDAR NEW SESSIONS ARE PUSHED TO, and the
-- event-title privacy mode (§1.2's privacy reasoning; default is the NARROWER option).
--
-- ★ `push_calendar_id IS NULL` means "the account's own primary calendar" — no separate boolean is
--   needed, the NULL itself carries the meaning.
-- ★★ `event_title_mode` defaults to `'session_only'` — the outside calendar event's title never
--    names a client unless the coach opts in to `'client_first_name'` (§1.2).
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.

ALTER TABLE keystone.calendar_connection
  ADD COLUMN push_calendar_id text,   -- NULL = the account's primary calendar
  ADD COLUMN event_title_mode text NOT NULL DEFAULT 'session_only'
    CHECK (event_title_mode IN ('session_only','client_first_name'));

COMMENT ON COLUMN keystone.calendar_connection.push_calendar_id IS
  'Spec 03a §3, task 3a.1. Which of the connected account''s calendars a confirmed session is '
  'pushed to. NULL = the account''s own primary calendar.';

COMMENT ON COLUMN keystone.calendar_connection.event_title_mode IS
  'Spec 03a §1.2/§3, task 3a.1. Default ''session_only'' is the NARROWER, privacy-preserving option '
  '— the pushed event''s title never names a client unless the coach opts into '
  '''client_first_name''.';
