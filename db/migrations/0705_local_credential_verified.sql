-- 0705 · A LOCAL LOGIN IS ONLY AS GOOD AS THE PROOF OF ITS EMAIL ADDRESS (Run 6). Additive; every existing login is treated as proven.
-- Found by measurement: with the sign-up email code on, a person could sign up with ANY address, then sign in with the password they had just chosen, and the sign-in token said email_verified = true — so /api/signup accepted it and made them the owner of a workspace under an address they never proved.
-- Two changes close it:
--   1. the credential remembers WHEN its address was proven (the emailed sign-up code, or the emailed password-reset link); a sign-in token carries email_verified only if it was;
--   2. an address nobody has proven is not an account — a new sign-up may take it over after two minutes (so a stranger cannot squat on someone else's address, and cannot push out a person halfway through proving their own).
ALTER TABLE keystone.local_credential ADD COLUMN IF NOT EXISTS verified_at timestamptz;
UPDATE keystone.local_credential SET verified_at = created_at WHERE verified_at IS NULL;   -- everything that exists today was made before this rule

DROP FUNCTION IF EXISTS keystone.local_credential_create(text, text, text);
CREATE OR REPLACE FUNCTION keystone.local_credential_create(p_uid text, p_email text, p_hash text, p_verified boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = keystone, pg_catalog AS $$
BEGIN
  INSERT INTO keystone.local_credential (uid, email, password_hash, verified_at) VALUES (p_uid, lower(p_email), p_hash, CASE WHEN p_verified THEN now() END);
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  UPDATE keystone.local_credential SET uid = p_uid, password_hash = p_hash, created_at = now(), verified_at = CASE WHEN p_verified THEN now() END
   WHERE lower(email) = lower(p_email) AND verified_at IS NULL AND created_at < now() - interval '2 minutes';
  RETURN FOUND;
END $$;

DROP FUNCTION IF EXISTS keystone.local_credential_get(text);
CREATE OR REPLACE FUNCTION keystone.local_credential_get(p_email text) RETURNS TABLE (uid text, password_hash text, verified boolean)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = keystone, pg_catalog AS $$
  SELECT c.uid, c.password_hash, c.verified_at IS NOT NULL FROM keystone.local_credential c WHERE lower(c.email) = lower(p_email)
$$;

CREATE OR REPLACE FUNCTION keystone.local_credential_mark_verified(p_email text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = keystone, pg_catalog AS $$
  WITH u AS (UPDATE keystone.local_credential SET verified_at = coalesce(verified_at, now()) WHERE lower(email) = lower(p_email) RETURNING 1) SELECT EXISTS (SELECT 1 FROM u)
$$;

-- following the emailed reset link also proves the address
CREATE OR REPLACE FUNCTION keystone.local_credential_reset_redeem(p_token_hash text, p_new_password_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = keystone, pg_catalog AS $$
DECLARE v_uid text;
BEGIN
  UPDATE keystone.local_credential_reset SET used_at = now()
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now() RETURNING uid INTO v_uid;
  IF v_uid IS NULL THEN RETURN false; END IF;
  UPDATE keystone.local_credential SET password_hash = p_new_password_hash, verified_at = coalesce(verified_at, now()) WHERE uid = v_uid;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION keystone.local_credential_create(text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.local_credential_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.local_credential_mark_verified(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.local_credential_create(text, text, text, boolean) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.local_credential_get(text) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.local_credential_mark_verified(text) TO app_rw;

DO $r6_self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'keystone' AND table_name = 'local_credential' AND column_name = 'verified_at') THEN RAISE EXCEPTION '0705: verified_at is missing'; END IF;
  IF EXISTS (SELECT 1 FROM keystone.local_credential WHERE verified_at IS NULL) THEN RAISE EXCEPTION '0705: an existing login was left unproven'; END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.local_credential_get(text)', 'EXECUTE') THEN RAISE EXCEPTION '0705: app_rw cannot read a credential'; END IF;
END
$r6_self_check$;
