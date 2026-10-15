-- 0208_operator_two_step
-- Stage 8 task 8.4 — CT-058. The operator grant becomes a two-step flow: one operator REQUESTS a
-- grant, a DIFFERENT operator APPROVES it. Nobody can grant themselves access to a practice.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F605, MEASURED against the real, deployed code before this migration was written (21 Sep 2026):
-- neither `keystone.caller_is_platform()` (0186:134-145) nor `keystone.resolve_session`'s own
-- operator-grant lookup (0186:46-65) filtered on `approved_at` — that column does not exist until
-- THIS migration adds it. Both do their own inline `SELECT ... FROM keystone_auth.operator_grant`;
-- neither calls `keystone.operator_grant_active`, so redefining only `operator_grant_active` would
-- have changed nothing about either. Left unfixed, a REQUESTED-BUT-NOT-YET-APPROVED grant
-- (`approved_at IS NULL`) would already open Platform through the real session path, defeating this
-- task's own stated goal. This migration therefore ALSO `CREATE OR REPLACE`s four already-deployed
-- functions in place (0184, 0186), never by hand-editing 0184's or 0186's own migration files —
-- those stay immutable, already applied in production: `keystone.grant_operator` and
-- `keystone.operator_grant_active` (0184), `keystone.resolve_session` and
-- `keystone.caller_is_platform()` (0186). Signature, return type, ownership, SECURITY DEFINER,
-- empty search_path and GRANT EXECUTE recipients are UNCHANGED for all four (CREATE OR REPLACE
-- preserves ACLs — CONTRACTS.md "FUNCTION RULE 2" — so none of them is re-GRANTed here).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ★★ FIX [MEASURED 22 Sep 2026]: same defect as 0204/0205/0206, same session — this file references
--    keystone_auth.operator_grant throughout and does CREATE OR REPLACE on functions auth_owner
--    already owns (0184/0186), all while running as app_owner, which holds no USAGE on schema
--    keystone_auth and is NOINHERIT so it does not implicitly pick up auth_owner's ownership either.
--    `SET LOCAL ROLE auth_owner` stays in effect for the whole file — auth_owner holds CREATE on
--    schema keystone too (`auth_owner=UC/app_owner`), so no mid-file switch is needed.
SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.operator_grant
  ADD COLUMN requested_by text,
  ADD COLUMN requested_at timestamptz;

-- CT-058: the operator who asks is not the operator who approves.
-- ★★★ THE `requested_by IS NULL OR …` DISJUNCT IS LOAD-BEARING, NOT DEFENSIVE, AND `requested_by`
--     MUST STAY NULLABLE. [Stage 7 CCR-10, STAGE-7-PLAN.md:78-87 and :1109-1116, MEASURED 20 Sep]
--     Stage 7's migration **0186** seeds exactly ONE bootstrap grant, through
--     `keystone.grant_operator`, so Platform is reachable at all. What that row carries, verbatim
--     from Stage 7's plan:
--         granted_by   = 'bootstrap:migration-0186'
--         requested_by = (the column does not exist yet — NULL after this ALTER)
--         reason       = 'first operator, Stage 7 deploy'
--         expires_at   = now() + interval '1 year'
--         revoked_at   = NULL
--     It is issued by a migration, not by a second person, so there is no requester to record and
--     none may be invented. A bare `CHECK (granted_by <> requested_by)` evaluates to NULL for that
--     row — which a CHECK treats as satisfied — but that only holds while the column is nullable,
--     and relying on three-valued logic to save a migration is what changes under a future NOT NULL.
--     The disjunct says it out loud instead.
--   ★★★ `requested_by` IS DELIBERATELY NOT `NOT NULL`, NOW OR EVER. Stage 7 CCR-10 states it as a
--     requirement on this task: making it NOT NULL fails the ALTER on the one row that exists, and
--     backfilling it would invent a requester for a grant that had none.
--   ★★ THE TWO-PERSON RULE STILL HOLDS FOR EVERY NEW GRANT, and not because of this CHECK.
--      A NULL `requested_by` can only ever mean "the 0186 bootstrap row", because:
--        (1) the table grants no INSERT to app_rw (CT-039) — nothing outside a definer can add a row;
--        (2) the ONLY definer that inserts is `keystone.request_operator_grant` (below), and it
--            ALWAYS writes a non-null `requested_by` (it is a NOT NULL argument, `p_requested_by`);
--        (3) `scripts/operator-grant.mjs` (Stage 7 CCR-12) calls `keystone.grant_operator`, which is
--            the same bootstrap path and is a LOCAL one-shot CLI, never the running application;
--        (4) no row becomes active except through `keystone.approve_operator_grant`, which refuses
--            `r.requested_by = p_approver_uid` and therefore refuses a NULL requester's approval too
--            (NULL = anything is NULL, not true — so a NULL-requester row can never be approved by
--            this path at all; it is only ever *already* approved, from 0186).
--      The bootstrap row is grandfathered as *already approved*, never as *approvable by its
--      requester*. ★ The test that proves the NULL cannot be reached any other way is (g2) below.
--   ★ A `NOT VALID` constraint was the alternative and is deliberately NOT used: `NOT VALID` leaves
--     the constraint unchecked for existing rows AND skips the scan, but it also leaves a permanently
--     unvalidated constraint in the catalogue that `db/gates/` has no rule for. One NULL-tolerant
--     CHECK that is fully valid is the smaller thing to carry.
ALTER TABLE keystone_auth.operator_grant
  ADD CONSTRAINT operator_grant_two_person
    CHECK (requested_by IS NULL OR granted_by <> requested_by);
ALTER TABLE keystone_auth.operator_grant
  ADD CONSTRAINT operator_grant_request_shape
    CHECK ((requested_by IS NULL) = (requested_at IS NULL));

-- Step 1. granted_by is NOT NULL on the table (CT-039), so a pending request parks the requester's
-- own uid there and the two-person CHECK is satisfied at approval, when granted_by is overwritten.
-- ★ A pending request is identified by approved_at IS NULL, not by a null granted_by.
ALTER TABLE keystone_auth.operator_grant ADD COLUMN approved_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F605 BACKFILL — every row that predates this column was created through keystone.grant_operator
-- (0184), the one-step CLI/bootstrap path (Stage 7 CCR-12), which is already a privileged,
-- out-of-band action and counts as self-approved by construction. approved_at = granted_at (the
-- moment trust was actually established), NOT now() — this migration may apply long after a row was
-- granted, and stamping "approved today" would misstate when approval happened. In production this
-- backfills exactly ONE row: the 0186 bootstrap grant (granted_by = 'bootstrap:migration-0186',
-- requested_by NULL). Without this, the very next statement (caller_is_platform()'s CREATE OR
-- REPLACE, below) makes that row — and therefore Platform itself — unreachable the instant this
-- migration lands, which is the opposite of CT-058's goal. Design call made explicitly here, not
-- left for the builder to improvise (F605): BACKFILLED, not left NULL.
DO $$
DECLARE v_count integer;
BEGIN
  UPDATE keystone_auth.operator_grant SET approved_at = granted_at WHERE approved_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '0208: % pre-existing operator_grant row(s) backfilled with approved_at = granted_at (the one-step keystone.grant_operator path counts as self-approved by construction)', v_count;
END $$;

-- Schema `keystone`, `search_path = ''`, owner auth_owner — the 0020 idiom; see 8.2 field 6 for why.
-- Not a credential resolver (it resolves nothing and returns a uuid it just minted), so it is not
-- added to CREDENTIAL_RESOLVERS; the empty-search_path rule still covers it.
CREATE FUNCTION keystone.request_operator_grant(
  p_subject_uid text, p_requested_by text, p_reason text, p_ttl interval
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id uuid;
BEGIN
  IF btrim(coalesce(p_reason,'')) = '' THEN
    RAISE EXCEPTION 'an operator grant always says why' USING ERRCODE = 'check_violation';
  END IF;
  -- CT-039: active-grant uniqueness is enforced HERE, because now() is not immutable in an index.
  IF EXISTS (SELECT 1 FROM keystone_auth.operator_grant
              WHERE firebase_uid = p_subject_uid AND revoked_at IS NULL
                AND approved_at IS NOT NULL AND expires_at > now()) THEN
    RAISE EXCEPTION 'that identity already holds an active operator grant'
      USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO keystone_auth.operator_grant
    (firebase_uid, granted_by, expires_at, reason, requested_by, requested_at)
  VALUES (p_subject_uid, p_requested_by, now() + p_ttl, p_reason, p_requested_by, now())
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- Step 2. Refuses the requester, refuses an already-approved row, refuses a revoked row.
-- ★★★ RETURNS IDENTIFIERS ONLY — `firebase_uid text` IS GONE. [K1-8-2] The caller passed the grant's
--     id in and already knows the subject; handing a Firebase uid back through a definer's signature
--     is the same shape CONTRACTS §0 C-1 refuses in `resolve_session`. `timestamptz` is not a
--     credential and is kept, because the caller genuinely needs to know when the grant ends.
--     8.9's `approveGrant` reads the subject from the row it requested, not from this return.
CREATE FUNCTION keystone.approve_operator_grant(p_id uuid, p_approver_uid text)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r keystone_auth.operator_grant%ROWTYPE;
BEGIN
  SELECT * INTO r FROM keystone_auth.operator_grant WHERE operator_grant.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such grant request' USING ERRCODE = 'no_data_found'; END IF;
  IF r.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'that request is already approved' USING ERRCODE = 'unique_violation'; END IF;
  IF r.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'that request was withdrawn' USING ERRCODE = 'check_violation'; END IF;
  IF r.requested_by = p_approver_uid THEN
    RAISE EXCEPTION 'the operator who asks is not the operator who approves'
      USING ERRCODE = 'check_violation'; END IF;
  RETURN QUERY
    UPDATE keystone_auth.operator_grant
       SET granted_by = p_approver_uid, granted_at = now(), approved_at = now()
     WHERE operator_grant.id = p_id
    RETURNING operator_grant.id, operator_grant.expires_at;
END $$;

ALTER FUNCTION keystone.request_operator_grant(text,text,text,interval) OWNER TO auth_owner;
ALTER FUNCTION keystone.approve_operator_grant(uuid,text)                OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.request_operator_grant(text,text,text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.approve_operator_grant(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.request_operator_grant(text,text,text,interval) TO app_rw, app_owner;
GRANT EXECUTE ON FUNCTION keystone.approve_operator_grant(uuid,text) TO app_rw, app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F605 — THE ACTUAL FIX. Four CREATE OR REPLACE statements against already-deployed functions
-- (0184, 0186), each preserving its exact signature/owner/DEFINER/search_path/ACL — see field 5.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- keystone.grant_operator (0184) — unchanged except: every row it inserts is now stamped
-- approved_at = now(). This is the one-step path (CCR-12); it is already a privileged, out-of-band
-- action, so it counts as self-approved at the moment it is issued — exactly the same reasoning as
-- the backfill above. scripts/operator-grant.mjs and test/s7_operator_grant.test.mjs (Stage 7,
-- unedited) call this unchanged and see NO behaviour difference: operator_grant_active(uid) still
-- reports true immediately after grant_operator succeeds (test (j) below proves it).
CREATE OR REPLACE FUNCTION keystone.grant_operator(
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

  IF EXISTS (
    SELECT 1 FROM keystone_auth.operator_grant
     WHERE firebase_uid = p_uid AND revoked_at IS NULL AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'grant_operator: uid % already holds an active operator grant', p_uid;
  END IF;

  INSERT INTO keystone_auth.operator_grant (firebase_uid, granted_by, expires_at, reason, approved_at)
  VALUES (p_uid, p_granted_by, p_expires_at, p_reason, now())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- keystone.operator_grant_status — NEW. The single place "is p_uid an operator RIGHT NOW, under the
-- two-step rule" is decided: approved, not revoked, not expired. Both readers below
-- (operator_grant_active, and 8.9's hasActiveOperatorGrant) go through this one function, so the
-- predicate exists in exactly one place in SQL, not reinvented per caller (F605's own instruction).
CREATE FUNCTION keystone.operator_grant_status(p_uid text)
RETURNS TABLE (active boolean, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT true, g.expires_at
    FROM keystone_auth.operator_grant g
   WHERE g.firebase_uid = p_uid
     AND g.revoked_at IS NULL
     AND g.approved_at IS NOT NULL
     AND g.expires_at > pg_catalog.now()
   ORDER BY g.expires_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION keystone.operator_grant_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.operator_grant_status(text) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.operator_grant_status(text) IS
  'CT-058 / F605 — the single reader of "is p_uid an operator RIGHT NOW": approved_at IS NOT NULL, revoked_at IS NULL, expires_at > now(). Zero rows means inactive (no grant, unapproved, revoked or expired — the caller cannot and need not tell which). keystone.operator_grant_active(text) is a thin wrapper over this. Task 8.9''s hasActiveOperatorGrant calls this directly, for expires_at, to clamp a Platform session''s ttlHours to the grant''s remaining life.';

-- keystone.operator_grant_active (0184) — unchanged signature/owner/DEFINER/ACL. Now delegates to
-- operator_grant_status so the predicate lives in exactly one place. Unchanged behaviour for
-- scripts/operator-grant.mjs and test/s7_operator_grant.test.mjs (Stage 7, unedited) for every row
-- created the one-step way, because grant_operator (above) now self-stamps approved_at.
CREATE OR REPLACE FUNCTION keystone.operator_grant_active(p_uid text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT active FROM keystone.operator_grant_status(p_uid)), false)
$$;

-- keystone.resolve_session (0174/0186) — unchanged signature/owner/DEFINER/search_path/return shape
-- (tenant_id uuid, app_user_id uuid, operator_grant_id uuid — still no text, still satisfies
-- catalog-conformance.mjs:667-676). Only change: the operator_grant_id subquery now also requires
-- approved_at IS NOT NULL — HALF of F605's actual fix: a requested-but-unapproved two-step grant no
-- longer becomes a session's operator_grant_id GUC.
CREATE OR REPLACE FUNCTION keystone.resolve_session(p_token_id text, p_secret_hash bytea)
RETURNS TABLE (tenant_id uuid, app_user_id uuid, operator_grant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT s.tenant_id, s.app_user_id,
         (SELECT g.id FROM keystone_auth.operator_grant g
           WHERE g.firebase_uid = s.firebase_uid
             AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.now()
             AND g.approved_at IS NOT NULL
           ORDER BY g.expires_at DESC LIMIT 1) AS operator_grant_id
    FROM keystone_auth.session s
    JOIN keystone.tenant t ON t.id = s.tenant_id
   WHERE s.token_id = p_token_id
     AND s.secret_hash = p_secret_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND (t.status NOT IN ('suspended','closed') OR s.kind = 'client')
$$;

-- keystone.caller_is_platform() (0186) — unchanged signature/owner/DEFINER/empty search_path (13
-- existing migration call sites and 2 gates keep working unedited). Only change: the EXISTS now also
-- requires g.approved_at IS NOT NULL — the OTHER half of F605's fix, and defence in depth alongside
-- resolve_session's own filter above (a stale GUC from before this migration, or any future caller
-- that reaches this function some way other than resolve_session, is covered too).
CREATE OR REPLACE FUNCTION keystone.caller_is_platform()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM keystone_auth.operator_grant g
     WHERE g.id = nullif(
                    pg_catalog.current_setting('keystone.operator_grant_id', true), '')::pg_catalog.uuid
       AND g.revoked_at IS NULL
       AND g.expires_at > pg_catalog.now()
       AND g.approved_at IS NOT NULL
  )
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK 1 — the four CREATE OR REPLACEs kept exactly the shape field 5 promises.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_sig text; v_owner text; v_prosecdef boolean; v_proconfig text[];
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'keystone.grant_operator(text,text,text,timestamptz)',
    'keystone.operator_grant_active(text)',
    'keystone.resolve_session(text,bytea)',
    'keystone.caller_is_platform()'
  ] LOOP
    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
      INTO v_owner, v_prosecdef, v_proconfig
      FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
    IF v_owner IS DISTINCT FROM 'auth_owner' THEN
      RAISE EXCEPTION '% is owned by %, must stay auth_owner after 0208''s CREATE OR REPLACE', v_sig, v_owner;
    END IF;
    IF NOT v_prosecdef THEN
      RAISE EXCEPTION '% lost SECURITY DEFINER in 0208''s CREATE OR REPLACE', v_sig;
    END IF;
    IF v_proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '% proconfig is %, expected search_path="" only', v_sig, v_proconfig;
    END IF;
    IF NOT has_function_privilege('app_rw', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'app_rw lost EXECUTE on % after 0208''s CREATE OR REPLACE', v_sig;
    END IF;
    IF has_function_privilege('public', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC gained EXECUTE on % — CREATE OR REPLACE must preserve the original REVOKE', v_sig;
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK 2 — THE F605 PROOF ITSELF, conditioned exactly as 0186's own closing self-check is
-- (K2-7-1): an unconditional version would abort every fresh database that has no platform identity
-- yet (dev, CI, restore — every one of them, always).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM keystone.app_user u JOIN keystone.tenant t ON t.id = u.tenant_id
              WHERE u.firebase_uid IS NOT NULL AND t.is_platform)
     AND NOT EXISTS (SELECT 1 FROM keystone_auth.operator_grant
                      WHERE revoked_at IS NULL AND expires_at > now() AND approved_at IS NOT NULL) THEN
    RAISE EXCEPTION '0208 left zero APPROVED live operator grants on a database that has a platform identity — the approved_at backfill did not reach the bootstrap row. Platform is now unreachable. Refusing to report success.';
  END IF;
END $$;

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly, at the very end. NEVER RESET ROLE.
