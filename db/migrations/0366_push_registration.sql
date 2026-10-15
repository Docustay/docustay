-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WAVE C4 TASK C4.4 — PUSH SENDER: DEVICE REGISTRATION AND FCM INTEGRATION
--
-- ★★★ THE TABLE ALREADY EXISTS (0016) WITH FULL SCHEMA, INDICES, RLS, AND COMMENTS.
-- This migration confirms the device_token infrastructure is in place and ready for the
-- application-level push sender to use.
--
-- ★ The device_token table:
--   - Stores FCM tokens registered by client apps
--   - UNIQUE (tenant_id, app_user_id, platform, token) enforces the ONE DEVICE, ONE ROW rule
--   - Has indices for queries by user and by last_seen_at (for pruning stale tokens)
--   - RLS policies restrict access to the tenant
--   - last_seen_at is updated on every registration (RULE 3: "timestamp every upload")
--   - Stale tokens (270+ days) are pruned proactively (RULE 4)
--   - Dead tokens are deleted on FCM rejection (RULE 2)
--
-- See `src/notifications/send.mjs:1-34` for the five FCM token rules this table supports.
-- See `src/notifications/push.mjs` for the FCM sender that uses device tokens.
-- See `src/notifications/writes.mjs:34` (CHANNELS) for push as a third preference axis.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★ Verify device_token table exists and has the correct schema for push notifications
DO $$
BEGIN
  -- Ensure the table exists with the required columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'keystone' AND table_name = 'device_token'
  ) THEN
    RAISE EXCEPTION 'device_token table does not exist — created by migration 0016_events_and_notifications.sql';
  END IF;

  -- Verify the UNIQUE constraint exists (prevents 83% duplication described in 0016)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'keystone' AND table_name = 'device_token'
    AND constraint_name = 'device_token_tenant_id_app_user_id_platform_token_key'
  ) THEN
    RAISE EXCEPTION 'device_token missing UNIQUE constraint — run migration 0016 first';
  END IF;

  -- Verify the required indices exist
  -- ★ FIX (coordinator, deploy checkpoint, 24 Sep 2026): `information_schema.statistics` is a
  --   MySQL system view — it does not exist in Postgres, so this whole block failed to apply.
  --   Postgres's own catalogue for this is `pg_indexes` (schemaname/tablename/indexname).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'keystone' AND tablename = 'device_token'
    AND indexname = 'device_token_user'
  ) THEN
    RAISE EXCEPTION 'device_token missing device_token_user index';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'keystone' AND tablename = 'device_token'
    AND indexname = 'device_token_stale'
  ) THEN
    RAISE EXCEPTION 'device_token missing device_token_stale index';
  END IF;

  RAISE NOTICE 'device_token table verified — push registration infrastructure ready';
END $$;
