-- 0207_backup_code
-- Stage 8 task 8.3 — CT-057. Ten one-time backup codes per confirmed TOTP factor, and the single
-- function that is the only way to spend one.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ Same RLS stance as 0206_totp_factor.sql / keystone_auth.session (0020:164-181): ENABLE, a single
--   deny_all policy, NOT FORCE (FORCE would filter keystone.spend_backup_code, owned by auth_owner,
--   and break every backup-code check), and NO GRANT TO app_rw on the table itself.
--
-- ★ `code_hash` is the same hashing idiom as a session secret (0020:120-127) and an email code
--   (0204): HMAC-SHA256 with KEYSTONE_TOKEN_PEPPER, 32 bytes, never bcrypt/argon2 (256 CSPRNG bits
--   already, a work factor multiplies an already-infeasible search).
--
-- ★★★ `keystone.spend_backup_code` LIVES IN SCHEMA `keystone`, NOT `keystone_auth`, AND IS OWNED BY
--     `auth_owner`, `SET search_path = ''` — the 0020 idiom `0204_email_code.sql` explains at length
--     (K1-8-2, CCR-3, CCR-5): `db/gates/catalog-conformance.mjs` scans
--     `WHERE n.nspname = 'keystone' AND p.prosecdef`, so a definer created in `keystone_auth` is
--     invisible to the gate. This one IS a credential resolver (task 8.21 adds it to
--     CREDENTIAL_RESOLVERS) — its return type is already `boolean`, which
--     `catalog-conformance.mjs:the-forbidden-type-check` already permits (no text/bytea/jsonb/json/
--     varchar/char/name anywhere in the result), so only the schema, the search_path and the owner
--     change here, never the return shape.
--
-- ★ THE UPDATE IS THE CHECK — no read-then-write gap. `spend_backup_code` marks a code used in the
--   SAME statement that verifies it is live, unused and belongs to a CONFIRMED factor, so two
--   concurrent callers presenting the same code cannot both succeed.
--
-- ★★★ BUILD-TIME CORRECTION #2, DIFFERENT FROM 0206's / 0204's / 0205's — THIS ONE CANNOT BE FIXED
--     BY A TRAILING `ALTER TABLE … OWNER TO auth_owner`, AND USES THE 0020/0184 `SET LOCAL ROLE
--     auth_owner` PREAMBLE INSTEAD. `factor_id … REFERENCES keystone_auth.totp_factor(id)` below is
--     a NEW situation neither 0204 nor 0205 had: an FK from one `keystone_auth` table into ANOTHER
--     one already owned by `auth_owner` (0206 committed first). `db/migrate.mjs:317` runs
--     `SET ROLE app_owner` — SESSION-level, not LOCAL — before every migration file, so this file's
--     `CREATE TABLE` starts as `app_owner`. `scripts/bootstrap-roles.mjs:169-172` (MEASURED,
--     `\du app_owner` → "No inheritance"): `app_owner` is **NOINHERIT**, and the `GRANT auth_owner TO
--     app_owner` membership is itself re-issued `WITH INHERIT FALSE` — membership permits an
--     EXPLICIT `SET ROLE auth_owner` (used for `ALTER FUNCTION … OWNER TO auth_owner` and by 0206),
--     but confers NO automatic REFERENCES/SELECT/INSERT privilege on objects `auth_owner` owns. A
--     bare `CREATE TABLE … REFERENCES keystone_auth.totp_factor(id)` run as `app_owner` would fail
--     outright with `permission denied for table totp_factor` — loud, not silent, but still a defect
--     in field 6's literal SQL, which names no `SET LOCAL ROLE` and no `GRANT REFERENCES`. Fixed here
--     by creating this table (and its function) while `SET LOCAL ROLE auth_owner` is active — the
--     exact 0020 (`0020:62`) / 0184 (`0184:44`) idiom, chosen over an explicit `GRANT REFERENCES ON
--     keystone_auth.totp_factor TO app_owner` because it also makes `backup_code` OWNED BY
--     `auth_owner` from creation, with no separate `ALTER TABLE … OWNER TO auth_owner` needed
--     afterward (unlike 0206/0204/0205, which have no such cross-table FK and keep the simpler
--     explicit-ALTER idiom). Filed as a finding (grep FINDINGS.md for "0207").
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.backup_code (
  id         uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  factor_id  uuid NOT NULL REFERENCES keystone_auth.totp_factor(id) ON DELETE CASCADE,
  -- Same hashing idiom as a session secret and an email code: HMAC-SHA256 with the pepper, 32 bytes.
  code_hash  bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX backup_code_unique_idx ON keystone_auth.backup_code (factor_id, code_hash);
CREATE INDEX backup_code_unused_idx ON keystone_auth.backup_code (factor_id) WHERE used_at IS NULL;

ALTER TABLE keystone_auth.backup_code ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.backup_code USING (false) WITH CHECK (false);

-- ★ No separate `ALTER TABLE … OWNER TO auth_owner` needed here (unlike 0206/0204/0205): this table
--   is created WHILE `SET LOCAL ROLE auth_owner` is active (see the header block above), so it is
--   owned by `auth_owner` from the moment it exists — the same reason `keystone_auth.session`
--   (0020:107) and `keystone_auth.operator_grant` (0184) need no trailing ALTER either.

COMMENT ON TABLE keystone_auth.backup_code IS
  'CT-057 — ten one-time backup codes per confirmed TOTP factor, cascade-deleted with the factor. ENABLE but not FORCE, deny_all policy, no app_rw grant — reached only through keystone.spend_backup_code. Shape copied from keystone_auth.session (0020).';

-- Returns true exactly once per code. The UPDATE is the check: no read-then-write gap.
-- ★★★ SCHEMA `keystone`, `search_path = ''`, owner auth_owner — the 0020 idiom (see the header above
--     for the full reason). This one IS a credential resolver and task 8.21 adds it to
--     CREDENTIAL_RESOLVERS. `boolean` already satisfies catalog-conformance.mjs's forbidden-type
--     check, so the return shape does not change; only the schema, the search_path and the owner do.
CREATE FUNCTION keystone.spend_backup_code(p_firebase_uid text, p_code_hash bytea)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH hit AS (
    UPDATE keystone_auth.backup_code b SET used_at = now()
      FROM keystone_auth.totp_factor f
     WHERE b.factor_id = f.id AND f.firebase_uid = p_firebase_uid
       AND f.confirmed_at IS NOT NULL
       AND b.code_hash = p_code_hash AND b.used_at IS NULL
    RETURNING b.id
  ) SELECT EXISTS (SELECT 1 FROM hit);
$$;

-- ★ No separate `ALTER FUNCTION … OWNER TO auth_owner` needed either — created while `SET LOCAL ROLE
--   auth_owner` is active, exactly as keystone.resolve_tenant_by_slug/resolve_session (0020) and
--   0184's three resolvers are, none of which carry an explicit ALTER either.
REVOKE ALL ON FUNCTION keystone.spend_backup_code(text,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.spend_backup_code(text,bytea) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.spend_backup_code(text,bytea) IS
  'CT-057 — spends one unused backup code for the CONFIRMED totp_factor matching p_firebase_uid, if p_code_hash matches an unused row. The UPDATE is the check (no read-then-write gap): returns true exactly once per code, false on any second attempt, an unconfirmed factor, or a wrong hash. Credential resolver (task 8.21). First caller: 8.8''s verify path.';

-- ★★ FIX [MEASURED 22 Sep 2026]: this file used to `SET LOCAL ROLE app_owner` HERE, before the
--    self-check below — but the self-check casts `'keystone_auth.backup_code'::regclass`, and a
--    qualified-name `::regclass` cast requires schema USAGE for the CURRENT role, same as any other
--    name resolution (isolated repro: `SELECT 'keystone_auth.totp_factor'::regclass` as app_owner
--    fails with the identical "permission denied for schema keystone_auth" this migration hit).
--    Role now stays `auth_owner` through the self-check too, and is handed back at the very end —
--    the 0204/0205/0206/0208 pattern, same session.
-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS — a REVOKE that degraded to
--    a warning, a grant that never landed, or a table left owned by the wrong role, all apply
--    "cleanly" and leave either a function nobody can call, one PUBLIC can call, or a function that
--    silently sees zero rows forever (0204/0205's identical self-check, F609; this file's own
--    cross-table-FK variant of the same defect class is F611).
DO $$
DECLARE
  v_owner        text;
  v_result       text;
  v_table_owner  text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_table_owner
    FROM pg_class WHERE oid = 'keystone_auth.backup_code'::regclass;
  IF v_table_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone_auth.backup_code is owned by %, must be auth_owner — otherwise the deny_all policy blocks keystone.spend_backup_code''s own writes (0020:60-62)', v_table_owner;
  END IF;

  SELECT pg_get_userbyid(proowner), pg_get_function_result(oid) INTO v_owner, v_result
    FROM pg_proc WHERE oid = 'keystone.spend_backup_code(text,bytea)'::regprocedure;
  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone.spend_backup_code is owned by %, must be auth_owner', v_owner;
  END IF;
  IF v_result IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'keystone.spend_backup_code returns %, must be boolean', v_result;
  END IF;

  IF NOT has_function_privilege('app_rw', 'keystone.spend_backup_code(text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE keystone.spend_backup_code';
  END IF;
  IF has_function_privilege('public', 'keystone.spend_backup_code(text,bytea)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE keystone.spend_backup_code — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.backup_code', 'SELECT') THEN
    RAISE EXCEPTION 'app_rw can SELECT keystone_auth.backup_code — this table must be reached only through keystone.spend_backup_code';
  END IF;
END $$;

SET LOCAL ROLE app_owner;   -- ★ F482: hand the role back explicitly, at the very end. NEVER RESET ROLE.
