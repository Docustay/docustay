-- 0473 — F740. Every call of keystone.request_operator_grant has thrown since 0208 shipped:
-- it INSERTs granted_by = requested_by (0208:120-124) while operator_grant_two_person (0208:70-72)
-- forbids that equality. A CHECK runs per statement; 0208's comment at :77-79 assumed the requester's
-- own uid could be parked in granted_by, and it cannot.
--
-- ★★★ THE FIX IS TO THE FUNCTION, NOT THE CONSTRAINT, AND THAT IS DELIBERATE.
--     test/e8_4_operator_two_step.test.mjs:211-217 is an explicit regression guard on the constraint:
--     it INSERTs granted_by = requested_by with approved_at absent (NULL) and asserts a refusal.
--     Relaxing the CHECK to "approved_at IS NULL OR ..." satisfies its first disjunct, that INSERT
--     succeeds, and a protected test fails — whose "obvious" remedy is to edit the test. So the
--     constraint stays exactly as 0208 wrote it and the INSERT parks a SENTINEL instead:
--     granted_by = 'pending:' || p_requested_by. granted_by stays NOT NULL (CT-039), the inequality
--     holds at every instant, and approve_operator_grant (0208:148-151) overwrites it.
--     ★ A system tag in granted_by is the established idiom, not a new one:
--       'bootstrap:migration-0186' has lived there since 0186 (scripts/operator-grant.mjs:71-74).
--     ★ 'pending:' || NULL is NULL, so request_operator_grant(subject, NULL, ...) still raises the
--       same 23502 that e8_4 leg (g2) asserts. Nothing is weakened.
--
-- ★★ TWO UNIQUENESS HOLES THAT PENDING ROWS EXPOSE ARE CLOSED IN THE SAME FILE (S18-4), because
--    they are harmless only while no pending row can exist:
--      (b) grant_operator's duplicate check (0208:193-198) has no approved_at filter, so ONE
--          abandoned request would block all granting for that identity for the whole TTL —
--          breaking the direct path that is the only one working today.
--      (c) approve_operator_grant has no active-grant check at all, so two pending requests could
--          both be approved into two simultaneous live grants.
--
-- MEASURED read-only, 25 Sep 2026, PRODUCTION (KEYSTONE_DEPLOYED_SUPERUSER_PG_URL from .env.local,
-- BEGIN READ ONLY ... ROLLBACK, counts only, never a row's contents, never a secret) AND LOCAL:
-- keystone_auth.operator_grant — production 7 rows, 7 with requested_by IS NULL; local 16 rows,
-- 16 with requested_by IS NULL; ZERO rows in either database have approved_at IS NOT NULL AND
-- requested_by IS NOT NULL AND granted_by = requested_by. No request has ever been recorded.
-- ★ NO DDL ON A TABLE, NO BACKFILL, NO ROW TOUCHED: this file replaces three function bodies and
--   nothing else, so there is no FORCE-RLS per-practice loop to run (0168/0172's pattern does not
--   apply — keystone_auth.operator_grant has no tenant_id, by design, 0184:46-57).
-- The three functions are owned by auth_owner (0208:155-156, MEASURED pg_proc.proowner both
-- databases), so the file runs as auth_owner — the 0208/0250/0368 idiom.
SET LOCAL ROLE auth_owner;

-- ── (a) request_operator_grant — the sentinel. One line differs from 0208:104-126. ──────────────
CREATE OR REPLACE FUNCTION keystone.request_operator_grant(
  p_subject_uid text, p_requested_by text, p_reason text, p_ttl interval
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_id uuid;
BEGIN
  IF pg_catalog.btrim(coalesce(p_reason,'')) = '' THEN
    RAISE EXCEPTION 'an operator grant always says why' USING ERRCODE = 'check_violation';
  END IF;
  -- CT-039: active-grant uniqueness is enforced HERE, because now() is not immutable in an index.
  IF EXISTS (SELECT 1 FROM keystone_auth.operator_grant
              WHERE firebase_uid = p_subject_uid AND revoked_at IS NULL
                AND approved_at IS NOT NULL AND expires_at > pg_catalog.now()) THEN
    RAISE EXCEPTION 'that identity already holds an active operator grant'
      USING ERRCODE = 'unique_violation';
  END IF;
  -- ★★★ 0473 — THE ONE CHANGED LINE. 'pending:' || p_requested_by, never p_requested_by itself.
  INSERT INTO keystone_auth.operator_grant
    (firebase_uid, granted_by, expires_at, reason, requested_by, requested_at)
  VALUES (p_subject_uid, 'pending:' || p_requested_by, pg_catalog.now() + p_ttl, p_reason,
          p_requested_by, pg_catalog.now())
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- ── (b) grant_operator — the duplicate check gains approved_at IS NOT NULL. ─────────────────────
--    Body otherwise identical to 0208:172-210.
CREATE OR REPLACE FUNCTION keystone.grant_operator(
  p_uid text, p_granted_by text, p_reason text, p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_uid IS NULL OR pg_catalog.btrim(p_uid) = '' THEN
    RAISE EXCEPTION 'grant_operator: p_uid must not be blank'; END IF;
  IF p_granted_by IS NULL OR pg_catalog.btrim(p_granted_by) = '' THEN
    RAISE EXCEPTION 'grant_operator: p_granted_by must not be blank'; END IF;
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'grant_operator: p_reason must not be blank'; END IF;
  IF p_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'grant_operator: p_expires_at (%) must be strictly in the future', p_expires_at;
  END IF;
  -- ★★★ 0473 (S18-4) — "AND approved_at IS NOT NULL" ADDED. Without it, one abandoned two-step
  --     request blocks this path for the whole TTL, and this path is the ONE that works today.
  IF EXISTS (
    SELECT 1 FROM keystone_auth.operator_grant
     WHERE firebase_uid = p_uid AND revoked_at IS NULL AND approved_at IS NOT NULL
       AND expires_at > pg_catalog.now()
  ) THEN
    RAISE EXCEPTION 'grant_operator: uid % already holds an active operator grant', p_uid;
  END IF;
  INSERT INTO keystone_auth.operator_grant (firebase_uid, granted_by, expires_at, reason, approved_at)
  VALUES (p_uid, p_granted_by, p_expires_at, p_reason, pg_catalog.now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ── (c) approve_operator_grant — the active-grant check, LAST so (c)'s message is unchanged. ────
--    Body otherwise identical to 0208:133-153; RETURNS TABLE shape unchanged (a REPLACE cannot
--    change it, and nothing here tries to).
CREATE OR REPLACE FUNCTION keystone.approve_operator_grant(p_id uuid, p_approver_uid text)
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
  -- ★★★ 0473 (S18-4) — NEW, AND DELIBERATELY LAST. Two pending requests for one identity could
  --     otherwise both be approved into two simultaneous live grants. g.id <> p_id excludes the row
  --     being approved; approved_at IS NOT NULL means a sibling PENDING request does not block here
  --     (that is request_operator_grant's check, 0208:115-118, and e8_4 leg (e) proves it).
  IF EXISTS (SELECT 1 FROM keystone_auth.operator_grant g
              WHERE g.firebase_uid = r.firebase_uid AND g.id <> p_id
                AND g.revoked_at IS NULL AND g.approved_at IS NOT NULL
                AND g.expires_at > pg_catalog.now()) THEN
    RAISE EXCEPTION 'that identity already holds an active operator grant'
      USING ERRCODE = 'unique_violation'; END IF;
  RETURN QUERY
    UPDATE keystone_auth.operator_grant
       SET granted_by = p_approver_uid, granted_at = pg_catalog.now(), approved_at = pg_catalog.now()
     WHERE operator_grant.id = p_id
    RETURNING operator_grant.id, operator_grant.expires_at;
END $$;

-- ★ CREATE OR REPLACE preserves owner and ACL; re-stated so the file reads completely and so a
--   diff against 0208:155-166 shows nothing moved.
ALTER FUNCTION keystone.request_operator_grant(text,text,text,interval) OWNER TO auth_owner;
ALTER FUNCTION keystone.approve_operator_grant(uuid,text)                OWNER TO auth_owner;
ALTER FUNCTION keystone.grant_operator(text,text,text,timestamptz)       OWNER TO auth_owner;
REVOKE ALL ON FUNCTION keystone.request_operator_grant(text,text,text,interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.approve_operator_grant(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.grant_operator(text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.request_operator_grant(text,text,text,interval) TO app_rw, app_owner;
GRANT EXECUTE ON FUNCTION keystone.approve_operator_grant(uuid,text) TO app_rw, app_owner;
GRANT EXECUTE ON FUNCTION keystone.grant_operator(text,text,text,timestamptz) TO app_rw, app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — the whole flow, in the migration, on throwaway uids, cleaned up to nothing.
-- Runs as auth_owner (still in effect), which owns the table, so the DELETE at the end is certain.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $f740$
DECLARE
  v_tag text := 'f740-selfcheck-' || pg_catalog.gen_random_uuid()::text;
  v_id  uuid;
  v_id2 uuid;
  v_ok  boolean := false;
  v_granted_by text;
BEGIN
  -- (1) a request can be made at all — this is the line that has thrown since 0208.
  v_id := keystone.request_operator_grant(v_tag || '-subject', v_tag || '-requester',
                                          '0473 self-check', interval '1 hour');
  IF v_id IS NULL THEN RAISE EXCEPTION '0473: request_operator_grant returned no id'; END IF;

  -- (2) the sentinel is parked, and the constraint was NOT relaxed.
  SELECT granted_by INTO v_granted_by FROM keystone_auth.operator_grant WHERE id = v_id;
  IF v_granted_by <> 'pending:' || v_tag || '-requester' THEN
    RAISE EXCEPTION '0473: granted_by is %, not the pending sentinel', v_granted_by; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'operator_grant_two_person'
                    AND conrelid = 'keystone_auth.operator_grant'::pg_catalog.regclass
                    AND convalidated
                    AND pg_catalog.pg_get_constraintdef(oid)
                        = 'CHECK (((requested_by IS NULL) OR (granted_by <> requested_by)))') THEN
    RAISE EXCEPTION '0473: operator_grant_two_person is not the 0208 definition — the constraint '
                    'must not be touched (S18-1; test/e8_4_operator_two_step.test.mjs:211-217 '
                    'is an explicit regression guard on it)';
  END IF;

  -- (3) ★★★ A PENDING ROW IS INERT — the safety property this whole relaxation rests on (S18-5).
  IF keystone.operator_grant_active(v_tag || '-subject') THEN
    RAISE EXCEPTION '0473: operator_grant_active was TRUE for a pending request'; END IF;
  PERFORM pg_catalog.set_config('keystone.operator_grant_id', v_id::text, true);
  IF keystone.caller_is_platform() THEN
    RAISE EXCEPTION '0473: caller_is_platform() was TRUE for a pending request id'; END IF;
  PERFORM pg_catalog.set_config('keystone.operator_grant_id', '', true);

  -- (4) the requester is refused BY THE NAMED CHECK, not by a raw constraint error.
  BEGIN
    PERFORM keystone.approve_operator_grant(v_id, v_tag || '-requester');
    RAISE EXCEPTION '0473: the requester approved their own request';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%asks is not the operator who approves%' THEN
      RAISE EXCEPTION '0473: refused for the wrong reason: %', SQLERRM;
    END IF;
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '0473: the named refusal did not fire'; END IF;

  -- (5) POSITIVE CONTROL for (3) and (4): a DIFFERENT operator approves, and BOTH readers flip.
  PERFORM keystone.approve_operator_grant(v_id, v_tag || '-approver');
  IF NOT EXISTS (SELECT 1 FROM keystone_auth.operator_grant
                  WHERE id = v_id AND approved_at IS NOT NULL
                    AND granted_by = v_tag || '-approver') THEN
    RAISE EXCEPTION '0473: approval by a different operator did not take'; END IF;
  IF NOT keystone.operator_grant_active(v_tag || '-subject') THEN
    RAISE EXCEPTION '0473: POSITIVE CONTROL FAILED — operator_grant_active is still false after '
                    'approval, so (3) proves nothing'; END IF;
  PERFORM pg_catalog.set_config('keystone.operator_grant_id', v_id::text, true);
  IF NOT keystone.caller_is_platform() THEN
    RAISE EXCEPTION '0473: POSITIVE CONTROL FAILED — caller_is_platform() is still false after '
                    'approval, so (3) proves nothing'; END IF;
  PERFORM pg_catalog.set_config('keystone.operator_grant_id', '', true);

  -- (6) S18-4(c): a SECOND pending request for the same identity cannot also be approved.
  --     request_operator_grant refuses a second request while an APPROVED grant is live, so the
  --     second request is made against a fresh subject first, then re-pointed — the only way to
  --     produce the two-pending shape the new check exists for.
  INSERT INTO keystone_auth.operator_grant
    (firebase_uid, granted_by, expires_at, reason, requested_by, requested_at)
  VALUES (v_tag || '-subject', 'pending:' || v_tag || '-requester2',
          pg_catalog.now() + interval '1 hour', '0473 self-check second pending',
          v_tag || '-requester2', pg_catalog.now())
  RETURNING id INTO v_id2;
  v_ok := false;
  BEGIN
    PERFORM keystone.approve_operator_grant(v_id2, v_tag || '-approver2');
    RAISE EXCEPTION '0473: a second grant was approved for an identity that already holds a live one';
  EXCEPTION WHEN unique_violation THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '0473: the active-grant check on approve did not fire'; END IF;

  -- (7) S18-4(b): an abandoned PENDING request must NOT block the direct grant_operator path.
  DELETE FROM keystone_auth.operator_grant WHERE id IN (v_id, v_id2);
  v_id := keystone.request_operator_grant(v_tag || '-direct', v_tag || '-requester3',
                                          '0473 abandoned request', interval '1 hour');
  v_id2 := keystone.grant_operator(v_tag || '-direct', 'bootstrap:0473-self-check',
                                   '0473 direct path with a pending request outstanding',
                                   pg_catalog.now() + interval '1 hour');
  IF v_id2 IS NULL THEN
    RAISE EXCEPTION '0473: grant_operator refused while only a PENDING request existed — S18-4(b) '
                    'is not fixed, and the one path that works today is broken'; END IF;
  -- POSITIVE CONTROL for (7): with the grant now APPROVED and live, the direct path refuses.
  v_ok := false;
  BEGIN
    PERFORM keystone.grant_operator(v_tag || '-direct', 'bootstrap:0473-self-check',
                                    '0473 duplicate attempt', pg_catalog.now() + interval '1 hour');
    RAISE EXCEPTION '0473: grant_operator issued a SECOND live grant for one identity';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%already holds an active operator grant%' THEN RAISE; END IF;
    v_ok := true;
  END;
  IF NOT v_ok THEN RAISE EXCEPTION '0473: the duplicate refusal on grant_operator did not fire'; END IF;

  -- nothing invented is left behind: only this self-check's own rows go.
  DELETE FROM keystone_auth.operator_grant
   WHERE firebase_uid LIKE v_tag || '%' OR requested_by LIKE v_tag || '%';
  RAISE NOTICE '0473: request -> inert while pending -> named refusal -> approval by a different '
               'operator -> no second live grant -> the direct path unblocked. All proved.';
END $f740$;

SET LOCAL ROLE app_owner;
