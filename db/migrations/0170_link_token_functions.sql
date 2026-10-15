-- 0170_link_token_functions
-- Stage 5 task 5.5 · CT-019 · CCR-9 (revoke keys on token_id, tenant from the transaction) ·
-- CCR-10 (peek_link_token, the non-spending sibling).
--
-- ★★★ FOUR SECURITY DEFINER FUNCTIONS, ALL OWNED BY auth_owner, ALL WITH AN EMPTY search_path, ALL
--     RETURNING NOTHING BUT uuids. The return type IS the safety argument: task 5.9 puts all four
--     into CREDENTIAL_RESOLVERS in db/gates/catalog-conformance.mjs, and :668 then refuses any
--     result type that mentions text, bytea or jsonb. So the purpose travels IN as p_purposes and a
--     uuid comes OUT — the same idiom as keystone.authorize_api_token (CT-090).
--
-- ★★★ CREATED *AS* auth_owner, NEVER CREATE-THEN-ALTER-OWNER. 0017:65-76 and F482 measured the trap:
--     while app_owner is the owner, a GRANT EXECUTE is folded into the owner's implicit ACL entry,
--     and ALTER FUNCTION ... OWNER TO then rewrites that entry and the grant is GONE — with no error
--     at either statement. db/gates/catalog-conformance.mjs:680-694 would then fail the function for
--     a NULL proacl, which means "EXECUTE to PUBLIC", not "no access". SET ROLE first; there is
--     nothing to transfer.
--
-- ★★ WHY redeem AND peek EACH WRITE THE FIVE PREDICATES OUT IN FULL, rather than sharing a helper.
--    A shared helper would have to be a fifth auth_owner-owned function reading keystone.link_token,
--    and check 12's allow-list (task 5.9 part C) names exactly these four; a fifth reader is reported
--    as an unexpected reader of a USING (true) table, which is the F501 shape that check exists to
--    pin. So the predicates are written twice, and test (k) of test/s5_link_token.test.mjs proves the
--    two copies agree on EVERY refusal — a peek that starts accepting what a redeem refuses is
--    exactly what drift here would look like.

SET LOCAL ROLE auth_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · MINT — the only way a row is created.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ IT ASSERTS p_tenant = current_tenant_id() AND RAISES OTHERWISE (critic K1-5-6). The function
--     is SECURITY DEFINER, so without that clause it would mint a token into any practice whose id
--     the caller could name. The argument stays for readability; it is CHECKED, not used.
--   ★ IS DISTINCT FROM, not <>: with no tenant context current_tenant_id() is NULL (0001:61-93), and
--     `p_tenant <> NULL` is NULL, which is not TRUE, so a plain comparison would let a contextless
--     mint through. The contextless case must raise, like every other.
--   ★ plpgsql rather than sql, for the RAISE. Every identifier is qualified because search_path is
--     empty; now() resolves from pg_catalog, which is always implicitly present.
CREATE FUNCTION keystone.mint_link_token(
  p_tenant uuid,
  p_token_id text,
  p_secret_hash bytea,
  p_purpose text,
  p_subject_type text,
  p_subject_id uuid,
  p_issued_to uuid,
  p_ttl interval)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION
      'mint_link_token: p_tenant is not the current practice. A SECURITY DEFINER mint must never take a tenant id on trust, so this is refused rather than minted into the practice the caller named.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO keystone.link_token
    (tenant_id, token_id, secret_hash, purpose, subject_type, subject_id, issued_to, expires_at)
  VALUES
    (p_tenant, p_token_id, p_secret_hash, p_purpose, p_subject_type, p_subject_id, p_issued_to,
     now() + p_ttl)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION keystone.mint_link_token(uuid, text, bytea, text, text, uuid, uuid, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.mint_link_token(uuid, text, bytea, text, text, uuid, uuid, interval) TO app_rw;

COMMENT ON FUNCTION keystone.mint_link_token(uuid, text, bytea, text, text, uuid, uuid, interval) IS
  'Stage 5 / 0170 (CT-019). Creates one keystone.link_token row and returns its id and nothing else.
   Raises insufficient_privilege unless p_tenant is the current practice, so a SECURITY DEFINER mint
   cannot be pointed at another practice; the link_token_mint_insert policy is the second, independent
   mechanism. The caller hashes the secret (HMAC-SHA256 peppered with KEYSTONE_TOKEN_PEPPER) and the
   secret itself never reaches the database.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · REDEEM — the spend. ONE statement, so the find and the spend cannot race.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ THIS FUNCTION DOES NOT ASSERT THE TENANT — IT IS HOW THE TENANT IS DISCOVERED. It runs with no
--     tenant context at all (src/db/index.mjs withCredentialLookup), which is why 0169 admits
--     auth_owner to this table with USING (true). What stands between a stranger and a practice's row
--     is the 43-character secret and the digest comparison, which happens HERE, in Postgres, on a
--     bytea, as an index probe — never in JavaScript, because returning secret_hash to app_rw is
--     precisely what db/gates/catalog-conformance.mjs:668 forbids.
--   ★ The five predicates are the whole refusal set: wrong secret, wrong purpose, already spent,
--     revoked, expired. All five return NO ROW, so the presenter cannot tell them apart, and an
--     unknown token_id is a sixth shape of the same answer.
CREATE FUNCTION keystone.redeem_link_token(p_token_id text, p_secret_hash bytea, p_purposes text[])
RETURNS TABLE (tenant_id uuid, subject_id uuid, issued_to uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE keystone.link_token t
     SET redeemed_at = now()
   WHERE t.token_id    = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.purpose     = ANY (p_purposes)
     AND t.redeemed_at IS NULL
     AND t.revoked_at  IS NULL
     AND t.expires_at  > now()
  RETURNING t.tenant_id, t.subject_id, t.issued_to
$$;

REVOKE ALL ON FUNCTION keystone.redeem_link_token(text, bytea, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.redeem_link_token(text, bytea, text[]) TO app_rw;

COMMENT ON FUNCTION keystone.redeem_link_token(text, bytea, text[]) IS
  'Stage 5 / 0170 (CT-019). Spends a link token and returns the practice, the subject and the person
   it was issued to — three uuids and nothing else. p_purposes is what the CALLER will accept; a row
   whose purpose is outside it returns nothing, indistinguishably from a bad secret, an expired, a
   revoked or an already-spent token. Deliberately NOT tenant-scoped: discovering the practice is what
   it is for. Single-use, in one statement, so the find and the spend cannot race.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · PEEK — the same five predicates as a SELECT, with no UPDATE (CCR-10).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ STABLE, not VOLATILE, and that is an assertion rather than a hint: peek must be provably unable
--    to write. It exists so Stage 8 can render "you have been invited to X as Y — accept?" without
--    burning the invitation on page load. It stamps nothing and consumes nothing.
--  ★ CONDITION 1 TRAVELS WITH IT (CONTRACTS §11 CCR-11): peek is an UNAUTHENTICATED EXISTENCE ORACLE
--    — "does this token exist" is now answerable without spending anything — so the route that
--    eventually mounts it must be rate-limited on the SAME bucket as redeem. No route mounts either
--    in Stage 5; this is RECORDED here for Stage 7 and Stage 8 to read, not enforced here.
CREATE FUNCTION keystone.peek_link_token(p_token_id text, p_secret_hash bytea, p_purposes text[])
RETURNS TABLE (tenant_id uuid, subject_id uuid, issued_to uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT t.tenant_id, t.subject_id, t.issued_to
    FROM keystone.link_token t
   WHERE t.token_id    = p_token_id
     AND t.secret_hash = p_secret_hash
     AND t.purpose     = ANY (p_purposes)
     AND t.redeemed_at IS NULL
     AND t.revoked_at  IS NULL
     AND t.expires_at  > now()
$$;

REVOKE ALL ON FUNCTION keystone.peek_link_token(text, bytea, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.peek_link_token(text, bytea, text[]) TO app_rw;

COMMENT ON FUNCTION keystone.peek_link_token(text, bytea, text[]) IS
  'Stage 5 / 0170 (CCR-10). keystone.redeem_link_token without the spend: the same five predicates as
   a SELECT, so an unauthenticated screen can say what a link is for without consuming it. STABLE, so
   it cannot write. It applies the same revoked / expired / spent / wrong-purpose refusal with the
   same undifferentiated answer, and it is an existence oracle: any route mounting it is rate-limited
   on the same bucket as redeem.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 4 · REVOKE — tenant-scoped, and the ONLY one of the four that is.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ SCOPED TO tenant_id = current_tenant_id() (CCR-9). token_id is GLOBALLY unique, so without that
--     clause a SECURITY DEFINER revoke could kill another practice's token by naming its id. The
--     caller supplies the practice by running inside its transaction — never as an argument — which
--     is also why src/auth/linkToken.mjs takes the tenant-scoped transaction handle and refuses
--     anything else by name.
--   ★★ AND IT REFUSES A TOKEN THAT IS ALREADY FINISHED WITH: revoked_at IS NULL AND redeemed_at IS
--      NULL. Revoking a spent token would move revoked_at on a row whose story is already told, and
--      the honest answer to "did I revoke it" is then no. This is what makes the JS half idempotent
--      by construction: a second revoke matches no row and reports false, exactly like
--      keystone.revoke_api_token (0046).
CREATE FUNCTION keystone.revoke_link_token(p_token_id text, p_reason text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE keystone.link_token t
     SET revoked_at = now(), revoked_reason = p_reason
   WHERE t.token_id    = p_token_id
     AND t.tenant_id   = keystone.current_tenant_id()
     AND t.revoked_at  IS NULL
     AND t.redeemed_at IS NULL
  RETURNING t.id
$$;

REVOKE ALL ON FUNCTION keystone.revoke_link_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_link_token(text, text) TO app_rw;

COMMENT ON FUNCTION keystone.revoke_link_token(text, text) IS
  'Stage 5 / 0170 (CT-019, CCR-9). Kills a link token that has not been spent, in the CURRENT practice
   only, and returns its id or nothing. Keyed on token_id, the same identifier redeem and peek take, so
   the module has one way to name a token. The tenant is never an argument: it comes from the
   tenant-scoped transaction, which is what stops a definer revoking another practice''s link.';

-- ★★★ SET LOCAL ROLE app_owner, NEVER RESET ROLE. RESET ROLE returns to the SESSION role, which
--     db/migrate.mjs:179 establishes from a SUPERUSER connection — so RESET ROLE lands on the
--     superuser, silently, for the rest of the migration (0017:107-112 measured it).
SET LOCAL ROLE app_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE THE TWO SILENT FAILURES DID NOT HAPPEN, IN THE MIGRATION (0017:116-118).
--    Both of the things this pair of migrations can get wrong fail QUIETLY and look like "the
--    token is invalid": (1) the F482 owner-transfer trap, whose fingerprint is a NULL proacl —
--    which means "EXECUTE to PUBLIC", not "no access" (db/gates/catalog-conformance.mjs:680-694);
--    and (2) 0169's DEFECT 1, auth_owner holding no privilege on the table, where a missing POLICY
--    returns zero rows silently. Both are catalog facts, so they are asserted here, at apply time,
--    with a positive control against a negative one.
--  ★ The BEHAVIOUR — mint, redeem once, peek without spending, refuse the rest — is proved in
--    test/s5_link_token.test.mjs (a)-(l) against real practices with real secrets, which is where
--    it belongs; a migration cannot mint into keystone.tenant without first being a tenant.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  n integer;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef, p.proacl, p.proconfig
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'keystone'
       AND p.proname IN ('mint_link_token','redeem_link_token','peek_link_token','revoke_link_token')
  LOOP
    IF r.owner <> 'auth_owner' THEN
      RAISE EXCEPTION '0170: keystone.% is owned by % — it must be auth_owner, or 0169''s policies do not apply to it', r.proname, r.owner;
    END IF;
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION '0170: keystone.% is not SECURITY DEFINER', r.proname;
    END IF;
    -- ★★★ THE F482 FINGERPRINT. A null ACL is not "locked down"; it is the DEFAULT, which is
    --     EXECUTE TO PUBLIC — and it is what an ALTER FUNCTION … OWNER TO leaves behind.
    IF r.proacl IS NULL THEN
      RAISE EXCEPTION '0170: keystone.% has a NULL proacl. That is EXECUTE TO PUBLIC, not "no access" — the REVOKE/GRANT pair did not survive.', r.proname;
    END IF;
    IF NOT pg_catalog.has_function_privilege('app_rw', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0170: app_rw cannot EXECUTE keystone.% — the application could not call it', r.proname;
    END IF;
    IF r.proconfig IS NULL OR NOT ('search_path=' = ANY (SELECT left(c, 12) FROM unnest(r.proconfig) AS c)) THEN
      RAISE EXCEPTION '0170: keystone.% has no search_path setting — a SECURITY DEFINER without one is hijackable', r.proname;
    END IF;
    n := COALESCE(n, 0) + 1;
  END LOOP;

  IF COALESCE(n, 0) <> 4 THEN
    RAISE EXCEPTION '0170: found % of the four link-token functions, not 4', COALESCE(n, 0);
  END IF;

  -- ── 0169's DEFECT 1: A POLICY IS NOT A PRIVILEGE, and the grant half is the half that is easy
  --    to forget. NEGATIVE first, then the POSITIVE CONTROL, so "every privilege check is false"
  --    cannot pass for "app_rw is correctly locked out".
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.link_token', 'INSERT') THEN
    RAISE EXCEPTION '0170: app_rw holds INSERT on keystone.link_token. CCR-16 forbids it, and the UNIQUE_EXCEPTIONS argument for link_token_token_id_key rests on its absence.';
  END IF;
  IF NOT pg_catalog.has_table_privilege('auth_owner', 'keystone.link_token', 'SELECT') THEN
    RAISE EXCEPTION '0170: auth_owner cannot SELECT keystone.link_token — redeem and peek would fail with "permission denied for table link_token"';
  END IF;
  IF NOT pg_catalog.has_table_privilege('auth_owner', 'keystone.link_token', 'INSERT') THEN
    RAISE EXCEPTION '0170: auth_owner cannot INSERT keystone.link_token — mint would fail';
  END IF;
  IF NOT pg_catalog.has_column_privilege('auth_owner', 'keystone.link_token', 'redeemed_at', 'UPDATE') THEN
    RAISE EXCEPTION '0170: auth_owner cannot UPDATE link_token.redeemed_at — redeem could never spend a token';
  END IF;
  IF pg_catalog.has_column_privilege('auth_owner', 'keystone.link_token', 'secret_hash', 'UPDATE') THEN
    RAISE EXCEPTION '0170: auth_owner can UPDATE link_token.secret_hash — the UPDATE grant is meant to be column-level over the three lifecycle columns only';
  END IF;

  -- ── And the policy half, by name: three for auth_owner plus tenant_isolation for app_rw.
  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'link_token'
     AND policyname IN ('tenant_isolation','link_token_credential_read','link_token_mint_insert','link_token_spend_update');
  IF n <> 4 THEN
    RAISE EXCEPTION '0170: keystone.link_token carries % of its four named policies. A GRANT without a policy fails as ZERO ROWS, silently — which reads as "that token is invalid".', n;
  END IF;

  RAISE NOTICE '0170: four definers owned by auth_owner with non-null ACLs and an empty search_path; auth_owner privileged and policied on keystone.link_token; app_rw holds no INSERT';
END $$;
