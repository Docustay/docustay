-- 0624_local_credential — Batch B. A built-in email + password identity for deployments that have no Firebase project: the Docustay self-host package, and the sandbox.
-- Production keeps Firebase; this is OFF unless KEYSTONE_LOCAL_AUTH=1 (src/auth/localIdentity.mjs), so a tenant-scoped request can never reach it and a production token can never be a local one.
-- It is an IDENTITY store (who may prove they are this email), not a tenant table — like a Firebase account it has no tenant. Reached ONLY through the two SECURITY DEFINER functions below;
-- `app_rw` has no privilege on the table itself. `app_user.firebase_uid` remains the link (a local identity's uid is 'local:<uuid>').
CREATE TABLE IF NOT EXISTS keystone.local_credential (
  uid           text        PRIMARY KEY CHECK (uid LIKE 'local:%'),
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS local_credential_email_key ON keystone.local_credential (lower(email));
ALTER TABLE keystone.local_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.local_credential FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS definer_only ON keystone.local_credential;
CREATE POLICY definer_only ON keystone.local_credential TO app_owner USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION keystone.local_credential_create(p_uid text, p_email text, p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = keystone, pg_catalog AS $$
BEGIN
  INSERT INTO keystone.local_credential (uid, email, password_hash) VALUES (p_uid, lower(p_email), p_hash);
  RETURN true;
EXCEPTION WHEN unique_violation THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION keystone.local_credential_get(p_email text) RETURNS TABLE (uid text, password_hash text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = keystone, pg_catalog AS $$
  SELECT c.uid, c.password_hash FROM keystone.local_credential c WHERE lower(c.email) = lower(p_email)
$$;

REVOKE ALL ON FUNCTION keystone.local_credential_create(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.local_credential_get(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.local_credential_create(text, text, text) TO app_rw;
GRANT EXECUTE ON FUNCTION keystone.local_credential_get(text) TO app_rw;

-- First-run check for a self-hosted install: is there no organisation yet? A boolean and nothing else crosses the boundary (no tenant table is readable without a tenant).
CREATE OR REPLACE FUNCTION keystone.setup_needed() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = keystone, pg_catalog AS $$
  SELECT NOT EXISTS (SELECT 1 FROM keystone.tenant)
$$;
REVOKE ALL ON FUNCTION keystone.setup_needed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.setup_needed() TO app_rw;
-- the tenant table is only readable by auth_owner (the identity-lookup owner, like resolve_tenant_by_slug); a definer function owned by anyone else would always see "no organisation"
ALTER FUNCTION keystone.setup_needed() OWNER TO auth_owner;
