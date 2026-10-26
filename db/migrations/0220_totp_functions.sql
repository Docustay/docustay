-- 0220_totp_functions
-- Stage 8 task 8.8 — F615 RESOLVED. Five auth_owner-owned SECURITY DEFINER functions in schema
-- keystone: the ONLY way src/auth/totp.mjs reaches keystone_auth.totp_factor / backup_code (both
-- deny_all, no app_rw grant — 0206/0207). Sibling of keystone.spend_backup_code (0207) and
-- keystone.grant_operator / revoke_operator / operator_grant_active (0184); same idiom throughout.
-- Field 4 of this task explains WHY FIVE FUNCTIONS FOR FOUR MODULE OPERATIONS — not repeated here.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ IDENTITY: every function takes p_firebase_uid text DIRECTLY — the 0184/0207 pattern (an
--     ALREADY Firebase-ID-token-verified uid, trusted as an argument the same way
--     operator_grant_active/grant_operator/revoke_operator/spend_backup_code already are), NOT
--     resolve_session's pattern (0186) of resolving identity FROM a presented, not-yet-trusted
--     credential. There is no less-trusted uid these functions could be confused with.
-- ★ Every raised exception carries a deliberate SQLSTATE, mapped by CODE in src/auth/totp.mjs (the
--   src/platform/jobActions.mjs:60 BY_SQLSTATE idiom, never a message match): 23505 unique_violation
--   → a confirmed factor already exists (kind: "conflict", 409); 22023 invalid_parameter_value → a
--   blank/malformed argument (kind: "validation").
-- ★ SET LOCAL ROLE auth_owner for the whole block — this migration creates ONLY functions (no new
--   table), the same shape as 0184, so it uses 0184's preamble idiom rather than a trailing ALTER.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

-- ── 1 · begin an enrolment ─────────────────────────────────────────────────────
-- Refuses (23505) when a CONFIRMED factor already exists — the caller turns two-step off first. An
-- existing UNCONFIRMED row for the same uid is replaced, not duplicated — a restarted enrolment is
-- free.
CREATE FUNCTION keystone.begin_totp_enrolment(
  p_firebase_uid text, p_secret_envelope jsonb, p_kek_version smallint
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_firebase_uid IS NULL OR btrim(p_firebase_uid) = '' THEN
    RAISE EXCEPTION 'begin_totp_enrolment: p_firebase_uid must not be blank' USING ERRCODE = '22023';
  END IF;
  IF p_secret_envelope IS NULL OR jsonb_typeof(p_secret_envelope) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'begin_totp_enrolment: p_secret_envelope must be a jsonb object' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM keystone_auth.totp_factor
     WHERE firebase_uid = p_firebase_uid AND confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'begin_totp_enrolment: uid % already holds a confirmed totp factor', p_firebase_uid
      USING ERRCODE = '23505';
  END IF;

  DELETE FROM keystone_auth.totp_factor
   WHERE firebase_uid = p_firebase_uid AND confirmed_at IS NULL;

  INSERT INTO keystone_auth.totp_factor (firebase_uid, secret_envelope, kek_version)
  VALUES (p_firebase_uid, p_secret_envelope, p_kek_version)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION keystone.begin_totp_enrolment(text, jsonb, smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.begin_totp_enrolment(text, jsonb, smallint) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.begin_totp_enrolment(text, jsonb, smallint) IS
  'F615 / 8.8 — begins (or restarts) an unconfirmed TOTP enrolment for p_firebase_uid. Refuses (23505) when a CONFIRMED factor already exists for the uid; replaces any existing UNCONFIRMED row for the same uid, freely. Returns the new factor id. First caller: src/auth/totp.mjs beginEnrolment.';

-- ── 2 · read the one factor row a uid holds (confirmed or not) ────────────────
-- Shared reader: confirmEnrolment calls this to open the UNCONFIRMED row it is about to confirm;
-- verifyTotp calls this to open the CONFIRMED row and read last_used_at for the replay check;
-- hasConfirmedFactor/countUnusedBackupCodes call it too. At most one row per uid —
-- begin_totp_enrolment's own refuse/replace logic is what keeps that true. unused_backup_codes
-- rides along so countUnusedBackupCodes needs no second call.
CREATE FUNCTION keystone.get_totp_factor(p_firebase_uid text)
RETURNS TABLE (
  id uuid, secret_envelope jsonb, kek_version smallint, confirmed_at timestamptz,
  last_used_at timestamptz, unused_backup_codes integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.secret_envelope, f.kek_version, f.confirmed_at, f.last_used_at,
         (SELECT count(*)::integer FROM keystone_auth.backup_code b
           WHERE b.factor_id = f.id AND b.used_at IS NULL)
    FROM keystone_auth.totp_factor f
   WHERE f.firebase_uid = p_firebase_uid;
$$;
REVOKE ALL ON FUNCTION keystone.get_totp_factor(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.get_totp_factor(text) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.get_totp_factor(text) IS
  'F615 / 8.8 — returns the (at most one) totp_factor row for p_firebase_uid, confirmed or not, plus its unused backup-code count; zero rows for no factor. secret_envelope is opened by the caller in Node (openSecret) — never in SQL. First callers: src/auth/totp.mjs confirmEnrolment, verifyTotp, hasConfirmedFactor, countUnusedBackupCodes.';

-- ── 3 · confirm an enrolment: the code has ALREADY been verified in Node ──────
-- ★ Trusts that the caller already ran the typed code through openSecret + the TOTP window check —
--   it does not re-derive that decision. p_backup_code_hashes must be exactly ten 32-byte HMAC
--   digests (hashSecret's own shape), pre-generated and pre-hashed in Node; this function only
--   writes them.
CREATE FUNCTION keystone.confirm_totp_enrolment(
  p_firebase_uid text, p_factor_id uuid, p_backup_code_hashes bytea[]
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_updated  integer;
  v_inserted integer;
BEGIN
  IF p_backup_code_hashes IS NULL OR array_length(p_backup_code_hashes, 1) IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'confirm_totp_enrolment: p_backup_code_hashes must hold exactly 10 hashes' USING ERRCODE = '22023';
  END IF;

  UPDATE keystone_auth.totp_factor
     SET confirmed_at = now()
   WHERE id = p_factor_id AND firebase_uid = p_firebase_uid AND confirmed_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'confirm_totp_enrolment: no unconfirmed factor % for this uid (already confirmed, restarted, or wrong id)', p_factor_id
      USING ERRCODE = '42704';
  END IF;

  WITH ins AS (
    INSERT INTO keystone_auth.backup_code (factor_id, code_hash)
    SELECT p_factor_id, h FROM unnest(p_backup_code_hashes) AS h
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;
REVOKE ALL ON FUNCTION keystone.confirm_totp_enrolment(text, uuid, bytea[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.confirm_totp_enrolment(text, uuid, bytea[]) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.confirm_totp_enrolment(text, uuid, bytea[]) IS
  'F615 / 8.8 — confirms the UNCONFIRMED factor p_factor_id for p_firebase_uid (sets confirmed_at) and inserts its ten backup codes, already hashed by the caller. Does NOT check the TOTP code itself — the caller has already done that against the envelope keystone.get_totp_factor returned, using openSecret. Refuses (42704) when no matching unconfirmed row exists; refuses (22023) unless exactly 10 hashes are given. Returns the count inserted (10 on success). First caller: src/auth/totp.mjs confirmEnrolment.';

-- ── 4 · record a successful verification ───────────────────────────────────────
-- ★ Called ONLY after Node has confirmed a code matches. Writes last_used_at = now(); decides
--   nothing itself. Never called on a failed attempt (field 4's replay-defence note).
CREATE FUNCTION keystone.record_totp_verified(p_firebase_uid text, p_factor_id uuid)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.totp_factor
       SET last_used_at = now()
     WHERE id = p_factor_id AND firebase_uid = p_firebase_uid AND confirmed_at IS NOT NULL
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM done);
$$;
REVOKE ALL ON FUNCTION keystone.record_totp_verified(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.record_totp_verified(text, uuid) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.record_totp_verified(text, uuid) IS
  'F615 / 8.8 — writes last_used_at = now() on the CONFIRMED factor p_factor_id for p_firebase_uid, after Node has already verified a code against it. Returns true if a row was updated, false otherwise (defensive; the normal caller already knows the row exists from get_totp_factor). First caller: src/auth/totp.mjs verifyTotp, on its own success path only — never called for a code that failed.';

-- ── 5 · turn it off ─────────────────────────────────────────────────────────────
-- ★ No code check here — src/auth/totp.mjs's disableTotp calls verifyTotp (or spend_backup_code)
--   FIRST and only reaches this on success (field 4). No operator-grant check either — that is 8.9's
--   hasActiveOperatorGrant, read in Node, never queried directly from this function (field 5).
CREATE FUNCTION keystone.disable_totp_factor(p_firebase_uid text)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    DELETE FROM keystone_auth.totp_factor
     WHERE firebase_uid = p_firebase_uid AND confirmed_at IS NOT NULL
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM done);
$$;
REVOKE ALL ON FUNCTION keystone.disable_totp_factor(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.disable_totp_factor(text) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.disable_totp_factor(text) IS
  'F615 / 8.8 — deletes the CONFIRMED factor for p_firebase_uid (cascades its backup codes, 0207). Returns true if a row was deleted. Callers must already have verified a current code (src/auth/totp.mjs disableTotp) and checked for an active operator grant (8.9) BEFORE calling this — neither check happens here.';

-- ★★ FIX [MEASURED 22 Sep 2026]: same defect as 0207/0227, same session — this used to `SET LOCAL
--    ROLE app_owner` HERE, before the self-check below, but the self-check reads keystone_auth
--    tables directly (backup_code, totp_factor) and app_owner holds no USAGE on schema keystone_auth
--    at all, so every one of those references failed with "permission denied for schema
--    keystone_auth". Role now stays auth_owner through the self-check too; handed back at the very
--    end of the file instead.

-- ★★ THE SELF-CHECK — proves ownership, the grants, PUBLIC's exclusion, and the whole lifecycle, not
--    merely that each statement ran without error (0184/0207's identical shape).
DO $$
DECLARE
  v_owner             text;
  v_uid               text := 'm0220-self-check-uid';
  v_uid2              text := 'm0220-self-check-uid-2';
  v_id                uuid;
  v_id2               uuid;
  v_row               record;
  v_dup_failed        boolean := false;
  v_conflict          boolean := false;
  v_hashes            bytea[];
  v_inserted          integer;
  v_verified          boolean;
  v_wrong_id_result   boolean;
  v_disabled          boolean;
  v_code_count        integer;
BEGIN
  FOR v_owner IN
    SELECT pg_get_userbyid(proowner) FROM pg_proc
     WHERE proname IN ('begin_totp_enrolment','get_totp_factor','confirm_totp_enrolment','record_totp_verified','disable_totp_factor')
       AND pronamespace = 'keystone'::regnamespace
  LOOP
    IF v_owner IS DISTINCT FROM 'auth_owner' THEN
      RAISE EXCEPTION 'a Stage 8 totp function is owned by %, must be auth_owner', v_owner;
    END IF;
  END LOOP;

  IF has_function_privilege('public', 'keystone.begin_totp_enrolment(text,jsonb,smallint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE keystone.begin_totp_enrolment — the REVOKE degraded to a warning';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.begin_totp_enrolment(text,jsonb,smallint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE keystone.begin_totp_enrolment';
  END IF;

  -- ★★ FIX [MEASURED 22 Sep 2026]: the three begin_totp_enrolment(...) calls below passed a bare `1`
  --    for p_kek_version — an untyped integer literal defaults to `integer`, and Postgres does not
  --    implicitly resolve that to the declared `smallint` parameter when picking a function overload,
  --    so the call failed with "function ...(text, jsonb, integer) does not exist" even though the
  --    only declared overload takes smallint. Cast to `::smallint` at all three call sites.
  -- 1 · begin
  SELECT keystone.begin_totp_enrolment(v_uid, '{"v":1,"purpose":"totp_secret","ciphertext":"x","wrappedKey":"y"}'::jsonb, 1::smallint) INTO v_id;

  -- 2 · get, unconfirmed
  SELECT * INTO v_row FROM keystone.get_totp_factor(v_uid);
  IF v_row.id IS DISTINCT FROM v_id OR v_row.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'get_totp_factor did not return the freshly begun UNCONFIRMED row';
  END IF;

  -- 3 · confirm with ten hashes (32 bytes each, no pgcrypto — 0002 — so built with decode/lpad)
  SELECT array_agg(decode(lpad(n::text, 64, '0'), 'hex')) INTO v_hashes FROM generate_series(1, 10) AS n;
  SELECT keystone.confirm_totp_enrolment(v_uid, v_id, v_hashes) INTO v_inserted;
  IF v_inserted <> 10 THEN
    RAISE EXCEPTION 'confirm_totp_enrolment inserted % backup codes, expected 10', v_inserted;
  END IF;
  SELECT count(*) INTO v_code_count FROM keystone_auth.backup_code WHERE factor_id = v_id;
  IF v_code_count <> 10 THEN
    RAISE EXCEPTION 'keystone_auth.backup_code holds % rows for the confirmed factor, expected 10', v_code_count;
  END IF;

  -- positive control: get_totp_factor now reports confirmed, with 10 unused codes
  SELECT * INTO v_row FROM keystone.get_totp_factor(v_uid);
  IF v_row.confirmed_at IS NULL OR v_row.unused_backup_codes <> 10 THEN
    RAISE EXCEPTION 'get_totp_factor reports confirmed_at=% unused_backup_codes=% after confirm_totp_enrolment succeeded', v_row.confirmed_at, v_row.unused_backup_codes;
  END IF;

  -- confirm_totp_enrolment refuses a second confirm of the same (already-confirmed) row
  BEGIN
    PERFORM keystone.confirm_totp_enrolment(v_uid, v_id, v_hashes);
  EXCEPTION WHEN OTHERS THEN
    v_dup_failed := true;
  END;
  IF NOT v_dup_failed THEN
    RAISE EXCEPTION 'confirm_totp_enrolment allowed confirming an already-confirmed factor a second time';
  END IF;

  -- begin_totp_enrolment now refuses (23505) for the same uid — a confirmed factor exists
  BEGIN
    PERFORM keystone.begin_totp_enrolment(v_uid, '{"v":1,"purpose":"totp_secret","ciphertext":"x2","wrappedKey":"y2"}'::jsonb, 1::smallint);
  EXCEPTION WHEN unique_violation THEN
    v_conflict := true;
  END;
  IF NOT v_conflict THEN
    RAISE EXCEPTION 'begin_totp_enrolment allowed a second enrolment over an already-confirmed factor';
  END IF;

  -- POSITIVE CONTROL: a DIFFERENT uid begins freely at the same moment
  SELECT keystone.begin_totp_enrolment(v_uid2, '{"v":1,"purpose":"totp_secret","ciphertext":"x3","wrappedKey":"y3"}'::jsonb, 1::smallint) INTO v_id2;

  -- 4 · record_totp_verified
  SELECT keystone.record_totp_verified(v_uid, v_id) INTO v_verified;
  IF v_verified IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'record_totp_verified returned % for a real confirmed factor, expected true', v_verified;
  END IF;
  -- POSITIVE CONTROL against a wrong id: reports false, not an error
  SELECT keystone.record_totp_verified(v_uid, v_id2) INTO v_wrong_id_result;
  IF v_wrong_id_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'record_totp_verified reported % for a factor id that does not belong to the uid, expected false', v_wrong_id_result;
  END IF;

  -- 5 · disable
  SELECT keystone.disable_totp_factor(v_uid) INTO v_disabled;
  IF v_disabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'disable_totp_factor returned % for a real confirmed factor, expected true', v_disabled;
  END IF;
  -- cascade proof: its backup codes are gone too
  SELECT count(*) INTO v_code_count FROM keystone_auth.backup_code WHERE factor_id = v_id;
  IF v_code_count <> 0 THEN
    RAISE EXCEPTION 'disable_totp_factor left % backup_code row(s) behind, expected the CASCADE to remove all of them', v_code_count;
  END IF;
  -- POSITIVE CONTROL: the OTHER uid's still-unconfirmed factor is untouched
  IF NOT EXISTS (SELECT 1 FROM keystone_auth.totp_factor WHERE id = v_id2) THEN
    RAISE EXCEPTION 'disable_totp_factor removed a row belonging to a different uid';
  END IF;

  -- clean up
  DELETE FROM keystone_auth.totp_factor WHERE firebase_uid IN (v_uid, v_uid2);

  RAISE NOTICE 'Stage 8 task 8.8 totp functions self-check: lifecycle, conflict refusal, cascade and grants all correct, proof rows cleaned up';
END $$;

SET LOCAL ROLE app_owner;   -- ★ F482: hand the role back explicitly, at the very end. NEVER RESET ROLE.
