-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0199 — A KEY CARRIES THE RANK OF WHOEVER MINTED IT. (Stage 7 task 7.23.)
--
-- ★★★ WHAT THIS IS FOR. A developer key's effective authority is **the intersection of its scopes
--     and the rank of the person who minted it**, frozen at mint time — never a union. Q5-9 named
--     the rule; nothing in the database carried it. This file adds the column, makes the one write
--     path carry it, opens the only read path that can exist, and adds the predicate that turns a
--     rank into a permission answer.
--
-- ══ THE FOUR MOVING PARTS ═══════════════════════════════════════════════════════════════════════
--   §1  the column          keystone_auth.api_token.rank_ceiling — NOT NULL, closed CHECK
--   §2  the write path      keystone.create_api_token gains a TENTH parameter and refuses a NULL
--   §3  the read path       keystone.api_token_rank_ceiling(text, bytea) — the ONLY one that exists
--   §4  the predicate       keystone.role_may(role_key, object, action) — the non-person user_may
--   §5  the self-check      the shape this file claims is the shape it leaves behind
--
-- ══ ORDERING ═══════════════════════════════════════════════════════════════════════════════════
-- ★ Load-bearing and satisfied at 0199: §1's CHECK is written in the POST-RELABEL vocabulary
--   (Q7-15), so it must land after 0187 (the Owner relabel) and 0189 (`front_desk` gone). It does.
--
-- ══ ROLES — F482, AND IT IS NOT OPTIONAL HERE ══════════════════════════════════════════════════
-- `db/migrate.mjs:301-311` sets `app_owner` before every file and restores it after.
-- `keystone_auth.api_token` and its functions belong to **auth_owner** (0045:39, 0046:33), and
-- **app_owner holds no USAGE on schema keystone_auth at all** — so §1, §2 and §3 run under
-- `SET LOCAL ROLE auth_owner`. §3's REVOKE/GRANT are issued WHILE auth_owner is still set, because
-- `app_owner` is NOINHERIT and cannot grant on an object it does not own. The role is handed back
-- with **`SET ROLE app_owner`, NEVER `RESET ROLE`** (0164:24-27 — `RESET ROLE` lands on the
-- connecting superuser and leaves every later object owned by the wrong role).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §1 · THE COLUMN ──────────────────────────────────────────────────────────────────────────────
-- ★★★ NO ROWS TO BACKFILL: EXECUTED 21 Sep 2026, keystone_auth.api_token holds 0 rows on production.
--     The DEFAULT is kept, not dropped, and it is the LOWEST rank on purpose: a row that somehow
--     arrives without a ceiling gets the least authority, not the most. Fail closed.
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.api_token
  ADD COLUMN rank_ceiling text NOT NULL DEFAULT 'coach'
    CONSTRAINT api_token_rank_ceiling_check CHECK (rank_ceiling IN ('owner','admin','coach'));

COMMENT ON COLUMN keystone_auth.api_token.rank_ceiling IS
  'STAGE-5-PLAN §9.4 item 5 / Q5-9. The rank of the person who minted this key, FROZEN at mint time. '
  'Effective authority is scopes INTERSECT this ceiling, never a union. A key''s rank never rises when '
  'its minter is promoted. Written only by keystone.create_api_token.';

-- ── §2 · THE WRITE PATH CARRIES IT ───────────────────────────────────────────────────────────────
-- ★★★ WHY A PARAMETER AND NOT A LOOKUP — Q7-20, and it is a PRIVILEGE fact, not a preference.
--     This function is owned by auth_owner. auth_owner holds SELECT on keystone.app_user
--     (firebase_uid, tenant_id) ONLY (0031:52) and app_user is FORCE RLS (0001:152), so it cannot
--     read staff_role — and 0124:29-33 REFUSED widening that grant when a route needed one more
--     column. So the ceiling arrives as an argument, exactly as p_created_by already does (0046:47),
--     and the "you cannot name a ceiling above your own" condition is supplied by the APPLICATION at
--     one call site (7.22): the app_user row the request already loaded inside the tenant
--     transaction. ★ THE TENANT IS STILL NEVER A PARAMETER — 0046:54-56's rule is untouched.
DROP FUNCTION keystone.create_api_token(text,text,text,bytea,text,text,text[],uuid,timestamptz);

CREATE FUNCTION keystone.create_api_token(
  p_environment text,
  p_class       text,
  p_token_id    text,
  p_secret_hash bytea,
  p_last_four   text,
  p_name        text,
  p_scopes      text[],
  p_created_by  uuid DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL,
  p_rank_ceiling text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tenant uuid;
  v_id     uuid;
BEGIN
  -- ★★★ THE TENANT COMES FROM THE SESSION, NEVER FROM A PARAMETER. Unchanged from 0046:54-56.
  v_tenant := keystone.current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'create_api_token requires tenant context — call it inside withTenant()'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- ★ NO DEFAULTING TO A RANK. A missing ceiling is a caller defect, and inventing 'coach' here
  --   would hide it behind a key that quietly works for reads. The column's DEFAULT exists for a
  --   row that arrives by some other route; this path must never take it.
  IF p_rank_ceiling IS NULL THEN
    RAISE EXCEPTION 'create_api_token requires a rank ceiling'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  INSERT INTO keystone_auth.api_token
    (tenant_id, environment, class, prefix, token_id, secret_hash,
     last_four, name, scopes, created_by, expires_at, rank_ceiling)
  VALUES
    (v_tenant, p_environment, p_class, 'gl_' || p_environment || '_', p_token_id, p_secret_hash,
     p_last_four, p_name, p_scopes, p_created_by, p_expires_at, p_rank_ceiling)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION keystone.create_api_token(text,text,text,bytea,text,text,text[],uuid,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.create_api_token(text,text,text,bytea,text,text,text[],uuid,timestamptz,text) TO app_rw;

-- ── §3 · READING THE CEILING BACK — THE ONLY PATH THAT EXISTS ────────────────────────────────────
-- ★★★ MEASURED: keystone_auth.api_token is RLS-ENABLED with a deny_all policy (0045:104-105,
--     USING (false) WITH CHECK (false)) and 0045:15 states "NO GRANT TO app_rw ON ANY TABLE".
--     keystone.authorize_api_token returns ONLY the tenant uuid (0171). So there is NO path from a
--     request to rank_ceiling without a definer. This is that path and nothing more.
--   ★★ IT TAKES THE SAME TWO CREDENTIAL ARGUMENTS authorize_api_token TAKES, so holding a key lets
--      you read YOUR OWN ceiling and no other. A function keyed on token_id alone would be an
--      enumeration oracle over every practice's keys.
--   ★ REVOKED AND EXPIRED KEYS ANSWER NULL, which the application treats as a refusal — the same
--     fail-closed answer authorize_api_token gives. There is no second liveness rule to drift.
--   ★ FUNCTION RULE 2: REVOKE ALL FROM PUBLIC then the one GRANT, both issued while auth_owner is
--     still set (app_owner is NOINHERIT and owns nothing in keystone_auth).
CREATE FUNCTION keystone.api_token_rank_ceiling(p_token_id text, p_secret_hash bytea)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.rank_ceiling
    FROM keystone_auth.api_token t
   WHERE t.token_id    = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.revoked_at IS NULL
     AND (t.expires_at IS NULL OR t.expires_at > pg_catalog.now())
$$;

COMMENT ON FUNCTION keystone.api_token_rank_ceiling(text, bytea) IS
  'Task 7.23. Returns the rank_ceiling of the key presenting these credentials, or NULL. The ONLY '
  'read path to that column from a request: keystone_auth.api_token is deny_all under RLS with no '
  'grant to app_rw (0045:104-105, 0045:15). SECURITY DEFINER for that reason alone — it answers '
  'about the CALLER''S OWN key because it requires the secret hash, exactly as '
  'keystone.authorize_api_token does. A revoked or expired key answers NULL, and the application '
  'refuses on NULL (fail closed).';

REVOKE ALL ON FUNCTION keystone.api_token_rank_ceiling(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.api_token_rank_ceiling(text, bytea) TO app_rw;

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly. NEVER `RESET ROLE`.

-- ── §4 · THE CEILING HALF OF THE INTERSECTION — Q7-18 ────────────────────────────────────────────
-- ★★★ keystone.user_may TAKES AN app_user ID AND A KEY HAS NONE: handleApiTokenRequest passes no
--     userId, so keystone.user_id is empty on a key request (src/paths/index.mjs:127-130, MEASURED).
--     This is the same question asked of a ROLE instead of a person.
-- ★★ IT IS A COPY OF NOTHING. The verb ladder below is 0192:58-59 (7.10's pinned user_may) character
--    for character, and the function is INVOKER security exactly as user_may is — app_rw holds SELECT
--    on keystone.role and keystone.role_permission (0066:239-240) and on keystone.role_action
--    (0190:99), and their RLS is already tenant-scoped, so no new privilege and no new policy is
--    created by this file.
-- ★★★ TWO BRANCHES, BECAUSE 7.1's INVENTORY HAS TWO KINDS OF ACTION. [MEASURED against WRITE_ROUTES]
--     37 of the 49 declared write routes name a LADDER VERB (view/edit/delete on an object); the
--     other 12 name a NAMED ACTION — document.sign, document.execute, template.author,
--     person.create, record.archive, record.restore. A single role_permission branch answers FALSE
--     for all 12, and every one of those routes would be refused to every key forever — which reads
--     as "the ceiling works" and is really "the question was unanswerable".
--   ★★ THE NAMED-ACTION MECHANISM IS NOT INVENTED HERE. keystone.role_action (0190:60-84, CT-092,
--      13 names, 28 seeded rows) is the canonical home for scopeless actions; role_permission
--      carries a coherence CHECK on (object, verb, scope) that a scopeless action cannot satisfy
--      (0066:110). This function READS role_action; it does not redefine it.
--   ★ NO RAISE FOR AN UNKNOWN ACTION. db/gates/s7_every_route_declares_a_permission.mjs:129-130
--     already fails any route whose `action` is not view/edit/delete nor a member of ROUTE_ACTIONS
--     (the same 13 names). The loudness belongs in the gate, before a request exists — F294's
--     lesson applied where it pays, not duplicated where it cannot fire.
CREATE FUNCTION keystone.role_may(p_role_key text, p_object text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  -- ── THE NAMED-ACTION BRANCH ────────────────────────────────────────────────────────────────────
  IF NOT (p_action = ANY (ARRAY['view','edit','delete'])) THEN
    RETURN EXISTS (
      SELECT 1
        FROM keystone.role r
        JOIN keystone.role_action ra
          ON ra.role_id = r.id AND ra.tenant_id = r.tenant_id
       WHERE r.key     = p_role_key
         AND ra.action = p_action
    );
  END IF;

  -- ── THE LADDER BRANCH ─────────────────────────────────────────────────────────────────────────
  -- ★★★ A typo in p_object must not read as "no permission granted" (F294, 0192:37-41). Here the
  --     object is supplied by 7.1's route table, not by a request, so a raise is a BUILD-time
  --     signal — exactly what it is in user_may.
  IF p_object IS NULL
     OR NOT EXISTS (SELECT 1 FROM keystone.permission_object o WHERE o.key = p_object) THEN
    RAISE EXCEPTION '"%" is not a permission object', p_object USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM keystone.role r
      JOIN keystone.role_permission rp
        ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
     WHERE r.key     = p_role_key
       AND rp.object = p_object
       -- The verb ladder: `delete` implies `edit` implies `view`. 0192:58-59, character for character.
       AND array_position(ARRAY['none','view','edit','delete'], rp.verb)
           >= array_position(ARRAY['none','view','edit','delete'], p_action)
       -- ★★★ 'everything' ONLY. A key owns no rows, so an 'owned' or 'team' grant is worth nothing
       --     to it. This single predicate IS "scopes INTERSECT ceiling, never a union".
       AND rp.scope = 'everything'
  );
END;
$$;

COMMENT ON FUNCTION keystone.role_may(text, text, text) IS
  'Q7-18, task 7.23. May a key carrying this ROLE KEY as its rank_ceiling do this to any row in the '
  'practice? The non-person twin of keystone.user_may. TWO BRANCHES because 7.1 declares two kinds '
  'of action: a ladder verb (view/edit/delete) is answered from role_permission at '
  'scope = ''everything'' only — a key owns nothing, so an owned/team grant gives it nothing — and a '
  'NAMED action (document.sign, person.create, record.archive, … the 13 of CT-092) is answered from '
  'keystone.role_action. Tenant scoping comes from RLS on keystone.role, role_permission and '
  'role_action, the same way user_may gets it: there is no p_tenant_id to get wrong. NOT SECURITY '
  'DEFINER (Q7-18) — it runs as the caller so RLS is what scopes it.';

-- ── §5 · SELF-CHECK — the shape this file claims is the shape it left behind ──────────────────────
DO $key_ceiling_check$
DECLARE
  v_raised boolean := false;
  v_n      int;
  v_args   text;
BEGIN
  -- (1) the column exists, is NOT NULL, and its CHECK is the post-relabel vocabulary (Q7-15).
  -- ★★ FIX [MEASURED 22 Sep 2026]: `information_schema.columns` applies `has_column_privilege` and
  --    by this point the role is back to `app_owner` (line 134), which "holds no USAGE on schema
  --    keystone_auth at all" (line 24) — so the view shows app_owner ZERO rows for this column,
  --    regardless of whether it exists. Isolated repro: adding a probe column under auth_owner then
  --    querying as app_owner returns 0 via information_schema.columns and 1 via pg_attribute in the
  --    same transaction. `pg_catalog.pg_attribute` is a raw catalog table with no privilege filter —
  --    same choice §b's comment (line 45-48) already made for the index shape-check, for the same
  --    reason.
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone_auth' AND c.relname = 'api_token'
     AND a.attname = 'rank_ceiling' AND a.attnotnull AND NOT a.attisdropped;
  IF v_n <> 1 THEN RAISE EXCEPTION '0199: rank_ceiling missing or nullable'; END IF;

  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conname = 'api_token_rank_ceiling_check'
     AND pg_get_constraintdef(oid) LIKE '%''owner''%''admin''%''coach''%';
  IF v_n <> 1 THEN RAISE EXCEPTION '0199: the ceiling CHECK is not the three post-relabel ranks'; END IF;

  -- (2) create_api_token takes TEN arguments and the nine-argument form is gone.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'keystone' AND p.proname = 'create_api_token';
  IF v_n <> 1 THEN RAISE EXCEPTION '0199: expected exactly one create_api_token, found %', v_n; END IF;

  -- ★★ FIX [MEASURED 22 Sep 2026]: `pg_get_function_identity_arguments` returns "name type" pairs
  --    ("p_expires_at timestamp with time zone, p_rank_ceiling text"), not bare comma-joined types —
  --    the pattern assumed the latter and never matched. Checked against the actual last-parameter
  --    name and type instead of guessing at the separator.
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'keystone' AND p.proname = 'create_api_token';
  IF v_args NOT LIKE '%p_expires_at timestamp with time zone, p_rank_ceiling text' THEN
    RAISE EXCEPTION '0199: create_api_token does not end in the rank-ceiling parameter (got %)', v_args;
  END IF;

  -- (3) the reader is DEFINER and the predicate is INVOKER — the two halves of Q7-18 and the F593
  --     ruling's sub-ruling (d), asserted so a later "tidy-up" cannot swap them.
  IF NOT (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'keystone' AND p.proname = 'api_token_rank_ceiling') THEN
    RAISE EXCEPTION '0199: api_token_rank_ceiling must be SECURITY DEFINER';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'keystone' AND p.proname = 'role_may') THEN
    RAISE EXCEPTION '0199: role_may must be INVOKER (Q7-18) so RLS scopes it';
  END IF;

  -- (4) the definer is not executable by PUBLIC (FUNCTION RULE 2), and app_rw can call it.
  IF has_function_privilege('public', 'keystone.api_token_rank_ceiling(text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION '0199: api_token_rank_ceiling is EXECUTE to PUBLIC';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.api_token_rank_ceiling(text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION '0199: app_rw cannot execute api_token_rank_ceiling';
  END IF;

  -- (5) BOTH branches answer, and neither answers TRUE for a role that does not exist.
  --     ★ This runs as app_owner with no tenant GUC, so RLS shows this block no role rows at all —
  --       which is exactly why the assertions here are the FALSE direction and the shape checks.
  --       The TRUE direction is asserted from a real request in test/s7_api_key_principal.test.mjs
  --       legs (a), (c) and (i), where a tenant context exists. A "true" assertion here would be
  --       the F143/F490 trap: a migration cannot see the rows it is asking about.
  IF keystone.role_may('__no_such_role__', 'invoice', 'edit') THEN
    RAISE EXCEPTION '0199: role_may answered true for a role that does not exist (ladder branch)';
  END IF;
  IF keystone.role_may('__no_such_role__', NULL, 'person.create') THEN
    RAISE EXCEPTION '0199: role_may answered true for a role that does not exist (named-action branch)';
  END IF;

  -- (6) the ladder branch still raises on a misspelled object.
  BEGIN
    PERFORM keystone.role_may('owner', 'invoyce', 'edit');
  EXCEPTION WHEN invalid_parameter_value THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION '0199: a misspelled object did not raise'; END IF;

  -- (7) the named-action branch does NOT raise on an object it never reads — the whole point of
  --     branching before the object check.
  PERFORM keystone.role_may('owner', NULL, 'record.archive');

  RAISE NOTICE '0199 self-check passed: column, ten-argument minter, definer reader, invoker predicate, both branches.';
END
$key_ceiling_check$;
