-- 0204_email_code
-- Stage 8 task 8.2 — CT-056. The table a 6-digit sign-in/verify/recover code lives in, hashed, with
-- its own attempt counter, plus the two definers that are the ONLY way to reach it.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE STANCE IS COPIED, DELIBERATELY, FROM `keystone_auth.session` (0020:164-181): ENABLE ROW
--     LEVEL SECURITY but deliberately **NOT FORCE**. FORCE applies the policy to the OWNER, and the
--     owner is `auth_owner` — which owns the SECURITY DEFINER resolvers below. 0008:8-16 MEASURED
--     that a definer function is still filtered by a forced policy. Forcing it here would harden
--     NOTHING and would MAKE EVERY LOGIN FAIL. A single `deny_all` policy, `USING (false) WITH CHECK
--     (false)`. **NO GRANT TO app_rw ON THIS TABLE.** Not SELECT, not anything — two independent
--     mechanisms, same as 0020: an ABSENT PRIVILEGE, and a policy that is false for the one role
--     that is not the owner. The catalog gate asserts SQLSTATE 42501, never "zero rows".
--
-- ★★★ THE FUNCTIONS LIVE IN SCHEMA `keystone`, NOT `keystone_auth`, AND THE TABLE STAYS WHERE IT IS
--     [K1-8-2, and CONTRACTS §4's head rule, which three planners filed independently — Stage 6
--     X6-2, Stage 7 CCR-3 and this plan's own CCR-5]. `db/gates/catalog-conformance.mjs` scans
--     `WHERE n.nspname = 'keystone' AND p.prosecdef`, so a definer created in `keystone_auth` is
--     INVISIBLE to the gate — built and policed by nothing. `keystone.resolve_session` (0020:221)
--     is the idiom: schema `keystone`, `SET search_path = ''`, owner `auth_owner`, REVOKE FROM
--     PUBLIC, GRANT EXECUTE TO app_rw, app_owner. Every object reference inside is schema-qualified,
--     which an empty search_path requires.
--
-- ★★★ `outcome` IS A smallint, NOT text (keystone.redeem_email_code). This function joins
--     `CREDENTIAL_RESOLVERS` (task 8.21), and `catalog-conformance.mjs` refuses
--     `text|bytea|jsonb|json|varchar|char|name` anywhere in a credential resolver's result —
--     "NOTHING BUT IDENTIFIERS CAN TRAVEL BACK". A `text` outcome is a shape in which a hash or an
--     address could one day travel, and the gate is right to refuse it.
--     ★ THE MAPPING IS FIXED AND IS THE CONTRACT (CCR-10):
--         0 = ok · 1 = no_code · 2 = expired · 3 = too_many · 4 = wrong
--     `src/auth/emailCode.mjs` (8.7) turns it back into a word; the database never carries the word.
-- ★★ A WRONG TRY INCREMENTS BEFORE IT ANSWERS, in one statement, so a race cannot buy a free guess.
--
-- ★ The code is 6 digits. It is HMAC-SHA256'd with KEYSTONE_TOKEN_PEPPER exactly as a session
--   secret is (src/auth/session.mjs:50) — same idiom, not a second one. 32 bytes, always.
--
-- ★ Both new functions are owned by `auth_owner` via an explicit `ALTER FUNCTION … OWNER TO
--   auth_owner` — `catalog-conformance.mjs` fails a credential resolver owned by anyone else, and
--   0008:8-16's reason is quoted there: an `app_owner`-owned definer is still filtered by FORCE. The
--   `ALTER … OWNER TO` lines are explicit rather than relying on the runner's role, because the
--   runner's role for schema `keystone` is `app_owner`, not `auth_owner`. `app_owner` is a member of
--   `auth_owner` (scripts/bootstrap-roles.mjs), which is what permits the ALTER at all.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★★ FIX [MEASURED 22 Sep 2026]: this file ran the CREATE TABLE as `app_owner`, which — per 0199's
--    own finding, same session — "holds no USAGE on schema keystone_auth at all". The CREATE TABLE
--    itself failed with "permission denied for schema keystone_auth" before the ALTER TABLE …
--    OWNER TO auth_owner below ever ran (that statement only re-owns a table that already exists).
--    Restructured to the 0020/0184/0199 `SET LOCAL ROLE auth_owner` preamble the build-time comment
--    below says it deliberately avoided — auth_owner owns schema keystone_auth and can create there.
SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.email_code (
  id            uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  firebase_uid  text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('verify_email','sign_in','recover')),
  -- The code is 6 digits. It is HMAC-SHA256'd with KEYSTONE_TOKEN_PEPPER exactly as a session
  -- secret is (src/auth/session.mjs:50) — same idiom, not a second one. 32 bytes, always.
  code_hash     bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  expires_at    timestamptz NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  smallint NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_code_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX email_code_live_idx ON keystone_auth.email_code (firebase_uid, purpose)
  WHERE consumed_at IS NULL;
CREATE INDEX email_code_expiry_idx ON keystone_auth.email_code (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE keystone_auth.email_code ENABLE ROW LEVEL SECURITY;
-- Same stance as keystone_auth.session (0020:167-181): ENABLE, deny-all, NOT FORCE, NO app_rw grant.
CREATE POLICY deny_all ON keystone_auth.email_code USING (false) WITH CHECK (false);

-- ★★★ BUILD-TIME CORRECTION (not in the plan's literal field-6 SQL — added here, reported with the
--     build). Without this the table stays owned by the migration runner (app_owner), NOT
--     auth_owner. 0020:60-62, verbatim: "every table here must be owned by auth_owner so that the
--     deny_all policy (which does not apply to the owner, since the tables are not FORCEd) leaves
--     exactly one role able to read them — the one the definer functions run as." The two functions
--     below are explicitly re-owned to auth_owner (field 6's own `ALTER FUNCTION … OWNER TO
--     auth_owner`), but a SECURITY DEFINER function's owner bypassing RLS depends on that SAME role
--     being the TABLE's owner too — auth_owner is not exempt from deny_all as a non-owner role.
--     Left as app_owner, `keystone.issue_email_code`'s INSERT would fail every call with "new row
--     violates row-level security policy", and `keystone.redeem_email_code`'s SELECT would silently
--     see zero rows always (outcome 1, no_code, forever) — the exact silent-guard failure mode this
--     project has shipped before. Fixed here with the same explicit-ALTER idiom the plan already
--     chose for the functions — since fixed above by adopting that same preamble, which makes this
--     line a no-op (the table is already owned by auth_owner) kept only as a harmless assertion.
ALTER TABLE keystone_auth.email_code OWNER TO auth_owner;

COMMENT ON TABLE keystone_auth.email_code IS
  'CT-056 / Stage 8 task 8.2 — a hashed 6-digit sign-in/verify/recover code, with its own attempt counter. ENABLE but not FORCE, deny_all policy, no app_rw grant — reached only through keystone.issue_email_code / keystone.redeem_email_code. Shape copied from keystone_auth.session (0020).';

-- ★★ FIX, CONTINUED: role stays `auth_owner` through the functions below too — `\dn+ keystone` shows
--    `auth_owner=UC/app_owner`, i.e. auth_owner already holds CREATE on schema keystone as well as
--    keystone_auth, so there is no need to switch back before CREATE FUNCTION. Switching back to
--    app_owner here (tried first) broke `check_function_bodies` validation of the LANGUAGE SQL
--    function below, which references keystone_auth.email_code directly — the creating role couldn't
--    see the table it names. Handed back to app_owner once, at the very end of the file (F482).

CREATE FUNCTION keystone.issue_email_code(
  p_firebase_uid text, p_purpose text, p_code_hash bytea, p_ttl interval
) RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH spent AS (
    UPDATE keystone_auth.email_code SET consumed_at = now()
     WHERE firebase_uid = p_firebase_uid AND purpose = p_purpose AND consumed_at IS NULL
  )
  INSERT INTO keystone_auth.email_code (firebase_uid, purpose, code_hash, expires_at)
  VALUES (p_firebase_uid, p_purpose, p_code_hash, now() + p_ttl)
  RETURNING id, expires_at;
$$;

CREATE FUNCTION keystone.redeem_email_code(
  p_firebase_uid text, p_purpose text, p_code_hash bytea
) RETURNS TABLE (outcome smallint, attempts_left smallint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r keystone_auth.email_code%ROWTYPE;
BEGIN
  SELECT * INTO r FROM keystone_auth.email_code
   WHERE firebase_uid = p_firebase_uid AND purpose = p_purpose AND consumed_at IS NULL
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 1::smallint, 0::smallint; RETURN; END IF;
  IF r.expires_at <= now() THEN
    UPDATE keystone_auth.email_code SET consumed_at = now() WHERE id = r.id;
    RETURN QUERY SELECT 2::smallint, 0::smallint; RETURN;
  END IF;
  IF r.attempts >= r.max_attempts THEN
    UPDATE keystone_auth.email_code SET consumed_at = now() WHERE id = r.id;
    RETURN QUERY SELECT 3::smallint, 0::smallint; RETURN;
  END IF;
  IF r.code_hash = p_code_hash THEN
    UPDATE keystone_auth.email_code SET consumed_at = now() WHERE id = r.id;
    RETURN QUERY SELECT 0::smallint, (r.max_attempts - r.attempts)::smallint; RETURN;
  END IF;
  UPDATE keystone_auth.email_code SET attempts = attempts + 1 WHERE id = r.id;
  RETURN QUERY SELECT 4::smallint, (r.max_attempts - r.attempts - 1)::smallint;
END $$;

ALTER FUNCTION keystone.issue_email_code(text,text,bytea,interval) OWNER TO auth_owner;
ALTER FUNCTION keystone.redeem_email_code(text,text,bytea)          OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.issue_email_code(text,text,bytea,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.redeem_email_code(text,text,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.issue_email_code(text,text,bytea,interval) TO app_rw, app_owner;
GRANT EXECUTE ON FUNCTION keystone.redeem_email_code(text,text,bytea) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.issue_email_code(text,text,bytea,interval) IS
  'CT-056 — issues a fresh code for (firebase_uid, purpose), consuming any prior live code for the same pair first (so only one code is ever live). Returns the new row''s id and expires_at. First caller: src/auth/emailCode.mjs (8.7).';

COMMENT ON FUNCTION keystone.redeem_email_code(text,text,bytea) IS
  'CT-056 / CCR-10 — checks p_code_hash against the most recent live code for (firebase_uid, purpose). Returns a smallint outcome: 0=ok, 1=no_code, 2=expired, 3=too_many, 4=wrong (this mapping is the contract, asserted by test/e8_2_email_code_table.test.mjs). A wrong try increments attempts and answers in the same statement, so a race cannot buy a free guess. First caller: src/auth/emailCode.mjs (8.7).';

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS — a REVOKE that degraded
--    to a warning, or a grant that never landed, applies "cleanly" and leaves either a function
--    nobody can call or one PUBLIC can call.
DO $$
DECLARE
  v_owner_issue  text;
  v_owner_redeem text;
  v_result_redeem text;
  v_table_owner  text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_table_owner
    FROM pg_class WHERE oid = 'keystone_auth.email_code'::regclass;
  IF v_table_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone_auth.email_code is owned by %, must be auth_owner — otherwise the deny_all policy blocks the SECURITY DEFINER functions'' own writes (0020:60-62)', v_table_owner;
  END IF;

  SELECT pg_get_userbyid(proowner) INTO v_owner_issue
    FROM pg_proc WHERE oid = 'keystone.issue_email_code(text,text,bytea,interval)'::regprocedure;
  IF v_owner_issue IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone.issue_email_code is owned by %, must be auth_owner', v_owner_issue;
  END IF;

  SELECT pg_get_userbyid(proowner), pg_get_function_result(oid) INTO v_owner_redeem, v_result_redeem
    FROM pg_proc WHERE oid = 'keystone.redeem_email_code(text,text,bytea)'::regprocedure;
  IF v_owner_redeem IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone.redeem_email_code is owned by %, must be auth_owner', v_owner_redeem;
  END IF;
  IF v_result_redeem ~* '\y(text|bytea|json|jsonb|varchar|char|name)\y' THEN
    RAISE EXCEPTION 'keystone.redeem_email_code result type (%) carries a forbidden type — outcome must be smallint, never text', v_result_redeem;
  END IF;

  IF NOT has_function_privilege('app_rw', 'keystone.issue_email_code(text,text,bytea,interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE keystone.issue_email_code';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.redeem_email_code(text,text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE keystone.redeem_email_code';
  END IF;
  IF has_function_privilege('public', 'keystone.issue_email_code(text,text,bytea,interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE keystone.issue_email_code — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
  IF has_function_privilege('public', 'keystone.redeem_email_code(text,text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE keystone.redeem_email_code — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.email_code', 'SELECT') THEN
    RAISE EXCEPTION 'app_rw can SELECT keystone_auth.email_code — this table must be reached only through the definer resolvers';
  END IF;
END $$;

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly, at the very end. NEVER RESET ROLE.
