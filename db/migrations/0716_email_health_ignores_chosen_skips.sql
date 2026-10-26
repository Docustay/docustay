-- 0716 · Run 8 J5 (R8-53) — THE EMAIL HEALTH CHECK COUNTED A PERSON'S OWN "DON'T EMAIL ME ABOUT THIS" AS A FAILED EMAIL.
-- MEASURED on a self-hosted install with email working: watch_system raised "Email: 2 of 3 email(s) failed or were skipped in the last 15 minutes (67%)"
-- while every email that was meant to go had gone (notification_delivery: the two `skipped` rows were "Sam opened …" notices, skipped because the
-- owner's notice settings have "opened" off — src/notifications/send.mjs:139-145 records that choice as `skipped` with NO error and NO provider).
-- The same rows exist on every deployment where anyone has turned a notice off, so the 5% threshold was crossed by people's settings, not by email.
-- A skip that means "this email could not go" always carries its reason (no provider key, a sample subject, the daily limit — src/email/send.mjs).
-- The rule now: an email row counts when something was meant to be sent; a skip with no reason is a choice and is not an email at all.
-- Replaces the function body only (same signature, same owner, so its grants stand); nothing else changes.

SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone_meta.email_health()
RETURNS TABLE (recent_total int, recent_bad int, day_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    count(*) FILTER (WHERE completed_at >= now() - interval '15 minutes')::int,
    count(*) FILTER (WHERE completed_at >= now() - interval '15 minutes'
                       AND status IN ('failed', 'skipped'))::int,
    count(*) FILTER (WHERE completed_at >= now() - interval '24 hours')::int
  FROM keystone.notification_delivery
  WHERE channel = 'email' AND completed_at IS NOT NULL
    AND NOT (status = 'skipped' AND error IS NULL)   -- the recipient's own notice settings said not to send it
$$;

COMMENT ON FUNCTION keystone_meta.email_health() IS
  'Stage 4 Task 11 / 07 §5, Run 8 0716 — cross-tenant email delivery counts for the 15-minute error-rate window and the 24-hour "any sends at all" window, leaving out the emails a person chose not to get (skipped with no error). Aggregates only — no notification id, no recipient, no tenant_id.';

SET LOCAL ROLE app_owner;
