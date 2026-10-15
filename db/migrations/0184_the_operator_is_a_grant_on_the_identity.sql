-- 0184_the_operator_is_a_grant_on_the_identity
-- Stage 7 task 7.4 — CT-039. The operator stops being a staff role and becomes a GRANT on an
-- identity: `keystone_auth.operator_grant` plus three SECURITY DEFINER functions in schema
-- `keystone` that are the ONLY way to reach it.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE SHAPE IS COPIED, DELIBERATELY, FROM `keystone_auth.session` (0020:107-267) — the same
--     schema, for the same reason: `keystone_auth` is the credential schema, OUTSIDE the tenant RLS
--     regime, protected by PRIVILEGE SEPARATION rather than a tenant predicate. See 0020's own
--     header for the full argument; it is not re-derived here.
--
--   · ENABLE ROW LEVEL SECURITY but deliberately **NOT FORCE** (0020:170-177's reasoning, verbatim
--     here too): FORCE applies a policy to the OWNER, and the owner is `auth_owner` — which owns
--     the SECURITY DEFINER resolvers below. Forcing it would hardennothing (no non-owner role holds
--     any grant on the table at all — see below) and would break every one of those three functions.
--   · A single `deny_all` policy, `USING (false) WITH CHECK (false)`.
--   · **No `app_rw` grant** — not SELECT, not anything. Two independent mechanisms, same as 0020:
--     an ABSENT PRIVILEGE, and a policy that is false for the one role that is not the owner and
--     might otherwise reach it. The catalog gate asserts SQLSTATE 42501, never "zero rows".
--
-- ★★★ NO `tenant_id`, EVER (CT-039). An operator grant names an IDENTITY (a Firebase uid), not a
--     membership in any one practice — the whole point of the grant is that it is orthogonal to
--     tenancy. A self-check `DO` block below asserts the column does not exist, so a later
--     migration cannot add one back quietly.
--
-- ★ F501 (the reference-practice leak) does not apply to the three functions below: none of them
--   reads a tenant-scoped table at all, so there is no reference practice's rows for them to leak.
--
-- ★★ THE FUNCTIONS LIVE IN SCHEMA `keystone`, NOT `keystone_auth` (CCR-3) — the existing session
--    resolvers (`resolve_tenant_by_slug`, `resolve_session`, `create_session`,
--    `revoke_sessions_for_uid`, 0020:197-267) already set that convention, and a second one would
--    be its own inconsistency. They are created here while still `SET LOCAL ROLE auth_owner`
--    (auth_owner holds `USAGE, CREATE` on schema `keystone` — `scripts/bootstrap-roles.mjs:533`),
--    exactly as 0020's own resolvers are.
--
-- ★ `keystone.grant_operator` and `keystone.revoke_operator` are `GRANT EXECUTE`d to `app_rw` (and
--   `app_owner`) — same as every 0020 resolver — because `src/platform/operatorGrant.mjs` reaches
--   them through the ordinary application connection (`withCredentialLookup`, which runs with no
--   tenant GUC set — exactly right here, since this table is not tenant-scoped at all).
--   `scripts/operator-grant.mjs` is their first real caller (CCR-12): without it, this migration's
--   own bootstrap grant (0186, Q7-10) would be a credential nothing could ever revoke.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

CREATE TABLE keystone_auth.operator_grant (
  id             uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  firebase_uid   text NOT NULL,
  granted_by     text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  reason         text NOT NULL CHECK (btrim(reason) <> ''),
  CONSTRAINT operator_grant_ends_after_it_starts CHECK (expires_at > granted_at),
  CONSTRAINT operator_grant_revoked_has_reason
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX operator_grant_uid_live_idx
  ON keystone_auth.operator_grant (firebase_uid, expires_at DESC) WHERE revoked_at IS NULL;
ALTER TABLE keystone_auth.operator_grant ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON keystone_auth.operator_grant USING (false) WITH CHECK (false);
-- No GRANT to app_rw, app_signup, app_worker or anyone. Reached only through the three functions.

COMMENT ON TABLE keystone_auth.operator_grant IS
  'CT-039 / Stage 7 task 7.4 — the operator is a GRANT on an identity, not a staff role or a tenant membership. No tenant_id, ever (self-checked below). ENABLE but not FORCE, deny_all policy, no app_rw grant — reached only through keystone.operator_grant_active / keystone.grant_operator / keystone.revoke_operator. Shape copied from keystone_auth.session (0020).';

-- ★★★ THE SELF-CHECK CT-039 ASKS FOR — A LATER MIGRATION CANNOT ADD `tenant_id` QUIETLY.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone_auth' AND table_name = 'operator_grant' AND column_name = 'tenant_id'
  ) THEN
    RAISE EXCEPTION 'keystone_auth.operator_grant has grown a tenant_id column — CT-039 requires this table to NEVER be tenant-scoped: an operator grant names an identity, not a membership in one practice.';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE THREE RESOLVERS — in schema keystone, owned by auth_owner (already SET LOCAL ROLE above).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── is this uid an operator RIGHT NOW ─────────────────────────────────────────
CREATE FUNCTION keystone.operator_grant_active(p_uid text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone_auth.operator_grant
     WHERE firebase_uid = p_uid AND revoked_at IS NULL AND expires_at > now()
  )
$$;
REVOKE ALL ON FUNCTION keystone.operator_grant_active(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.operator_grant_active(text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.operator_grant_active(text) IS
  'CT-039 — true when p_uid holds a live (not revoked, not expired) operator_grant row. RETURNS boolean and nothing else. 7.6''s keystone.caller_is_platform() reads the operator GUC through this after Stage 7; scripts/operator-grant.mjs list uses it too. No non-test application caller until 7.6/9.x — recorded as a knowing baseline orphan (db/gates/wiring-baseline.json).';

-- ── ISSUE a grant — the only INSERT path this table will ever have ───────────
-- ★ Refuses a blank reason, refuses an expires_at that is not strictly in the future, and refuses a
--   SECOND active grant for the same uid — CT-039's own note: `UNIQUE (firebase_uid) WHERE
--   revoked_at IS NULL AND expires_at > now()` is impossible (now() is not immutable), so the
--   function IS the uniqueness, checked and enforced in the same statement that inserts.
CREATE FUNCTION keystone.grant_operator(
  p_uid text, p_granted_by text, p_reason text, p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_uid IS NULL OR btrim(p_uid) = '' THEN
    RAISE EXCEPTION 'grant_operator: p_uid must not be blank';
  END IF;
  IF p_granted_by IS NULL OR btrim(p_granted_by) = '' THEN
    RAISE EXCEPTION 'grant_operator: p_granted_by must not be blank';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'grant_operator: p_reason must not be blank';
  END IF;
  IF p_expires_at <= now() THEN
    RAISE EXCEPTION 'grant_operator: p_expires_at (%) must be strictly in the future', p_expires_at;
  END IF;

  -- ★★★ THE UNIQUENESS CHECK CT-039 SAYS CANNOT BE A PARTIAL UNIQUE INDEX. Checked and enforced
  --     inside the SAME function call as the INSERT, so there is no window between the check and
  --     the write for a second caller to land a second active grant in.
  IF EXISTS (
    SELECT 1 FROM keystone_auth.operator_grant
     WHERE firebase_uid = p_uid AND revoked_at IS NULL AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'grant_operator: uid % already holds an active operator grant', p_uid;
  END IF;

  INSERT INTO keystone_auth.operator_grant (firebase_uid, granted_by, expires_at, reason)
  VALUES (p_uid, p_granted_by, p_expires_at, p_reason)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION keystone.grant_operator(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.grant_operator(text, text, text, timestamptz) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.grant_operator(text, text, text, timestamptz) IS
  'CT-039 — the only way an operator_grant row comes into existence. Refuses a blank uid, a blank granted_by, a blank reason, an expires_at not strictly in the future, and a second active grant for the same uid. Returns the new row''s id. First callers: 0186''s bootstrap seed (Q7-10) and scripts/operator-grant.mjs grant (CCR-12).';

-- ── REVOKE every currently-active grant for a uid ─────────────────────────────
-- ★ Idempotent: a uid with no active grant matches nothing and returns 0 — never an error.
CREATE FUNCTION keystone.revoke_operator(p_uid text, p_reason text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'revoke_operator: p_reason must not be blank';
  END IF;

  WITH done AS (
    UPDATE keystone_auth.operator_grant
       SET revoked_at = now(), revoked_reason = p_reason
     WHERE firebase_uid = p_uid AND revoked_at IS NULL
     RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM done;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION keystone.revoke_operator(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_operator(text, text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.revoke_operator(text, text) IS
  'CT-039 — revokes every currently-active operator_grant row for p_uid (in practice at most one, by grant_operator''s own uniqueness check). Refuses a blank reason. Returns how many rows it revoked; 0 for a uid with no active grant, never an error. Without a caller of this function, the first operator grant would be a credential nothing could ever take back (CCR-12) — scripts/operator-grant.mjs revoke is that caller.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ PROVE IT — BOTH THE LIFECYCLE AND THE DUPLICATE REFUSAL — WHILE STILL auth_owner, THE TABLE'S
--    OWNER: RLS is enabled but not forced, so the owner is exempt from the deny_all policy and can
--    read/clean up its own proof rows directly, the same way 0020's proof reads keystone.tenant
--    directly as the role that is exempt from it in context.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_active_before boolean;
  v_id             uuid;
  v_active_after   boolean;
  v_dup_failed     boolean := false;
  v_revoked_count  integer;
  v_active_after_revoke boolean;
BEGIN
  -- 1 · a uid with no grant at all reports false.
  SELECT keystone.operator_grant_active('m0184-self-check-uid-1') INTO v_active_before;
  IF v_active_before IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'operator_grant_active reported % for a uid with no grant at all', v_active_before;
  END IF;

  -- 2 · grant it, confirm it reports true.
  SELECT keystone.grant_operator(
    'm0184-self-check-uid-1', 'migration-0184-self-check', 'migration self-check', now() + interval '1 hour'
  ) INTO v_id;
  SELECT keystone.operator_grant_active('m0184-self-check-uid-1') INTO v_active_after;
  IF v_active_after IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'operator_grant_active reported % immediately after grant_operator issued a grant for it', v_active_after;
  END IF;

  -- 3 · a SECOND active grant for the SAME uid must be refused.
  BEGIN
    PERFORM keystone.grant_operator(
      'm0184-self-check-uid-1', 'migration-0184-self-check', 'duplicate attempt', now() + interval '1 hour');
  EXCEPTION WHEN OTHERS THEN
    v_dup_failed := true;
  END;
  IF NOT v_dup_failed THEN
    RAISE EXCEPTION 'grant_operator allowed a SECOND active grant for a uid that already holds one';
  END IF;

  -- 4 · POSITIVE CONTROL for 3: a DIFFERENT uid succeeds at the same moment.
  PERFORM keystone.grant_operator(
    'm0184-self-check-uid-2', 'migration-0184-self-check', 'second identity control', now() + interval '1 hour');

  -- 5 · revoke, confirm the count and the flip back to false.
  SELECT keystone.revoke_operator('m0184-self-check-uid-1', 'migration self-check cleanup') INTO v_revoked_count;
  IF v_revoked_count <> 1 THEN
    RAISE EXCEPTION 'revoke_operator revoked % row(s) for m0184-self-check-uid-1, expected exactly 1', v_revoked_count;
  END IF;
  PERFORM keystone.revoke_operator('m0184-self-check-uid-2', 'migration self-check cleanup');

  SELECT keystone.operator_grant_active('m0184-self-check-uid-1') INTO v_active_after_revoke;
  IF v_active_after_revoke IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'operator_grant_active reported % after revoke_operator revoked the grant', v_active_after_revoke;
  END IF;

  -- ★ Clean up the proof rows — auth_owner owns the table and RLS is not forced, so this is a
  --   direct DELETE, not another definer call. Leaves the table exactly as this migration found it.
  DELETE FROM keystone_auth.operator_grant WHERE firebase_uid IN ('m0184-self-check-uid-1', 'm0184-self-check-uid-2');

  RAISE NOTICE 'keystone_auth.operator_grant self-check: active/inactive lifecycle correct, duplicate-active grant refused, proof rows cleaned up';
END $$;

SET LOCAL ROLE app_owner;

-- ★★ AND app_owner ITSELF HOLDS NO DIRECT PRIVILEGE ON THE TABLE — the same "no GRANT to app_rw"
--    line above applies to every non-owner role, app_owner included. Proven here rather than
--    asserted: SQLSTATE 42501 is the ONLY acceptable outcome, never "zero rows" (which is what a
--    working policy looks like and would be indistinguishable from an empty table).
DO $$
BEGIN
  PERFORM 1 FROM keystone_auth.operator_grant LIMIT 1;
  RAISE EXCEPTION 'app_owner could read keystone_auth.operator_grant directly — it holds no GRANT on this table and this must fail with insufficient_privilege';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'keystone_auth.operator_grant: app_owner has no direct privilege (SQLSTATE 42501), exactly as designed';
END $$;
