-- FOUND 6 Oct 2026 (production): "Stripe webhooks: nightly reconciliation last ran 57 h ago". The reconcile DID run every night (job_run ok, stripe.* refreshed 6 Oct 10:00), but the verdict row
-- could not be written: since the Stripe login split (db/migrate.mjs#splitStripeSyncLogin) the sync engine's own login `app_stripe_sync` writes keystone_meta.stripe_mirror_health through
-- sync.postgresClient (src/money/stripeMirror.mjs#recordMirrorHealth) and holds NO privilege on it (has_table_privilege = false, measured). recordMirrorHealth swallows the error ("continuing"),
-- so the health row stayed at 4 Oct 10:00 and the watcher called a healthy reconciliation stale. The webhook route's own health write failed the same way.
-- Additive and idempotent; skipped where the login does not exist (a fresh self-hosted install without the split).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_stripe_sync') THEN
    GRANT USAGE ON SCHEMA keystone_meta TO app_stripe_sync;
    GRANT SELECT, UPDATE ON keystone_meta.stripe_mirror_health TO app_stripe_sync;
  END IF;
END $$;
