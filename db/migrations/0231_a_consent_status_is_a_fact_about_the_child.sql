-- 0231_a_consent_status_is_a_fact_about_the_child
-- 12-signup-first-run-people.md §3.3 (A5, task 12.4) — the PEOPLE-LIST-FACING half of 0231:
--   1. `keystone.app_user.consent_status` — the standing guardian-consent status PeopleAdolescents
--      shows, written by `setConsentStatus` (src/people/writes.mjs). NOT the per-booking consent
--      gate (spec 03b/CT-116, which reads this column as one input alongside an executed document).
--   2. `keystone.app_user.lead_next_step` — free text, staff-set, shown on PeopleLeads.
--
-- Coach-assignment and lead-owner reuse the EXISTING `keystone.app_user.owner_user_id`
-- (0071_record_ownership.sql — already exists, already FK'd to app_user(tenant_id, id) ON DELETE SET
-- NULL, already indexed `app_user_owner_idx`/`app_user_unassigned_idx`). [MEASURED] its existing
-- writer is a trigger that sets `owner_user_id = id` for STAFF rows only; no write route sets it for
-- a non-staff person today — this task's `assignPerson` (src/people/writes.mjs) is the first. No new
-- column is needed for that half; this migration is columns for consent_status/lead_next_step only.
--
-- consent_status goes on `app_user`, not `guardian`: `keystone.guardian` (0074) is a per-(guardian,
-- child) pair — an adolescent can have zero, one or two rows — and PeopleAdolescents needs ONE
-- status per adolescent, always resolvable, independent of how many (if any) guardians are linked.
--
-- No FORCE-RLS/grant change needed — both columns land on an already-FORCE-RLS'd, already-`app_rw`-
-- granted table (0001_platform_skeleton.sql:98-192).
--
-- Migration block usage: 0229-0231 used, three of the twenty allocated (0229-0248).

ALTER TABLE keystone.app_user
  ADD COLUMN consent_status text
    CHECK (consent_status IS NULL OR consent_status IN ('not_started','waiting','granted','declined')),
  ADD COLUMN lead_next_step text;

-- consent_status is only meaningful for an adolescent; enforced, not just documented, so a write path
-- cannot silently set it on the wrong kind of row.
ALTER TABLE keystone.app_user
  ADD CONSTRAINT app_user_consent_status_adolescent_only
    CHECK (consent_status IS NULL OR role = 'adolescent_client');

COMMENT ON COLUMN keystone.app_user.consent_status IS
  'spec 12 — the standing guardian-consent status shown on PeopleAdolescents. NOT the per-booking consent gate (that is spec 03b/CT-116, which reads this as one input alongside an executed document).';
COMMENT ON COLUMN keystone.app_user.lead_next_step IS
  'spec 12 — free text, staff-set, shown on PeopleLeads. No enum: a next step is whatever the coach actually needs to do, and a closed list of "call / email / follow up" was rejected as narrower than what a lead pipeline actually needs (the maintainer''s standing MOCKUPS-wins-on-content rule, C2).';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- SELF-CHECK — the shape this file claims is the shape the table now has.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'app_user' AND column_name = 'consent_status'
  ) THEN
    RAISE EXCEPTION 'keystone.app_user.consent_status was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'app_user' AND column_name = 'lead_next_step'
  ) THEN
    RAISE EXCEPTION 'keystone.app_user.lead_next_step was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'app_user_consent_status_adolescent_only'
  ) THEN
    RAISE EXCEPTION 'app_user_consent_status_adolescent_only CHECK was not created';
  END IF;
END $$;
