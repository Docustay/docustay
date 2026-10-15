-- 0344_the_intake_answer_is_recorded_beside_its_siblings
-- PART 4.5 [TY, RULED 23 Sep 2026] — signup asks FOUR things at creation: shape, business type,
-- team size, moving from. `shape` joins `coaching_type`/`team_size`/`moving_from` on the same
-- write-once row, replacing the separate "what do you need the platform for?" step (WORKSTREAM 12).
--
-- ★ NULLABLE, UNLIKE ITS THREE SIBLINGS. Every existing `tenant_intake` row answered the wizard
--   before this question existed — it was never asked, so recording an answer for it would be
--   inventing one. `keystone.tenant.shape` (migration 0343) is the OPERATIONAL column every route
--   reads and it defaults to 'both'; this column is the audit trail of what was actually asked at
--   signup, and NULL here honestly means "not asked". Every new row supplies it — the route parses
--   it through `SignupQuestionsAnswers`, which requires it.
ALTER TABLE keystone.tenant_intake ADD COLUMN shape text
  CHECK (shape IS NULL OR shape IN ('crm', 'run', 'both'));

COMMENT ON COLUMN keystone.tenant_intake.shape IS
  'Which shape the Owner picked at signup (crm/run/both) — NULL on every row from before this '
  'question existed. keystone.tenant.shape (migration 0343) is the operational column; this is '
  'the write-once record of the original answer.';
