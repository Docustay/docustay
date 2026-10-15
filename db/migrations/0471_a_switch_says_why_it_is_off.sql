-- 0471_a_switch_says_why_it_is_off.sql — Stage 18 task 18.17
-- Feature switches: availability, labels, counts (server + 0471)
--
-- Each switch now carries its plain name, what it does, and an availability
-- (available · trying it out · blocked · being built) with the honest reason.
-- The list shows how many practices have it and since when; blocked/being-built
-- switches cannot be turned on.
--
-- ★★★ Feature flag table now has `label`, `availability`, and `availability_reason`
--     columns. Migration adds them with defaults; existing keys get labels via UPDATE;
--     `client_app_native` and `tap_to_pay` are inserted as `being_built`.

ALTER TABLE keystone.feature_flag
  ADD COLUMN label text NULL CHECK (label IS NULL OR btrim(label) <> ''),
  ADD COLUMN availability text NOT NULL DEFAULT 'available'
    CHECK (availability IN ('available','trial','blocked','being_built')),
  ADD COLUMN availability_reason text NULL,
  ADD CONSTRAINT feature_flag_blocked_says_why CHECK (availability <> 'blocked' OR availability_reason IS NOT NULL);

-- ★ REHEARSAL FIX (25 Sep 2026): feature_flag is FORCE RLS with no platform write policy — the
--   INSERT failed outright and every UPDATE below would have matched ZERO rows silently. 0433's
--   idiom: lift FORCE for the DML, restore it, and prove both the restore and the writes.
ALTER TABLE keystone.feature_flag NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.feature_flag (key, description, default_on, label, availability, availability_reason) VALUES
  ('client_app_native', 'Native, on both stores', false, 'The client app', 'being_built', 'Being built'),
  ('tap_to_pay', 'In-person payments on a phone', false, 'Tap to Pay', 'being_built', 'It only works in the Workbench app, and the app is being built')
ON CONFLICT (key) DO NOTHING;

UPDATE keystone.feature_flag SET label = 'Payments' WHERE key = 'stripe_enabled';
UPDATE keystone.feature_flag SET label = 'Email sending' WHERE key = 'resend_enabled';
UPDATE keystone.feature_flag SET label = 'Webhooks' WHERE key = 'webhooks_enabled';
UPDATE keystone.feature_flag SET label = 'Public booking page' WHERE key = 'public_booking_enabled';
UPDATE keystone.feature_flag SET label = 'Google Calendar' WHERE key = 'google_calendar_enabled';
UPDATE keystone.feature_flag SET label = 'Outlook Calendar' WHERE key = 'outlook_calendar_enabled';
UPDATE keystone.feature_flag SET label = 'Gmail sending' WHERE key = 'google_mail_enabled';
UPDATE keystone.feature_flag SET label = 'File storage' WHERE key = 's3_enabled';
UPDATE keystone.feature_flag SET label = 'Bot protection on public forms' WHERE key = 'turnstile_enabled';
UPDATE keystone.feature_flag SET label = 'Automations sending' WHERE key = 'n8n_send';

ALTER TABLE keystone.feature_flag FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean; n int;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT forced THEN RAISE EXCEPTION '0471: FORCE ROW LEVEL SECURITY was not restored on keystone.feature_flag'; END IF;
  SELECT count(*) INTO n FROM keystone.feature_flag WHERE key IN ('client_app_native','tap_to_pay');
  IF n <> 2 THEN RAISE EXCEPTION '0471: expected both new flag rows, found %', n; END IF;
  -- Every flag that exists must carry the label this file gave it (a key that does not exist here
  -- is not an error — the UPDATE names keys some databases never seeded).
  SELECT count(*) INTO n FROM keystone.feature_flag
   WHERE key IN ('stripe_enabled','resend_enabled','webhooks_enabled','public_booking_enabled',
                 'google_calendar_enabled','outlook_calendar_enabled','google_mail_enabled',
                 's3_enabled','turnstile_enabled','n8n_send') AND label IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '0471: % existing flag(s) left without the label this migration sets', n; END IF;
END $$;
