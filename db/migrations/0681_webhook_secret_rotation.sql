-- 0681 · Webhook secret rotation (Final Push FP-F5, 7 Oct 2026). Additive. While `previous_secret_expires_at` is in the future, deliveries are signed with BOTH the new and the previous secret,
-- so a receiver can switch to the new secret without a gap. After the window the previous secret is ignored (and cleared the next time the endpoint is rotated).
ALTER TABLE keystone.webhook_endpoint
  ADD COLUMN IF NOT EXISTS previous_secret_envelope   jsonb       NULL,
  ADD COLUMN IF NOT EXISTS previous_secret_expires_at timestamptz NULL;
