-- 0284_calendar_connection_identity_and_token
-- Spec 03a (calendar and sync) task 3a.1 · §3 — HOW EACH CONNECTION'S CREDENTIAL IS ACTUALLY FOUND.
--
-- ★★★ THE DECISION, §1.1. Google rides the EXISTING per-account `keystone.google_identity` consent
--     (0057) rather than minting a second, independent refresh token on the same Google account —
--     avoiding both a duplicate live credential for one real-world account and the 100-token
--     eviction cap `src/run/blocked.mjs`'s A10.1 comment documents. Microsoft gets its OWN token
--     storage directly on `calendar_connection`, because nothing else in this codebase shares a
--     Microsoft consent with it yet (no Growth-equivalent Microsoft feature exists to collide with).
--
-- ★★ The CHECK below makes the two branches MUTUALLY EXCLUSIVE AND EXHAUSTIVE, matching
--    `calendar_connection.provider`'s existing `CHECK (provider IN ('google','microsoft'))` (0013):
--    a google row NEVER carries its own envelope, and a microsoft row NEVER points at
--    `google_identity` — one shape per provider, enforced by the database, not by application code
--    remembering to check.
--
-- ★ Envelope purpose for the Microsoft branch is `'calendar_microsoft'` — already a member of
--   `SECRET_PURPOSES` (`src/secrets/envelope.mjs:39`), zero prior writers; no `SECRET_PURPOSES`
--   change ships with this migration (§1.1 correction to CT-114, CONTRACTS-FEATURES.md).
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.

ALTER TABLE keystone.calendar_connection
  ADD COLUMN google_identity_id uuid REFERENCES keystone.google_identity(id) ON DELETE RESTRICT,
  ADD COLUMN refresh_envelope   jsonb,          -- Microsoft only; same shape google_identity.refresh_envelope uses
  ADD COLUMN kek_version        smallint,
  ADD COLUMN token_fingerprint  text;

ALTER TABLE keystone.calendar_connection ADD CONSTRAINT calendar_connection_token_shape CHECK (
  (provider = 'google'    AND google_identity_id IS NOT NULL AND refresh_envelope IS NULL) OR
  (provider = 'microsoft' AND google_identity_id IS NULL     AND refresh_envelope IS NOT NULL
                           AND kek_version IS NOT NULL AND token_fingerprint IS NOT NULL));

COMMENT ON CONSTRAINT calendar_connection_token_shape ON keystone.calendar_connection IS
  'Spec 03a §3, task 3a.1. A google row''s credential lives on keystone.google_identity (0057) — '
  'google_identity_id set, refresh_envelope NULL. A microsoft row carries its own sealed refresh '
  'token directly here (purpose ''calendar_microsoft'') — google_identity_id NULL, the other three '
  'columns all set. No row may be neither shape or both.';
