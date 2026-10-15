-- 0353_task_manual_write_path
-- Manual task creation and snoozing support.
--
-- ★★ MANUAL TASKS ALLOWED BUT NOT THE POINT. ADD3-1 explicitly allows manual tasks
--    (created by a person, not an event chain), so we add created_by_app_user_id to track
--    who created them. ★ NULL means system-created or event-created; a user id means a person
--    made it. Event-created tasks (created_by_event_id IS NOT NULL) stay unique per (subject,
--    topic) to prevent chain retry duplicates. Manual tasks have no such constraint.
--
-- ★ SNOOZED_UNTIL allows a person to hide a task until a future date, without closing it.
--   Unlike closed_at, it is purely temporal and does not affect task status queries (except
--   screens that filter on snoozed_until to show only "active now" tasks).

-- ─────────────────────────────────────────────────────────────────────────────
-- Add two nullable columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.task
  ADD COLUMN created_by_app_user_id uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  ADD COLUMN snoozed_until timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- Index relaxation: task_open_key applies only to event-created tasks
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ THE UNIQUE CONSTRAINT MUST NOT APPLY TO MANUAL TASKS. The partial unique index
--     task_open_key prevented duplicates on retried chain events (and still does). But a
--     person manually creating tasks should be able to create as many as they want with the
--     same (subject, topic). Loosen the index to apply only when created_by_event_id IS NOT NULL.

DROP INDEX keystone.task_open_key;

CREATE UNIQUE INDEX task_open_key ON keystone.task (tenant_id, subject_type, subject_id, topic)
  WHERE closed_at IS NULL AND created_by_event_id IS NOT NULL;
