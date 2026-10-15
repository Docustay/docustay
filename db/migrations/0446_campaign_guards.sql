-- 0446_campaign_guards — Stage 16 task 16.5
--
-- Adds the columns the campaign editor draws (leave_out_segment, never_more_than window, send_at)
-- and a new 'scheduled' campaign state. Campaign already has FORCED RLS; no RLS changes needed.
--
-- NEW COLUMNS:
--   leave_out_segment_id — optional reference to a segment; must differ from segment_id if set
--   never_more_than_days — window constraint on send frequency; defaults to 90, ranges 0–365
--   scheduled_for — timestamp when a scheduled campaign should send
--
-- UPDATED CONSTRAINT:
--   campaign_state_check — now admits 'scheduled' state in addition to draft|sending|sent|failed
--   campaign_scheduled_shape — ensures 'scheduled' state has a non-null scheduled_for timestamp
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
ALTER TABLE keystone.campaign
  ADD COLUMN leave_out_segment_id uuid REFERENCES keystone.segment(id) ON DELETE SET NULL,
  ADD COLUMN never_more_than_days integer NOT NULL DEFAULT 90 CHECK (never_more_than_days BETWEEN 0 AND 365),
  ADD COLUMN scheduled_for timestamptz,
  ADD CONSTRAINT campaign_leave_out_differs CHECK (leave_out_segment_id IS NULL OR leave_out_segment_id <> segment_id);

ALTER TABLE keystone.campaign DROP CONSTRAINT campaign_state_check;

ALTER TABLE keystone.campaign ADD CONSTRAINT campaign_state_check
  CHECK (state IN ('draft','scheduled','sending','sent','failed'));

ALTER TABLE keystone.campaign ADD CONSTRAINT campaign_scheduled_shape
  CHECK (state <> 'scheduled' OR scheduled_for IS NOT NULL);
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)