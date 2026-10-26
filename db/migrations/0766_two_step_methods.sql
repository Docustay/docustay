-- 0766 · Two-step sign-in methods (20 Oct 2026). STRICTLY ADDITIVE: three new tables, one new column, and new functions. Nothing that exists is dropped or changed in meaning.
-- A person can now use a passkey or a security key as a second step, keep recovery codes that do not depend on an authenticator app, ask the sign-in not to repeat the second step on a device for 30 days, and see their recent security activity.
-- Same stance as 0206 / 0207 / 0684: every table belongs to auth_owner, has row-level security enabled with a deny-all policy, and app_rw holds no privilege on it; the application reaches them only through the SECURITY DEFINER functions below (search_path empty).
--   recovery_code    ten single-use codes per PERSON (not per authenticator factor); only the hash is stored (same hash the old backup codes use). The old backup_code rows keep working and are counted with these.
--   trusted_device   a hash of a random token held in an HttpOnly cookie; skips ONLY the second step, for the same person, until it expires or is revoked. Deleted on every two-step change and every password reset.
--   security_event   a short list of what happened to a person's sign-in security (method added or removed, recovery code used, two-step turned on or off); the last 200 are kept.
--   passkey.kind     'passkey' (today's behaviour) or 'security_key' (a roaming key: second step only).
SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.recovery_code (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  firebase_uid text        NOT NULL CHECK (btrim(firebase_uid) <> ''),
  code_hash    bytea       NOT NULL CHECK (octet_length(code_hash) = 32),
  used_at      timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX recovery_code_unique_idx ON keystone_auth.recovery_code (firebase_uid, code_hash);
CREATE INDEX recovery_code_unused_idx ON keystone_auth.recovery_code (firebase_uid) WHERE used_at IS NULL;
ALTER TABLE keystone_auth.recovery_code ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.recovery_code USING (false) WITH CHECK (false);

CREATE TABLE keystone_auth.trusted_device (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  firebase_uid text        NOT NULL CHECK (btrim(firebase_uid) <> ''),
  token_hash   bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  label        text        NOT NULL DEFAULT 'This device' CHECK (char_length(label) BETWEEN 1 AND 120),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  expires_at   timestamptz NOT NULL
);
CREATE INDEX trusted_device_by_uid_idx ON keystone_auth.trusted_device (firebase_uid);
ALTER TABLE keystone_auth.trusted_device ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.trusted_device USING (false) WITH CHECK (false);

CREATE TABLE keystone_auth.security_event (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  firebase_uid text        NOT NULL CHECK (btrim(firebase_uid) <> ''),
  kind         text        NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 60),
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_event_by_uid_idx ON keystone_auth.security_event (firebase_uid, at DESC);
ALTER TABLE keystone_auth.security_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.security_event USING (false) WITH CHECK (false);

ALTER TABLE keystone_auth.passkey ADD COLUMN kind text NOT NULL DEFAULT 'passkey' CHECK (kind IN ('passkey', 'security_key'));

-- ── recovery codes ──────────────────────────────────────────────────────────────────────────────
-- Replace the person's recovery codes with a new set: the unused old ones (new table and the old backup codes) stop working, the new hashes are stored. Returns how many were stored.
CREATE FUNCTION keystone.replace_recovery_codes(p_firebase_uid text, p_hashes bytea[])
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN RAISE EXCEPTION 'replace_recovery_codes: uid must not be blank' USING ERRCODE = '22023'; END IF;
  IF p_hashes IS NULL OR cardinality(p_hashes) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'replace_recovery_codes: between 1 and 20 codes' USING ERRCODE = '22023'; END IF;
  DELETE FROM keystone_auth.recovery_code WHERE firebase_uid = p_firebase_uid;
  UPDATE keystone_auth.backup_code b SET used_at = now()
    FROM keystone_auth.totp_factor f WHERE b.factor_id = f.id AND f.firebase_uid = p_firebase_uid AND b.used_at IS NULL;
  INSERT INTO keystone_auth.recovery_code (firebase_uid, code_hash) SELECT p_firebase_uid, h FROM unnest(p_hashes) AS h ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Spend one recovery code: the new table first, then the old backup codes of a confirmed authenticator factor. One UPDATE is the check (no read-then-write gap).
CREATE FUNCTION keystone.spend_recovery_code(p_firebase_uid text, p_code_hash bytea)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hit integer;
BEGIN
  WITH hit AS (
    UPDATE keystone_auth.recovery_code r SET used_at = now()
     WHERE r.firebase_uid = p_firebase_uid AND r.code_hash = p_code_hash AND r.used_at IS NULL RETURNING r.id
  ) SELECT count(*) INTO v_hit FROM hit;
  IF v_hit > 0 THEN RETURN true; END IF;
  RETURN keystone.spend_backup_code(p_firebase_uid, p_code_hash);
END $$;

CREATE FUNCTION keystone.count_recovery_codes(p_firebase_uid text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ((SELECT count(*) FROM keystone_auth.recovery_code r WHERE r.firebase_uid = p_firebase_uid AND r.used_at IS NULL)
        + (SELECT count(*) FROM keystone_auth.backup_code b JOIN keystone_auth.totp_factor f ON f.id = b.factor_id
            WHERE f.firebase_uid = p_firebase_uid AND f.confirmed_at IS NOT NULL AND b.used_at IS NULL))::integer
$$;

-- A person who already has recovery codes adds an authenticator app: the ten backup codes that confirming the app creates are retired at once, so the person keeps ONE set (the one they saved).
CREATE FUNCTION keystone.retire_backup_codes(p_firebase_uid text)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  UPDATE keystone_auth.backup_code b SET used_at = now()
    FROM keystone_auth.totp_factor f WHERE b.factor_id = f.id AND f.firebase_uid = p_firebase_uid AND b.used_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── what a person has, in one read ──────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.two_step_summary(p_firebase_uid text)
RETURNS TABLE (totp_confirmed_at timestamptz, totp_last_used_at timestamptz, passkeys integer, security_keys integer, recovery_left integer, remembered integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT f.confirmed_at FROM keystone_auth.totp_factor f WHERE f.firebase_uid = p_firebase_uid AND f.confirmed_at IS NOT NULL LIMIT 1),
         (SELECT f.last_used_at FROM keystone_auth.totp_factor f WHERE f.firebase_uid = p_firebase_uid AND f.confirmed_at IS NOT NULL LIMIT 1),
         (SELECT count(*)::integer FROM keystone_auth.passkey p WHERE p.firebase_uid = p_firebase_uid AND p.kind = 'passkey'),
         (SELECT count(*)::integer FROM keystone_auth.passkey p WHERE p.firebase_uid = p_firebase_uid AND p.kind = 'security_key'),
         keystone.count_recovery_codes(p_firebase_uid),
         (SELECT count(*)::integer FROM keystone_auth.trusted_device d WHERE d.firebase_uid = p_firebase_uid AND d.expires_at > now())
$$;

-- The roster call: which of these people have ANY second step (a confirmed authenticator app, a passkey or a security key).
CREATE FUNCTION keystone.second_factor_uids(p_firebase_uids text[])
RETURNS TABLE (firebase_uid text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u FROM unnest(p_firebase_uids) AS u
   WHERE EXISTS (SELECT 1 FROM keystone_auth.totp_factor f WHERE f.firebase_uid = u AND f.confirmed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM keystone_auth.passkey p WHERE p.firebase_uid = u)
$$;

-- ── passkeys and security keys ──────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.add_passkey_kind(p_firebase_uid text, p_credential_id text, p_public_key text, p_counter bigint, p_transports text[], p_name text, p_email text, p_kind text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN RAISE EXCEPTION 'add_passkey: uid must not be blank' USING ERRCODE = '22023'; END IF;
  IF p_kind NOT IN ('passkey', 'security_key') THEN RAISE EXCEPTION 'add_passkey: unknown kind' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM keystone_auth.passkey WHERE firebase_uid = p_firebase_uid) >= 10 THEN RAISE EXCEPTION 'add_passkey: at most 10 passkeys per person' USING ERRCODE = '23505'; END IF;
  INSERT INTO keystone_auth.passkey (firebase_uid, email, credential_id, public_key, counter, transports, name, kind)
  VALUES (p_firebase_uid, left(p_email, 320), p_credential_id, p_public_key, coalesce(p_counter, 0), coalesce(p_transports, '{}'),
          coalesce(nullif(btrim(left(p_name, 80)), ''), CASE WHEN p_kind = 'security_key' THEN 'Security key' ELSE 'Passkey' END), p_kind) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION keystone.list_passkeys_kind(p_firebase_uid text)
RETURNS TABLE (id uuid, credential_id text, name text, transports text[], created_at timestamptz, last_used_at timestamptz, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id, p.credential_id, p.name, p.transports, p.created_at, p.last_used_at, p.kind FROM keystone_auth.passkey p WHERE p.firebase_uid = p_firebase_uid ORDER BY p.created_at
$$;

-- ── remembered devices (30 days, the second step only) ─────────────────────────────────────────
CREATE FUNCTION keystone.add_trusted_device(p_firebase_uid text, p_token_hash bytea, p_label text, p_expires timestamptz)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN RAISE EXCEPTION 'add_trusted_device: uid must not be blank' USING ERRCODE = '22023'; END IF;
  DELETE FROM keystone_auth.trusted_device WHERE firebase_uid = p_firebase_uid AND expires_at <= now();
  DELETE FROM keystone_auth.trusted_device WHERE id IN (SELECT id FROM keystone_auth.trusted_device WHERE firebase_uid = p_firebase_uid ORDER BY created_at DESC OFFSET 19);
  INSERT INTO keystone_auth.trusted_device (firebase_uid, token_hash, label, expires_at)
  VALUES (p_firebase_uid, p_token_hash, coalesce(nullif(btrim(left(p_label, 120)), ''), 'This device'), p_expires) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION keystone.check_trusted_device(p_firebase_uid text, p_token_hash bytea)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH hit AS (UPDATE keystone_auth.trusted_device d SET last_used_at = now()
                WHERE d.firebase_uid = p_firebase_uid AND d.token_hash = p_token_hash AND d.expires_at > now() RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM hit)
$$;

-- Forget every remembered device of a person (the default), or one of them.
CREATE FUNCTION keystone.revoke_trusted_devices(p_firebase_uid text, p_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM keystone_auth.trusted_device WHERE firebase_uid = p_firebase_uid AND (p_id IS NULL OR id = p_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

CREATE FUNCTION keystone.list_trusted_devices(p_firebase_uid text)
RETURNS TABLE (id uuid, label text, created_at timestamptz, last_used_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id, d.label, d.created_at, d.last_used_at, d.expires_at FROM keystone_auth.trusted_device d WHERE d.firebase_uid = p_firebase_uid AND d.expires_at > now() ORDER BY d.created_at DESC
$$;

-- ── recent security activity ────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.record_security_event(p_firebase_uid text, p_kind text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN RETURN; END IF;
  INSERT INTO keystone_auth.security_event (firebase_uid, kind, detail) VALUES (p_firebase_uid, left(p_kind, 60), coalesce(p_detail, '{}'::jsonb));
  DELETE FROM keystone_auth.security_event WHERE id IN (SELECT id FROM keystone_auth.security_event WHERE firebase_uid = p_firebase_uid ORDER BY at DESC, id DESC OFFSET 200);
END $$;

CREATE FUNCTION keystone.list_security_events(p_firebase_uid text, p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, kind text, detail jsonb, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.id, e.kind, e.detail, e.at FROM keystone_auth.security_event e WHERE e.firebase_uid = p_firebase_uid ORDER BY e.at DESC, e.id DESC LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
$$;

-- ── turn it all off (the person turning it off, or an owner resetting a teammate): authenticator factor and its backup codes, passkeys, recovery codes, remembered devices ──
CREATE FUNCTION keystone.clear_second_factors(p_firebase_uid text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_had boolean;
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN RAISE EXCEPTION 'clear_second_factors: uid must not be blank' USING ERRCODE = '22023'; END IF;
  v_had := EXISTS (SELECT 1 FROM keystone_auth.totp_factor f WHERE f.firebase_uid = p_firebase_uid AND f.confirmed_at IS NOT NULL) OR EXISTS (SELECT 1 FROM keystone_auth.passkey p WHERE p.firebase_uid = p_firebase_uid);
  DELETE FROM keystone_auth.totp_factor WHERE firebase_uid = p_firebase_uid;   -- its backup codes go with it (ON DELETE CASCADE)
  DELETE FROM keystone_auth.passkey WHERE firebase_uid = p_firebase_uid;
  DELETE FROM keystone_auth.recovery_code WHERE firebase_uid = p_firebase_uid;
  DELETE FROM keystone_auth.trusted_device WHERE firebase_uid = p_firebase_uid;
  RETURN v_had;
END $$;

CREATE FUNCTION keystone.has_second_factor(p_firebase_uid text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM keystone_auth.totp_factor f WHERE f.firebase_uid = p_firebase_uid AND f.confirmed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM keystone_auth.passkey p WHERE p.firebase_uid = p_firebase_uid)
$$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['replace_recovery_codes(text,bytea[])','spend_recovery_code(text,bytea)','count_recovery_codes(text)','retire_backup_codes(text)','two_step_summary(text)','second_factor_uids(text[])',
                           'add_passkey_kind(text,text,text,bigint,text[],text,text,text)','list_passkeys_kind(text)','add_trusted_device(text,bytea,text,timestamptz)','check_trusted_device(text,bytea)',
                           'revoke_trusted_devices(text,uuid)','list_trusted_devices(text)','record_security_event(text,text,jsonb)','list_security_events(text,integer)','clear_second_factors(text)','has_second_factor(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION keystone.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION keystone.%s TO app_rw, app_owner', f);
  END LOOP;
END $$;

-- ── a deleted account or workspace takes the new rows with it (0699 and 0695 name each table they clear) ──
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
  DELETE FROM keystone_auth.recovery_code     WHERE firebase_uid = p_uid;
  DELETE FROM keystone_auth.trusted_device    WHERE firebase_uid = p_uid;
  DELETE FROM keystone_auth.security_event    WHERE firebase_uid = p_uid;
END
$fn$;

CREATE OR REPLACE FUNCTION keystone.delete_workspace_credentials(p_tenant uuid, p_uids text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT keystone.workspace_deletion_active(p_tenant) THEN
    RAISE EXCEPTION 'workspace credentials are removed only as part of deleting the workspace' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM keystone_auth.session        WHERE tenant_id = p_tenant;
  DELETE FROM keystone_auth.api_token      WHERE tenant_id = p_tenant;
  DELETE FROM keystone_auth.webhook_source WHERE tenant_id = p_tenant;
  IF p_uids IS NOT NULL AND cardinality(p_uids) > 0 THEN
    DELETE FROM keystone_auth.email_code        WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.passkey_challenge WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.backup_code       WHERE factor_id IN (SELECT id FROM keystone_auth.totp_factor WHERE firebase_uid = ANY (p_uids));
    DELETE FROM keystone_auth.totp_factor       WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.passkey           WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.recovery_code     WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.trusted_device    WHERE firebase_uid = ANY (p_uids);
    DELETE FROM keystone_auth.security_event    WHERE firebase_uid = ANY (p_uids);
  END IF;
END
$fn$;

DO $self_check$
DECLARE t text; v_owner text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recovery_code', 'trusted_device', 'security_event'] LOOP
    SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = ('keystone_auth.' || t)::regclass;
    IF v_owner IS DISTINCT FROM 'auth_owner' THEN RAISE EXCEPTION '0766: keystone_auth.% is owned by %, must be auth_owner', t, v_owner; END IF;
    IF has_table_privilege('app_rw', 'keystone_auth.' || t, 'SELECT') OR has_table_privilege('app_rw', 'keystone_auth.' || t, 'INSERT')
       OR has_table_privilege('app_rw', 'keystone_auth.' || t, 'UPDATE') OR has_table_privilege('app_rw', 'keystone_auth.' || t, 'DELETE') THEN
      RAISE EXCEPTION '0766: app_rw must hold no privilege on keystone_auth.%', t;
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'keystone.clear_second_factors(text)', 'EXECUTE') THEN RAISE EXCEPTION '0766: clear_second_factors must not be callable by PUBLIC'; END IF;
END
$self_check$;

SET ROLE app_owner;
