-- 0020_keystone_auth
-- P13.0b — the credential schema · P13.2b — the session store · ADDENDUM 4 A4.1
-- ★ BUILD-UI.md calls this "migration 0017b"; it takes 0020 for the ordering reason in 0017.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FINDING THIS FILE EXISTS FOR. READ IT BEFORE CHANGING ANYTHING HERE.
--
--   THE CREDENTIAL STORE IS THE ONE THING TENANT RLS CANNOT PROTECT, BECAUSE IT IS WHAT DECIDES
--   THE TENANT.
--
-- A session record, an api_token and an inbound-webhook route are all read BEFORE withTenant()
-- can be called — they are what PRODUCES the tenant. So no policy of the form
-- `tenant_id = current_tenant_id()` can ever be satisfied on them: the GUC is unset at the moment
-- they are consulted, `current_tenant_id()` is NULL, and NULL = anything is NULL, not TRUE.
--
-- ★★ THE SAME WALL, MEASURED THREE TIMES ALREADY IN THIS BUILD:
--   · 0001:149-158 — keystone.tenant is ENABLE + FORCE under `id = current_tenant_id()`, so a
--     slug lookup with no context returns ZERO ROWS. The query that ESTABLISHES context is
--     denied by the RLS that context is required to satisfy. It presents at runtime as
--     "every login fails with NoTenantContext" — which looks like an auth bug and is a schema one.
--   · 0008:8-16 — "FORCE applies the policy TO THE TABLE OWNER TOO … SECURITY DEFINER BUYS
--     NOTHING AGAINST A FORCED POLICY." So the obvious fix is inert.
--   · catalog-conformance.mjs:63-66 requires `relforcerowsecurity` on EVERY table in schema
--     keystone, with no exception list, and :113-118 bans BYPASSRLS.
--   ⇒ A credential table CANNOT LIVE IN SCHEMA `keystone` AT ALL.
--
-- ★★★ WHAT REPLACES RLS HERE, AND IT IS NOT "NOTHING":
--   PRIVILEGE SEPARATION plus A RETURN TYPE TOO NARROW TO CARRY A LEAK.
--   · the tables are owned by `auth_owner` — NOLOGIN, NOBYPASSRLS, not superuser;
--   · `app_rw` IS NOT A MEMBER of auth_owner and holds NO privilege on any table here — not
--     SELECT, not anything. It reaches them ONLY through the definer resolvers below;
--   · each resolver returns uuids and nothing else. There is no shape in which a token hash, a
--     session secret, an email or another tenant's row travels back to app_rw.
--   That is the 0007/0008 `account_seat_counts` argument, made with uuids instead of integers.
-- ★ Precedent for a second schema: db/migrate.mjs:72 already creates keystone_meta.
--
-- ★★★ AND THE CATALOG GATE IS EXTENDED TO POLICE ALL OF IT — NEVER WEAKENED TO TOLERATE IT.
-- An unscanned schema is exactly how this stops being a design and becomes a hole. See
-- db/gates/catalog-conformance.mjs check 10.
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- ★★ GRANTED WHILE STILL app_owner, BECAUSE ONLY THE TABLE'S OWNER MAY GRANT ON IT.
-- A FOREIGN KEY requires the REFERENCES privilege on the target, and auth_owner holds only
-- SELECT on keystone.tenant (from 0017). [EXECUTED] without these the CREATE TABLE below dies
-- with `permission denied for table tenant` — a FK is a privilege, not just a constraint.
-- ★ REFERENCES and nothing more. It does NOT confer SELECT on app_user: the session table needs
--   to point AT a person, never to read one. ★ And it is narrow on purpose — a FK can be used as
--   an existence oracle, so it is granted on exactly the two tables the session row must anchor
--   to and on no others.
GRANT REFERENCES ON keystone.tenant   TO auth_owner;
GRANT REFERENCES ON keystone.app_user TO auth_owner;

CREATE SCHEMA keystone_auth AUTHORIZATION auth_owner;

-- ★★ EVERYTHING FROM HERE RUNS AS auth_owner, NOT app_owner, AND IT HAS TO.
-- `AUTHORIZATION auth_owner` makes auth_owner the schema's OWNER, so app_owner — which merely
-- created it — holds no CREATE inside it and cannot GRANT on it. [EXECUTED] the first attempt
-- died on `permission denied for schema keystone_auth` at the first CREATE TABLE.
-- ★ It is also the RIGHT ownership: every table here must be owned by auth_owner so that the
--   deny_all policy (which does not apply to the owner, since the tables are not FORCEd) leaves
--   exactly one role able to read them — the one the definer functions run as.
SET LOCAL ROLE auth_owner;

REVOKE ALL ON SCHEMA keystone_auth FROM PUBLIC;
GRANT USAGE ON SCHEMA keystone_auth TO auth_owner;
-- ★ app_rw gets USAGE on the SCHEMA and NOTHING on the tables. USAGE alone confers no ability to
--   read anything; it only permits naming objects inside. Without it the definer functions —
--   which run as auth_owner — are fine, but error messages become confusing.
GRANT USAGE ON SCHEMA keystone_auth TO app_rw;

COMMENT ON SCHEMA keystone_auth IS
  'P13.0b — the credential schema, deliberately OUTSIDE the tenant RLS regime. Everything here is read BEFORE a tenant exists, so tenant_id = current_tenant_id() is unsatisfiable on it by construction. Protected by privilege separation (app_rw holds nothing) plus definer resolvers with uuid-only return types. Policed by catalog-conformance check 10.';

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- P13.2b — THE SESSION STORE.
--
-- ★★★ THE DECISION, AND THE MEASUREMENT THAT DECIDED IT.
-- [MEAS, firebase-admin source] `setCustomUserClaims` (base-auth.js:482-487) does NOT touch
-- `tokensValidAfterTime`; only `revokeRefreshTokens` does (:491-492); and `checkRevoked` compares
-- against exactly that field (:962-971).
-- ⇒ A USER MOVED FROM TENANT A TO TENANT B KEEPS A CRYPTOGRAPHICALLY VALID TOKEN NAMING A FOR UP
--   TO AN HOUR, AND verifyIdToken(token, true) ACCEPTS IT. RLS cannot help: the context is
--   correct-looking and wrong. Y1's threat model covers "no context" and "wrong context asked for
--   explicitly" — NOT "stale context supplied by a trusted issuer".
--
-- TWO CLOSURES WERE AVAILABLE:
--   (a) STATELESS — revokeRefreshTokens on every tenant change PLUS checkRevoked on every
--       request. ★ checkRevoked forces a getUser() NETWORK ROUND TRIP TO GOOGLE PER REQUEST,
--       which makes a Firebase Auth outage a TOTAL APPLICATION OUTAGE and puts a WAN hop in
--       front of every read. §D2 currently implies this.
--   (b) A KEYSTONE-SIDE SESSION — one verifyIdToken at login, then a row. Revocation becomes a
--       DELETE and is INSTANT. The resolved tenant UUID is stored ONCE instead of re-resolved
--       per request.
--
-- ★★★ (b) IS CHOSEN. Three reasons, in order of weight:
--   1. It is strictly better on the isolation property Y1 exists to protect: the residual window
--      in which a stale tenant remains reachable goes from "up to an hour, unobservable" to
--      "until the row is deleted, which we do synchronously". P13.9 measures the number.
--   2. It is what the code ALREADY SAYS IT DOES. paths/index.mjs:11 —
--        "browser — signed session cookie → tenant from the session record"
--      (a) would make that comment false while leaving it in place.
--   3. It removes Google from the per-request critical path entirely.
-- ★ Cost, stated honestly: a session is state, and state must be expired and swept. That is the
--   `expires_at` column and P18's sweeper, and it is a smaller cost than a WAN hop per request.
-- ══════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone_auth.session (
  id              uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  -- ★ RESTRICT, always — the house rule for a tenant FK. A tenant with live sessions must not be
  --   deletable out from under them.
  tenant_id       uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id     uuid NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  -- ★ The uid the session was minted for, kept so a uid→sessions revocation is one indexed query
  --   and does not need a join into a table this schema must not depend on reading.
  firebase_uid    text NOT NULL,

  -- ★★★ THE SALT DILEMMA, RESOLVED THE SAME WAY P19.3 RESOLVES IT FOR api_token — deliberately,
  -- so the reasoning is not re-derived (and re-derived differently) in two places.
  --   A per-row salt (bcrypt/argon2) makes the digest a function of (secret, salt), so IT CANNOT
  --   BE AN INDEX KEY: lookup degrades to a sequential scan running a deliberately-expensive KDF
  --   once per row — every authenticated request becomes O(n) in sessions-in-existence.
  --   RESOLUTION: a PUBLIC token_id travels in the presented string, `ks_<token_id>_<secret>`.
  --   Lookup is a unique-index probe on token_id; verification is a digest comparison.
  -- ★ HMAC-SHA256 WITH A PEPPER (KEYSTONE_TOKEN_PEPPER), not bcrypt/argon2: the secret is 256
  --   CSPRNG bits, not a human password, so a work factor multiplies an already-infeasible
  --   search. The PEPPER buys something real — a stolen database dump cannot be used to confirm
  --   a guessed session offline, because the pepper lives in a different blast radius.
  --   ★ bcrypt would additionally truncate at 72 bytes, silently discarding entropy.
  token_id        text NOT NULL CHECK (token_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  secret_hash     bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  -- ★ A version column so a pepper rotation is a migration rather than archaeology.
  hash_alg        text NOT NULL DEFAULT 'hmac-sha256-v1' CHECK (hash_alg IN ('hmac-sha256-v1')),

  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL CHECK (expires_at > created_at),
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text CHECK (revoked_reason IN ('logout','tenant_changed','admin','expired_sweep')),

  -- ★ WHY IT WAS REVOKED MUST BE ANSWERABLE. A revoked_at with no reason is a session that
  --   vanished, and "was this a logout or a tenancy change?" is exactly the question asked after
  --   an incident.
  CONSTRAINT session_revocation_shape
    CHECK ((revoked_at IS NULL AND revoked_reason IS NULL) OR
           (revoked_at IS NOT NULL AND revoked_reason IS NOT NULL))
);

-- ★★★ GLOBAL UNIQUE, DELIBERATELY, AND IT DOES NOT LEAD WITH tenant_id.
-- It MUST be: the presenter's tenant is UNKNOWN at lookup time — that is the entire reason this
-- schema exists. ★ The 0001:135-139 leak argument does NOT reach it: both values are
-- server-generated CSPRNG output that no caller can choose, and app_rw has NO INSERT privilege
-- here, so there is no path on which a tenant can provoke the violation and read its message.
-- Recorded as a named exception in the catalog gate rather than by loosening the rule.
CREATE UNIQUE INDEX session_token_id_key ON keystone_auth.session (token_id);
CREATE INDEX session_live_idx  ON keystone_auth.session (tenant_id, app_user_id)
  WHERE revoked_at IS NULL;
-- ★ The revocation query for P13.7d/U27: "every live session for this uid", by uid alone, because
--   a tenancy change means the OLD tenant is exactly what must not be used to find it.
CREATE INDEX session_by_uid_idx ON keystone_auth.session (firebase_uid) WHERE revoked_at IS NULL;
CREATE INDEX session_expiry_idx ON keystone_auth.session (expires_at)   WHERE revoked_at IS NULL;

COMMENT ON TABLE keystone_auth.session IS
  'P13.2b — the keystone-side session. Chosen over stateless per-request checkRevoked because setCustomUserClaims does not move tokensValidAfterTime, so a tenancy change leaves a valid token naming the old tenant for up to an hour. Revocation here is a DELETE/UPDATE and is instant.';

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- THE RLS STANCE FOR EVERY TABLE IN THIS SCHEMA — AND IT IS THE INVERSE OF EVERYWHERE ELSE.
-- ══════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone_auth.session ENABLE ROW LEVEL SECURITY;

-- ★★★ DELIBERATELY *NOT* FORCED, AND THIS IS THE ONLY PLACE IN THE SYSTEM WHERE THAT IS TRUE.
-- FORCE applies the policy to the OWNER, and the owner is auth_owner — which owns the SECURITY
-- DEFINER resolvers below. 0008:8-16 MEASURED that a definer function is still filtered by a
-- forced policy. Forcing it here would harden NOTHING and would MAKE EVERY LOGIN FAIL.
-- ★★ That is why the catalog gate needs a second rule set asserting the INVERSE properties: a
--    future well-meaning `ALTER TABLE … FORCE ROW LEVEL SECURITY` here looks like a security
--    improvement and takes down authentication for every user. It must be caught as loudly as a
--    missing FORCE is caught in schema keystone.
CREATE POLICY deny_all ON keystone_auth.session USING (false) WITH CHECK (false);

-- ★★ NO GRANT TO app_rw ON THIS TABLE. Not SELECT, not anything. TWO INDEPENDENT MECHANISMS:
--    an ABSENT PRIVILEGE, and a policy that is false for every role that is not the owner.
--    Either alone would do; both are present because this is the table that decides tenancy.
--    ★ The catalog gate asserts SQLSTATE 42501 (insufficient_privilege), NOT "zero rows" —
--      zero rows is what a WORKING policy looks like and is indistinguishable from "the grant
--      was there but the table was empty". Only 42501 proves the privilege is absent.

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- THE RESOLVERS — in schema keystone, owned by auth_owner.
-- ★ (already running as auth_owner since the schema was created — see the note above)
-- ══════════════════════════════════════════════════════════════════════════════════════════

-- ── P13.0b · slug → uuid ──────────────────────────────────────────────────────
-- ★ This is the function that unblocks login. Without it `withTenant(orgIdClaim)` is called with
--   a SLUG — and db/index.mjs:48-53 rejects anything that is not a UUID with a plain Error,
--   which toAppError classifies INTERNAL/500. So the symptom of its absence is a 500 on every
--   login, not a 401.
CREATE FUNCTION keystone.resolve_tenant_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT t.id FROM keystone.tenant t
   WHERE lower(t.slug) = lower(p_slug)
     -- ★★ A SUSPENDED OR DELETED TENANT MUST NOT RESOLVE. Otherwise disabling a tenant leaves
     --    every one of its users able to log in, and the only thing stopping them is whatever
     --    the UI happens to check.
     AND t.status = 'active'
$$;
REVOKE ALL ON FUNCTION keystone.resolve_tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_tenant_by_slug(text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.resolve_tenant_by_slug(text) IS
  'P13.0b — slug to tenant uuid, for the one moment before tenant context exists. RETURNS uuid and nothing else: the return type IS the safety argument. Refuses a non-active tenant.';

-- ── P13.2b · session token → (tenant, user) ───────────────────────────────────
-- ★★ RETURNS TWO UUIDS, WHERE ADDENDUM 4 SAYS "a bare uuid" — and the deviation is stated rather
--    than slipped in. A session must yield BOTH the tenant AND the person; splitting it into two
--    functions would mean two probes of the same row per request, and worse, two places where the
--    revoked/expired predicate must agree. ★ The SAFETY ARGUMENT IS UNCHANGED: the return type is
--    two uuids. No token_id, no secret_hash, no email, no display name, nothing from any other
--    row can travel through this signature.
CREATE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id
    FROM keystone_auth.session s
   WHERE s.token_id = p_token_id
     -- ★★★ CONSTANT-TIME-ISH COMPARISON OF THE DIGEST, NOT OF THE SECRET. The lookup is by the
     --     PUBLIC token_id; the secret never appears in a WHERE clause in plaintext anywhere.
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
$$;
REVOKE ALL ON FUNCTION keystone.resolve_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.resolve_session(text, bytea) TO app_rw, app_owner;

-- ── the writes: create, touch, revoke. Each is VOLATILE and each is narrow. ───
CREATE FUNCTION keystone.create_session(
  p_tenant_id uuid, p_app_user_id uuid, p_firebase_uid text,
  p_token_id text, p_secret_hash bytea, p_ttl interval
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO keystone_auth.session
    (tenant_id, app_user_id, firebase_uid, token_id, secret_hash, expires_at)
  VALUES (p_tenant_id, p_app_user_id, p_firebase_uid, p_token_id, p_secret_hash, now() + p_ttl)
  RETURNING id
$$;
REVOKE ALL ON FUNCTION keystone.create_session(uuid, uuid, text, text, bytea, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.create_session(uuid, uuid, text, text, bytea, interval) TO app_rw, app_owner;

-- ★★★ U27's INSTANT CLOSURE. This is the whole point of choosing a session over stateless:
--     a tenancy change calls this, and the old tenant becomes unreachable in ONE STATEMENT
--     rather than in "up to an hour".
CREATE FUNCTION keystone.revoke_sessions_for_uid(p_firebase_uid text, p_reason text)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.session
       SET revoked_at = now(), revoked_reason = p_reason
     WHERE firebase_uid = p_firebase_uid AND revoked_at IS NULL
     RETURNING 1)
  SELECT count(*)::integer FROM done
$$;
REVOKE ALL ON FUNCTION keystone.revoke_sessions_for_uid(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_sessions_for_uid(text, text) TO app_rw, app_owner;

SET LOCAL ROLE app_owner;

-- ══════════════════════════════════════════════════════════════════════════════════════════
-- ★★ PROVE IT — BOTH DIRECTIONS, IN THE MIGRATION.
-- ══════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_slug text; v_direct integer; v_resolved uuid;
BEGIN
  -- ★★ THE PROOF CANNOT FIND A TENANT THE ORDINARY WAY, AND THAT IS THE POINT BEING PROVEN.
  -- This block runs as app_owner, which FORCE RLS filters to zero rows on keystone.tenant — so
  -- `SELECT id FROM keystone.tenant LIMIT 1` returns NULL here. [EXECUTED] the first attempt
  -- aborted on exactly that, via its own "a zero here would mean nothing" guard. ★ The guard was
  -- right and the query was wrong: the slug has to come through a definer, which is the whole
  -- thesis of this migration arriving in its own proof.
  SELECT slug INTO v_slug FROM keystone.tenant_timezones_for_health() LIMIT 1;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'no tenant exists at all, so the resolver proof could not run — a zero here would mean nothing';
  END IF;

  -- ★ THE NEGATIVE THAT MOTIVATES THE WHOLE FILE: a DIRECT slug lookup with no tenant context
  --   returns nothing. If this ever returns a row, tenant_isolation on keystone.tenant is broken
  --   and the resolver is masking it.
  SELECT count(*) INTO v_direct FROM keystone.tenant WHERE status='active';
  IF v_direct <> 0 THEN
    RAISE EXCEPTION 'a direct read of keystone.tenant with NO tenant context returned % row(s) — tenant_isolation is not filtering, and this migration would be papering over it', v_direct;
  END IF;

  -- ★ THE POSITIVE: through the resolver, the same lookup works.
  SELECT keystone.resolve_tenant_by_slug(v_slug) INTO v_resolved;
  IF v_resolved IS NULL THEN
    RAISE EXCEPTION 'resolve_tenant_by_slug returned NULL for a slug that exists — login would fail for every user';
  END IF;

  -- ★ AND AN UNKNOWN SLUG MUST RESOLVE TO NULL, NOT TO SOMETHING. "Never fall through to a
  --   default tenant" is P13.3's rule and this is its database half.
  IF keystone.resolve_tenant_by_slug('no-such-tenant-anywhere') IS NOT NULL THEN
    RAISE EXCEPTION 'resolve_tenant_by_slug returned a tenant for an unknown slug';
  END IF;

  RAISE NOTICE 'keystone_auth: direct read of keystone.tenant sees 0 (correct); resolve_tenant_by_slug(%) -> %; unknown slug -> NULL', v_slug, v_resolved;
END $$;
