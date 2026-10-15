-- 0580 · ROUTE PLATFORM'S RESEND WEBHOOK TO ITS PRACTICE (2 Oct 2026, found while retiring the legacy
-- Firebase functions).
--
-- the platform's own Resend webhook (731e5ea4-…, created 2 Oct 2026 16:01 UTC) has been delivered 20+ events and
-- EVERY ONE was refused 401 "no tenant mapped for resend:example.com": the signature verified, but
-- keystone_auth.webhook_source — the table that says which practice owns a sending domain — has no rows at all
-- (MEASURED against production). The inbound route resolves a Resend event's tenant from the `from` domain
-- (src/routes/webhooks.mjs), so without this row no delivery/bounce/complaint event reached the platform and the
-- legacy Firebase `resendWebhook` function was the only thing recording them.
--
-- ★ Nothing in the application ever wrote this row (the stripe account has ensure_stripe_account_source; the
--   Resend domain had no equivalent) — a guard whose condition nothing supplied. The one verified sending
--   domain on the Resend account is example.com, Docustay's. Idempotent; a no-op where Docustay is absent.
DO $src$
DECLARE
  v_tenant uuid := keystone.resolve_tenant_by_slug('foundry');
BEGIN
  IF v_tenant IS NULL THEN
    RAISE NOTICE '0580: no tenant with slug foundry — nothing to map';
    RETURN;
  END IF;
  SET LOCAL ROLE auth_owner;
  INSERT INTO keystone_auth.webhook_source (tenant_id, provider, external_id)
  SELECT v_tenant, 'resend', 'example.com'
   WHERE NOT EXISTS (SELECT 1 FROM keystone_auth.webhook_source
                      WHERE provider = 'resend' AND external_id = 'example.com' AND retired_at IS NULL);
  SET LOCAL ROLE app_owner;
END
$src$;
