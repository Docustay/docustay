-- 0288_calendar_event_map_review_state
-- Spec 03a (calendar and sync) task 3a.1 · §3 — THE REMOTE-CHANGE REVIEW FLAG (`CalendarFlag`) and
-- the idempotent-push marker, so a retried push job (§7) does not re-issue an identical
-- create/update/delete against the provider on every retry attempt.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.

ALTER TABLE keystone.calendar_event_map
  ADD COLUMN last_pushed_state       text,   -- e.g. 'confirmed:2026-10-01T14:00Z' — what we last told the provider
  ADD COLUMN remote_change_pending   boolean NOT NULL DEFAULT false,
  ADD COLUMN remote_change_detail    jsonb;  -- {proposed_starts_at, proposed_ends_at}, nothing else — no title

COMMENT ON COLUMN keystone.calendar_event_map.last_pushed_state IS
  'Spec 03a §3, task 3a.1. What Workbench last told the provider about this event (e.g. '
  '''confirmed:2026-10-01T14:00Z''), so a retried push job can tell "already sent" from "needs '
  'sending" and never re-issues an identical create/update/delete on retry.';

COMMENT ON COLUMN keystone.calendar_event_map.remote_change_pending IS
  'Spec 03a §3/§5, task 3a.1. Set true when the pull sweep (§7) detects an etag change on this '
  'mapped event and the paired booking is still open — surfaces on the CalendarFlag banner.';

COMMENT ON COLUMN keystone.calendar_event_map.remote_change_detail IS
  'Spec 03a §3, task 3a.1. {proposed_starts_at, proposed_ends_at} ONLY — never a title, never any '
  'other field the outside provider sent.';
