-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P2 CLOSE (§VISUAL) — AN ARCHIVED PERSON COULD STILL LOG IN, AND KEPT THE SESSION THEY HAD.
--
-- ★★★ [MEASURED, local, today] the login lookup by `firebase_uid` for an ARCHIVED person returned
--     **1 row** — "Departed Client". Neither layer had an archive predicate:
--       · `keystone.resolve_tenants_by_firebase_uid` — matched on uid and `t.status = 'active'`
--       · `src/auth/login.mjs` — `SELECT ... FROM keystone.app_user WHERE firebase_uid = $1`
--     So a departed client, a dismissed coach, or a person archived BY MISTAKE could sign straight
--     back in, and every surface treated them as current.
--
-- ★★ AND ARCHIVING DID NOT END THE SESSION THEY ALREADY HELD. `revokeSessionsForUid` has existed
--    since P0.7 and is called from exactly two places — a tenant switch and an explicit logout.
--    `archiveRecord` called neither. **Retiring somebody was a change to what lists show, not to
--    what they can reach**, which is the opposite of what an operator archiving a person believes
--    they are doing.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RULING — AND IT IS THE MIRROR OF 0095, NOT A CONTRADICTION OF IT.
--
--   0095 removed an archive test from an RLS policy on the grounds that **a policy answers who may
--   see a row, not whether the row is current.** This migration ADDS an archive test to an
--   AUTHENTICATION resolver. Both follow from the same distinction:
--     · `document_is_visible` decides whether a VIEWER may read a RECORD — currency is not its
--       question, and asking it there made archiving impossible.
--     · `resolve_tenants_by_firebase_uid` decides whether a PERSON IS STILL A MEMBER OF THIS
--       PRACTICE — currency is the ONLY question it asks. An archived person is not.
--   ★ Stated as one rule: **archival hides a record from lists; it REVOKES a person.** The two
--     directions are different because a document is a thing the practice keeps and a person is
--     somebody who can act.
--
-- ★ THE STATUS GATE ALREADY HERE IS THE PRECEDENT, IN ITS OWN WORDS: *"Disabling a tenant must log
--   its people out of it, and that cannot depend on which resolver the login path happens to call."*
--   Archiving a person is the same sentence one level down.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★★★ THIS FUNCTION IS OWNED BY `auth_owner`, NOT `app_owner`, AND THAT SEPARATION IS DELIBERATE:
--     the role that owns the application's tables cannot silently rewrite authentication.
--     [EXECUTED] running this migration without the SET ROLE below fails with
--       FATAL: must be owner of function resolve_tenants_by_firebase_uid
--   ★★ `app_owner` IS a member of `auth_owner` (pg_has_role → t), so the crossing is permitted — but
--      it is written here EXPLICITLY, for one statement, and reset immediately. A migration that
--      changes an auth object should have to say so in its own text.
--   ★ RESET, not `SET ROLE app_owner`: the runner set app_owner before this file and RESET returns
--     to exactly that, rather than re-asserting a role this file should not be naming twice.
SET ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.resolve_tenants_by_firebase_uid(p_uid text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id
    FROM keystone.app_user u
    JOIN keystone.tenant  t ON t.id = u.tenant_id
   WHERE u.firebase_uid = p_uid
     AND p_uid IS NOT NULL
     AND p_uid <> ''
     -- ★★ THE SAME STATUS GATE AS resolve_tenant_by_slug. Disabling a tenant must log its people
     --    out of it, and that cannot depend on which resolver the login path happens to call.
     AND t.status = 'active'
     -- ★★★ AND THE SAME SENTENCE ONE LEVEL DOWN: archiving a PERSON must log that person out, and
     --     that cannot depend on which resolver the login path happens to call either.
     AND u.archived_at IS NULL
   ORDER BY t.id
$$;

COMMENT ON FUNCTION keystone.resolve_tenants_by_firebase_uid(text) IS
  'Login-time membership resolution. ★★★ Refuses a person whose archived_at is set: archival hides '
  'a RECORD from lists but REVOKES a PERSON, because a person is somebody who can act. Compare '
  'document_is_visible (0095), which deliberately does NOT test archived_at — a visibility policy '
  'answers who may see a row, never whether the row is current.';

RESET ROLE;
