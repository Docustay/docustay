-- 0700 · ATTEMPT LIMITS THAT FOLLOW THE ACCOUNT, NOT THE CODE OR THE ADDRESS (security audit run 5, 10 Oct 2026: S-3 and S-10).
--
--   S-3  POST /api/auth/two-step/verify had no per-account counter: 6 digits, 3 accepted steps, only the shared per-IP bucket in front of it, so a
--        first-factor-compromised account lost its second factor to a slow, wide brute force.
--   S-10 Sign-in by code: 5 tries per CODE and 5 code requests per 15 minutes meant a fresh code every few minutes reset the guess budget (25 guesses per
--        15 minutes per target, forever), and every request mailed the person being targeted.
--
-- ONE small table and TWO functions serve every case, keyed (scope, key):
--     scope 'two_step'          key = the identity (firebase uid)   — wrong second-factor codes, across every sign-in attempt and every partial session
--     scope 'two_step_session'  key = sha256 of the partial session — wrong codes inside ONE partial session (the application kills the session when refused)
--     scope 'email_code'        key = the identity (firebase uid)   — wrong sign-in-by-code guesses, ACROSS codes (the per-code counter in 0204 stays)
--     scope 'email_request'     key = the lower-cased address       — code requests, with exponential back-off (the 5-per-15-minutes bucket in 0205 stays)
--
-- keystone.auth_attempt_take is called BEFORE the check it limits, and counts the attempt in the same statement that decides it, so a burst of parallel
-- guesses cannot buy free ones (the row is locked for the decision; same idea as 0204's redeem_email_code, which increments before it answers):
--     0        the attempt is allowed (and has been counted)
--     N > 0    refused: locked for another N seconds. Refused attempts are NOT counted, so hammering a locked account does not lengthen the lock.
--   After `p_free` allowed attempts the account locks for `p_lock`; when the lock runs out exactly ONE more attempt is allowed and, if it is not cleared, the
--   lock returns, doubled each time up to `p_cap`. A quiet spell of `p_window` since the last counted attempt forgives everything. A success calls
--   keystone.auth_attempt_clear.
--
-- Same shape as 0204/0205 and the 0695/0699 pattern: the table belongs to auth_owner, row-level security is ENABLEd with a deny-all policy and NO grant to
-- app_rw, and the only way in is a SECURITY DEFINER function owned by auth_owner with an empty search_path. Additive and idempotent.

SET LOCAL ROLE auth_owner;

CREATE TABLE IF NOT EXISTS keystone_auth.auth_attempt (
  scope         text        NOT NULL CHECK (scope IN ('two_step','two_step_session','email_code','email_request')),
  key           text        NOT NULL CHECK (btrim(key) <> ''),
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  strikes       integer     NOT NULL DEFAULT 0 CHECK (strikes >= 0),
  locked_until  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS auth_attempt_sweep_idx ON keystone_auth.auth_attempt (updated_at);

ALTER TABLE keystone_auth.auth_attempt ENABLE ROW LEVEL SECURITY;
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'keystone_auth' AND tablename = 'auth_attempt' AND policyname = 'deny_all') THEN
    CREATE POLICY deny_all ON keystone_auth.auth_attempt USING (false) WITH CHECK (false);
  END IF;
END
$policy$;
ALTER TABLE keystone_auth.auth_attempt OWNER TO auth_owner;

COMMENT ON TABLE keystone_auth.auth_attempt IS
  'Security audit run 5 (S-3, S-10) — cumulative attempt counters per identity / partial session / address, with a lock. ENABLE but not FORCE, deny_all policy, no app_rw grant — reached only through keystone.auth_attempt_take / auth_attempt_clear. Shape copied from keystone_auth.email_code (0204).';

CREATE OR REPLACE FUNCTION keystone.auth_attempt_take(
  p_scope text, p_key text, p_free integer, p_lock interval, p_cap interval, p_window interval
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  r      keystone_auth.auth_attempt%ROWTYPE;
  v_att  integer;
  v_str  integer;
  v_for  interval;
BEGIN
  IF p_free IS NULL OR p_free < 1 THEN RAISE EXCEPTION 'auth_attempt_take: p_free must be at least 1'; END IF;
  IF p_lock IS NULL OR p_lock <= interval '0' OR p_cap IS NULL OR p_cap < p_lock OR p_window IS NULL OR p_window <= interval '0' THEN
    RAISE EXCEPTION 'auth_attempt_take: p_lock, p_cap and p_window must be positive and p_cap >= p_lock';
  END IF;

  INSERT INTO keystone_auth.auth_attempt (scope, key) VALUES (p_scope, p_key) ON CONFLICT (scope, key) DO NOTHING;
  SELECT * INTO r FROM keystone_auth.auth_attempt WHERE scope = p_scope AND key = p_key FOR UPDATE;   -- the decision below is made holding this row: parallel attempts line up behind it

  -- housekeeping: forget long-quiet rows (never the one in hand)
  DELETE FROM keystone_auth.auth_attempt
   WHERE updated_at < now() - interval '7 days' AND (locked_until IS NULL OR locked_until < now())
     AND NOT (scope = p_scope AND key = p_key);

  IF r.locked_until IS NOT NULL AND r.locked_until > now() THEN
    RETURN GREATEST(1, ceil(extract(epoch FROM (r.locked_until - now())))::integer);    -- refused, and not counted
  END IF;

  v_att := r.attempts; v_str := r.strikes;
  IF r.updated_at < now() - p_window THEN
    v_att := 0; v_str := 0;                                   -- a quiet spell forgives
  ELSIF r.locked_until IS NOT NULL THEN
    v_att := LEAST(v_att, p_free - 1);                        -- a lock that has run out grants exactly one attempt
  END IF;

  v_att := v_att + 1;
  IF v_att >= p_free THEN
    v_str := v_str + 1;
    v_for := LEAST(p_cap, p_lock * power(2, LEAST(v_str - 1, 20)));
    UPDATE keystone_auth.auth_attempt SET attempts = v_att, strikes = v_str, locked_until = now() + v_for, updated_at = now() WHERE scope = p_scope AND key = p_key;
  ELSE
    UPDATE keystone_auth.auth_attempt SET attempts = v_att, strikes = v_str, locked_until = NULL, updated_at = now() WHERE scope = p_scope AND key = p_key;
  END IF;
  RETURN 0;
END
$fn$;

CREATE OR REPLACE FUNCTION keystone.auth_attempt_clear(p_scope text, p_key text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $fn$
  DELETE FROM keystone_auth.auth_attempt WHERE scope = p_scope AND key = p_key;
$fn$;

ALTER FUNCTION keystone.auth_attempt_take(text, text, integer, interval, interval, interval) OWNER TO auth_owner;
ALTER FUNCTION keystone.auth_attempt_clear(text, text) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.auth_attempt_take(text, text, integer, interval, interval, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.auth_attempt_clear(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.auth_attempt_take(text, text, integer, interval, interval, interval) TO app_rw, app_owner;
GRANT EXECUTE ON FUNCTION keystone.auth_attempt_clear(text, text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.auth_attempt_take(text, text, integer, interval, interval, interval) IS
  'Security audit run 5 (S-3, S-10) — counts one attempt for (scope, key) and answers in the same statement: 0 = allowed, N > 0 = locked for N more seconds (refused attempts are not counted). After p_free allowed attempts the lock is p_lock, doubling each time up to p_cap; a quiet p_window forgives. Callers: src/auth/attemptLimit.mjs.';
COMMENT ON FUNCTION keystone.auth_attempt_clear(text, text) IS
  'Security audit run 5 (S-3, S-10) — forgets the counter for (scope, key) after a success. Callers: src/auth/attemptLimit.mjs.';


DO $auth_attempt_self_check$
DECLARE v_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = 'keystone_auth.auth_attempt'::regclass;
  IF v_owner IS DISTINCT FROM 'auth_owner' THEN RAISE EXCEPTION '0700: keystone_auth.auth_attempt is owned by %, must be auth_owner', v_owner; END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'keystone.auth_attempt_take(text,text,integer,interval,interval,interval)'::regprocedure) IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0700: keystone.auth_attempt_take must be owned by auth_owner';
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'keystone.auth_attempt_clear(text,text)'::regprocedure) IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0700: keystone.auth_attempt_clear must be owned by auth_owner';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.auth_attempt_take(text,text,integer,interval,interval,interval)', 'EXECUTE')
     OR NOT has_function_privilege('app_rw', 'keystone.auth_attempt_clear(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0700: app_rw cannot EXECUTE the attempt-limit functions';
  END IF;
  IF has_function_privilege('public', 'keystone.auth_attempt_take(text,text,integer,interval,interval,interval)', 'EXECUTE')
     OR has_function_privilege('public', 'keystone.auth_attempt_clear(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0700: PUBLIC can EXECUTE the attempt-limit functions — the REVOKE degraded to a warning';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.auth_attempt', 'SELECT') THEN
    RAISE EXCEPTION '0700: app_rw can SELECT keystone_auth.auth_attempt — it must be reached only through the definer functions';
  END IF;
END
$auth_attempt_self_check$;

SET LOCAL ROLE app_owner;   -- the self-check above reads the sign-in schema, so it ran as auth_owner; the runner's own role comes back here
