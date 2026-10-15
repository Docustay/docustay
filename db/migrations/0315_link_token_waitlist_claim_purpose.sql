-- 0315_link_token_waitlist_claim_purpose
-- Spec 03b task 3b.1 · CT-106 (CONTRACTS-FEATURES.md — new link_token purpose).
--
-- ★★★ EXTENDS keystone.link_token.purpose's CHECK, DOES NOT REPLACE ITS MEANING. Stage 8's 0203
--    already extended 0169's single seeded value ('document_signature') to
--    ('document_signature', 'invite', 'client_invite') — MEASURED there as the constraint
--    `link_token_purpose_check` (re-confirmed here by grep: 0203 is the only migration to touch it
--    since 0169, and no later migration has). Same drop-and-reunion idiom as 0203/0309: every
--    existing value is carried forward, only 'waitlist_claim' is new.
--
-- ★★ 'waitlist_claim': a single-redemption, short-TTL link sent when a waitlist slot opens
--    (`booking.waitlist.offered`, spec 03b §5), subject type `booking_waitlist_entry`. The teen
--    consent gate (CT-116) does NOT need a new purpose — it reuses 'document_signature' on the
--    existing signer-link path, because a guardian's consent is a document to sign, not a new kind
--    of link (CONTRACTS-FEATURES.md CT-106).
--
-- ★ `PURPOSE_SUBJECT_TYPE` (`src/auth/linkToken.mjs`) gets the matching one new entry as part of
--   task 3b.4 (the waitlist job/route code that actually mints and redeems this purpose) — NOT this
--   migration, which is schema-only. `test/s5_link_token.test.mjs` test (j) compares the CHECK's
--   values against that map's keys and fails red if only one side is extended, exactly as 0203's own
--   header states.

ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_purpose_check;
ALTER TABLE keystone.link_token ADD CONSTRAINT link_token_purpose_check
  CHECK (purpose IN ('document_signature', 'invite', 'client_invite', 'waitlist_claim'));
--                   ^^^^^^^^^^^^^^^^^^^^ ^^^^^^^^ ^^^^^^^^^^^^^^^ 0169/0203's three existing values,
--                   carried forward unchanged. 'waitlist_claim' is the only new member.

COMMENT ON CONSTRAINT link_token_purpose_check ON keystone.link_token IS
  'Spec 03b / 0315 (CT-106). Widened from 0203''s three values to add waitlist_claim: a
   single-redemption, short-TTL link sent when a waitlist slot opens (subject_type
   booking_waitlist_entry). PURPOSE_SUBJECT_TYPE (src/auth/linkToken.mjs) gets the matching entry in
   task 3b.4, not this migration.';
