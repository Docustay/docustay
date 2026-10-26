-- 0169_link_token
-- Stage 5 task 5.5 · CT-018 · CCR-15 (global unique) · CCR-16 (app_rw reads, and only some columns).
--
-- THE FOURTH CREDENTIAL TYPE IN THE PRODUCT. A link token is presented by someone with NO SESSION,
-- out of an email, and the row is how the practice is discovered. Everything below follows from that
-- one sentence, and the four corrections recorded in STAGE-5-PLAN task 5.5 are each marked inline.
--
-- The functions that read and write this table are in 0170. Nothing else may: app_rw holds a
-- column-level SELECT and nothing more, so every write in the product goes through a SECURITY
-- DEFINER function owned by auth_owner.

CREATE TABLE keystone.link_token (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES keystone.tenant(id),
  token_id      text NOT NULL CHECK (token_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  secret_hash   bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  purpose       text NOT NULL CHECK (purpose IN ('document_signature')),
  subject_type  text NOT NULL,
  subject_id    uuid NULL,
  issued_to     uuid NULL REFERENCES keystone.app_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  redeemed_at   timestamptz NULL,
  revoked_at    timestamptz NULL,
  revoked_reason text NULL
);

-- ★★★ GLOBAL UNIQUE, DELIBERATELY — DEFECT 2. `redeem_link_token` and `peek_link_token` are handed a
--     token_id and NO TENANT; discovering the tenant is what they are for. A UNIQUE (tenant_id,
--     token_id) would not make `WHERE token_id = $1` single-valued, and a redeem that matched two
--     practices' rows would spend both. The two precedents are global and argue the same point:
--     0020_keystone_auth.sql:148-154 (session_token_id_key) and 0045:97 (api_token_token_id_key).
--   ★★ The INDEX NAME is load-bearing: db/gates/catalog-conformance.mjs:493 keys UNIQUE_EXCEPTIONS
--      on it. Task 5.9 adds the entry under exactly this name. Do not rename it.
CREATE UNIQUE INDEX link_token_token_id_key ON keystone.link_token (token_id);

ALTER TABLE keystone.link_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.link_token FORCE  ROW LEVEL SECURITY;

-- ── app_rw: READ ONLY, AND NOT THE TWO SECRET COLUMNS (CCR-16) ────────────────────────────────
-- ★★★ CT-018 asks for SELECT, INSERT, UPDATE. DEFECT 3: the global unique index's exception
--     argument in the catalog gate is "app_rw holds no INSERT, so no tenant can provoke the
--     violation and read its message" (0045:449-455, repeated for session_token_id_key). Granting
--     INSERT would make that argument FALSE for this table. Nothing in the product needs it: every
--     write goes through a definer function in 0170. ★ The SELECT is column-level, excluding
--     `token_id` and `secret_hash`, so a future "outstanding invitations" screen can list them
--     without the lookup id or the digest ever reaching app_rw. The idiom is 0157:89.
GRANT SELECT (id, tenant_id, purpose, subject_type, subject_id, issued_to,
              created_at, expires_at, redeemed_at, revoked_at, revoked_reason)
  ON keystone.link_token TO app_rw;

-- ★ current_tenant_id(), NEVER require_tenant_id() — DEFECT 4. require_tenant_id() RAISES when no
--   tenant is set (0001:61-93), and a permissive policy that raises aborts the statement instead of
--   evaluating false, which would break redeem for auth_owner. 0003's WITH CHECK clauses use the
--   raising form; this table deliberately does not, and there is no WITH CHECK here anyway because
--   app_rw cannot write.
CREATE POLICY tenant_isolation ON keystone.link_token
  FOR SELECT USING (tenant_id = keystone.current_tenant_id());

-- ── auth_owner: A POLICY IS NOT A PRIVILEGE (0017:48-57) — DEFECT 1 ───────────────────────────
-- Both halves, or the four definer functions in 0170 fail: without the GRANT, loudly
-- ("permission denied for table link_token"); with the GRANT and no policy, as ZERO ROWS, silently.
GRANT SELECT ON keystone.link_token TO auth_owner;
GRANT INSERT ON keystone.link_token TO auth_owner;
-- ★★ COLUMN-LEVEL UPDATE. A definer may set the three lifecycle columns and NOTHING else — not
--    tenant_id, not secret_hash, not purpose, not subject_*. The idiom is 0157:89.
GRANT UPDATE (redeemed_at, revoked_at, revoked_reason) ON keystone.link_token TO auth_owner;

-- ★★★ USING (true) — CROSS-TENANT ON PURPOSE, AND THIS IS THE WHOLE SAFETY ARGUMENT OF THE FEATURE.
--     A link is presented by someone with NO SESSION; the row is how the tenant is discovered. What
--     stands between a stranger and a practice's row is the 43-character secret and the digest
--     comparison, not this policy. Same shape as tenant_health_read (0017:56-57).
CREATE POLICY link_token_credential_read ON keystone.link_token
  AS PERMISSIVE FOR SELECT TO auth_owner USING (true);

-- ★ MINT is tenant-scoped: it always runs inside a tenant-scoped transaction and mint_link_token
--   asserts p_tenant = current_tenant_id() as well. Two mechanisms, deliberately.
CREATE POLICY link_token_mint_insert ON keystone.link_token
  AS PERMISSIVE FOR INSERT TO auth_owner WITH CHECK (tenant_id = keystone.current_tenant_id());

-- ★ SPEND is cross-tenant for the same reason the read is: redeem has no tenant context. The
--   column-level UPDATE grant above is what bounds it.
CREATE POLICY link_token_spend_update ON keystone.link_token
  AS PERMISSIVE FOR UPDATE TO auth_owner USING (true) WITH CHECK (true);

COMMENT ON POLICY link_token_credential_read ON keystone.link_token IS
  'Stage 5 / 0169 — admits ONLY auth_owner, ONLY for SELECT, so keystone.redeem_link_token() and
   keystone.peek_link_token() can find a token presented by someone with no session. Unconditional by
   necessity: the tenant is what the lookup discovers. Pinned by catalog-conformance check 12.';

-- ★★ THE CHECK ON `purpose` IS THE PURPOSE REGISTER, AND IT IS MANDATORY (CT-018, critic K1-5-1).
--    Stage 5 seeds it with the single value this stage and STAGE-7-PLAN's four signer routes need.
--    Stage 8's migration 0203 EXTENDS this list — it does not create it — adding 'invite' and
--    'client_invite'. The JS half of the register is PURPOSE_SUBJECT_TYPE in src/auth/linkToken.mjs,
--    and test (j) of test/s5_link_token.test.mjs compares the two sets so neither can be extended
--    without the other.
COMMENT ON TABLE keystone.link_token IS
  'Stage 5 / 0169 (CT-018). Single-use, expiring, unguessable links presented by someone with NO
   session — sign a document today, accept an invitation from Stage 8. Stores an HMAC-SHA256 digest
   peppered with KEYSTONE_TOKEN_PEPPER and never the secret. token_id is GLOBALLY unique because the
   presenter''s practice is unknown at lookup time (CCR-15). app_rw holds a column-level SELECT that
   excludes token_id and secret_hash and NOTHING else (CCR-16): every write goes through one of the
   four SECURITY DEFINER functions in 0170. A link is revoked, never deleted.';
