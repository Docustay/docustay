-- 0218_feature_flag_seed.sql — Task 9.13. Seeds the eight per-service kill-switch rows into
-- keystone.feature_flag (0213). Insert-only; no RLS or grant change — 0213 already set those.
--
-- ★★★ THE EIGHT NAMES MATCH THE EIGHT PROVIDER MODULES, RE-MEASURED AFTER 9.6 (Task 9.13 field 6):
--   stripe_enabled          src/provisioning/steps/stripeCustomer.mjs, src/money/charge.mjs
--   resend_enabled          src/email/resend.mjs, src/provisioning/steps/resendDomain.mjs
--   s3_enabled               src/storage/s3.mjs
--   google_calendar_enabled  (kill switch seeded here; guarded at the calendar sync call sites —
--                             out of this task's eight-module list, which is provider TRANSPORT
--                             modules only. The flag row exists so a future guard has one to read.)
--   google_mail_enabled      src/email/senders.mjs (enumerateGoogleSendAs)
--   webhooks_enabled         src/webhooks/outbound.mjs
--   turnstile_enabled        (kill switch seeded here; Turnstile has no dedicated provider module
--                             in src/ today — same note as google_calendar_enabled above.)
--   n8n_send                 src/automations/n8n.mjs — ships OFF (Q9-6: no n8n instance exists)
--
-- ★ default_on = true for every service that is genuinely live today, so seeding this migration
--   does not silently turn anything off that already works. n8n_send is the one exception —
--   9.13 field 6 and 9.14's own "what done looks like" both require it to ship false.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
--
-- ★★ FIX [MEASURED 22 Sep 2026]: `keystone.feature_flag` (0213) is ENABLE+FORCE with exactly ONE
--    policy, `feature_flag_read` (SELECT only) — "the flag vocabulary must be migration-only" is
--    0213's own stated design, so there is deliberately no INSERT policy and no INSERT grant for
--    anyone, app_owner included (app_owner is NOBYPASSRLS). A bare INSERT here failed with "new row
--    violates row-level security policy for table feature_flag". 0182's identical-shape seed avoided
--    this by seeding BEFORE its table's FORCE was turned on; this migration runs AFTER 0213 already
--    forced it, so it uses the 0018 house pattern instead — suspend FORCE, seed, restore FORCE, and
--    assert it came back — the same bracket 0189/0194/0195/0196/0197 already use for exactly this
--    situation.
ALTER TABLE keystone.feature_flag NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.feature_flag (key, description, default_on) VALUES
  ('stripe_enabled',          'Stripe customer creation and charge-intent creation (src/provisioning/steps/stripeCustomer.mjs, src/money/charge.mjs). Off refuses every new Stripe call; nothing already charged is affected.', true),
  ('resend_enabled',          'Outgoing email through Resend, including sending-domain registration (src/email/resend.mjs, src/provisioning/steps/resendDomain.mjs). Off refuses every new send attempt with a readable reason.', true),
  ('s3_enabled',              'Object storage reads and writes (src/storage/s3.mjs: put/get/head/delete). Off refuses every new storage call for the affected practice.', true),
  ('google_calendar_enabled', 'Google Calendar sync for a practice''s connected calendars. Off stops new sync attempts; existing bookings are unaffected.', true),
  ('google_mail_enabled',     'Google-authenticated mail sending, including Gmail Send-As enumeration (src/email/senders.mjs). Off refuses new attempts.', true),
  ('webhooks_enabled',        'Outbound webhook delivery to a practice''s own configured endpoints (src/webhooks/outbound.mjs). Off refuses new deliveries with a readable reason; nothing already delivered is affected.', true),
  ('turnstile_enabled',       'Cloudflare Turnstile verification on public forms. Off refuses new verification attempts for the affected practice.', true),
  ('n8n_send',                'Outbox delivery of events to n8n (src/automations/n8n.mjs, the outbox n8n sink). Ships OFF — Q9-6: no n8n instance exists yet.', false)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.feature_flag FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    "the flag vocabulary must be migration-only" and every later migration/gate would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0218: FORCE ROW LEVEL SECURITY was not restored on keystone.feature_flag';
  END IF;
END $$;
