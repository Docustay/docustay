-- 0205_code_request_window
-- Stage 8 task 8.2 — CT-056 / spec 04 §5: "the platform limits code requests to 5 per 15 minutes per
-- email and per IP." The window is a TABLE, not the in-process map at src/http/rateLimit.mjs:23
-- (task 8.11's, untouched here), because the limit is per **email address** — a value the
-- in-process map has never held — and because a limiter that resets on every deploy is not a
-- limiter for credential stuffing.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ Same RLS stance as 0204_email_code.sql / keystone_auth.session (0020:164-181): ENABLE, a single
--   deny_all policy, NOT FORCE (FORCE would filter the SECURITY DEFINER function below, owned by
--   auth_owner, and break every code request), and NO GRANT TO app_rw on the table itself.
--
-- ★ `keystone.take_code_request` lives in schema `keystone`, owned by auth_owner, `SET search_path
--   = ''` — the same 0020 idiom `0204_email_code.sql` explains at length (CCR-3, K1-8-2). It is NOT
--   a credential resolver (it resolves no credential and returns a boolean, not an identifier), so
--   it is NOT added to CREDENTIAL_RESOLVERS in db/gates/catalog-conformance.mjs (untouched by this
--   migration — that is task 8.21's file). It is still covered by that gate's empty-search_path
--   rule, which applies to EVERY SECURITY DEFINER function in schema `keystone`, credential resolver
--   or not.
--
-- ★ `scope` is 'email' or 'ip' so ONE table serves both axes of spec 04 §5's limit, keyed
--   (scope, key, window_start). `key` is `lower(email)` for scope 'email' and the textual client IP
--   for scope 'ip' — never a code, never a hash; the CHECK only forbids blank, the caller (8.7)
--   supplies the right value for the scope.
--
-- ★ `window_start` is a FIXED bucket boundary (floor(epoch / window) * window), not a sliding
--   window anchored to the first request — so the primary key doubles as the upsert target
--   (ON CONFLICT (scope, key, window_start)) and a single statement is both the increment and the
--   read of the post-increment count. The DELETE below sweeps rows whose bucket has fully expired,
--   so the table does not grow without bound; it never touches the bucket the statement just wrote.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★★ FIX [MEASURED 22 Sep 2026]: same defect as 0204_email_code.sql, same session — CREATE TABLE ran
--    as app_owner, which holds no USAGE on schema keystone_auth, and failed with "permission denied
--    for schema keystone_auth" before the ALTER TABLE … OWNER TO auth_owner below (which only
--    re-owns a table that already exists) ever ran. `SET LOCAL ROLE auth_owner` stays in effect for
--    both the table AND the function below — auth_owner holds CREATE on schema keystone too
--    (`\dn+ keystone`: `auth_owner=UC/app_owner`), so there is no need to switch roles mid-file.
SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.code_request_window (
  scope         text NOT NULL CHECK (scope IN ('email','ip')),
  -- lower(email) for scope 'email'; the textual address for scope 'ip'. Never a code, never a hash.
  key           text NOT NULL CHECK (btrim(key) <> ''),
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (scope, key, window_start)
);
CREATE INDEX code_request_window_sweep_idx ON keystone_auth.code_request_window (window_start);

ALTER TABLE keystone_auth.code_request_window ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.code_request_window USING (false) WITH CHECK (false);

-- ★★★ BUILD-TIME CORRECTION (not in the plan's literal field-6 SQL — added here, reported with the
--     build; the same fix and the same reason as 0204_email_code.sql's identical comment). Without
--     this the table stays owned by the migration runner (app_owner), not auth_owner, and
--     0020:60-62's rule applies here too: "every table here must be owned by auth_owner so that the
--     deny_all policy … leaves exactly one role able to read them — the one the definer functions
--     run as." Left as app_owner, keystone.take_code_request's INSERT/UPDATE would fail every call
--     with a row-security violation. Filed as a finding (grep FINDINGS.md for "0205").
ALTER TABLE keystone_auth.code_request_window OWNER TO auth_owner;

COMMENT ON TABLE keystone_auth.code_request_window IS
  'CT-056 / spec 04 §5 — 5 code requests per 15 minutes per email and per IP, one row per (scope, key, window_start) fixed bucket. ENABLE but not FORCE, deny_all policy, no app_rw grant — reached only through keystone.take_code_request. Shape copied from keystone_auth.session (0020).';

-- Returns true when the request is ALLOWED, false when the budget is spent. One statement.
CREATE FUNCTION keystone.take_code_request(
  p_scope text, p_key text, p_limit integer, p_window interval
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE w timestamptz := to_timestamp(floor(extract(epoch FROM now())
                                      / extract(epoch FROM p_window))
                                      * extract(epoch FROM p_window));
        c integer;
BEGIN
  INSERT INTO keystone_auth.code_request_window (scope, key, window_start, count)
  VALUES (p_scope, p_key, w, 1)
  ON CONFLICT (scope, key, window_start)
    DO UPDATE SET count = keystone_auth.code_request_window.count + 1
  RETURNING count INTO c;
  DELETE FROM keystone_auth.code_request_window WHERE window_start < w - p_window;
  RETURN c <= p_limit;
END $$;

ALTER FUNCTION keystone.take_code_request(text,text,integer,interval) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.take_code_request(text,text,integer,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.take_code_request(text,text,integer,interval) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.take_code_request(text,text,integer,interval) IS
  'CT-056 / spec 04 §5 — one statement, atomic increment-and-check against a fixed bucket keyed (p_scope, p_key). Returns true when the post-increment count is <= p_limit (the request is allowed), false once the budget for that bucket is spent. Not a credential resolver (returns boolean, resolves nothing) — not in CREDENTIAL_RESOLVERS, still subject to the empty-search_path rule. First caller: src/auth/emailCode.mjs (8.7).';

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS.
DO $$
DECLARE
  v_owner       text;
  v_result      text;
  v_table_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_table_owner
    FROM pg_class WHERE oid = 'keystone_auth.code_request_window'::regclass;
  IF v_table_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone_auth.code_request_window is owned by %, must be auth_owner — otherwise the deny_all policy blocks keystone.take_code_request''s own writes (0020:60-62)', v_table_owner;
  END IF;

  SELECT pg_get_userbyid(proowner), pg_get_function_result(oid) INTO v_owner, v_result
    FROM pg_proc WHERE oid = 'keystone.take_code_request(text,text,integer,interval)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone.take_code_request is owned by %, must be auth_owner', v_owner;
  END IF;
  IF v_result IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'keystone.take_code_request returns %, must be boolean', v_result;
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.take_code_request(text,text,integer,interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE keystone.take_code_request';
  END IF;
  IF has_function_privilege('public', 'keystone.take_code_request(text,text,integer,interval)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE keystone.take_code_request — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.code_request_window', 'SELECT') THEN
    RAISE EXCEPTION 'app_rw can SELECT keystone_auth.code_request_window — this table must be reached only through keystone.take_code_request';
  END IF;
END $$;

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly, at the very end. NEVER RESET ROLE.
