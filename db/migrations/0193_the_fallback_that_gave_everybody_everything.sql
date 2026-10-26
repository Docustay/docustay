-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0193 — THE FALLBACK THAT GAVE EVERYBODY EVERYTHING, GONE. (Stage 7 task 7.11.)
--
-- ★★★ WHAT THIS DROPS. `keystone.scope_not_yet_configured(uuid)` (0075, re-keyed by 0078) is the
--     tenant-wide fail-OPEN disjunct that `src/records/lists/_shared.mjs`'s `scoped()` and
--     `src/records/queries.mjs`'s `scopedRecord()` OR into every ownable-object predicate: while a
--     tenant holds zero `keystone.user_role` rows, EVERY staff member reads EVERYTHING in the
--     practice, regardless of their own role or lack of one. `0190` seeds every practice's three
--     roles and their 63 grants; `0191` grants every staff row the `user_role` its own `staff_role`
--     names, and its closing self-check (`0191:112-167`) is what proves the fallback is no longer
--     load-bearing anywhere on this database. **This file repeats that same assertion as a guard**,
--     so the DROP below cannot be applied to a database where 0191 was skipped, forgotten, or ran
--     against a different database than this migration is being applied to.
--
-- ══ WHY THE GUARD IS REPEATED HERE RATHER THAN TRUSTED FROM 0191 ══════════════════════════════════
-- Migrations apply one at a time, in order, but nothing stops a database from reaching 0193 by a
-- path that skipped 0191's self-check being meaningful *at this moment* — a practice created between
-- 0191 applying and 0193 applying, or a staff row inserted outside the migration path entirely, would
-- leave 0191's already-passed assertion stale. Re-checking here, immediately before the DROP, is the
-- same "prove it right before you rely on it" discipline 0191's own header states for 0193
-- (`0191:4-8`): "re-asserted by 0193's own guard before the DROP."
--
-- ══ F490 — SAME REASONING AS 0187/0190/0191 ═══════════════════════════════════════════════════════
-- `keystone.role` and `keystone.user_role` are ENABLE **and FORCE** row level security (0066:208-213).
-- `db/migrate.mjs` runs every file as `app_owner` with no tenant GUC (0010:38-49) — a global read here
-- would see zero rows and the guard would pass vacuously over every practice at once. Enumerate
-- practices as `auth_owner` (bypasses RLS to read `keystone.tenant`), then re-check per practice under
-- that practice's own GUC, exactly as `0191:112-167`'s self-check does.
--
-- ══ WHAT THIS DOES NOT TOUCH ═══════════════════════════════════════════════════════════════════════
-- MEASURED: `grep -rln "scope_not_yet_configured" db/migrations/` returns only `0075` and `0078` — the
-- two definitions. **No RLS policy calls this function** — removing it changes no policy, no grant,
-- no table. The two call sites that OR it into their predicate (`src/records/lists/_shared.mjs:94`,
-- `src/records/queries.mjs:360`) are application code, not SQL, and are this task's other two files.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that re-creates the function
--   body from 0078, the same reasoning 0189 states for retiring `front_desk` (`0189:34-38`).
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry practice ids and counts.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0193: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regprocedure('keystone.scope_not_yet_configured(uuid)') IS NULL THEN
    RAISE EXCEPTION '0193: keystone.scope_not_yet_configured(uuid) does not exist — nothing to drop, or this file already applied';
  END IF;

  IF to_regclass('keystone.role') IS NULL
     OR to_regclass('keystone.role_permission') IS NULL
     OR to_regclass('keystone.user_role') IS NULL THEN
    RAISE EXCEPTION '0193: keystone.role, keystone.role_permission or keystone.user_role does not exist';
  END IF;
END
$preconditions$;

-- ── §b · THE GUARD — EVERY STAFF MEMBER MUST HOLD A user_role ROW, ACCUMULATED PER PRACTICE (F490) ──
-- ★★★ THIS IS THE SAME ASSERTION `0191:112-167` MAKES, REPEATED HERE SO THE DROP CANNOT BE APPLIED
--     TO A DATABASE WHERE 0191 WAS SKIPPED (0191's own header, `:8`, and this task's plan entry,
--     field 6, both require it). If even one staff row in one practice holds no `user_role` row,
--     dropping the fallback below would lock that person out of everything instead of leaving them
--     on the (leaky but survivable) fallback — so the guard RAISEs and the DROP never runs.
DO $the_guard$
DECLARE
  v_tenant_ids    uuid[];
  v_tenant_id     uuid;
  v_staff         integer;
  v_covered       integer;
  v_total_staff   bigint := 0;
  v_total_covered bigint := 0;
  i               integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0193: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    SELECT count(*) INTO v_staff
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id() AND u.role = 'staff';

    SELECT count(DISTINCT ur.user_id) INTO v_covered
      FROM keystone.user_role ur
     WHERE ur.tenant_id = keystone.current_tenant_id();

    IF v_staff <> v_covered THEN
      RAISE EXCEPTION '0193: practice % has % staff row(s) but only % hold(s) a user_role row — keystone.scope_not_yet_configured() cannot be dropped while this disagrees (0191 must apply cleanly first)',
        v_tenant_id, v_staff, v_covered;
    END IF;

    v_total_staff   := v_total_staff   + v_staff;
    v_total_covered := v_total_covered + v_covered;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_total_staff <> v_total_covered THEN
    RAISE EXCEPTION '0193: % staff row(s) total but % covered by a user_role row total — the per-practice checks above should have already caught this',
      v_total_staff, v_total_covered;
  END IF;

  IF coalesce(array_length(v_tenant_ids, 1), 0) = 0 THEN
    RAISE NOTICE '0193: guard confirmed nothing — 0 practices exist on this database. Expected on a fresh database.';
  ELSE
    RAISE NOTICE '0193: guard passed — % staff row(s) across % practice(s), all % covered by a user_role row. Dropping keystone.scope_not_yet_configured().',
      v_total_staff, array_length(v_tenant_ids, 1), v_total_covered;
  END IF;
END
$the_guard$;

-- ── §c · THE DROP ───────────────────────────────────────────────────────────────────────────────
DROP FUNCTION keystone.scope_not_yet_configured(uuid);

-- ── §d · THE SELF-CHECK — THE FUNCTION IS GONE, AND user_may (THE REAL PREDICATE) IS NOT ─────────
-- ★★★ Positive control in the same block: dropping the fallback must not have taken the real
--     predicate down with it. `keystone.user_may` is 0192's function and must still answer.
DO $the_shape_is_what_it_claims$
DECLARE
  v_answer boolean;
BEGIN
  IF to_regprocedure('keystone.scope_not_yet_configured(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0193: keystone.scope_not_yet_configured(uuid) still exists after DROP FUNCTION';
  END IF;

  -- ★ Positive control — the real predicate, keystone.user_may, must still answer a boolean.
  SELECT keystone.user_may(NULL, 'person', 'view', NULL) INTO v_answer;
  IF v_answer IS DISTINCT FROM false THEN
    RAISE EXCEPTION '0193: keystone.user_may(NULL, ''person'', ''view'', NULL) must answer false (no user, no grant), got % — dropping the fallback must not have disturbed it',
      v_answer;
  END IF;

  RAISE NOTICE '0193: keystone.scope_not_yet_configured(uuid) is gone; keystone.user_may still answers (positive control).';
END
$the_shape_is_what_it_claims$;
