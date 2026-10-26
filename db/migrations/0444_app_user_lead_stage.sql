-- 0444_app_user_lead_stage
-- Stage 16 task 16.3 — Board screen vocabulary: a closed lead-stage column.
--
-- Adds `lead_stage` to keystone.app_user as a nullable text column with CHECK constraint
-- admitting only ('enquired','talked_to','estimate_sent','booked','became_client'). NULL
-- renders in the "Enquired" column of the Board screen (the default). Existing rows backfill
-- to NULL (correct default); app_user already has FORCED RLS, which automatically covers
-- this new column — no new RLS policy is added.
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
ALTER TABLE keystone.app_user
  ADD COLUMN lead_stage text
  CONSTRAINT app_user_lead_stage_check
  CHECK (lead_stage IS NULL OR lead_stage IN ('enquired','talked_to','estimate_sent','booked','became_client'));

CREATE INDEX app_user_lead_stage ON keystone.app_user (tenant_id, lead_stage) WHERE lead_stage IS NOT NULL;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)