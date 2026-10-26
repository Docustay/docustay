-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- S1.3 / F365 — THE PRACTICE SWITCHER SAID "No practice" ON EVERY SCREEN OF THE CRM, AND IT WAS A
-- PERMISSIONS BUG WEARING A LAYOUT BUG'S CLOTHES.
--
-- ★★★ THE DEFECT, MEASURED AGAINST THE DEPLOYED DATABASE:
--   · `keystone.practices_for_session(uuid,uuid)` is owned by `auth_owner` (SECURITY DEFINER, so it
--     runs as that role whoever calls it).
--   · `auth_owner`'s SELECT grant on `keystone.app_user` is **exactly two columns** —
--     `(firebase_uid, tenant_id)`, from 0031:52.
--   · `has_column_privilege('auth_owner','keystone.app_user','id','SELECT')` = **false**
--   · 0102's `me` CTE filters `WHERE u.id = p_app_user_id`.
--   · EXECUTED: the call raises `ERROR: permission denied for table app_user`
--     `CONTEXT: SQL function "practices_for_session" statement 1`
--   So `GET /api/auth/practices` could not succeed for ANY caller, and the switcher rendered its
--   empty state — "No practice" — for a tenant whose name the UNAUTHENTICATED branding endpoint
--   returns correctly. It reads as a layout bug and is a permissions bug.
--
-- ★★★ AND 0102 DIAGNOSED THIS EXACT CONSTRAINT IN ITS OWN HEADER, THEN VIOLATED IT FOUR LINES
--     LATER. Its words: *"`auth_owner` holds column-level SELECT on (firebase_uid, tenant_id) ONLY
--     (0031), and **Postgres requires SELECT on a column to use it in a WHERE clause**, so
--     filtering by `id` is a privilege it does not have."* It wrote that as the reason the ROUTE
--     could not look the uid up — and then had the FUNCTION do the thing it had just described as
--     impossible. ★★ That is worth recording as its own lesson: a correct constraint stated in a
--     comment is not a guard. Nothing executes prose.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FIX, AND IT IS NEITHER OF THE TWO F365 PROPOSED.
--
--   F365 offered (a) `GRANT SELECT (id) ON app_user TO auth_owner` — one line, but it widens the
--   credential path's read and 0031's whole argument is that that path should see as little as
--   possible; and (b) re-key the `me` CTE on `firebase_uid` — right in principle, except the
--   CALLER only has an `app_user_id`, so somebody still has to make that translation and the
--   translation is the privilege.
--
-- ★★★ THERE IS A THIRD OPTION AND IT COSTS NOTHING: **`keystone_auth.session` ALREADY HOLDS BOTH
--     `app_user_id` AND `firebase_uid` ON THE SAME ROW, AND `auth_owner` *OWNS* THAT TABLE.**
--     (0020:107 creates it `SET LOCAL ROLE auth_owner`; `create_session` writes `firebase_uid`
--     into it at login.) So the app_user_id → firebase_uid translation happens entirely inside a
--     table this role owns outright, and `app_user` is then read ONLY through `firebase_uid` and
--     `tenant_id` — the two columns it is granted.
--
--   WHAT THIS COSTS:  no new grant · no signature change · no route change · no plumbing through
--                     the principal · `src/routes/index.mjs:383` is untouched.
--
-- ★★ AND IT IS WHAT THE FUNCTION'S NAME ALREADY CLAIMED. It is called `practices_for_SESSION`.
--    Resolving the identity *from the session table* is not a workaround; it is the function
--    finally doing what it says.
--
-- ★★★ "BOTH COORDINATES MUST MATCH" IS PRESERVED AND IN FACT STRENGTHENED. 0102's security
--     argument was that keying on `app_user_id` alone would let a session in practice A name a
--     person in practice B and read THEIR memberships. Here the pair must match a **LIVE, UNREVOKED,
--     UNEXPIRED SESSION ROW** — so the caller cannot even name a person who has never signed in,
--     let alone one in another practice. The predicate got narrower, not wider.
--
-- ★ THE ZERO-ROW CASE IS UNCHANGED AND STILL CORRECT. A person created by staff who has never
--   signed in has no session, so `me` is empty, `firebase_uid = NULL` is never true, and the
--   function returns zero rows rather than every practice. 0102 documented exactly that behaviour
--   for its own null case; it survives the change.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.practices_for_session(p_tenant_id uuid, p_app_user_id uuid)
RETURNS TABLE (id uuid, slug text, name text, is_current boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    -- ★★★ THE TRANSLATION HAPPENS IN A TABLE `auth_owner` OWNS. No column of `keystone.app_user` is
    --     touched here at all, so the ungranted `id` never appears in a WHERE clause.
    -- ★★ DISTINCT because one person legitimately holds several live sessions — two browsers, a
    --    phone and a laptop. Without it a person with three sessions makes the scalar subquery
    --    below return three rows and the whole call fails with "more than one row returned by a
    --    subquery used as an expression" — which would be this defect replaced by a louder one.
    -- ★ The liveness predicates mirror `resolve_session`'s exactly. They are not decoration: a
    --   REVOKED session must not be able to answer a question about who you are, and 0020's whole
    --   argument for a stateful session is that revocation takes effect in one statement.
    SELECT DISTINCT s.firebase_uid
      FROM keystone_auth.session s
     WHERE s.app_user_id = p_app_user_id
       AND s.tenant_id   = p_tenant_id
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
       AND s.firebase_uid IS NOT NULL
  )
  SELECT t.id, t.slug, t.name, (t.id = p_tenant_id) AS is_current
    FROM keystone.app_user u
    JOIN keystone.tenant t ON t.id = u.tenant_id
   -- ★★ `firebase_uid` and `tenant_id` (via the join) are the two columns 0031 granted. That is the
   --    entire read this function makes against `app_user`, and it is now within its privileges.
   WHERE u.firebase_uid = (SELECT firebase_uid FROM me)
     AND t.status = 'active'
   ORDER BY t.name
$$;

REVOKE ALL ON FUNCTION keystone.practices_for_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.practices_for_session(uuid, uuid) TO app_rw;

COMMENT ON FUNCTION keystone.practices_for_session(uuid, uuid) IS
  'P5.1 / F365 — the practices the SIGNED-IN identity belongs to, keyed by the session''s own '
  'tenant and app_user. Resolves firebase_uid from keystone_auth.session (a table auth_owner owns) '
  'rather than from app_user.id, which auth_owner holds no SELECT on — reading it raised '
  '"permission denied for table app_user" and made the switcher say "No practice" on every screen. '
  'Requires a LIVE session for the pair, so a caller cannot name a person in another practice or '
  'one who has never signed in. Active practices only, matching login''s gate.';

RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE GUARD, AND IT IS A REAL ONE RATHER THAN A COMMENT — WHICH IS THIS MIGRATION'S OWN LESSON
--     APPLIED TO ITSELF. 0102 stated the column-privilege constraint in prose and then broke it.
--     Prose does not execute. This does:
--
--   For every SECURITY DEFINER function owned by `auth_owner` that mentions `app_user`, assert the
--   role actually holds SELECT on every `app_user` column the function names. ★★ Written as a
--   NEGATIVE check with a PAIRED POSITIVE — it fails loudly if the set of definers it examines is
--   EMPTY, because a guard that inspects nothing passes forever.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $guard$
DECLARE
  n_checked int := 0;
BEGIN
  -- ★ The one column this defect turned on. `has_column_privilege` is the same question Postgres
  --   asks at execution time, so this is not a proxy for the check — it IS the check.
  IF has_column_privilege('auth_owner', 'keystone.app_user', 'id', 'SELECT') THEN
    RAISE WARNING
      'auth_owner now holds SELECT on app_user.id. That is NOT required by this fix and widens the '
      'credential path 0031 deliberately narrowed. If something granted it, find out what and why.';
  END IF;

  IF NOT has_column_privilege('auth_owner', 'keystone.app_user', 'firebase_uid', 'SELECT')
     OR NOT has_column_privilege('auth_owner', 'keystone.app_user', 'tenant_id', 'SELECT') THEN
    RAISE EXCEPTION
      'practices_for_session reads app_user.(firebase_uid, tenant_id) and auth_owner is missing '
      'SELECT on at least one of them. The switcher cannot work; see 0031.';
  END IF;

  SELECT count(*) INTO n_checked
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone'
     AND p.prosecdef
     AND pg_get_userbyid(p.proowner) = 'auth_owner'
     AND pg_get_functiondef(p.oid) LIKE '%app_user%';

  -- ★★★ THE PAIRED POSITIVE. If this sweep finds NOTHING it has proven nothing, and a guard that
  --     proves nothing is worse than no guard — it reports success forever. F365 measured FIVE such
  --     definers; anything below that means the query stopped matching what it is meant to match.
  IF n_checked < 5 THEN
    RAISE EXCEPTION
      'expected at least 5 auth_owner SECURITY DEFINER functions reading app_user, found %. '
      'The sweep is not matching what it is meant to match — fix the sweep, not this number.',
      n_checked;
  END IF;

  RAISE NOTICE 'F365 guard: % auth_owner definers read app_user; column grants intact.', n_checked;
END
$guard$;
