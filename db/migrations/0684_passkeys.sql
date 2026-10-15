-- 0684 · Passkeys (Final Push FP-E3, 7 Oct 2026). STRICTLY ADDITIVE: two new tables and eight functions. No existing user, session, second factor or setting changes.
-- A passkey is a WebAuthn credential kept per IDENTITY (firebase uid), like the TOTP factor. The public key is not a secret; the private key never leaves the person's device.
-- Same stance as keystone_auth.totp_factor (0206): RLS enabled with a deny-all policy, no grant to app_rw, reached only through SECURITY DEFINER functions owned by auth_owner.
SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.passkey (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  firebase_uid  text        NOT NULL CHECK (btrim(firebase_uid) <> ''),
  email         text        NULL CHECK (email IS NULL OR char_length(email) <= 320),   -- the sign-in address at registration, so the built-in identity can mint its token without a lookup
  credential_id text        NOT NULL UNIQUE CHECK (char_length(credential_id) BETWEEN 16 AND 1400),
  public_key    text        NOT NULL CHECK (char_length(public_key) BETWEEN 16 AND 4000),
  counter       bigint      NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports    text[]      NOT NULL DEFAULT '{}',
  name          text        NOT NULL DEFAULT 'Passkey' CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NULL
);
CREATE INDEX passkey_by_uid_idx ON keystone_auth.passkey (firebase_uid);
ALTER TABLE keystone_auth.passkey ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.passkey USING (false) WITH CHECK (false);

-- A challenge is single-use and short-lived: put at "begin", taken (deleted) at "finish". A replayed assertion finds no challenge.
CREATE TABLE keystone_auth.passkey_challenge (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  purpose      text        NOT NULL CHECK (purpose IN ('register', 'login')),
  challenge    text        NOT NULL CHECK (char_length(challenge) BETWEEN 16 AND 200),
  firebase_uid text        NULL,
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
ALTER TABLE keystone_auth.passkey_challenge ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.passkey_challenge USING (false) WITH CHECK (false);

CREATE FUNCTION keystone.put_passkey_challenge(p_purpose text, p_challenge text, p_firebase_uid text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  DELETE FROM keystone_auth.passkey_challenge WHERE expires_at < now();
  INSERT INTO keystone_auth.passkey_challenge (purpose, challenge, firebase_uid) VALUES (p_purpose, p_challenge, p_firebase_uid) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION keystone.take_passkey_challenge(p_id uuid, p_purpose text)
RETURNS TABLE (challenge text, firebase_uid text) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM keystone_auth.passkey_challenge WHERE id = p_id AND purpose = p_purpose AND expires_at >= now() RETURNING challenge, firebase_uid
$$;

CREATE FUNCTION keystone.add_passkey(p_firebase_uid text, p_credential_id text, p_public_key text, p_counter bigint, p_transports text[], p_name text, p_email text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN RAISE EXCEPTION 'add_passkey: uid must not be blank' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM keystone_auth.passkey WHERE firebase_uid = p_firebase_uid) >= 10 THEN RAISE EXCEPTION 'add_passkey: at most 10 passkeys per person' USING ERRCODE = '23505'; END IF;
  INSERT INTO keystone_auth.passkey (firebase_uid, email, credential_id, public_key, counter, transports, name)
  VALUES (p_firebase_uid, left(p_email, 320), p_credential_id, p_public_key, coalesce(p_counter, 0), coalesce(p_transports, '{}'), coalesce(nullif(btrim(p_name), ''), 'Passkey')) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION keystone.get_passkey(p_credential_id text)
RETURNS TABLE (id uuid, firebase_uid text, email text, public_key text, counter bigint, transports text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.firebase_uid, p.email, p.public_key, p.counter, p.transports FROM keystone_auth.passkey p WHERE p.credential_id = p_credential_id
$$;

CREATE FUNCTION keystone.touch_passkey(p_credential_id text, p_counter bigint)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH u AS (UPDATE keystone_auth.passkey SET counter = greatest(counter, p_counter), last_used_at = now() WHERE credential_id = p_credential_id RETURNING 1) SELECT EXISTS (SELECT 1 FROM u)
$$;

CREATE FUNCTION keystone.list_passkeys(p_firebase_uid text)
RETURNS TABLE (id uuid, credential_id text, name text, transports text[], created_at timestamptz, last_used_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.credential_id, p.name, p.transports, p.created_at, p.last_used_at FROM keystone_auth.passkey p WHERE p.firebase_uid = p_firebase_uid ORDER BY p.created_at
$$;

CREATE FUNCTION keystone.delete_passkey(p_firebase_uid text, p_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM keystone_auth.passkey WHERE firebase_uid = p_firebase_uid AND id = p_id RETURNING 1) SELECT EXISTS (SELECT 1 FROM d)
$$;

CREATE FUNCTION keystone.rename_passkey(p_firebase_uid text, p_id uuid, p_name text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH u AS (UPDATE keystone_auth.passkey SET name = left(btrim(p_name), 80) WHERE firebase_uid = p_firebase_uid AND id = p_id AND btrim(p_name) <> '' RETURNING 1) SELECT EXISTS (SELECT 1 FROM u)
$$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['add_passkey(text,text,text,bigint,text[],text,text)','get_passkey(text)','touch_passkey(text,bigint)','list_passkeys(text)','delete_passkey(text,uuid)','rename_passkey(text,uuid,text)','put_passkey_challenge(text,text,text)','take_passkey_challenge(uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION keystone.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION keystone.%s TO app_rw, app_owner', f);
  END LOOP;
END $$;

SET ROLE app_owner;
