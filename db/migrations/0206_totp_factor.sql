-- 0206_totp_factor
-- Stage 8 task 8.3 — CT-057. One sealed TOTP secret per IDENTITY (not per tenant, not per
-- membership). An identity that is a coach in one practice and a client in another has ONE second
-- factor, never two — this table has no tenant_id, deliberately, exactly as
-- keystone_auth.operator_grant (CT-039, "an operator has no row in any practice").
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE STANCE IS COPIED, DELIBERATELY, FROM `keystone_auth.session` (0020:164-181), THE SAME WAY
--     `keystone_auth.email_code` (0204) COPIES IT: ENABLE ROW LEVEL SECURITY but deliberately NOT
--     FORCE. FORCE applies the deny_all policy to the OWNER too, and the owner is `auth_owner` —
--     which owns the SECURITY DEFINER resolvers that read/write this table (0207's
--     `keystone.spend_backup_code`, and 8.8's enrol/confirm/verify functions). Forcing it here would
--     harden nothing and would make every second-factor check fail. A single `deny_all` policy,
--     `USING (false) WITH CHECK (false)`. NO GRANT TO app_rw ON THIS TABLE — reached only through
--     SECURITY DEFINER functions owned by `auth_owner`.
--
-- ★★★ THE SECRET_ENVELOPE SHAPE COMES FROM CT-061, MEASURED at src/secrets/envelope.mjs:112-129:
--     `sealSecret` returns exactly ten keys — v, tenantId, purpose, ciphertext, iv, tag, wrappedKey,
--     keyIv, keyTag, fingerprint. The CHECK below only asserts the three keys this table's own
--     invariant depends on (object shape, ciphertext, wrappedKey present, purpose pinned to
--     'totp_secret' — CT-062's closed purpose list, src/secrets/envelope.mjs:33-41, already includes
--     'totp_secret'). It does not duplicate the full ten-key shape check, which belongs to the
--     application layer (8.8) that calls sealSecret in the first place.
--
-- ★ `kek_version` is the 0212 idiom (db/migrations/0212_kek_version.sql, Stage 9 task 9.2, CONFIRMED
--   landed before this migration is dispatched — CONTRACTS §0 C-5 / Q0-21, ordering enforced by
--   dispatch order, not by migration filename order: db/migrate.mjs applies files in filename order
--   and 0206 sorts BEFORE 0212, so this migration itself does not and cannot depend on 0212's DDL
--   existing yet — it only borrows the same `kek_version smallint` column idiom that 0212
--   establishes elsewhere (db/migrations/0047_outbound_webhooks.sql:30-69 is the earlier precedent
--   MEASURED in STAGE-8-PLAN.md task 8.3 field 3).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★★ FIX [MEASURED 22 Sep 2026]: same defect as 0204/0205, same session — CREATE TABLE ran as
--    app_owner, which holds no USAGE on schema keystone_auth, and failed with "permission denied for
--    schema keystone_auth" before the ALTER TABLE … OWNER TO auth_owner below (which only re-owns a
--    table that already exists) ever ran.
SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.totp_factor (
  id              uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  -- NO tenant_id, deliberately: one identity, one second factor, across every practice.
  firebase_uid    text NOT NULL,
  -- CT-061's ten-key envelope, purpose 'totp_secret' (CT-062). The shared secret is never plain.
  secret_envelope jsonb NOT NULL
    CHECK (jsonb_typeof(secret_envelope) = 'object'
           AND secret_envelope ? 'ciphertext' AND secret_envelope ? 'wrappedKey'
           AND secret_envelope ? 'purpose'
           AND secret_envelope ->> 'purpose' = 'totp_secret'),
  kek_version     smallint NOT NULL DEFAULT 1 CHECK (kek_version >= 1),
  confirmed_at    timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- CT-057: one CONFIRMED factor per identity. An unconfirmed enrolment may be restarted freely.
CREATE UNIQUE INDEX totp_factor_one_confirmed_idx
  ON keystone_auth.totp_factor (firebase_uid) WHERE confirmed_at IS NOT NULL;
CREATE INDEX totp_factor_by_uid_idx ON keystone_auth.totp_factor (firebase_uid);

ALTER TABLE keystone_auth.totp_factor ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.totp_factor USING (false) WITH CHECK (false);

-- ★★★ BUILD-TIME CORRECTION (not in the plan's literal field-6 SQL — added here, reported with the
--     build; the identical fix and identical reason as task 8.2's F609). Without this the table
--     stays owned by the migration runner (app_owner), not auth_owner, and 0020:60-62's rule applies
--     here too: "every table here must be owned by auth_owner so that the deny_all policy … leaves
--     exactly one role able to read them — the one the definer functions run as." Left as app_owner,
--     0207's `keystone.spend_backup_code` (which SELECTs this table via a JOIN) would silently see
--     zero rows always, and 8.8's enrol/confirm/verify functions would fail every write with a
--     row-security violation. Filed as a finding (grep FINDINGS.md for "0206").
ALTER TABLE keystone_auth.totp_factor OWNER TO auth_owner;

COMMENT ON TABLE keystone_auth.totp_factor IS
  'CT-057 — one sealed TOTP secret per identity (no tenant_id: the factor belongs to the identity, not a membership). ENABLE but not FORCE, deny_all policy, no app_rw grant — reached only through SECURITY DEFINER functions (keystone.spend_backup_code here, 8.8''s enrol/confirm/verify functions). Shape copied from keystone_auth.session (0020).';

COMMENT ON COLUMN keystone_auth.totp_factor.secret_envelope IS
  'CT-061 envelope, purpose totp_secret. NEVER logged, never returned by any route, never in an '
  'error message. The provisioning URI is shown once at enrolment and is not stored.';

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS — a table left owned by the
--    migration runner applies "cleanly" and leaves every SECURITY DEFINER function that touches it
--    silently unable to see or write its own rows (0204/0205's identical self-check, F609).
DO $$
DECLARE
  v_table_owner text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_table_owner
    FROM pg_class WHERE oid = 'keystone_auth.totp_factor'::regclass;
  IF v_table_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone_auth.totp_factor is owned by %, must be auth_owner — otherwise the deny_all policy blocks the SECURITY DEFINER functions that read/write it (0020:60-62)', v_table_owner;
  END IF;

  IF has_table_privilege('app_rw', 'keystone_auth.totp_factor', 'SELECT') THEN
    RAISE EXCEPTION 'app_rw can SELECT keystone_auth.totp_factor — this table must be reached only through SECURITY DEFINER functions';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.totp_factor', 'INSERT') THEN
    RAISE EXCEPTION 'app_rw can INSERT keystone_auth.totp_factor — this table must be reached only through SECURITY DEFINER functions';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.totp_factor', 'UPDATE') THEN
    RAISE EXCEPTION 'app_rw can UPDATE keystone_auth.totp_factor — this table must be reached only through SECURITY DEFINER functions';
  END IF;
  IF has_table_privilege('app_rw', 'keystone_auth.totp_factor', 'DELETE') THEN
    RAISE EXCEPTION 'app_rw can DELETE keystone_auth.totp_factor — this table must be reached only through SECURITY DEFINER functions';
  END IF;
END $$;

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly, at the very end. NEVER RESET ROLE.
