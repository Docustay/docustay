-- 0699 · REMOVING A DELETED ACCOUNT'S SIGN-IN IDENTITY (Round 3, 10 Oct 2026). Companion to 0698. When a person's account deletion has run its cooling-off period, the worker erases their staff row (application code) and calls this ONE function
-- for the sign-in side: the codes, passkeys, 2-step factors and built-in password of the identity — but only when that identity belongs to nobody else in any workspace. It returns the identity so the application can remove it from the identity provider after the commit.
--   · It refuses unless a deletion request of kind 'account' exists in THIS workspace, is 'running', and its cooling-off period has ended. A request still inside its period cannot be used to touch anyone's sign-in.
--   · Same shape as 0695: the sign-in tables belong to auth_owner and refuse every other role, so the work is done by auth_owner functions that app_owner's wrapper calls.
GRANT SELECT ON keystone.deletion_request TO auth_owner;   -- the sign-in role reads the request it is asked to carry out (row-level security still scopes it to the workspace in context)
SET LOCAL ROLE auth_owner;
CREATE OR REPLACE FUNCTION keystone.account_identity_only_here(p_request uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT u.firebase_uid
    FROM keystone.deletion_request r JOIN keystone.app_user u ON u.id = r.subject_user_id AND u.tenant_id = r.tenant_id
   WHERE r.id = p_request AND r.kind = 'account' AND r.status = 'running' AND r.scheduled_for <= now() AND r.tenant_id::text = current_setting('keystone.tenant_id', true)
     AND u.firebase_uid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM keystone.app_user o WHERE o.firebase_uid = u.firebase_uid AND o.id <> u.id)
$fn$;
REVOKE ALL ON FUNCTION keystone.account_identity_only_here(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.account_identity_only_here(uuid) TO app_owner;

CREATE OR REPLACE FUNCTION keystone.remove_account_credentials(p_request uuid, p_uid text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF p_uid IS NULL OR p_uid IS DISTINCT FROM keystone.account_identity_only_here(p_request) THEN
    RAISE EXCEPTION 'sign-in credentials are removed only for a deletion that is due, and only for an identity nobody else uses' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM keystone_auth.session           WHERE firebase_uid = p_uid;
  DELETE FROM keystone_auth.email_code        WHERE firebase_uid = p_uid;
  DELETE FROM keystone_auth.passkey_challenge WHERE firebase_uid = p_uid;
  DELETE FROM keystone_auth.backup_code       WHERE factor_id IN (SELECT id FROM keystone_auth.totp_factor WHERE firebase_uid = p_uid);
  DELETE FROM keystone_auth.totp_factor       WHERE firebase_uid = p_uid;
  DELETE FROM keystone_auth.passkey           WHERE firebase_uid = p_uid;
END
$fn$;
REVOKE ALL ON FUNCTION keystone.remove_account_credentials(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.remove_account_credentials(uuid, text) TO app_owner;
SET LOCAL ROLE app_owner;

-- the wrapper the application calls: removes the credentials and the built-in password, returns the identity (null when it is shared or there is none)
CREATE OR REPLACE FUNCTION keystone.remove_account_identity(p_request uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_uid text := keystone.account_identity_only_here(p_request);
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  PERFORM keystone.remove_account_credentials(p_request, v_uid);
  DELETE FROM keystone.local_credential WHERE uid = v_uid;
  RETURN v_uid;
END
$fn$;
REVOKE ALL ON FUNCTION keystone.remove_account_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.remove_account_identity(uuid) TO app_rw;

DO $account_identity_self_check$
BEGIN
  IF has_function_privilege('public', 'keystone.remove_account_identity(uuid)', 'EXECUTE') OR has_function_privilege('public', 'keystone.remove_account_credentials(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION '0699: the identity-removal functions must not be executable by PUBLIC'; END IF;
  IF has_function_privilege('app_rw', 'keystone.remove_account_credentials(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION '0699: app_rw must call remove_account_identity, not the credential function directly'; END IF;
END
$account_identity_self_check$;
