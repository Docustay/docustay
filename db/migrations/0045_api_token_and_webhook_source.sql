-- 0045 — keystone_auth.api_token + keystone_auth.webhook_source, and their resolvers.
-- Implements P19.3 (api_token, hash only), P19.4 (shown once), P19.5 (inbound routing table).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE D2.1 FINDING, WHICH IS WHY THESE TWO TABLES ARE NOT IN SCHEMA `keystone`.
--     **THE CREDENTIAL STORE IS THE ONE THING TENANT RLS CANNOT PROTECT, BECAUSE IT IS WHAT DECIDES
--     THE TENANT.** `api_token` and the inbound webhook routing table are read BEFORE `withTenant()`
--     can be called, so a policy of the form `tenant_id = current_tenant_id()` can never be
--     satisfied on them — at lookup time there is no current tenant; finding it is the point.
--   ★★ AND `SECURITY DEFINER` DOES NOT RESCUE IT: 0008:8-16 MEASURED that FORCE applies to the
--      table's OWNER too, so a definer function owned by the same role is still filtered by its own
--      forced policy. Meanwhile catalog-conformance.mjs requires FORCE on EVERY table in schema
--      `keystone` with no exception list, and separately bans BYPASSRLS.
--   ★★★ THEREFORE: schema `keystone_auth`, owned by `auth_owner` (NOLOGIN, NOBYPASSRLS, not
--        superuser, `app_rw` not a member), **NO GRANT TO app_rw ON ANY TABLE**, reachable only
--        through SECURITY DEFINER resolvers whose RETURN TYPE IS A BARE `uuid`.
--   ★ What replaces RLS is privilege separation plus a return type too narrow to carry a leak —
--     the 0008 argument, with one UUID instead of five integers.
--
-- ★★★ IF YOU ARE HERE TO "FIX" THE MISSING FORCE: DO NOT. `ALTER TABLE keystone_auth.<t> FORCE ROW
--     LEVEL SECURITY` applies `deny_all` to `auth_owner`, which owns the resolvers — so every
--     resolver returns nothing and **EVERY LOGIN AND EVERY API CALL FAILS**. It looks like a
--     security improvement in review. `catalog-conformance.mjs` check 10 fails loudly on it, in
--     that direction, on purpose.
--
-- ★★ THE SALT DILEMMA AND ITS RESOLUTION (P19.3), because the obvious choice is the wrong one.
--    A per-row salt (bcrypt/argon2) makes the digest a function of (secret, salt), so **it cannot be
--    an index key** — lookup degrades to a sequential scan running a deliberately-expensive KDF once
--    per row, i.e. every authenticated request becomes O(n) in tokens-in-existence. Disqualifying on
--    performance alone, before any security argument.
--    RESOLUTION: a PUBLIC `token_id` travels in the presented string — `gl_live_<token_id>_<secret>`.
--    Lookup is a unique-index probe on `token_id`; verification is a digest comparison.
--  ★ HMAC-SHA256 WITH A PEPPER from `KEYSTONE_TOKEN_PEPPER`, not bcrypt/argon2: the secret is 256
--    CSPRNG bits, not a human password, so a work factor multiplies an already-infeasible search.
--    The pepper buys something real — a stolen database dump cannot be used to confirm a guessed
--    token offline, because the pepper lives in a different blast radius.
--  ★ bcrypt additionally truncates at 72 bytes, silently discarding entropy.

SET LOCAL ROLE auth_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · keystone_auth.api_token
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone_auth.api_token (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  environment   text        NOT NULL CHECK (environment IN ('live','test')),
  -- ★ `class` decides which resolver can see the row, and the two resolvers are separate functions
  --   with separate grants — never one function with a branch (§Y5).
  class         text        NOT NULL DEFAULT 'secret' CHECK (class IN ('secret','publishable')),
  -- ★ DERIVED, never independently typed: a prefix that disagrees with `environment` would let a
  --   test key look like a live one in every log and every screenshot.
  prefix        text        NOT NULL CHECK (prefix = 'gl_' || environment || '_'),
  -- ★★ THE PUBLIC LOOKUP ID. Crockford base32, 26 chars — the shape of a ULID, and deliberately
  --    NOT the secret. This is what makes a unique-index probe possible at all.
  token_id      text        NOT NULL CHECK (token_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  -- ★★★ THE HASH, AND NEVER THE KEY. 32 bytes because HMAC-SHA256 is 32 bytes; the CHECK means a
  --     truncated or base64-mangled digest cannot be stored and then silently never match.
  secret_hash   bytea       NOT NULL CHECK (octet_length(secret_hash) = 32),
  -- ★ A version column so a pepper rotation is a migration rather than archaeology.
  hash_alg      text        NOT NULL DEFAULT 'hmac-sha256-v1' CHECK (hash_alg IN ('hmac-sha256-v1')),
  -- ★★ THE ONLY FRAGMENT OF THE SECRET EVER READABLE (P19.4). Four characters is enough for a human
  --    to tell two keys apart in a list and far too few to narrow a 256-bit search.
  last_four     text        NOT NULL CHECK (char_length(last_four) = 4),
  name          text        NOT NULL CHECK (btrim(name) <> ''),
  scopes        text[]      NOT NULL DEFAULT '{}',
  created_by    uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  revoked_by    uuid        REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz CHECK (expires_at IS NULL OR expires_at > created_at),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  last_used_ip  inet,

  CONSTRAINT api_token_revocation_shape CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL),
  -- ★ A token with no scopes can do nothing, so it is a support ticket waiting to happen rather
  --   than a safe default. Refuse it at creation.
  CONSTRAINT api_token_scopes_nonempty  CHECK (cardinality(scopes) > 0),
  CONSTRAINT api_token_scopes_shape
    CHECK (array_to_string(scopes, ',') ~ '^[a-z_]+:(read|write)(,[a-z_]+:(read|write))*$'),
  -- ★★★ §Y5 "NEVER LET ONE KEY CLASS BECOME THE OTHER" AS A CONSTRAINT, NOT A CONVENTION.
  --     A publishable key is safe in public HTML only because it can do exactly one write-scoped
  --     thing. Expressed here, a refactor cannot widen it.
  CONSTRAINT api_token_publishable_shape
    CHECK (class <> 'publishable'
           OR (cardinality(scopes) = 1 AND scopes[1] LIKE '%:write'))
);

-- ★★★ THESE TWO INDEXES ARE DELIBERATELY GLOBAL AND DO NOT LEAD WITH tenant_id.
--     They must be: **the presenter's tenant is unknown at lookup time, which is the entire reason
--     this schema exists.** The 0001:135-139 leak argument (a bare UNIQUE lets tenant A discover a
--     value in tenant B, because uniqueness checks bypass RLS) does NOT reach them — both values are
--     server-generated CSPRNG output no caller can choose, and `app_rw` has NO INSERT privilege, so
--     there is no path on which a tenant can provoke the violation and read its message.
--   ★ Recorded as named exceptions in the catalog gate's UNIQUE_EXCEPTIONS map with that argument —
--     never by loosening the rule.
CREATE UNIQUE INDEX api_token_token_id_key    ON keystone_auth.api_token (token_id);
CREATE UNIQUE INDEX api_token_secret_hash_key ON keystone_auth.api_token (secret_hash);
CREATE INDEX api_token_tenant_idx ON keystone_auth.api_token (tenant_id, created_at DESC);
CREATE INDEX api_token_active_idx ON keystone_auth.api_token (tenant_id) WHERE revoked_at IS NULL;

-- ★★★ ENABLE, **NOT FORCE** — see the header. And a deny_all policy as the SECOND independent
--     mechanism on top of the absent GRANT.
ALTER TABLE keystone_auth.api_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.api_token USING (false) WITH CHECK (false);

COMMENT ON TABLE keystone_auth.api_token IS
  'API tokens. Lives outside the tenant RLS regime because it is what DECIDES the tenant: it is read '
  'before withTenant() can be called, so no tenant_id = current_tenant_id() policy could ever be '
  'satisfied. Protected by privilege separation (no GRANT to app_rw) plus resolvers returning a bare '
  'uuid. Stores an HMAC-SHA256 digest and last_four only — the key itself is shown once, at creation, '
  'and is not recoverable from this table.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · keystone_auth.webhook_source — INBOUND routing (P19.5)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ THIS TABLE HAD NO PHASE AND NO SPECIFICATION ANYWHERE IN THE PRIOR PLAN, while carrying LIVE
--    STRIPE PAYLOADS. §Y1 item 3 and §Y4 describe the inbound path; webhook_endpoint and
--    webhook_delivery are explicitly OUTBOUND. So `webhookRoutes` — a Map, with a chicken-and-egg as
--    sharp as api_token's — had no successor. It has one now.
CREATE TABLE keystone_auth.webhook_source (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  provider    text        NOT NULL CHECK (provider IN ('stripe','documenso','resend')),
  -- ★★ THE VENDOR'S OWN ID, NEVER A NAME OR AN EMAIL (hard limit 2). A routing table keyed on a
  --    human identifier is a routing table that breaks when somebody changes their name, and it
  --    puts personal data on the unauthenticated inbound path.
  external_id text        NOT NULL CHECK (btrim(external_id) <> ''),
  created_at  timestamptz NOT NULL DEFAULT now(),
  retired_at  timestamptz
);

-- ★ Global unique, deliberately — and here there is a SECOND reason on top of the lookup one:
--   **two tenants claiming one vendor object is the bug this table exists to forbid.** A
--   tenant-scoped unique would *permit* the ambiguity and then resolve it arbitrarily.
CREATE UNIQUE INDEX webhook_source_ref_key
  ON keystone_auth.webhook_source (provider, external_id) WHERE retired_at IS NULL;
CREATE INDEX webhook_source_tenant_idx ON keystone_auth.webhook_source (tenant_id);

ALTER TABLE keystone_auth.webhook_source ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.webhook_source USING (false) WITH CHECK (false);

COMMENT ON TABLE keystone_auth.webhook_source IS
  'Inbound webhook routing: which tenant owns a given vendor object. Outside the tenant RLS regime '
  'for the same reason as api_token — it is read to DISCOVER the tenant. The unique index is global '
  'on purpose: two tenants claiming one vendor object is the ambiguity this table forbids.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · The resolvers. In schema `keystone`, owned by auth_owner, RETURNING A BARE uuid.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ `RETURNS uuid` IS THE SAFETY ARGUMENT, NOT A CONVENIENCE. 0008:26-29 made this argument with
--     five integers; one UUID is narrower still. **There is no shape in which a token name, a hash,
--     or another tenant's row can travel back to app_rw.** The catalog gate asserts the return type
--     mentions no text/bytea/jsonb, which is strictly stronger than a string match on 'uuid'.

-- ★ STABLE, not VOLATILE: it must not write. `last_used_at` is written separately, AFTER
--   withTenant() opens, so that write is not a second chicken-and-egg.
CREATE FUNCTION keystone.resolve_api_token(p_token_id text, p_secret_hash bytea)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.tenant_id FROM keystone_auth.api_token t
   WHERE t.token_id = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.class = 'secret'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
$$;
REVOKE ALL ON FUNCTION keystone.resolve_api_token(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_api_token(text, bytea) TO app_rw;

-- ★★★ A SEPARATE FUNCTION WITH A SEPARATE GRANT, NEVER ONE FUNCTION WITH A BRANCH (§Y5, P19.8).
--     `EXECUTE` goes to **app_embed only**, so app_rw cannot resolve a publishable key and
--     app_embed cannot resolve a secret one. Two resolvers, two grants — a branch inside one
--     function is one refactor away from resolving either class for either role.
CREATE FUNCTION keystone.resolve_publishable_key(p_token_id text, p_secret_hash bytea)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.tenant_id FROM keystone_auth.api_token t
   WHERE t.token_id = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.class = 'publishable'
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > now())
$$;
REVOKE ALL ON FUNCTION keystone.resolve_publishable_key(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_publishable_key(text, bytea) TO app_embed;

CREATE FUNCTION keystone.resolve_webhook_source(p_provider text, p_external_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.tenant_id FROM keystone_auth.webhook_source s
   WHERE s.provider = p_provider AND s.external_id = p_external_id AND s.retired_at IS NULL
$$;
REVOKE ALL ON FUNCTION keystone.resolve_webhook_source(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_webhook_source(text, text) TO app_rw;

-- ★★ THE ONE VOLATILE FUNCTION, AND ITS PREDICATE IS THE WHOLE POINT.
--    `last_used_at` is not written by the resolver (which is STABLE). This runs AFTER withTenant()
--    has opened, so it is not a second chicken-and-egg — and it is scoped to
--    `tenant_id = keystone.current_tenant_id()` so **a caller cannot touch a token it did not
--    present**. Without that predicate, knowing any token_id would let one tenant stamp another
--    tenant's key and pollute the only "is this key still in use" signal there is.
CREATE FUNCTION keystone.touch_api_token(p_token_id text, p_ip inet DEFAULT NULL)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.api_token
     SET last_used_at = now(),
         last_used_ip = COALESCE(p_ip, last_used_ip)
   WHERE token_id = p_token_id
     AND tenant_id = keystone.current_tenant_id()
  RETURNING tenant_id
$$;
REVOKE ALL ON FUNCTION keystone.touch_api_token(text, inet) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.touch_api_token(text, inet) TO app_rw;

RESET ROLE;
