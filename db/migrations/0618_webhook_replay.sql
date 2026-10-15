-- 0618 — WEBHOOK REPLAY (QUEUE §25.5). A person clicks "Replay" on a delivery: that creates a NEW delivery row (a new attempt) that records which delivery it replays and who asked.
-- ★ The platform's guard "never a second POST for a delivered (event, endpoint)" stays for every AUTOMATIC path (first send, retries, the sweep). Only an explicit replay may bypass it, and a replay never schedules a retry and never marks the pair dead.
-- Additive: two nullable columns on an existing table. Row-level security and grants are unchanged.
ALTER TABLE keystone.webhook_delivery
  ADD COLUMN replay_of  uuid REFERENCES keystone.webhook_delivery(id) ON DELETE SET NULL,
  ADD COLUMN replayed_by uuid;
ALTER TABLE keystone.webhook_delivery
  ADD CONSTRAINT webhook_delivery_replay_shape CHECK (replayed_by IS NULL OR replay_of IS NOT NULL);
CREATE INDEX webhook_delivery_replays ON keystone.webhook_delivery (tenant_id, replay_of) WHERE replay_of IS NOT NULL;
COMMENT ON COLUMN keystone.webhook_delivery.replay_of IS 'The delivery this attempt replays (an explicit, person-clicked re-send). NULL for every automatic attempt.';
COMMENT ON COLUMN keystone.webhook_delivery.replayed_by IS 'The staff member who clicked Replay. Set only with replay_of.';
