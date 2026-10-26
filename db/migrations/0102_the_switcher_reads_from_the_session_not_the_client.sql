-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P5.1 — THE SWITCHER'S READ IS KEYED BY THE SESSION, AND THE CLIENT NEVER HANDLES A uid.
--
-- ★★★ 0101 GAVE US `practices_for_firebase_uid(text)`, WHICH IS THE RIGHT FUNCTION FOR LOGIN —
--     login is the one moment a uid is legitimately in hand. But the SWITCHER runs for an already
--     signed-in person, and `resolveSession()` returns `{tenantId, appUserId}` and NO uid
--     (`src/auth/session.mjs:99`). Two bad ways to bridge that gap, both rejected:
--       · send the uid to the browser so it can pass it back — ★★ a caller-supplied identity is
--         exactly what this system refuses everywhere else, and it would turn a read about
--         YOURSELF into a read about ANYONE whose uid you learned.
--       · let the route look the uid up itself — it cannot. `auth_owner` holds column-level SELECT
--         on (firebase_uid, tenant_id) ONLY (0031), and **Postgres requires SELECT on a column to
--         use it in a WHERE clause**, so filtering by `id` is a privilege it does not have.
--
-- ★★ SO THE SESSION'S OWN COORDINATES ARE THE ARGUMENT. The caller passes what the session row
--    already proved — tenant + app_user — and the uid is resolved INSIDE the definer and never
--    leaves it. There is no argument here an attacker benefits from guessing: knowing another
--    person's app_user_id gets you their practice list ONLY if you also hold a session whose
--    tenant matches, which is the same thing as being them.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.practices_for_session(p_tenant_id uuid, p_app_user_id uuid)
RETURNS TABLE (id uuid, slug text, name text, is_current boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    -- ★ BOTH coordinates must match. Keying on app_user_id alone would let a session in practice A
    --   name a person in practice B and read THEIR memberships — a cross-tenant read through an
    --   argument, which is the shape this project fuzzes for in both directions.
    SELECT u.firebase_uid
      FROM keystone.app_user u
     WHERE u.id = p_app_user_id
       AND u.tenant_id = p_tenant_id
       AND u.firebase_uid IS NOT NULL
  )
  SELECT t.id, t.slug, t.name, (t.id = p_tenant_id) AS is_current
    FROM keystone.app_user u
    JOIN keystone.tenant t ON t.id = u.tenant_id
   WHERE u.firebase_uid = (SELECT firebase_uid FROM me)
     AND t.status = 'active'
   ORDER BY t.name
$$;

REVOKE ALL ON FUNCTION keystone.practices_for_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.practices_for_session(uuid, uuid) TO app_rw;

-- ★★ `is_current` IS COMPUTED HERE RATHER THAN BY THE BROWSER. The switcher has to mark which
--    practice you are in, and the client comparing a slug it was told against a slug it was also
--    told proves nothing. The server knows which tenant the SESSION carries; that is the fact.
-- ★ An identity with no uid (a person created by staff who has never signed in) yields NULL from
--   `me`, and `firebase_uid = NULL` is never true — so it returns zero rows rather than every
--   practice. That is the correct answer and it is why the comparison is `=` against a scalar
--   subquery rather than an IN over a set that could be empty.
COMMENT ON FUNCTION keystone.practices_for_session(uuid, uuid) IS
  'P5.1 — the practices the SIGNED-IN identity belongs to, keyed by the session''s own tenant and '
  'app_user rather than by a client-supplied uid. Resolves the firebase_uid internally so it never '
  'reaches the browser. Both coordinates must match, so a session in one practice cannot name a '
  'person in another and read their memberships. Active practices only, matching login''s gate.';

RESET ROLE;
