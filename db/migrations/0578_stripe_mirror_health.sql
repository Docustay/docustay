-- 0578_stripe_mirror_health
--
-- specs/STRIPE-MIRROR.md §4 stage (f) — the ONE row the Stripe mirror's own health lives in, read
-- by `src/health/watch.mjs`'s `stripe_webhooks` check (which until now was a hard-coded
-- "unknown — not connected yet — Stage 9" placeholder, so nothing ever alarmed on a broken Stripe
-- webhook — the 28 Sep → 2 Oct outage went unnoticed for four days for exactly that reason).
-- Written by the webhook route (every verified event) and by the nightly reconciliation
-- (`src/money/mirrorReconcile.mjs`). No tenant data: counts, timestamps and Stripe event ids only.
CREATE TABLE IF NOT EXISTS keystone_meta.stripe_mirror_health (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_webhook_at          timestamptz,
  webhook_failures_since   integer NOT NULL DEFAULT 0,   -- mirror update threw since the last clean reconcile
  last_reconcile_at        timestamptz,
  last_reconcile_ok        boolean,
  drift_count              integer NOT NULL DEFAULT 0,   -- rows the reconcile had to CHANGE (a webhook was missed)
  failed_deliveries        integer NOT NULL DEFAULT 0,   -- Stripe events with a failed delivery in the last 24h
  last_error               text,
  last_report              jsonb,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO keystone_meta.stripe_mirror_health (id) VALUES (true) ON CONFLICT DO NOTHING;
GRANT SELECT, INSERT, UPDATE ON keystone_meta.stripe_mirror_health TO app_rw;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON keystone_meta.stripe_mirror_health TO app_worker';
  END IF;
END $g$;

DO $check$ BEGIN
  IF (SELECT count(*) FROM keystone_meta.stripe_mirror_health) <> 1 THEN
    RAISE EXCEPTION '0578 self-check: stripe_mirror_health must hold exactly one row';
  END IF;
END $check$;
