-- 0227_operator_actions_are_audited_outside_any_tenant
-- F629's fix — closes the gap task 8.9 self-flagged and stopped on (step 2 BUILD, new Stage 7/8
-- combined build): `openPlatformSession`, `requestGrant` and `approveGrant` must record
-- `operator.acted_as` / `operator.grant_requested` / `operator.grant_approved`, but
-- `keystone.audit_entry.tenant_id` is `NOT NULL` and RLS-enforced (0183), while the subject of all
-- three actions — `keystone_auth.operator_grant` (0184) — is, by CT-039's own design, "No
-- tenant_id, ever". `writeAudit` (src/permissions/audit.mjs:178) throws before any of the three
-- could ever reach Postgres.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ DESIGN DECISION (F629): A NEW, NARROW, PLATFORM-SCOPED AUDIT TABLE — NOT a sentinel tenant_id
--     and NOT an edit to keystone.audit_entry / require_tenant_id() (0001, 0183, both already
--     deployed and shared by every tenant-scoped write in the product). `keystone_auth` already
--     holds exactly this shape of thing outside per-tenant RLS — `keystone_auth.operator_grant`
--     itself (0184) and `keystone_auth.session` (0020) are both ENABLE-but-not-FORCE, `deny_all`,
--     with NO grant to app_rw, reached only through named SECURITY DEFINER functions in schema
--     `keystone` (CCR-3's convention). This migration adds a FOURTH table of that exact shape,
--     `keystone_auth.operator_audit_entry`, and ONE new writer, `keystone.write_operator_audit()` —
--     the same "new narrow SECURITY DEFINER function + new migration" shape this run has preferred
--     throughout over touching already-deployed shared infrastructure (F626's `0226`, this file's
--     own sibling). `keystone_meta` (0127/0128/0185 — worker_heartbeat, alert_state, backup_run)
--     was considered and rejected: those three are PLATFORM OBSERVABILITY tables, deliberately
--     GRANTed SELECT to app_rw and gated by an RLS policy on `keystone.caller_is_platform()` so a
--     live operator session can read them. An audit trail of operator actions is the opposite
--     shape — write-once, narrowly-actored, not yet needed by any reader this stage builds — so it
--     takes `keystone_auth`'s stricter, zero-grant precedent, not `keystone_meta`'s readable one.
--     A later task that needs to DISPLAY this trail adds a read policy / SECURITY DEFINER reader
--     then, the same way `keystone.viewer_may_read_audit()` (0183) is separate, later-addable
--     infrastructure layered on top of `keystone.audit_entry` rather than baked into its INSERT
--     path.
--
-- ★★ REASON IS NOT A JS-SUPPLIED ARGUMENT — IT IS READ FROM THE GRANT ITSELF. CT-041's `writeAudit`
--    takes `reason` as a parameter because a general audit action has no fixed subject to read one
--    from. Every row this table will ever hold has exactly one subject —
--    `keystone_auth.operator_grant` — and that row ALREADY carries `reason NOT NULL CHECK
--    (btrim(reason) <> '')` (0184:54). `keystone.write_operator_audit()` below reads it directly,
--    the same idiom 0183's own `audit_fill_operator_uid()` trigger uses to read
--    `keystone_auth.operator_grant` from inside a SECURITY DEFINER body rather than trust a
--    duplicate value the caller passed in. This also means `openPlatformSession`, `requestGrant`
--    and `approveGrant` (src/auth/operatorSession.mjs, task 8.9) never need to carry a reason
--    string across two function calls — one less place for it to drift.
--
-- ★ ACTION VOCABULARY: a plain CHECK against the three literal strings, not a foreign key onto
--   `keystone.audit_action` (0183) — those three strings are already members of the frozen 25
--   (AUDIT_ACTIONS / CT-042), so there is no new vocabulary being invented here, only a second
--   table three of the 25 can land in. A cross-schema foreign key would need `auth_owner` granted
--   `REFERENCES` on `keystone.audit_action`, a new grant on shared, already-deployed infrastructure
--   this migration has no reason to ask for when a CHECK gives the same integrity.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · keystone_auth.operator_audit_entry — shape copied from keystone_auth.operator_grant (0184)
--     and keystone_auth.session (0020): ENABLE, not FORCE; deny_all; no grant to app_rw.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone_auth.operator_audit_entry (
  id                      uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  at                      timestamptz NOT NULL DEFAULT now(),
  actor_operator_grant_id uuid        NOT NULL
                            REFERENCES keystone_auth.operator_grant(id) ON DELETE RESTRICT,
  action                  text        NOT NULL
                            CHECK (action IN ('operator.acted_as', 'operator.grant_requested',
                                               'operator.grant_approved')),
  object                  text        NOT NULL DEFAULT 'operator_grant',
  subject_id              uuid,
  reason                  text        NOT NULL CHECK (btrim(reason) <> ''),
  request_id              text
);
CREATE INDEX operator_audit_entry_grant_idx
  ON keystone_auth.operator_audit_entry (actor_operator_grant_id, at DESC);

ALTER TABLE keystone_auth.operator_audit_entry ENABLE ROW LEVEL SECURITY;
-- ★ NOT FORCE — same reasoning as 0184: the owner (auth_owner) is also the writer function's
--   owner, and FORCE would apply deny_all to that owner too.
CREATE POLICY deny_all ON keystone_auth.operator_audit_entry USING (false) WITH CHECK (false);
-- No GRANT to app_rw, app_signup, app_worker or anyone. Reached only through
-- keystone.write_operator_audit() below.

COMMENT ON TABLE keystone_auth.operator_audit_entry IS
  'F629 fix / Stage 8 task 8.9. The audit trail for the three genuinely tenant-less operator
   actions (operator.acted_as, operator.grant_requested, operator.grant_approved) that
   keystone.audit_entry (0183) cannot hold because its tenant_id is NOT NULL and RLS-enforced.
   Shape copied from keystone_auth.operator_grant (0184): ENABLE but not FORCE, deny_all policy,
   no app_rw grant — reached only through keystone.write_operator_audit(). reason is never passed
   in; it is read from keystone_auth.operator_grant.reason, the row''s own single source of truth.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · keystone.write_operator_audit() — the ONE writer. Schema keystone (CCR-3's convention:
--     resolvers over keystone_auth tables live in keystone, not keystone_auth), owned by
--     auth_owner (needs to read keystone_auth.operator_grant, which nothing but auth_owner can).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.write_operator_audit(
  p_action text, p_actor_operator_grant_id uuid, p_subject_id uuid DEFAULT NULL,
  p_request_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id     uuid;
  v_reason text;
BEGIN
  IF p_action NOT IN ('operator.acted_as', 'operator.grant_requested', 'operator.grant_approved') THEN
    RAISE EXCEPTION 'write_operator_audit: "%" is not one of the three operator audit actions', p_action;
  END IF;
  IF p_actor_operator_grant_id IS NULL THEN
    RAISE EXCEPTION 'write_operator_audit requires actor_operator_grant_id — every row here is an operator action';
  END IF;

  -- ★ Reads the reason from the grant itself — see the file header. A grant id that names no row
  --   is a programming error at the call site (src/auth/operatorSession.mjs), same idiom as
  --   0183's audit_fill_operator_uid().
  SELECT reason INTO v_reason FROM keystone_auth.operator_grant WHERE id = p_actor_operator_grant_id;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'write_operator_audit: keystone_auth.operator_grant has no row for id %', p_actor_operator_grant_id;
  END IF;

  INSERT INTO keystone_auth.operator_audit_entry
    (actor_operator_grant_id, action, object, subject_id, reason, request_id)
  VALUES (p_actor_operator_grant_id, p_action, 'operator_grant', p_subject_id, v_reason, p_request_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION
  keystone.write_operator_audit(text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  keystone.write_operator_audit(text, uuid, uuid, text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.write_operator_audit(text, uuid, uuid, text) IS
  'F629 fix / Stage 8 task 8.9. The only writer of keystone_auth.operator_audit_entry. Refuses an
   action outside the three-member set, a null actor_operator_grant_id, and a grant id that names
   no row. reason is read from keystone_auth.operator_grant, never passed by the caller. Called
   from src/auth/operatorSession.mjs via withCredentialLookup — no tenant GUC is set or needed,
   because there is no tenant to set one for.';

-- ★ NOT added to CREDENTIAL_RESOLVERS (db/gates/catalog-conformance.mjs): it resolves nothing and
--   returns a uuid it just minted, no different from keystone.request_operator_grant /
--   approve_operator_grant (0208), which the same gate's own comment excludes for the identical
--   reason. The generic SECURITY DEFINER rule (empty search_path, no EXECUTE TO PUBLIC, an ACL
--   that is not NULL) still applies to it because it lives in schema keystone, and is proved below.

-- ★★ FIX [MEASURED 22 Sep 2026]: same defect as 0207, same session — this file used to switch back
--    to app_owner HERE, before the self-check below, but that check casts
--    'keystone_auth.operator_audit_entry'::regclass, and a qualified-name ::regclass cast requires
--    schema USAGE for the CURRENT role (isolated repro, this session: `SELECT
--    'keystone_auth.totp_factor'::regclass` as app_owner fails with the identical "permission denied
--    for schema keystone_auth"). Role stays auth_owner through both self-check blocks now; the
--    redundant `SET LOCAL ROLE auth_owner` at the top of the second block (line ~201, unchanged) is
--    a harmless no-op kept to avoid touching that block's own logic.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ PROVE IT — shape (RLS, ACL) plus the lifecycle plus the three refusals, in that order.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_enabled  boolean;
  v_forced   boolean;
  n          integer;
  r          record;
BEGIN
  -- ── shape: ENABLE, not FORCE, exactly one policy ──────────────────────────────────────────
  SELECT relrowsecurity, relforcerowsecurity INTO v_enabled, v_forced
    FROM pg_catalog.pg_class WHERE oid = 'keystone_auth.operator_audit_entry'::regclass;
  IF NOT v_enabled THEN
    RAISE EXCEPTION '0227: keystone_auth.operator_audit_entry is not ROW LEVEL SECURITY enabled';
  END IF;
  IF v_forced THEN
    RAISE EXCEPTION '0227: keystone_auth.operator_audit_entry is FORCE row level security — must be ENABLE-only, same reasoning as 0184';
  END IF;
  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone_auth' AND tablename = 'operator_audit_entry';
  IF n <> 1 THEN
    RAISE EXCEPTION '0227: keystone_auth.operator_audit_entry carries % polic(y/ies), expected exactly 1 (deny_all)', n;
  END IF;

  -- ── function shape: SECURITY DEFINER, auth_owner, empty search_path, non-null ACL ──────────
  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
         p.proacl IS NULL AS acl_null,
         (p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE left(c, 12) = 'search_path=')) AS has_search_path
    INTO r
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'keystone' AND p.proname = 'write_operator_audit';
  IF r.owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0227: keystone.write_operator_audit() is owned by %, not auth_owner', r.owner;
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION '0227: keystone.write_operator_audit() is not SECURITY DEFINER';
  END IF;
  IF r.acl_null THEN
    RAISE EXCEPTION '0227: keystone.write_operator_audit() has a NULL proacl — that is EXECUTE TO PUBLIC (F482)';
  END IF;
  IF NOT r.has_search_path THEN
    RAISE EXCEPTION '0227: keystone.write_operator_audit() has no search_path setting';
  END IF;

  -- ── app_rw holds NO privilege on the table at all — SQLSTATE 42501, never "zero rows" ──────
  IF pg_catalog.has_table_privilege('app_rw', 'keystone_auth.operator_audit_entry', 'SELECT') THEN
    RAISE EXCEPTION '0227: app_rw can SELECT keystone_auth.operator_audit_entry directly — it must be reachable only through keystone.write_operator_audit()';
  END IF;

  RAISE NOTICE '0227: keystone_auth.operator_audit_entry is ENABLE+not-FORCE with 1 policy; keystone.write_operator_audit() is a well-formed auth_owner SECURITY DEFINER; app_rw holds no direct privilege';
END $$;

-- Lifecycle + refusals, run as auth_owner (exempt from deny_all, same as 0184's own proof) so the
-- test rows can be created and cleaned up directly.
SET LOCAL ROLE auth_owner;
DO $$
DECLARE
  v_grant_id     uuid;
  v_audit_id     uuid;
  v_row          keystone_auth.operator_audit_entry%ROWTYPE;
  v_bad_action   boolean := false;
  v_bad_grant    boolean := false;
BEGIN
  -- 1 · a real grant to hang the audit rows off.
  SELECT keystone.grant_operator(
    'm0227-self-check-uid', 'migration-0227-self-check', 'migration self-check reason',
    now() + interval '1 hour'
  ) INTO v_grant_id;

  -- 2 · each of the three actions writes a row, and the reason comes from the grant, not a param.
  SELECT keystone.write_operator_audit('operator.acted_as', v_grant_id) INTO v_audit_id;
  SELECT * INTO v_row FROM keystone_auth.operator_audit_entry WHERE id = v_audit_id;
  IF v_row.reason IS DISTINCT FROM 'migration self-check reason' THEN
    RAISE EXCEPTION '0227: write_operator_audit wrote reason %, expected the grant''s own reason', v_row.reason;
  END IF;
  IF v_row.object IS DISTINCT FROM 'operator_grant' THEN
    RAISE EXCEPTION '0227: write_operator_audit wrote object %, expected operator_grant', v_row.object;
  END IF;

  PERFORM keystone.write_operator_audit('operator.grant_requested', v_grant_id);
  PERFORM keystone.write_operator_audit('operator.grant_approved', v_grant_id);

  -- 3 · REFUSAL: an action outside the three-member set.
  BEGIN
    PERFORM keystone.write_operator_audit('operator.grant_revoked', v_grant_id);
  EXCEPTION WHEN OTHERS THEN
    v_bad_action := true;
  END;
  IF NOT v_bad_action THEN
    RAISE EXCEPTION '0227: write_operator_audit accepted "operator.grant_revoked", outside the three-member set';
  END IF;

  -- 4 · REFUSAL: a grant id that names no row.
  BEGIN
    PERFORM keystone.write_operator_audit('operator.acted_as', '00000000-0000-0000-0000-000000000000'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_bad_grant := true;
  END;
  IF NOT v_bad_grant THEN
    RAISE EXCEPTION '0227: write_operator_audit accepted a grant id with no matching row';
  END IF;

  -- 5 · POSITIVE CONTROL for both refusals above: the three real writes (step 2) all succeeded.
  PERFORM 1 FROM keystone_auth.operator_audit_entry WHERE actor_operator_grant_id = v_grant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '0227: the three valid writes in step 2 did not actually land';
  END IF;

  -- ★ cleanup — auth_owner is exempt from deny_all (ENABLE not FORCE), same as 0184's own proof.
  DELETE FROM keystone_auth.operator_audit_entry WHERE actor_operator_grant_id = v_grant_id;
  PERFORM keystone.revoke_operator('m0227-self-check-uid', 'migration self-check cleanup');

  RAISE NOTICE '0227: lifecycle correct (reason inherited from the grant, object defaulted), both refusals (bad action, unknown grant id) correctly raised, proof rows cleaned up';
END $$;

SET LOCAL ROLE app_owner;
