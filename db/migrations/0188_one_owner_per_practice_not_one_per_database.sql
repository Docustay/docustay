-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0188 — ONE OWNER PER PRACTICE, NOT ONE PER DATABASE. (Stage 7 task 7.7, part 2 of 2: THE RULE.)
--
-- ★★★ RULED BY TY, 21 SEP 2026 (Q7-1), plan's recommendation taken: the last-Owner trigger applies
--     only from THIS file onward. `0187_every_practice_gets_an_owner.sql` has already moved every
--     row; this file replaces the rules that described the old vocabulary.
--
-- ══ WHAT LEAVES, AND WHY ALL OF IT LEAVES IN ONE FILE ═════════════════════════════════════════
--   · `app_user_single_super_admin_1_idx` — `UNIQUE (staff_role) WHERE staff_role = 'super_admin_1'`
--     (`0010:138-139`): **one Super Admin 1 per DATABASE**. [MEASURED on production, 18 Sep 2026,
--     0160's rollback] that index is what refused a second practice's founder with "duplicate key
--     value violates unique constraint app_user_single_super_admin_1_idx" — a per-DATABASE rule
--     meeting a per-PRACTICE product. **0160'S LESSON, APPLIED:** the old index is dropped in the
--     SAME migration that adds the new one, so there is never a moment when both rules exist.
--   · `app_user_super_admin_1_guard` and `keystone.enforce_super_admin_1()` (`0010:132-134`,
--     rewritten `0014:39-82`) — the §K3 server boundary for a rank that no longer exists. The
--     authority it carried does not evaporate: it moved to the operator GRANT (`0184`/`0186`, tasks
--     7.4 and 7.6), which is seeded in the same deploy.
--   · the third and fourth values of the rank CHECK — `0187` widened
--     `app_user_staff_role_check` to the union of old and new; this file narrows it to
--     `('owner','admin','coach')`. ★★ `ADD CONSTRAINT` validates by scanning the table **WITHOUT
--     RLS** (`0010:48-49` — it was the only statement in 0010 that told the truth), so a row 0187
--     failed to move cannot hide from it. That is deliberate: this is the file that cannot be
--     fooled by FORCE RLS, and it runs after the one that can.
--
-- ══ WHAT ARRIVES ══════════════════════════════════════════════════════════════════════════════
--   · `app_user_one_owner_per_tenant_idx` — `UNIQUE (tenant_id) WHERE staff_role = 'owner'`. It
--     LEADS WITH `tenant_id`, which is `0001:135-139`'s rule (a violation must not disclose another
--     practice's existence) and is what the old index deliberately did not do.
--   · `keystone.enforce_last_owner()` — the other half of "exactly one": the index stops a SECOND
--     Owner, the trigger stops the practice reaching ZERO. Without it, "exactly one" is only ever
--     "at most one", and a practice can be left with nobody who can change a setting.
--
-- ★★★ WHO SUPPLIES THE CONDITION THE TRIGGER CHECKS (CLAUDE.md failure 1): the TABLE'S OWN CONTENTS.
--     No GUC, no session variable, no test fixture, nothing the application has to remember to set.
--     It fires on every DELETE and on every UPDATE of `staff_role`/`tenant_id` that any caller makes
--     — the application's `setStaffRole` (`src/people/writes.mjs`), a migration, or psql alike. The
--     §d probe below proves it fires, on real rows, at apply time.
--
-- ★★ FORCE RLS DEFEATS SECURITY DEFINER — THE FIFTH SIGHTING, ALREADY ACCOUNTED FOR. The trigger
--    function must count the Owners of the row's own practice, and `keystone.app_user` is FORCE RLS
--    (`0001:151-152`); definer rights do not buy visibility (`0014:9-24`). So it adopts the ROW'S OWN
--    tenant context for exactly one read and restores the caller's on BOTH the success and the error
--    path — the same narrow, restored switch as `keystone.enforce_super_admin_1()` (`0014:55-72`) and
--    `keystone.account_seat_counts()` (0008). A caller left holding another practice's context would
--    have cross-tenant read of every table for the rest of its transaction.
--
-- ★ A NORMAL (ORIGIN) TRIGGER, NOT `ENABLE ALWAYS`, DELIBERATELY. `session_replication_role =
--   replica` is how the fixtures tear their own data down, per session and never globally
--   (`db/gates/fixtures/suppressTriggers.mjs`); an ALWAYS trigger would make deleting a fixture
--   practice impossible and would push teardown back to the global `DISABLE TRIGGER` that file
--   exists to stop. The reference practice's rows are protected from DELETE by 0099's ALWAYS
--   triggers, which is the case that genuinely needs it.
--
-- ★ EVERY NEW SECURITY DEFINER IN SCHEMA `keystone` CARRIES `SET search_path = ''` AND AN EXPLICIT
--   `REVOKE ALL … FROM PUBLIC` (STAGE-7-PLAN.md §4's stage-wide rule; `db/gates/catalog-conformance.mjs`
--   :696-758 fails a NULL `proacl`, which is Postgres's default for a brand-new function). A trigger
--   function needs no `GRANT EXECUTE` to fire — `0021:69-78` proved exactly that for
--   `enforce_super_admin_1`, and §d proves it again here, live.
--
-- ★ Runs as `app_owner` (`db/migrate.mjs:317`), which owns the table and the functions. Every
--   `SET LOCAL ROLE auth_owner` returns with `SET LOCAL ROLE app_owner`, NEVER a bare `RESET ROLE`
--   (F482). No secret, no email, no display name is read or printed: ids and counts only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  v_triggers integer;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0188: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.app_user') IS NULL THEN
    RAISE EXCEPTION '0188: keystone.app_user does not exist';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'keystone.app_user'::regclass
                    AND conname  = 'app_user_staff_role_check') THEN
    RAISE EXCEPTION '0188: app_user_staff_role_check does not exist — 0187 must be applied first';
  END IF;

  -- ★ `keystone.enforce_super_admin_1()` is dropped below. Refuse if anything OTHER than the one
  --   trigger 0010:132-134 created depends on it: dropping a function out from under an unknown
  --   caller is how a boundary disappears quietly.
  SELECT count(*) INTO v_triggers
    FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgfoid = to_regprocedure('keystone.enforce_super_admin_1()');
  IF to_regprocedure('keystone.enforce_super_admin_1()') IS NOT NULL AND v_triggers > 1 THEN
    RAISE EXCEPTION '0188: % triggers use keystone.enforce_super_admin_1() — expected only app_user_super_admin_1_guard (0010:132-134)', v_triggers;
  END IF;
END
$preconditions$;

-- ── §b · THE OLD RULE LEAVES AND THE NEW ONE ARRIVES, IN ONE FILE (0160's lesson) ───────────────

-- ★ The per-DATABASE office, and its server boundary.
DROP TRIGGER IF EXISTS app_user_super_admin_1_guard ON keystone.app_user;
DROP FUNCTION IF EXISTS keystone.enforce_super_admin_1();
DROP INDEX IF EXISTS keystone.app_user_single_super_admin_1_idx;

-- ★★ THE NARROWING. This statement scans every row without RLS; it is the one that cannot be
--    fooled by FORCE (header). `staff_role_shape` (0010:90-93) is untouched and still ties the rank
--    to `role = 'staff'`. The NAME is preserved: test/p15b_people_writes.test.mjs:216 reads this
--    constraint by name and compares its values with `STAFF_ROLES`.
ALTER TABLE keystone.app_user DROP CONSTRAINT app_user_staff_role_check;
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_staff_role_check
  CHECK (staff_role IN ('owner','admin','coach'));

-- ★★ AT MOST ONE OWNER **PER PRACTICE**. Leads with tenant_id (0001:135-139), so a violation says
--    "this practice already has an Owner" and discloses nothing about any other practice.
CREATE UNIQUE INDEX app_user_one_owner_per_tenant_idx
  ON keystone.app_user (tenant_id) WHERE staff_role = 'owner';

COMMENT ON INDEX keystone.app_user_one_owner_per_tenant_idx IS
  'Stage 7 / 7.7 — exactly one Owner per practice. Replaces app_user_single_super_admin_1_idx (0010:138-139), which was UNIQUE (staff_role) WHERE staff_role = ''super_admin_1'' — one per DATABASE, the rule 0160 was rolled back over. The AT-LEAST-one half is keystone.enforce_last_owner().';

-- ── §c · A PRACTICE MUST ALWAYS HAVE AN OWNER ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION keystone.enforce_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_tenant text;
  v_owners        integer;
BEGIN
  -- ★ Only the LOSS of an Owner is interesting. A row that was not the Owner cannot leave the
  --   practice without one, whatever it is being changed into.
  IF OLD.staff_role IS DISTINCT FROM 'owner' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- ★ An UPDATE that leaves the Owner an Owner OF THE SAME PRACTICE changes nothing this rule is
  --   about. Moving the row to another practice DOES: the old practice loses its Owner.
  IF TG_OP = 'UPDATE'
     AND NEW.staff_role IS NOT DISTINCT FROM 'owner'
     AND NEW.tenant_id  IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  v_caller_tenant := current_setting('keystone.tenant_id', true);

  BEGIN
    -- ★★ Adopt the ROW'S OWN tenant context for exactly one read — 0014:55-72, verbatim in shape.
    --    It uses the RLS mechanism rather than escaping it; no BYPASSRLS role exists or is needed.
    --    It discloses nothing: the caller already holds the row it is deleting or changing.
    PERFORM set_config('keystone.tenant_id', OLD.tenant_id::text, true);

    SELECT count(*) INTO v_owners
      FROM keystone.app_user u
     WHERE u.tenant_id = OLD.tenant_id
       AND u.staff_role = 'owner'
       AND u.id <> OLD.id;

    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
  EXCEPTION WHEN OTHERS THEN
    -- ★★ Restore on the error path too (0014:67-71): a caller left holding another practice's
    --    context would have cross-tenant read of every table for the rest of its transaction.
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
    RAISE;
  END;

  IF v_owners = 0 THEN
    RAISE EXCEPTION 'a practice must always have an Owner'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('app_user %s is the only person with staff_role = ''owner'' in practice %s', OLD.id, OLD.tenant_id),
            HINT    = 'Give the Owner rank to somebody else in this practice first, then change or remove this person.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

COMMENT ON FUNCTION keystone.enforce_last_owner() IS
  'Stage 7 / 7.7 — the AT-LEAST-one half of "exactly one Owner per practice" (app_user_one_owner_per_tenant_idx is the at-most-one half). Refuses a DELETE, a demotion, or a move to another practice that would leave a practice with zero Owners. Counts under the ROW''s own tenant context, restored on every path: FORCE RLS means SECURITY DEFINER alone cannot see the row (0014).';

-- ★ `UPDATE OF staff_role, tenant_id` narrows the UPDATE case only; the DELETE case is unfiltered,
--   which is what it must be.
CREATE TRIGGER app_user_last_owner_guard
  BEFORE DELETE OR UPDATE OF staff_role, tenant_id ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.enforce_last_owner();

-- ★★ A brand-new function's default acl IS `PUBLIC` (a NULL `proacl`), and
--    db/gates/catalog-conformance.mjs:746-751 fails on exactly that. A trigger function needs no
--    EXECUTE grant to fire — 0021:69-78 measured it, and §d measures it again below.
REVOKE ALL ON FUNCTION keystone.enforce_last_owner() FROM PUBLIC;

-- ── §d · THE SELF-CHECK — THE FOUR FACTS, AND THEN THE RULE, LIVE ──────────────────────────────
DO $the_shape_is_what_it_claims$
DECLARE
  v_def        text;
  v_values     text[];
  v_idxdef     text;
  v_prosecdef  boolean;
  v_proconfig  text[];
  v_proacl     text;
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_staff      integer;
  v_owners     integer;
  v_seen_staff bigint := 0;
  v_owned      integer := 0;
  v_staffless  integer := 0;
  v_bad        text[] := '{}';
  i            integer;
BEGIN
  -- (1) THE OLD PER-DATABASE INDEX IS GONE.
  IF to_regclass('keystone.app_user_single_super_admin_1_idx') IS NOT NULL THEN
    RAISE EXCEPTION '0188: app_user_single_super_admin_1_idx still exists — the per-database rule and the per-practice rule would both be live, which is 0160 again';
  END IF;

  -- (2) THE OLD SERVER BOUNDARY IS GONE (function and trigger).
  IF to_regprocedure('keystone.enforce_super_admin_1()') IS NOT NULL THEN
    RAISE EXCEPTION '0188: keystone.enforce_super_admin_1() still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'keystone.app_user'::regclass
                AND NOT tgisinternal
                AND tgname = 'app_user_super_admin_1_guard') THEN
    RAISE EXCEPTION '0188: trigger app_user_super_admin_1_guard still exists on keystone.app_user';
  END IF;

  -- (3) THE RANK CHECK NAMES EXACTLY THREE VALUES, AND THEY ARE THESE THREE.
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.app_user'::regclass
     AND c.conname  = 'app_user_staff_role_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0188: app_user_staff_role_check is missing after the narrowing';
  END IF;
  -- ★ The pattern is `test/p15b_people_writes.test.mjs:214`'s, not a new one: MEASURED, Postgres
  --   deparses this CHECK as `... = ANY (ARRAY['owner'::text, 'admin'::text, 'coach'::text])`, and
  --   that test already reads this very constraint by that shape.
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_values
    FROM regexp_matches(v_def, '''([a-z_0-9]+)''::text', 'g') AS m;
  IF v_values IS DISTINCT FROM ARRAY['admin','coach','owner'] THEN
    RAISE EXCEPTION '0188: app_user_staff_role_check names % — expected exactly admin, coach, owner. Definition: %',
      coalesce(array_to_string(v_values, ', '), '(none)'), v_def;
  END IF;

  -- (4) THE NEW INDEX IS UNIQUE, PARTIAL ON owner, AND LEADS WITH tenant_id.
  IF to_regclass('keystone.app_user_one_owner_per_tenant_idx') IS NULL THEN
    RAISE EXCEPTION '0188: app_user_one_owner_per_tenant_idx was not created';
  END IF;
  SELECT pg_get_indexdef(to_regclass('keystone.app_user_one_owner_per_tenant_idx')) INTO v_idxdef;
  IF v_idxdef IS NULL THEN
    RAISE EXCEPTION '0188: app_user_one_owner_per_tenant_idx exists but has no definition';
  END IF;
  IF v_idxdef NOT LIKE 'CREATE UNIQUE INDEX%(tenant_id)%WHERE (staff_role = ''owner''::text)' THEN
    RAISE EXCEPTION '0188: app_user_one_owner_per_tenant_idx is not UNIQUE (tenant_id) WHERE staff_role = ''owner'': %', v_idxdef;
  END IF;

  -- (4b) THE NEW DEFINER OBEYS THE STAGE-WIDE RULE (search_path pinned, no EXECUTE to PUBLIC).
  IF to_regprocedure('keystone.enforce_last_owner()') IS NULL THEN
    RAISE EXCEPTION '0188: keystone.enforce_last_owner() was not created';
  END IF;
  SELECT p.prosecdef, p.proconfig, coalesce(p.proacl::text, '(null — PUBLIC)')
    INTO v_prosecdef, v_proconfig, v_proacl
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('keystone.enforce_last_owner()');
  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '0188: keystone.enforce_last_owner() is not SECURITY DEFINER — it could not read the practice''s own rows under FORCE RLS';
  END IF;
  IF v_proconfig IS NULL OR NOT (v_proconfig::text LIKE '%search_path=%') THEN
    RAISE EXCEPTION '0188: keystone.enforce_last_owner() has no pinned search_path (proconfig %)', coalesce(v_proconfig::text, '(null)');
  END IF;
  IF v_proacl = '(null — PUBLIC)' THEN
    RAISE EXCEPTION '0188: keystone.enforce_last_owner() has a NULL proacl, which IS execute-to-PUBLIC — db/gates/catalog-conformance.mjs:746-751 fails on exactly this';
  END IF;

  -- (5) EVERY PRACTICE THAT HAS STAFF HOLDS EXACTLY ONE OWNER — RE-READ INDEPENDENTLY OF 0187.
  --     ★★ F490: enumerate as auth_owner, read each practice under its own GUC as app_owner. A
  --        single global count would read 0 rows and pass vacuously, which is the failure this
  --        project has shipped four times.
  --     ★ A practice with NO staff at all is counted and NAMED in the NOTICE, not asserted over:
  --       `staff_role_shape` (0010:90-93) means only a `role = 'staff'` row can carry a rank, so
  --       such a practice has no candidate to be its Owner. Production holds 3 practices, each with
  --       one staff member (EXECUTED 21 Sep 2026), so it reports 3 owned and 0 staffless there.
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0188: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    SELECT count(*) FILTER (WHERE u.role = 'staff'),
           count(*) FILTER (WHERE u.staff_role = 'owner')
      INTO v_staff, v_owners
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id();

    v_seen_staff := v_seen_staff + v_staff;
    IF v_staff = 0 THEN
      v_staffless := v_staffless + 1;
    ELSIF v_owners = 1 THEN
      v_owned := v_owned + 1;
    ELSE
      v_bad := v_bad || format('%s (%s staff, %s owner(s))', v_tenant_id, v_staff, v_owners);
    END IF;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF array_length(v_bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION '0188: % practice(s) with staff do not hold exactly one Owner: %',
      array_length(v_bad, 1), array_to_string(v_bad, ' · ');
  END IF;

  RAISE NOTICE '0188: shape confirmed — old index gone, old guard gone, rank CHECK = (admin, coach, owner), % practice(s) with staff hold exactly one Owner, % hold no staff at all, across % staff row(s) visible',
    v_owned, v_staffless, v_seen_staff;
END
$the_shape_is_what_it_claims$;

-- ── §e · THE RULE, EXERCISED ON REAL ROWS, WITH ITS POSITIVE CONTROL ───────────────────────────
-- ★★★ A GUARD THAT NOBODY HAS SEEN FIRE IS A GUARD NOBODY HAS SEEN FIRE. §d proves the catalogue
--     says the right things; this proves the trigger REFUSES. And it carries its positive control in
--     the same block: the SAME UPDATE, on the SAME row and the SAME column, with a value the rule
--     permits, must SUCCEED — otherwise "it was refused" would be indistinguishable from "this
--     connection cannot touch that row at all" (FORCE RLS), which is precisely the vacuous pass
--     0014:26-32 records the P5.4 gate making.
-- ★ NEITHER PROBE LEAVES A ROW CHANGED. Each runs in its own subtransaction: the refusal unwinds
--   itself, and the control is unwound by a raise with a private SQLSTATE. `updated_at` is not
--   bumped, no event is written, and nothing is left for the next reader to explain.
DO $the_last_owner_rule_is_live$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_owner_id   uuid;
  v_control    integer := 0;
  v_refused    boolean := false;
  v_done       boolean := false;
  i            integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    EXIT WHEN v_done;
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    SELECT u.id INTO v_owner_id
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id()
       AND u.staff_role = 'owner'
     ORDER BY u.id
     LIMIT 1;
    CONTINUE WHEN v_owner_id IS NULL;

    -- ★ POSITIVE CONTROL — the same statement, a value the rule allows. Unwound by KS188.
    BEGIN
      UPDATE keystone.app_user SET staff_role = 'owner' WHERE id = v_owner_id;
      GET DIAGNOSTICS v_control = ROW_COUNT;
      RAISE EXCEPTION 'unwind the control' USING ERRCODE = 'KS188';
    EXCEPTION WHEN SQLSTATE 'KS188' THEN
      NULL;  -- the row change is rolled back to the subtransaction's savepoint; v_control survives
    END;
    IF v_control <> 1 THEN
      RAISE EXCEPTION '0188: the control could not update the Owner row of practice % at all (% row(s)) — the refusal below would prove nothing', v_tenant_id, v_control;
    END IF;

    -- ★ THE RULE ITSELF — demoting the only Owner must be refused.
    BEGIN
      UPDATE keystone.app_user SET staff_role = 'coach' WHERE id = v_owner_id;
    EXCEPTION WHEN check_violation THEN
      v_refused := true;
    END;
    IF NOT v_refused THEN
      RAISE EXCEPTION '0188: demoting the ONLY Owner of practice % was ALLOWED — keystone.enforce_last_owner is inert (a trigger function that does not fire, 0021:69-78''s failure mode)', v_tenant_id;
    END IF;

    v_done := true;
    RAISE NOTICE '0188: the last-Owner rule is live — in practice %, the control (owner → owner) changed 1 row and was unwound, and the demotion (owner → coach) of the only Owner was refused', v_tenant_id;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF NOT v_done THEN
    RAISE NOTICE '0188: the live probe did NOT run — no practice on this database holds an Owner (expected on a fresh database, where 0187 had no staff to promote). The rule is created but unexercised here; test/s7_one_owner_per_practice.test.mjs and step 3 exercise it.';
  END IF;
END
$the_last_owner_rule_is_live$;
