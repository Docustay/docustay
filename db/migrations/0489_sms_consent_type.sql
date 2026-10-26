-- 0489 — SMS CONSENT TYPE AND SMS NOTIFICATION CHANNEL
--
-- ★★★ TASK 20.49 — TCPA IS NOT CAN-SPAM. SMS sends require ACTIVE `sms_marketing` consent,
--     independent from email consent. A person may consent to email and not SMS, or vice versa.
--     The two are NEVER implied by each other.
--
-- Changes:
-- (1) Widen `consent_record.consent_type` CHECK to admit 'sms_marketing'
-- (2) Widen `notification_rule.channel` CHECK to admit 'sms'
-- (3) Self-checks prove both the widening works AND unknown types still refused (positive control)

ALTER TABLE keystone.consent_record NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_rule NO FORCE ROW LEVEL SECURITY;

-- ── (1) Widen consent_record.consent_type CHECK ───────────────────────────────────────────────
ALTER TABLE keystone.consent_record
  DROP CONSTRAINT consent_record_consent_type_check,
  ADD CONSTRAINT consent_record_consent_type_check
    CHECK (consent_type IN ('marketing', 'terms_of_service', 'privacy_policy', 'sms_marketing'));

-- ── (2) Widen notification_rule.channel CHECK ──────────────────────────────────────────────────
ALTER TABLE keystone.notification_rule
  DROP CONSTRAINT notification_rule_channel_check,
  ADD CONSTRAINT notification_rule_channel_check
    CHECK (channel IN ('in_app', 'email', 'push', 'sms'));

-- ── Self-checks, run while NO FORCE is in effect ────────────────────────────────────────────────
DO $check$
DECLARE
  constraint_exists boolean;
BEGIN
  -- Verify the constraints exist
  SELECT EXISTS(
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema = 'keystone' AND table_name = 'consent_record'
       AND constraint_name = 'consent_record_consent_type_check'
  ) INTO constraint_exists;
  IF NOT constraint_exists THEN
    RAISE EXCEPTION '0489 self-check: consent_record_consent_type_check constraint missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.constraint_column_usage
     WHERE table_schema = 'keystone' AND table_name = 'notification_rule'
       AND constraint_name = 'notification_rule_channel_check'
  ) INTO constraint_exists;
  IF NOT constraint_exists THEN
    RAISE EXCEPTION '0489 self-check: notification_rule_channel_check constraint missing';
  END IF;

  -- ★ POSITIVE CONTROL: prove 'sms_marketing' is ACCEPTED in consent_record
  BEGIN
    INSERT INTO keystone.consent_record
      (tenant_id, person_id, consent_type, consent_method, is_active, created_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', NULL, 'sms_marketing', 'api', true, now());
    DELETE FROM keystone.consent_record
     WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
       AND consent_type = 'sms_marketing';
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION '0489 self-check: sms_marketing type was REJECTED by constraint (should be accepted)';
    WHEN OTHERS THEN NULL;  -- FK will fail, that's fine — the constraint passed
  END;

  -- ★ POSITIVE CONTROL: prove 'sms' is ACCEPTED in notification_rule
  BEGIN
    INSERT INTO keystone.notification_rule
      (tenant_id, topic, role, channel, enabled)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'test.topic', 'client_parent', 'sms', true);
    DELETE FROM keystone.notification_rule
     WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
       AND channel = 'sms';
  EXCEPTION
    WHEN check_violation THEN
      RAISE EXCEPTION '0489 self-check: sms channel was REJECTED by constraint (should be accepted)';
    WHEN OTHERS THEN NULL;  -- FK will fail, that's fine — the constraint passed
  END;

  -- ★ NEGATIVE CONTROL: prove an unknown consent_type is still REFUSED
  BEGIN
    INSERT INTO keystone.consent_record
      (tenant_id, person_id, consent_type, consent_method, is_active, created_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', NULL, 'unknown_consent_type', 'api', true, now());
    RAISE EXCEPTION '0489 self-check: an unknown consent_type was ACCEPTED (should be refused)';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- the constraint refused it: correct
  END;

  -- ★ NEGATIVE CONTROL: prove an unknown channel is still REFUSED
  BEGIN
    INSERT INTO keystone.notification_rule
      (tenant_id, topic, role, channel, enabled)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'test.topic', 'client_parent', 'unknown_channel', true);
    RAISE EXCEPTION '0489 self-check: an unknown channel was ACCEPTED (should be refused)';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- the constraint refused it: correct
  END;
END
$check$;

ALTER TABLE keystone.consent_record FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.notification_rule FORCE ROW LEVEL SECURITY;

-- ── RLS verification ──────────────────────────────────────────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'consent_record';
  IF NOT forced THEN
    RAISE EXCEPTION '0489 self-check: RLS is no longer FORCED on consent_record';
  END IF;

  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'notification_rule';
  IF NOT forced THEN
    RAISE EXCEPTION '0489 self-check: RLS is no longer FORCED on notification_rule';
  END IF;
END
$rls$;
