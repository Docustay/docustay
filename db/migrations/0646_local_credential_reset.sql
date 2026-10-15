-- 0646_local_credential_reset — D-006. A deployment with no Firebase project (the self-host package, the sandbox) had a "Forgot password" screen whose request answered 500 ("KEYSTONE_FIREBASE_PROJECT_ID is not set").
-- This adds the built-in identity's own reset: a one-time, expiring token (only its SHA-256 is stored), reached ONLY through the two SECURITY DEFINER functions below, like 0624's credential functions.
CREATE TABLE IF NOT EXISTS keystone.local_credential_reset (
  token_hash text        PRIMARY KEY,
  uid        text        NOT NULL REFERENCES keystone.local_credential(uid) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE keystone.local_credential_reset ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.local_credential_reset FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS definer_only ON keystone.local_credential_reset;
CREATE POLICY definer_only ON keystone.local_credential_reset TO app_owner USING (true) WITH CHECK (true);

-- Issue: true when the address has an identity (a fresh token replaces any earlier unused one); false when it does not. The caller gives the same answer either way.
CREATE OR REPLACE FUNCTION keystone.local_credential_reset_issue(p_email text, p_token_hash text, p_ttl_seconds int) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = keystone, pg_catalog AS $$
DECLARE v_uid text;
BEGIN
  SELECT uid INTO v_uid FROM keystone.local_credential WHERE lower(email) = lower(p_email);
  IF v_uid IS NULL THEN RETURN false; END IF;
  DELETE FROM keystone.local_credential_reset WHERE uid = v_uid AND used_at IS NULL;
  INSERT INTO keystone.local_credential_reset (token_hash, uid, expires_at) VALUES (p_token_hash, v_uid, now() + make_interval(secs => p_ttl_seconds));
  RETURN true;
END $$;

-- Redeem: sets the new password hash once, for an unexpired unused token; false otherwise (the same refusal for unknown, used and expired).
CREATE OR REPLACE FUNCTION keystone.local_credential_reset_redeem(p_token_hash text, p_new_password_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = keystone, pg_catalog AS $$
DECLARE v_uid text;
BEGIN
  UPDATE keystone.local_credential_reset SET used_at = now()
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now() RETURNING uid INTO v_uid;
  IF v_uid IS NULL THEN RETURN false; END IF;
  UPDATE keystone.local_credential SET password_hash = p_new_password_hash WHERE uid = v_uid;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION keystone.local_credential_reset_issue(text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.local_credential_reset_redeem(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.local_credential_reset_issue(text, text, int) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.local_credential_reset_redeem(text, text) TO app_rw;
