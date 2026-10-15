-- 0143_a_webhook_is_retried_then_given_up_once
-- Stage 3 Task 7 — spec 02 §2 rules 6 and 8, §3 (webhooks row), §12 duplicate delivery; spec 07 §3;
-- Task 5 review F1.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ BEFORE: `webhook_delivery.next_retry_at` (0047) was never read or written — a failed POST was retried
--     ZERO times. src/webhooks/outbound.mjs now writes it on 07's schedule and the per-practice
--     `retry_webhooks` sweep reads it. This migration adds what that needs and nothing more:
--
--   · `dead_at` — set on the LAST attempt row when the sixth attempt fails: that (event, endpoint) will
--     never be tried again. A column, not a new `status` value, so the attempt's own outcome
--     (`failed` vs `timed_out`) is kept — a human deciding whether to re-send needs those apart (0047).
--   · `gave_up_reported_at` / `gave_up_report_attempts` — the job.gave_up platform event is written
--     after the attempt commits, on the worker's own connection (the writer is app_worker-only, 0138);
--     these record that it was, and bound a writer that keeps failing — the same shape as
--     event_delivery (0139/0142).
--   · SHAPE CHECKS: only a failed/timed-out attempt may carry a retry time or be dead, and a dead row has
--     no retry time. A `delivered` row with a next_retry_at is the state in which a receiver is POSTed a
--     second time, so it is made unrepresentable.
--   · `closed_reason` (fix round 1, review T7-R2) — a due retry whose endpoint was DISABLED, or which no
--     longer subscribes to the event's topic, is closed with a reason instead of being filtered out of the
--     sweep forever. It is NOT `dead`: dead means "every attempt failed" and is reported as job.gave_up; a
--     disable or an unsubscribe is a person's decision, not a failure, so it is visible on the row and
--     reported nowhere. A PAUSED endpoint's retry stays due (spec 02: pausing never loses an event).
--   · ONE DEAD ROW PER (endpoint, event), enforced by a partial unique index.
--   · AN INDEX for dead rows not yet reported. Due retries use 0047's `webhook_delivery_retry_idx`
--     ((tenant_id, next_retry_at) WHERE status IN ('failed','timed_out')) — the sweep's query carries
--     that status predicate. Fix round 1 (T7-R4) removed a second, duplicate index from this file.
--
-- ★ Existing rows: next_retry_at has never been written (MEASURED, recon §5), so every existing row
--   already satisfies the new checks; the checks are added VALID and the DO block asserts it.
-- ★ Runs as app_owner (db/migrate.mjs), which owns the table. No SET ROLE, no RESET ROLE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.webhook_delivery
  ADD COLUMN IF NOT EXISTS dead_at timestamptz,
  ADD COLUMN IF NOT EXISTS gave_up_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS gave_up_report_attempts integer NOT NULL DEFAULT 0
    CHECK (gave_up_report_attempts >= 0),
  ADD COLUMN IF NOT EXISTS closed_reason text
    CONSTRAINT webhook_delivery_closed_reason_check CHECK (closed_reason IN ('endpoint_disabled','unsubscribed'));

ALTER TABLE keystone.webhook_delivery
  ADD CONSTRAINT webhook_delivery_retry_shape CHECK (
    (next_retry_at IS NULL OR status IN ('failed','timed_out')) AND
    (dead_at IS NULL OR (status IN ('failed','timed_out') AND next_retry_at IS NULL)) AND
    (gave_up_reported_at IS NULL OR dead_at IS NOT NULL) AND
    (closed_reason IS NULL OR (status IN ('failed','timed_out') AND next_retry_at IS NULL AND dead_at IS NULL))
  );

CREATE UNIQUE INDEX IF NOT EXISTS webhook_delivery_dead_once
  ON keystone.webhook_delivery (tenant_id, endpoint_id, event_id) WHERE dead_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS webhook_delivery_gave_up_owed_idx
  ON keystone.webhook_delivery (tenant_id, dead_at)
  WHERE dead_at IS NOT NULL AND gave_up_reported_at IS NULL;

COMMENT ON COLUMN keystone.webhook_delivery.next_retry_at IS
  'Stage 3 T7. When this failed/timed-out attempt is due to be retried (07: 1 min, 5 min, 30 min, 2 h, 12 h after '
  'attempts 1-5). Cleared when the next attempt is inserted, so only the latest attempt of an (event, endpoint) '
  'ever carries one. Read by the retry_webhooks sweep.';
COMMENT ON COLUMN keystone.webhook_delivery.dead_at IS
  'Stage 3 T7. Set on the sixth failed attempt: this (event, endpoint) is given up and never retried. A job.gave_up '
  'platform event is written for it (gave_up_reported_at).';
COMMENT ON COLUMN keystone.webhook_delivery.closed_reason IS
  'Stage 3 T7 fix 1. Set (with next_retry_at cleared) on a pending retry whose endpoint was disabled or no longer '
  'subscribes to the topic. Not dead, never reported as job.gave_up: a deliberate decision is not a failure.';
COMMENT ON COLUMN keystone.webhook_delivery.gave_up_report_attempts IS
  'Stage 3 T7. Failed attempts to write this dead row''s job.gave_up platform event; the worker stops at its bound.';

DO $check$
DECLARE
  n integer;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0143 is running as %, expected app_owner — never RESET ROLE', current_user;
  END IF;
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname = 'webhook_delivery_retry_shape' AND conrelid = 'keystone.webhook_delivery'::regclass AND convalidated;
  IF n <> 1 THEN
    RAISE EXCEPTION '0143: webhook_delivery_retry_shape is missing or not validated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'webhook_delivery' AND relforcerowsecurity
                   AND relnamespace = 'keystone'::regnamespace) THEN
    RAISE EXCEPTION '0143: webhook_delivery is no longer FORCE ROW LEVEL SECURITY';
  END IF;
END
$check$;
