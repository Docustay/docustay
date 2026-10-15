-- 0030_resolve_tenant_by_uid
-- P17.9 — D-17.26. ★★★ TENANCY IS RESOLVED FROM OUR OWN TABLE. A GOOGLE CLAIM CANNOT GRANT IT.
--
-- ★★★ THE MEASUREMENT THAT FORCED THIS. [EXECUTED 2026-09-13] signup created tenant `example`, wrote
-- super_admin_1 with the right firebase_uid, and called setCustomUserClaims({orgId:'example'}). Reading
-- the account back moments later:
--       stored custom claims  →  {"role":"pir","orgId":"_consumer","tenantId":"consumer"}
--       the refreshed token   →  orgId "_consumer"
--     ★★ A THIRD PARTY OVERWROTE OUR CLAIM. Keystone shares the Firebase project `the project secret store`
--        with the LIVE Nexus app, whose `onAuthUserCreate` trigger fires on the account Keystone just
--        created and calls setCustomUserClaims itself — and that API REPLACES the claims object, it
--        does not merge. So `resolve_tenant_by_slug('_consumer')` returned NULL and login answered
--        `invalid credential` about a credential that was perfectly valid.
--     ★ This is not a race that can be won by re-setting the claim afterwards: the other system owns
--       a trigger on the same event and will keep firing. Any design where OUR tenancy lives in a
--       field SOMEONE ELSE writes is broken by construction.
--
-- ★★★ SO THE CLAIM STOPS BEING THE RESOLVER — AND login.mjs ALREADY ARGUED FOR THIS IN ITS OWN
--     COMMENTS (U27): "A Firebase custom claim is GOOGLE'S ASSERTION ABOUT IDENTITY. It is not our
--     statement about who belongs to which practice." It already re-checked the uid→tenant link
--     against `app_user` after resolving. The claim was doing nothing the table could not do better.
--
-- ★★ IS THIS WEAKER? NO, AND THE PRECISE REASON MATTERS. Before: a valid token + an org claim + an
--    active tenant + an `app_user` row for that uid IN that tenant. After: a valid token + an active
--    tenant that CONTAINS an `app_user` row for that uid. The membership row was always the
--    authority; the claim only said where to look. ★ A claim can now never ADMIT anything — at most
--    it narrows among memberships already confirmed (see the multi-tenant note below). That is a
--    strictly smaller grant surface, not a larger one.
--
-- ★★★ RETURNS SETOF, NOT uuid, AND THAT IS THE WHOLE AMBIGUITY DESIGN.
--     [MEASURED] the uniqueness constraint is `UNIQUE (tenant_id, firebase_uid)` — so ONE PERSON MAY
--     LEGITIMATELY HOLD MEMBERSHIPS IN SEVERAL TENANTS (a coach who also runs their own practice).
--     A function returning a scalar would have to pick one, and picking one is precisely the
--     `|| signerByRole.client` failure class CLAUDE.md §2.7 records: one party's credential quietly
--     catching another's branch. ★ So this returns EVERY match and the caller must decide; login
--     refuses on more than one unless the claim names one of them.
--
-- ★ `status = 'active'` is carried over from resolve_tenant_by_slug DELIBERATELY: a suspended or
--   closed tenant must not be loginable, and that property must not be lost by changing resolvers.

CREATE OR REPLACE FUNCTION keystone.resolve_tenants_by_firebase_uid(p_uid text)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = ''
AS $fn$
  SELECT t.id
    FROM keystone.app_user u
    JOIN keystone.tenant  t ON t.id = u.tenant_id
   WHERE u.firebase_uid = p_uid
     AND p_uid IS NOT NULL
     AND p_uid <> ''
     -- ★★ THE SAME STATUS GATE AS resolve_tenant_by_slug. Disabling a tenant must log its people
     --    out of it, and that cannot depend on which resolver the login path happens to call.
     AND t.status = 'active'
   ORDER BY t.id
$fn$;

COMMENT ON FUNCTION keystone.resolve_tenants_by_firebase_uid(text) IS
  'P17.9 / D-17.26. Returns every ACTIVE tenant in which this Firebase uid has an app_user row. '
  'Replaces the Firebase custom claim as the way login finds a tenant, because the claim is written '
  'by a DIFFERENT application sharing the same Firebase project (Nexus onAuthUserCreate) and '
  'setCustomUserClaims REPLACES rather than merges — MEASURED overwriting orgId with "_consumer" and '
  'locking the owner out of the workspace they had just created. Returns a SET, never a scalar: one '
  'person may hold memberships in several tenants and a resolver that picked one would be the '
  'cross-party fallback defect. The caller refuses ambiguity; a claim may narrow, never admit.';

-- ★★★ REVOKE FROM PUBLIC FIRST. Postgres grants EXECUTE on every new function to PUBLIC by default —
--     migration 0029 exists because I shipped exactly that hole one file earlier, and
--     catalog-conformance.mjs caught it. Doing it in the same migration this time.
REVOKE ALL ON FUNCTION keystone.resolve_tenants_by_firebase_uid(text) FROM PUBLIC;

-- ★ `app_rw` is the role behind `withCredentialLookup` (src/db/index.mjs:176), which is the only
--   caller: the lookup runs with NO tenant context, before a session exists.
GRANT EXECUTE ON FUNCTION keystone.resolve_tenants_by_firebase_uid(text) TO app_rw;
