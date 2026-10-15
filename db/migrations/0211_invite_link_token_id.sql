-- 0211_invite_link_token_id
-- Stage 8 task 8.6 · F612 (resolved 21 Sep 2026) — revokeInvite needs a way to name the
-- keystone.link_token row it kills without app_rw ever reading keystone.link_token.token_id
-- (CCR-16 excludes that column from app_rw's SELECT, 0169:40-50).
--
-- DESIGN DECISION: the public token_id is a COPY, stored on keystone.invite itself, written once by
-- createInvite in the same transaction as the mint. keystone.link_token stays the only credential
-- row and the only thing keystone.revoke_link_token ever writes to; this migration adds no grant, no
-- policy and no function on it. CCR-16's own comment ("so a future 'outstanding invitations' screen
-- can list them without the lookup id ... ever reaching app_rw") is about keystone.link_token, a
-- shared, globally-unique, cross-tenant table (0169's own header); keystone.invite is per-tenant and
-- app_rw already holds full, uncolumned SELECT/INSERT/UPDATE on it (0202:66). listInvites (this
-- task's third export) does not select or return this column, so that property is unaffected.
--
-- The alternative (a new SECURITY DEFINER function, or folding a subject_id lookup into
-- revoke_link_token itself) was rejected: both require editing src/auth/linkToken.mjs and/or
-- db/gates/catalog-conformance.mjs's CREDENTIAL_RESOLVERS allow-list — both Stage 5's, both outside
-- this task's "what not to touch" (field 5) — and changing revoke_link_token's own signature would
-- break db/gates/s5_api_contract.mjs:718-725, which already calls it keyed on token_id.
--
-- Safe as NOT NULL: keystone.invite (0202) is created earlier in this same migration block and has
-- never been written to by any deployed application code — 8.6 is the first and only writer, and its
-- own createInvite (field 4) always supplies token_id at INSERT time, never in a later UPDATE.

ALTER TABLE keystone.invite
  ADD COLUMN token_id text NOT NULL CHECK (token_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$');

-- ★ UNIQUE, mirroring link_token_token_id_key (0169:31) — the value is a copy of a column that is
--   already globally unique one table over, so a duplicate here can only mean a bug (two invites
--   minted against the same link token), never a legitimate state.
CREATE UNIQUE INDEX invite_token_id_key ON keystone.invite (token_id);

COMMENT ON COLUMN keystone.invite.token_id IS
  'F612 / 8.6 (0211). A COPY of the keystone.link_token row''s public token_id (0169), written once
   by createInvite in the same transaction as the mint. Exists only so revokeInvite can name the
   link token to kill without app_rw ever reading keystone.link_token.token_id (CCR-16 excludes it).
   Never returned by listInvites or any other reader.';
