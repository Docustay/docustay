-- 0341_sixteen_kinds_of_business
-- TOUCH-UP · WORKSTREAM 12 · TY, 23 Sep 2026 — "What kind of business?" widens from the 7-value
-- placeholder list migration 0229 shipped to the 16 verticals the platform actually sells to
-- (MEASURED against https://example.com, live copy, 23 Sep 2026) plus 'other' ("something
-- else"), carried forward unchanged.
--
-- ★ EXISTING ROWS ARE REMAPPED, NOT ORPHANED. A DROP+ADD CHECK with a narrower or renamed value
--   list would leave any already-answered practice (Docustay, any test practice) holding a value the
--   new CHECK rejects on the next read that re-validates it — same shape as 0203's own warning.
--   The UPDATE below runs BEFORE the constraint swap and maps every one of the 7 old values onto
--   its nearest of the 17 new ones; 'other' stays 'other'.
UPDATE keystone.tenant_intake SET coaching_type = CASE coaching_type
  WHEN 'life'                  THEN 'coaching'            -- "Life, business, executive and career"
  WHEN 'career'                THEN 'coaching'
  WHEN 'recovery'              THEN 'recovery_coaching'   -- FOUNDRY's own answer
  WHEN 'fitness'                THEN 'personal_training'
  WHEN 'health_and_wellness'   THEN 'nutrition'
  WHEN 'family_and_parenting'  THEN 'other'                -- no matching vertical; honest fallback
  ELSE coaching_type                                       -- 'other' stays 'other'
END
WHERE coaching_type IN ('life', 'career', 'recovery', 'fitness', 'health_and_wellness', 'family_and_parenting');

ALTER TABLE keystone.tenant_intake DROP CONSTRAINT tenant_intake_coaching_type_check;
ALTER TABLE keystone.tenant_intake ADD CONSTRAINT tenant_intake_coaching_type_check
  CHECK (coaching_type IN (
    'coaching', 'recovery_coaching', 'tutoring', 'personal_training', 'consulting',
    'salon_and_spa', 'nutrition', 'music_and_arts', 'doula_and_birth', 'pet_services',
    'photography', 'legal_and_accounting', 'inspection_and_trades', 'language_and_translation',
    'driving_instruction', 'event_planning', 'other'
  ));

COMMENT ON COLUMN keystone.tenant_intake.coaching_type IS
  'Which of Workbench''s 16 verticals this practice picked at signup, or ''other''. Widened from a '
  '7-value coaching-only placeholder at 0341 to match the 16 kinds of business example.com '
  'actually lists (renameable per-tenant terminology, unaffected — this is the ONBOARDING answer, '
  'not a display label).';
