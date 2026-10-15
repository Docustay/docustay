-- 0173_session_device_columns
-- Stage 6 task 6.1 — CT-021: keystone_auth.session learns what device it is, and why it died.
--
-- ★ Adds three columns (`user_agent`, `ip_first_seen`, `kind`) to keystone_auth.session, widens the
--   `revoked_reason` CHECK by four new reasons Stage 6 and Stage 7 write, and adds a 9-argument
--   overload of keystone.create_session that writes the new columns.
--
-- ★★★ THE 6-ARGUMENT keystone.create_session IS NOT DROPPED. Migrations reach production during
--     step 5's deploy, and between the migration landing and the new application image serving
--     traffic, the OLD image is still calling the 6-argument signature. Dropping it would break
--     every login in the deploy window. It is instead CREATE OR REPLACE'd into a thin delegating
--     wrapper (p_user_agent := NULL, p_ip := NULL, p_kind := 'app') and marked deprecated with a
--     COMMENT ON. Retiring it is a later stage's dead-code pass.
--
-- ★ keystone_auth.session is OWNED BY auth_owner (0020:53, `SET LOCAL ROLE auth_owner` before the
--   CREATE TABLE), and this file runs as app_owner (db/migrate.mjs per-file `SET ROLE app_owner`),
--   a NOINHERIT member of auth_owner (0132 header). ALTER TABLE and CREATE FUNCTION both need
--   ownership, so the role is switched exactly as 0167 does and put back explicitly — NOT
--   `RESET ROLE`, the session-level reset that caused F482 (db/migrate.mjs:301-316).
-- ★ The new function's owner must end up auth_owner: db/gates/catalog-conformance.mjs:653-655
--   names `create_session` in CREDENTIAL_RESOLVERS and fails any resolver of that name whose owner
--   is not auth_owner (catalog-conformance.mjs:702-704).
-- ★ No foreign key is added and none is re-validated here — see STAGE-6-PLAN.md §11 task 6.1 field
--   5, the 399 orphan rows on production.
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.session
  ADD COLUMN user_agent    text CHECK (char_length(user_agent) <= 400),
  ADD COLUMN ip_first_seen inet,
  ADD COLUMN kind          text NOT NULL DEFAULT 'app'
             CHECK (kind IN ('app','operator','client'));

-- ★ The four new reasons Stage 6 and Stage 7 write. Widening a CHECK can never invalidate an
--   existing row: every value the old set admitted, the new set admits.
ALTER TABLE keystone_auth.session DROP CONSTRAINT session_revoked_reason_check;
ALTER TABLE keystone_auth.session ADD CONSTRAINT session_revoked_reason_check
  CHECK (revoked_reason IN ('logout','tenant_changed','admin','expired_sweep',
                            'role_changed','password_changed','device_removed','operator_ended'));

-- ★ NEW OVERLOAD. The 6-argument version below stays callable through the deploy window.
CREATE FUNCTION keystone.create_session(
  p_tenant_id uuid, p_app_user_id uuid, p_firebase_uid text,
  p_token_id text, p_secret_hash bytea, p_ttl interval,
  p_user_agent text, p_ip inet, p_kind text
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO keystone_auth.session
    (tenant_id, app_user_id, firebase_uid, token_id, secret_hash, expires_at,
     user_agent, ip_first_seen, kind)
  VALUES (p_tenant_id, p_app_user_id, p_firebase_uid, p_token_id, p_secret_hash, now() + p_ttl,
          left(p_user_agent, 400), p_ip, coalesce(p_kind, 'app'))
  RETURNING id
$$;
REVOKE ALL ON FUNCTION keystone.create_session(uuid, uuid, text, text, bytea, interval, text, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.create_session(uuid, uuid, text, text, bytea, interval, text, inet, text) TO app_rw, app_owner;

CREATE OR REPLACE FUNCTION keystone.create_session(
  p_tenant_id uuid, p_app_user_id uuid, p_firebase_uid text,
  p_token_id text, p_secret_hash bytea, p_ttl interval
) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT keystone.create_session(p_tenant_id, p_app_user_id, p_firebase_uid,
                                 p_token_id, p_secret_hash, p_ttl, NULL, NULL, 'app')
$$;
COMMENT ON FUNCTION keystone.create_session(uuid, uuid, text, text, bytea, interval) IS
  'DEPRECATED (Stage 6, 0173). Kept only so the pre-deploy image keeps logging in during the deploy window. New callers use the 9-argument overload.';

SET LOCAL ROLE app_owner;
