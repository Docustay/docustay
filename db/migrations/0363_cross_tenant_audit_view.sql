-- 0363_cross_tenant_audit_view
-- Platform operators' cross-tenant audit trail reader.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ OPERATOR-ONLY ENFORCED IN SQL, NOT THE ROUTE. A SECURITY DEFINER function that unions
--     audit events from both keystone.audit_entry (per-tenant) and
--     keystone_auth.operator_audit_entry (platform-wide), gated on keystone.caller_is_platform()
--     so that any caller who is not a platform operator sees zero rows, regardless of whether the
--     route itself remembers to check.
--
-- ★★ The two tables are normalized to a common shape:
--    - keystone.audit_entry: multi-tenant, includes tenant_id, actor_user_id and actor_operator_uid
--    - keystone_auth.operator_audit_entry: platform-wide, no tenant_id, only actor_operator_grant_id
--    Both carry id, at, actor_operator_grant_id, action, object, subject_id, reason, request_id.
--    The union uses NULL for tenant_id on operator_audit_entry rows (platform-scoped, not
--    tenant-scoped) and NULL for actor_user_id on those same rows (only operators, never users).
--
-- ★★ The route's own permission check (authoriseSection + callerIsPlatform in platform.mjs) is
--    a secondary defense; the database gate is the primary one and does all the work.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.platform_list_audit_events()
RETURNS TABLE (
  id                      uuid,
  tenant_id               uuid,
  at                      timestamptz,
  actor_user_id           uuid,
  actor_operator_uid      text,
  actor_operator_grant_id uuid,
  action                  text,
  object                  text,
  subject_id              uuid,
  before                  jsonb,
  after                   jsonb,
  reason                  text,
  request_id              text,
  event_type              text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    ae.id,
    ae.tenant_id,
    ae.at,
    ae.actor_user_id,
    ae.actor_operator_uid,
    ae.actor_operator_grant_id,
    ae.action,
    ae.object,
    ae.subject_id,
    ae.before,
    ae.after,
    ae.reason,
    ae.request_id,
    'tenant_audit'::text AS event_type
  FROM keystone.audit_entry ae
  WHERE keystone.caller_is_platform()
  UNION ALL
  SELECT
    oae.id,
    NULL::uuid AS tenant_id,
    oae.at,
    NULL::uuid AS actor_user_id,
    NULL::text AS actor_operator_uid,
    oae.actor_operator_grant_id,
    oae.action,
    oae.object,
    oae.subject_id,
    NULL::jsonb AS before,
    NULL::jsonb AS after,
    oae.reason,
    oae.request_id,
    'operator_audit'::text AS event_type
  FROM keystone_auth.operator_audit_entry oae
  WHERE keystone.caller_is_platform()
  ORDER BY at DESC
$$;

-- ★ NO direct GRANT to anyone: this function is reached only through named callers (the route),
--   never by application code directly selecting from it.
REVOKE ALL ON FUNCTION keystone.platform_list_audit_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.platform_list_audit_events() TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.platform_list_audit_events() IS
  'Platform-only cross-tenant audit trail reader. Returns all keystone.audit_entry rows from every
   tenant UNION with keystone_auth.operator_audit_entry rows (platform-wide operator actions), but
   ONLY if the caller is a platform operator (keystone.caller_is_platform() = true). Non-platform
   callers receive zero rows. event_type distinguishes the source (tenant_audit vs operator_audit);
   before/after/actor_user_id/actor_operator_uid are NULL for operator_audit rows.';

-- ★★ PROVE THE FUNCTION EXISTS AND IS CORRECTLY CONFIGURED (same pattern as platform_list_tenants).
DO $$
DECLARE
  r record;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
         p.proacl IS NULL AS acl_null,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path
    INTO r
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'platform_list_audit_events';

  IF r IS NULL THEN
    RAISE EXCEPTION '0363: keystone.platform_list_audit_events() does not exist';
  END IF;
  IF r.owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0363: keystone.platform_list_audit_events() is owned by %, not auth_owner', r.owner;
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0363: keystone.platform_list_audit_events() is not SECURITY DEFINER';
  END IF;
  IF r.acl_null THEN
    RAISE EXCEPTION '0363: keystone.platform_list_audit_events() has a NULL proacl — that is EXECUTE TO PUBLIC (F482)';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0363: keystone.platform_list_audit_events() has no search_path setting';
  END IF;

  RAISE NOTICE '0363: keystone.platform_list_audit_events() is a well-formed auth_owner SECURITY DEFINER function, gated on caller_is_platform()';
END $$;

SET LOCAL ROLE app_owner;
