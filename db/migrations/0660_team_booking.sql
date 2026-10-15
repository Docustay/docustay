-- 0660 — TEAM BOOKING (the maintainer, 6 Oct 2026): a free First Light Call booked from the practice's own website, assigned
-- at booking time to one of the people who deliver the service. Specs: specs/BOOKING-TEAM-AUDIT-6OCT.md,
-- specs/BOOKING-TEAM-PLAN-6OCT.md. ADDITIVE ONLY: every statement is a new nullable/defaulted column or a widened check,
-- idempotent, and changes no existing row.
--
--   service.booking_key            a practice-chosen STABLE name a website can call ('first-light-call'); unique per practice
--   service_host.priority          lower number is offered first under the 'priority' rule (default 100)
--   service_host.last_assigned_at  what 'round_robin' orders by; written in the booking transaction, under the host locks
--   booking_policy.assignment_rule per-service override of the practice default (booking.assignment_rule, a tenant setting)
--   rate_limit_window.bucket       + 'public_booking', so a flood at a practice's public booking door cannot spend the
--                                  same per-practice budget its staff use (rateLimit.mjs: "a bucket is an edit there AND a migration")

ALTER TABLE keystone.service
  ADD COLUMN IF NOT EXISTS booking_key text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_booking_key_shape' AND conrelid = 'keystone.service'::regclass) THEN
    ALTER TABLE keystone.service
      ADD CONSTRAINT service_booking_key_shape CHECK (booking_key IS NULL OR booking_key ~ '^[a-z0-9][a-z0-9-]{0,62}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS service_booking_key_unique
  ON keystone.service (tenant_id, booking_key) WHERE booking_key IS NOT NULL;

ALTER TABLE keystone.service_host
  ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;

ALTER TABLE keystone.booking_policy
  ADD COLUMN IF NOT EXISTS assignment_rule text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_policy_assignment_rule_check' AND conrelid = 'keystone.booking_policy'::regclass) THEN
    ALTER TABLE keystone.booking_policy
      ADD CONSTRAINT booking_policy_assignment_rule_check
      CHECK (assignment_rule IS NULL OR assignment_rule IN ('round_robin', 'priority', 'least_booked'));
  END IF;
END $$;

-- the bucket vocabulary: the eleven names from 0166, plus public_booking
ALTER TABLE keystone.rate_limit_window DROP CONSTRAINT IF EXISTS rate_limit_window_bucket_known;
ALTER TABLE keystone.rate_limit_window
  ADD CONSTRAINT rate_limit_window_bucket_known
  CHECK (bucket IN ('api','app','documents','engagements','home','list','nav','platform','records','settings','write','public_booking'));

-- self-check, with a positive control inside the SQL
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'keystone'
     AND ((table_name = 'service' AND column_name = 'booking_key')
       OR (table_name = 'service_host' AND column_name IN ('priority', 'last_assigned_at'))
       OR (table_name = 'booking_policy' AND column_name = 'assignment_rule'));
  IF n <> 4 THEN RAISE EXCEPTION '0660 — expected 4 new columns, found %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'keystone' AND indexname = 'service_booking_key_unique') THEN
    RAISE EXCEPTION '0660 — service_booking_key_unique is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_limit_window_bucket_known'
                  AND pg_get_constraintdef(oid) LIKE '%public_booking%' AND pg_get_constraintdef(oid) LIKE '%engagements%') THEN
    RAISE EXCEPTION '0660 — the bucket check must name public_booking AND still name the old buckets';
  END IF;
END $$;
