-- 0749 · resolve_session refuses a session whose practice row no longer exists (Run 10 SU-001, e6_02 (e)).
-- 0368 turned the JOIN on keystone.tenant into a LEFT JOIN so a tenant-less OPERATOR session resolves, and wrote the suspended/closed check as
-- `t.id IS NULL OR ...`. That also let a session with a NON-NULL tenant_id that names no practice resolve (t.id IS NULL there too). Only a
-- session with tenant_id IS NULL may skip the practice check. Everything else is 0532's definition, unchanged (owner, SECURITY DEFINER, empty search_path, ACL kept by CREATE OR REPLACE).
SET LOCAL ROLE auth_owner;

CREATE OR REPLACE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid, viewing_as_app_user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
             AND g.approved_at IS NOT NULL
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id,
         CASE WHEN s.viewing_as_expires_at > now() THEN s.viewing_as_app_user_id ELSE NULL END
           AS viewing_as_app_user_id
    FROM keystone_auth.session s
    LEFT JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.kind NOT IN ('partial', 'handoff')
     AND (s.tenant_id IS NULL OR t.id IS NOT NULL)
     AND (t.id IS NULL OR t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

SET LOCAL ROLE app_owner;

DO $$ BEGIN
  IF current_user <> 'app_owner' THEN RAISE EXCEPTION '0749 finished as % — it must hand back to app_owner', current_user; END IF;
  IF (SELECT pg_get_functiondef('keystone.resolve_session(text,bytea)'::regprocedure)) NOT LIKE '%s.tenant_id IS NULL OR t.id IS NOT NULL%' THEN RAISE EXCEPTION '0749: resolve_session was not replaced'; END IF;
END $$;
