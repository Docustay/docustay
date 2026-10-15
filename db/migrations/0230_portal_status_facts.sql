-- 0230_portal_status_facts
-- CT-104 / 12-signup-first-run-people.md §3.2 (A4) — the two new facts `portalStatus()`
-- (src/people/portalStatus.mjs) needs and cannot get any other way:
--   1. `keystone.app_user.email_bounced_at` — set by the extended `email.bounced` webhook handler
--      (src/routes/webhooks.mjs).
--   2. `keystone.person_ever_signed_in(uuid)` — `keystone_auth.session` carries no grant to
--      `app_rw` (0020:168,178,235,250,267 — ENABLE but not FORCE, deny_all, EXECUTE-only via its
--      three existing definers), so a list query running as `app_rw` cannot read it directly.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ORDERING, AND WHY (§3.2's own note). The `ALTER TABLE keystone.app_user ADD COLUMN` below
--     MUST run FIRST, as `app_owner` (the default migration role) — `app_owner` owns `app_user`
--     and `auth_owner` does not, so that statement cannot run inside the `SET LOCAL ROLE
--     auth_owner` block that follows. The function is then created WHILE STILL `auth_owner`, for
--     the reason `0204_email_code.sql`'s own comment records: switching back to `app_owner`
--     before creating a `LANGUAGE sql` function that references a `keystone_auth` table breaks
--     `check_function_bodies` validation, because the CREATING role cannot see the table it
--     names. This migration reuses that exact lesson rather than rediscovering it.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.app_user ADD COLUMN email_bounced_at timestamptz;

COMMENT ON COLUMN keystone.app_user.email_bounced_at IS
  'CT-104 §3.2 — set by the extended email.bounced webhook handler (src/routes/webhooks.mjs). Outranks active/invited in portalStatus() (src/people/portalStatus.mjs) — a bounced address is a live problem even for someone who has signed in before.';

-- ★ A small partial index: every People list this spec touches reads this column, and a full scan
--   of app_user per list render is the wrong default even at the platform's current size.
CREATE INDEX app_user_email_bounced_idx ON keystone.app_user (tenant_id)
  WHERE email_bounced_at IS NOT NULL;

-- ★★★ SAME IDIOM AS `keystone.issue_email_code`/`redeem_email_code` (0204) AND
--     `keystone.resolve_session` (0020): schema `keystone`, SET search_path = '', owner
--     `auth_owner`, REVOKE FROM PUBLIC, GRANT EXECUTE TO app_rw, app_owner.
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.person_ever_signed_in(p_app_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone_auth.session WHERE app_user_id = p_app_user_id
  );
$$;

ALTER FUNCTION keystone.person_ever_signed_in(uuid) OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.person_ever_signed_in(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.person_ever_signed_in(uuid) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.person_ever_signed_in(uuid) IS
  'CT-104 §3.2 — has this app_user ever had a session row? §4: takes an app_user_id the CALLER already resolved under its own RLS-scoped query (called from inside a list SQL statement already filtered to the viewer''s tenant via scoped()) — does not itself accept or leak a tenant id, matching the narrow-definer-function idiom is_guardian_of()/resolve_session both already use. First caller: src/people/portalStatus.mjs (12-signup-first-run-people.md).';

SET LOCAL ROLE app_owner;  -- never a bare RESET ROLE — F482, restated at 0204's own preamble

-- ★★ THE MIGRATION PROVES THE PART THAT FAILS QUIETLY BEFORE IT COMMITS — a REVOKE that degraded
--    to a warning, or a grant that never landed, applies "cleanly" and leaves either a function
--    nobody can call or one PUBLIC can call. Same shape as 0204's own verification block.
DO $$
DECLARE
  v_owner_fn text;
BEGIN
  SELECT pg_get_userbyid(proowner) INTO v_owner_fn
    FROM pg_proc WHERE oid = 'keystone.person_ever_signed_in(uuid)'::regprocedure;
  IF v_owner_fn IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION 'keystone.person_ever_signed_in is owned by %, must be auth_owner — otherwise it is filtered by keystone_auth.session''s own (non-forced) policy the same way any other non-owner role would be', v_owner_fn;
  END IF;

  IF NOT has_function_privilege('app_rw', 'keystone.person_ever_signed_in(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'app_rw cannot EXECUTE keystone.person_ever_signed_in';
  END IF;
  IF has_function_privilege('public', 'keystone.person_ever_signed_in(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can EXECUTE keystone.person_ever_signed_in — the REVOKE degraded to a warning (0121 TRAP 1)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'app_user' AND column_name = 'email_bounced_at'
  ) THEN
    RAISE EXCEPTION 'keystone.app_user.email_bounced_at was not created';
  END IF;
END $$;
