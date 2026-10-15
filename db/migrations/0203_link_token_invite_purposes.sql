-- 0203_link_token_invite_purposes
-- Stage 8 task 8.1 · CCR-4 / CT-018 / CONTRACTS §0 C-13.
--
-- THIS EXTENDS Stage 5's CHECK on keystone.link_token.purpose; it does not create one. Stage 5's
-- migration 0169 shipped the column with a CHECK seeded with exactly one value,
-- 'document_signature'. This migration's job is 'document_signature' + 'invite' + 'client_invite'
-- — drop and re-add the constraint with the UNION, never with only the two new values. Dropping a
-- CHECK and re-adding it with the old value missing would silently legalise nothing and illegalise
-- every signature link already issued.
--
-- ★ MEASURED 21 Sep 2026, LOCAL database at head 0172, read-only:
--     conname             = link_token_purpose_check
--     pg_get_constraintdef = CHECK ((purpose = 'document_signature'::text))
--   (Postgres normalised the single-value IN to =. The parser in test (j) of
--    test/s5_link_token.test.mjs pulls quoted literals out of whatever form is there, so the
--    normalisation is harmless — but do not expect to read the word IN back.)
--
-- ★★ THIS MIGRATION AND src/auth/linkToken.mjs's PURPOSE_SUBJECT_TYPE MAP EDIT ARE ONE TASK (8.1)
--    AND MUST LAND TOGETHER. test/s5_link_token.test.mjs test (j) compares the CHECK's values
--    against PURPOSE_SUBJECT_TYPE's keys and fails red if only one side is extended.
ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_purpose_check;
ALTER TABLE keystone.link_token ADD CONSTRAINT link_token_purpose_check
  CHECK (purpose IN ('document_signature', 'invite', 'client_invite'));
--                   ^^^^^^^^^^^^^^^^^^^^ Stage 5's seeded value, carried forward, NOT dropped.
