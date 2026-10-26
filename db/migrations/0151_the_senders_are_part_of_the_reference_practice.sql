-- 0151_the_senders_are_part_of_the_reference_practice
-- FINDINGS F502 · ruling R58 (Ty, Stage 4 Task 5) · the same guard 0099 attached, 0133 let see, and 0144 re-homed.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE GAP. 0099 attached `keystone.refuse_touch_reference_rows()` to every tenant-scoped table FROM THE
--     CATALOGUE — ONCE. keystone.sender_identity and keystone.sender_routing arrived later (0126), and no migration
--     ever gave them the guard or recorded a decision [MEASURED, F502]. A gate cleaning up with the wrong tenant id
--     could remove the reference practice's senders, leaving a practice that "exists" and cannot send.
--
-- ★★ THE RULING (R58). GUARD sender_identity and sender_routing. EXEMPT entitlement_warned, with its reason
--    recorded where the coverage check reads it (db/gates/catalog-conformance.mjs EXEMPT): a "we already sent this
--    warning" ledger (0111), not set-up or history; losing a row at most re-arms one warning.
--
-- ★★ WHY BOTH, AND NOT ONE. sender_routing.sender_identity_id → sender_identity is ON DELETE RESTRICT. A cleanup
--    deletes child then parent, statement by statement. With only the parent guarded, the child DELETE succeeds and
--    the parent DELETE is refused — the practice is left HALF-cleaned (routing gone, identity kept). With both
--    guarded, the first statement is refused and nothing is removed. [EXECUTED both halves:
--    test/s4_reference_guard_senders.test.mjs, the counterfactual lifts routing's guard inside a rolled-back
--    transaction.]
--
-- WHAT THIS FILE DOES, per table — exactly the shape the other 65 guarded tables carry, COMPARED, not retyped:
--   §b the two triggers 0099 creates (AFTER DELETE … REFERENCING OLD TABLE … FOR EACH STATEMENT; BEFORE TRUNCATE …
--      FOR EACH STATEMENT), both ENABLE ALWAYS; their pg_get_triggerdef is asserted equal to app_user's with the
--      table name substituted.
--   §c GRANT SELECT TO reference_guard (0144 §b) — read back, because a GRANT that takes no effect only WARNS.
--   §d `reference_guard_read` FOR SELECT TO reference_guard ONLY (0144 §c), whose deparsed USING is asserted equal
--      to app_user's. ★★★ NEVER TO app_owner — permissive policies OR-combine, and a policy TO app_owner handed the
--      reference practice to every app_owner SECURITY DEFINER function (F501).
--   §e the end state from the catalogue: no policy on either table names app_owner; set equality across the whole
--      schema (every table carrying the trigger carries the policy, and the reverse); and a runtime probe as
--      reference_guard (sees) and app_owner (sees nothing).
--
-- ★ Runs as app_owner (db/migrate.mjs per-file SET ROLE). Every SET LOCAL ROLE reference_guard (§b's lend/take-back,
--   §e's probe) returns to app_owner explicitly. NO `RESET ROLE` anywhere (F482).
-- ★ PRECONDITION — app_owner must OWN both tables (CREATE POLICY and ENABLE ALWAYS TRIGGER need ownership).
--   [MEASURED 18 Sep 2026] the LOCAL database had them owned by keystone_admin — F482's drift (built across separate
--   `up` runs after a RESET ROLE); production re-read 0 tables owned by anyone but app_owner (F482 PROOF); a fresh
--   database gets app_owner (migrate.mjs per-file SET ROLE). §a refuses with the repair rather than guessing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ───────────────────────────────────────────────────────────────────────────
DO $precondition$
DECLARE
  v_rel   text;
  v_owner text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0151: must run as app_owner (db/migrate.mjs), running as %', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reference_guard') THEN
    RAISE EXCEPTION '0151: role reference_guard does not exist — 0144 (and its superuser role step) must be applied first';
  END IF;
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'keystone.refuse_touch_reference_rows()'::regprocedure))
     <> 'reference_guard' THEN
    RAISE EXCEPTION '0151: keystone.refuse_touch_reference_rows() is not owned by reference_guard — 0144 is not in effect';
  END IF;
  FOREACH v_rel IN ARRAY ARRAY['sender_identity', 'sender_routing'] LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'keystone' AND c.relname = v_rel AND c.relkind = 'r';
    IF v_owner IS NULL THEN
      RAISE EXCEPTION '0151: keystone.% does not exist', v_rel;
    END IF;
    IF v_owner <> 'app_owner' THEN
      RAISE EXCEPTION '0151: keystone.% is owned by %, not app_owner (F482 ownership drift). As a SUPERUSER, first: '
        'ALTER TABLE keystone.% OWNER TO app_owner; — then re-run db/migrate.mjs up.', v_rel, v_owner, v_rel;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = format('keystone.%I', v_rel)::regclass
                    AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN
      RAISE EXCEPTION '0151: keystone.% has no tenant_id column — the guard joins on it', v_rel;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgrelid = format('keystone.%I', v_rel)::regclass
                AND tg.tgfoid = 'keystone.refuse_touch_reference_rows'::regproc)
       OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = format('keystone.%I', v_rel)::regclass
                   AND polname = 'reference_guard_read') THEN
      RAISE EXCEPTION '0151: keystone.% already carries the guard or its policy — changed by hand? refusing to guess', v_rel;
    END IF;
  END LOOP;
  RAISE NOTICE '0151 §a: both tables owned by app_owner, have tenant_id, carry no guard yet; 0144 is in effect';
END
$precondition$;

-- ── §b · the triggers, exactly as 0099 creates them ──────────────────────────────────────────────
-- ★★ CREATE TRIGGER needs EXECUTE on the trigger function, held by the table owner. [EXECUTED, first draft of this
--    file] "permission denied for function keystone.refuse_touch_reference_rows": since 0144 the function is owned by
--    reference_guard with ACL {reference_guard=X/reference_guard}, and app_owner is a NOINHERIT member — so it holds
--    no EXECUTE. 0099 never met this because app_owner owned the function then. EXECUTE is checked at CREATE time
--    only (firing does not re-check), so it is lent for the two CREATEs and taken back at once — 0144 §d's pattern
--    for CREATE on the schema. The grant is made AS reference_guard (its owner; app_owner holds SET on it), and
--    §e asserts the ACL is back to exactly what it was.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER sender_identity_refuse_reference_delete_trg AFTER DELETE ON keystone.sender_identity
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.sender_identity ENABLE ALWAYS TRIGGER sender_identity_refuse_reference_delete_trg;
CREATE TRIGGER sender_identity_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.sender_identity
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.sender_identity ENABLE ALWAYS TRIGGER sender_identity_refuse_reference_truncate_trg;

CREATE TRIGGER sender_routing_refuse_reference_delete_trg AFTER DELETE ON keystone.sender_routing
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.sender_routing ENABLE ALWAYS TRIGGER sender_routing_refuse_reference_delete_trg;
CREATE TRIGGER sender_routing_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.sender_routing
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.sender_routing ENABLE ALWAYS TRIGGER sender_routing_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ── §c · the privilege a policy needs underneath it ──────────────────────────────────────────────
GRANT SELECT ON keystone.sender_identity TO reference_guard;
GRANT SELECT ON keystone.sender_routing  TO reference_guard;

-- ── §d · the visibility, TO reference_guard ONLY, same USING as every other guarded table ─────────
CREATE POLICY reference_guard_read ON keystone.sender_identity FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE is_reference));
CREATE POLICY reference_guard_read ON keystone.sender_routing FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE is_reference));

COMMENT ON POLICY reference_guard_read ON keystone.sender_identity IS
  'F502 / R58 / 0151 (the shape 0144 gave the other guarded tables). Lets refuse_touch_reference_rows, owned by '
  'reference_guard, SEE this table''s reference-practice rows on TRUNCATE — SELECT only, reference rows only. '
  '★★★ NOT app_owner: permissive policies OR-combine, so a policy TO app_owner gave EVERY app_owner SECURITY DEFINER '
  'function the reference practice (F501: account_seat_counts counted 3 people as 8).';
COMMENT ON POLICY reference_guard_read ON keystone.sender_routing IS
  'F502 / R58 / 0151 (the shape 0144 gave the other guarded tables). Lets refuse_touch_reference_rows, owned by '
  'reference_guard, SEE this table''s reference-practice rows on TRUNCATE — SELECT only, reference rows only. '
  '★★★ NOT app_owner: permissive policies OR-combine, so a policy TO app_owner gave EVERY app_owner SECURITY DEFINER '
  'function the reference practice (F501: account_seat_counts counted 3 people as 8).';

-- ── §e · the promised end state, from the catalogue ──────────────────────────────────────────────
DO $assert$
DECLARE
  v_rel       text;
  v_ref_trg   text[];
  v_new_trg   text[];
  v_ref_using text;
  v_new_using text;
  v_bad       text;
  v_guarded   integer;
  v_policies  integer;
BEGIN
  -- the model: app_user's triggers and policy, as the catalogue deparses them
  SELECT array_agg(replace(pg_get_triggerdef(tg.oid), 'app_user', '%T%') || ' enabled=' || tg.tgenabled::text ORDER BY tg.tgtype)
    INTO v_ref_trg
    FROM pg_trigger tg
   WHERE tg.tgrelid = 'keystone.app_user'::regclass AND tg.tgfoid = 'keystone.refuse_touch_reference_rows'::regproc;
  SELECT pg_get_expr(polqual, polrelid) INTO v_ref_using
    FROM pg_policy WHERE polrelid = 'keystone.app_user'::regclass AND polname = 'reference_guard_read';
  IF coalesce(array_length(v_ref_trg, 1), 0) <> 2 OR v_ref_using IS NULL THEN
    RAISE EXCEPTION '0151 §e: the model (keystone.app_user) does not carry 2 guard triggers and a reference_guard_read';
  END IF;

  FOREACH v_rel IN ARRAY ARRAY['sender_identity', 'sender_routing'] LOOP
    -- 1. triggers: text-equal to app_user's, table name substituted, ENABLE ALWAYS
    SELECT array_agg(replace(pg_get_triggerdef(tg.oid), v_rel, '%T%') || ' enabled=' || tg.tgenabled::text ORDER BY tg.tgtype)
      INTO v_new_trg
      FROM pg_trigger tg
     WHERE tg.tgrelid = format('keystone.%I', v_rel)::regclass AND tg.tgfoid = 'keystone.refuse_touch_reference_rows'::regproc;
    IF v_new_trg IS DISTINCT FROM v_ref_trg THEN
      RAISE EXCEPTION '0151 §e: keystone.% guard triggers % differ from app_user''s %', v_rel, v_new_trg, v_ref_trg;
    END IF;

    -- 2. policy: exactly one reference_guard_read, SELECT, PERMISSIVE, TO reference_guard only, USING equal to app_user's
    SELECT pg_get_expr(polqual, polrelid) INTO v_new_using
      FROM pg_policy
     WHERE polrelid = format('keystone.%I', v_rel)::regclass AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid] AND polcmd = 'r' AND polpermissive;
    IF v_new_using IS DISTINCT FROM v_ref_using THEN
      RAISE EXCEPTION '0151 §e: keystone.% reference_guard_read USING (%) differs from app_user''s (%) or has the wrong shape',
        v_rel, v_new_using, v_ref_using;
    END IF;

    -- 3. ★★★ no policy on this table names app_owner (F501)
    SELECT string_agg(polname, ', ') INTO v_bad
      FROM pg_policy WHERE polrelid = format('keystone.%I', v_rel)::regclass AND 'app_owner'::regrole::oid = ANY(polroles);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '0151 §e: keystone.% has polic(ies) naming app_owner: % (F501)', v_rel, v_bad;
    END IF;

    -- 4. the grant took effect; and every function a SELECT-applicable policy calls is executable (0144 §b)
    IF NOT has_table_privilege('reference_guard', format('keystone.%I', v_rel)::regclass, 'SELECT') THEN
      RAISE EXCEPTION '0151 §e: GRANT SELECT ON keystone.% TO reference_guard did not take effect', v_rel;
    END IF;
    SELECT string_agg(DISTINCT pr.oid::regprocedure::text, ', ') INTO v_bad
      FROM pg_policy pol
      JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid AND d.refclassid = 'pg_proc'::regclass
      JOIN pg_proc pr ON pr.oid = d.refobjid
     WHERE pol.polrelid = format('keystone.%I', v_rel)::regclass
       AND (pol.polroles @> ARRAY[0::oid] OR pol.polroles @> ARRAY['reference_guard'::regrole::oid])
       AND pol.polcmd IN ('r', '*')
       AND NOT has_function_privilege('reference_guard', pr.oid, 'EXECUTE');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION '0151 §e: reference_guard cannot EXECUTE function(s) keystone.%''s policies call: %', v_rel, v_bad;
    END IF;
  END LOOP;

  -- 5. set equality across the schema: trigger ⇔ policy (keystone.tenant carries the policy and its own guard)
  WITH want AS (
    SELECT DISTINCT tg.tgrelid AS rel FROM pg_trigger tg
     WHERE tg.tgfoid = 'keystone.refuse_touch_reference_rows'::regproc AND NOT tg.tgisinternal
    UNION SELECT 'keystone.tenant'::regclass::oid
  ), have AS (
    SELECT polrelid AS rel FROM pg_policy
     WHERE polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid] AND polcmd = 'r' AND polpermissive
  )
  SELECT string_agg(x, '; ') INTO v_bad FROM (
    SELECT 'missing on ' || rel::regclass::text AS x FROM want WHERE rel NOT IN (SELECT rel FROM have)
    UNION ALL
    SELECT 'unexpected on ' || rel::regclass::text FROM have WHERE rel NOT IN (SELECT rel FROM want)
  ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0151 §e: reference_guard_read does not match the guarded set: %', v_bad;
  END IF;
  SELECT count(DISTINCT tg.tgrelid) INTO v_guarded
    FROM pg_trigger tg WHERE tg.tgfoid = 'keystone.refuse_touch_reference_rows'::regproc AND NOT tg.tgisinternal;
  SELECT count(*) INTO v_policies FROM pg_policy WHERE polname = 'reference_guard_read';
  IF v_policies <> v_guarded + 1 THEN
    RAISE EXCEPTION '0151 §e: % reference_guard_read policies, expected % (tenant + % guarded)', v_policies, v_guarded + 1, v_guarded;
  END IF;
  SELECT string_agg(polrelid::regclass::text, ', ') INTO v_bad
    FROM pg_policy WHERE polname = 'reference_guard_read' AND 'app_owner'::regrole::oid = ANY(polroles);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0151 §e: reference_guard_read targets app_owner on: % (F501)', v_bad;
  END IF;

  -- 6. the lent EXECUTE is back: the guard's ACL is exactly its owner's, and app_owner cannot execute it
  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'keystone.refuse_touch_reference_rows()'::regprocedure)
       IS DISTINCT FROM '{reference_guard=X/reference_guard}'
     OR has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0151 §e: refuse_touch_reference_rows ACL is % — the EXECUTE lent to app_owner was not taken back',
      (SELECT proacl::text FROM pg_proc WHERE oid = 'keystone.refuse_touch_reference_rows()'::regprocedure);
  END IF;

  RAISE NOTICE '0151 §e: sender_identity + sender_routing carry the guard exactly as app_user does; % guarded table(s) ⇔ % reference_guard_read (incl. keystone.tenant); none names app_owner',
    v_guarded, v_policies;
END
$assert$;

-- ── §e (runtime) · who can SEE reference sender rows now ─────────────────────────────────────────
-- ★ As the guard's own role, run the guard's own TRUNCATE-branch query on both tables: an error here (a missing
--   grant, a policy function it cannot execute) aborts the migration instead of surfacing later as a TRUNCATE
--   refused — or allowed — for the wrong reason. Then app_owner, with NO tenant context, must see zero.
SELECT set_config('keystone.tenant_id', '', true);
SET LOCAL ROLE reference_guard;
DO $guard_probe$
DECLARE
  v_n bigint;
BEGIN
  SELECT (SELECT count(*) FROM keystone.sender_identity x JOIN keystone.tenant t ON t.id = x.tenant_id WHERE t.is_reference)
       + (SELECT count(*) FROM keystone.sender_routing  x JOIN keystone.tenant t ON t.id = x.tenant_id WHERE t.is_reference)
    INTO v_n;
  PERFORM set_config('keystone_0151.ref_rows_seen_by_guard', v_n::text, true);
END
$guard_probe$;
SET LOCAL ROLE app_owner;

DO $probe$
DECLARE
  v_owner bigint;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0151 probe: expected to be back as app_owner, am %', current_user;
  END IF;
  SELECT (SELECT count(*) FROM keystone.sender_identity) + (SELECT count(*) FROM keystone.sender_routing) INTO v_owner;
  IF v_owner <> 0 THEN
    RAISE EXCEPTION '0151 probe: app_owner sees % sender row(s) with no tenant context — F501 is not closed on these tables', v_owner;
  END IF;
  RAISE NOTICE '0151 probe: reference_guard sees % reference sender row(s); app_owner (no tenant context) sees 0',
    current_setting('keystone_0151.ref_rows_seen_by_guard');
END
$probe$;
