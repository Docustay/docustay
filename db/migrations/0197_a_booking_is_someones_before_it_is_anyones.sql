-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0197 — A BOOKING IS SOMEONE'S BEFORE IT IS ANYONE'S. (Stage 7 task 7.18.)
--
-- ★★★ WHAT THIS FIXES. `src/booking/createBooking.mjs`'s `createBooking` — [MEASURED]
--     `grep -n "user_may\|scope_allows\|forbidden"` returns NOTHING in that file — takes an
--     `actorUserId` and a `hostId` and never asks whether the actor may book for that host. Carried
--     from Stage 3: `reschedule.mjs:23-30`'s own header says "Booking CREATE has the same gap; that
--     is Stage 7's." A Coach whose `engagement` scope is `owned` could book a session onto ANY other
--     coach's calendar — an app-layer gap this migration closes at the row itself, so any future
--     writer (a script, a worker, a second route) inherits the rule too, not just this one call site.
--
-- ★★ THE FIX. `keystone.booking`'s `tenant_insert` policy (0013, the shared per-table loop: `FOR
--    INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())`) gains a second conjunct —
--    `AND keystone.user_may(keystone.current_user_id(), 'engagement', 'edit', host_id)` — the SAME
--    object/verb/owner triple `src/records/queries.mjs`'s `RECORD_QUERIES.booking` already asks for
--    the read side (task 7.18 also moves that read from `'view'` to `'edit'` for cancel/reschedule,
--    in the JS files, not here). A Coach on `engagement: edit/owned` may insert with themselves as
--    host; booking for another coach needs `team` or `everything` scope on `engagement`.
--
-- ★ WHO SUPPLIES THE CONDITION. `keystone.current_user_id()` reads the `keystone.user_id` GUC set at
--   `src/db/index.mjs:115` on every request — the application, not a test fixture. The application
--   ALSO checks `keystone.user_may($1, 'engagement', 'edit', hostId)` explicitly at the JS layer
--   (`src/booking/createBooking.mjs`, this same task) before ever reaching this INSERT — belt and
--   braces on purpose for the least-reversible calendar write: the JS check answers `forbidden`
--   (creating is not a record whose existence could leak), and THIS policy is the backstop that
--   holds even if a future code path skips the JS check.
--
-- ★★ THE EXISTING TENANT CONJUNCT IS KEPT, NOT REPLACED. Dropping `tenant_id = require_tenant_id()`
--    would let the scope conjunct alone decide admission, and `user_may` says nothing about tenant
--    membership — that would open a path where the SCOPE check technically passes for a host in a
--    DIFFERENT tenant. Both conjuncts, `AND`ed, exactly as field 6 states.
--
-- ★★★ [F658 FIX, 22 Sep 2026] THE ABOVE ALONE DOES NOTHING. `keystone.booking` also carries the
--     0013 shared-loop `tenant_isolation` policy — `FOR ALL`, tenant-only, no explicit `WITH CHECK`.
--     Postgres uses a `FOR ALL` PERMISSIVE policy's `USING` clause as an IMPLICIT `WITH CHECK` for
--     INSERT too, and PERMISSIVE policies OR together — so `tenant_isolation`'s tenant-only check
--     alone still admitted every INSERT, completely defeating `tenant_insert`'s new `user_may`
--     conjunct. Confirmed two ways: with `tenant_insert` as rewritten above and `tenant_isolation`
--     left alone, Coach A (engagement: edit/owned) still inserted a booking with Coach B as host;
--     dropping `tenant_isolation` alone made the identical INSERT correctly fail with SQLSTATE
--     42501. `0196` (`invoice`/`payment`/`subscription`, the migration immediately before this one)
--     hit and fixed the exact same shape by splitting its `tenant_isolation` into a `FOR SELECT`-only
--     policy plus separate `tenant_update`/`tenant_delete` — §b1 below applies that identical
--     restructuring to `booking`. The READ side is UNCHANGED (this task, 7.18, only closes the
--     INSERT gap — `tenant_isolation` keeps its tenant-only USING, no `user_may` added to SELECT).
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that restores the single
--   tenant predicate, same reasoning 0189/0193/0195 give for their own reversible drops.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry counts and SQLSTATEs only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  v_check text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0197: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0197: keystone.booking does not exist';
  END IF;

  IF to_regprocedure('keystone.user_may(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION '0197: keystone.user_may(uuid, text, text, uuid) does not exist — 7.10/0192 must run first';
  END IF;

  SELECT with_check INTO v_check
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';

  IF v_check IS NULL THEN
    RAISE EXCEPTION '0197: keystone.booking carries no tenant_insert policy to replace';
  END IF;
  IF v_check !~ 'require_tenant_id' THEN
    RAISE EXCEPTION '0197: keystone.booking''s tenant_insert WITH CHECK does not mention require_tenant_id — changed by hand? refusing to guess: %', v_check;
  END IF;
  IF v_check ~ 'user_may' THEN
    RAISE EXCEPTION '0197: keystone.booking''s tenant_insert WITH CHECK already mentions user_may — changed by hand? refusing to guess: %', v_check;
  END IF;

  -- [F658 FIX] the same shape-check 0196 §a runs before splitting tenant_isolation.
  SELECT qual INTO v_check FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_isolation';
  IF v_check IS NULL THEN
    RAISE EXCEPTION '0197: keystone.booking carries no tenant_isolation policy to split';
  END IF;
  IF v_check !~ 'current_tenant_id' THEN
    RAISE EXCEPTION '0197: keystone.booking''s tenant_isolation USING does not mention current_tenant_id — changed by hand? refusing to guess: %', v_check;
  END IF;
END
$preconditions$;

-- ── §b1 · [F658 FIX] SPLIT tenant_isolation SO IT STOPS IMPLICITLY RE-ADMITTING EVERY INSERT ──────
-- Same restructuring 0196 applied to invoice/payment/subscription. Read side unchanged (tenant-only);
-- UPDATE/DELETE reproduce exactly what the dropped FOR ALL policy already allowed for those commands.
DROP POLICY tenant_isolation ON keystone.booking;

CREATE POLICY tenant_isolation ON keystone.booking
  FOR SELECT USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_update ON keystone.booking
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_delete ON keystone.booking
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

COMMENT ON POLICY tenant_isolation ON keystone.booking IS
  'Stage 7 task 7.18 (F658 fix). FOR SELECT only (was FOR ALL) — read side unchanged, tenant-only. '
  'Split so its USING clause can no longer act as an implicit WITH CHECK that re-admits every INSERT '
  'regardless of tenant_insert''s user_may conjunct. UPDATE/DELETE keep the old tenant-only answer '
  'via the new tenant_update/tenant_delete policies, reproducing exactly what FOR ALL already allowed.';

-- ── §b2 · THE POLICY — tenant_insert gains the second conjunct ─────────────────────────────────
DROP POLICY tenant_insert ON keystone.booking;

CREATE POLICY tenant_insert ON keystone.booking
  FOR INSERT WITH CHECK (
    tenant_id = keystone.require_tenant_id()
    AND keystone.user_may(keystone.current_user_id(), 'engagement', 'edit', host_id)
  );

COMMENT ON POLICY tenant_insert ON keystone.booking IS
  'Stage 7 task 7.18. Same tenant conjunct as 0013''s shared loop, plus '
  'keystone.user_may(current_user_id(), ''engagement'', ''edit'', host_id): the actor must hold '
  'engagement:edit scope covering the host they are booking for. A coach on engagement:edit/owned '
  'may book only themselves; team/everything is required to book another coach''s calendar. Backstop '
  'for src/booking/createBooking.mjs''s own JS-layer check (same task) — belt and braces for the '
  'least-reversible calendar write.';

-- ── §c · SELF-CHECK, PART 1 — THE CATALOG SHAPE THIS FILE CLAIMS ───────────────────────────────
DO $shape_check$
DECLARE
  n integer;
  v_check text;
BEGIN
  -- ★★ FIX [MEASURED 22 Sep 2026]: this used to count ALL policies on the table and require exactly
  --    2, but `reference_guard_read` (the reference-practice protection system's own SELECT policy,
  --    present on every FORCE RLS tenant table, `booking` included) is a 3rd policy this count never
  --    accounted for — never exercised before now. Counting the NAMED policies by name, rather
  --    than the table's total policy count, is what the exception message already claimed to check.
  -- ★★★ [F658 FIX] now 4 named policies, not 2 — tenant_isolation (FOR SELECT), tenant_insert,
  --     tenant_update, tenant_delete — per the §b1 split above.
  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking'
     AND policyname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete');
  IF n <> 4 THEN
    RAISE EXCEPTION '0197: keystone.booking carries % of the 4 named policies (tenant_isolation, tenant_insert, tenant_update, tenant_delete)', n;
  END IF;

  SELECT with_check INTO v_check FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';
  IF v_check !~ 'require_tenant_id' OR v_check !~ 'user_may' THEN
    RAISE EXCEPTION '0197: keystone.booking''s tenant_insert policy does not carry both conjuncts: %', v_check;
  END IF;

  -- [F658 FIX] tenant_isolation must now be FOR SELECT only, not FOR ALL — the whole point of the
  -- split is that it can no longer supply an implicit WITH CHECK for INSERT. pg_policies.cmd is the
  -- human-readable text form ('SELECT'/'INSERT'/'UPDATE'/'DELETE'/'ALL'), not polcmd's single-char code.
  SELECT cmd INTO v_check FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_isolation';
  IF v_check IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION '0197: keystone.booking''s tenant_isolation policy is not FOR SELECT (cmd=%) — the F658 split did not take', v_check;
  END IF;

  RAISE NOTICE '0197: keystone.booking carries 4 policies; tenant_isolation is FOR SELECT only, tenant_insert reads both require_tenant_id() and user_may(...).';
END
$shape_check$;

-- ── §d · SELF-CHECK, PART 2 — A FABRICATED COACH, FUNCTIONALLY, WITH A POSITIVE CONTROL ────────
-- ★★★ A coach holding `engagement: edit, owned` may insert a booking with THEMSELVES as host, and
--     may NOT with ANOTHER coach as host — the negative and its positive control, both here.
--     Everything fabricated is deleted at the end of this block; nothing survives the migration.
--     Modelled on 0195's §e (record_reason) / 0021:61-82's probe-tenant-and-delete shape.
--
-- ★★ F490 FIX [MEASURED 22 Sep 2026]: `keystone.tenant` is FORCE RLS (`0001:151-152`) with no
--    INSERT policy `app_owner` (NOBYPASSRLS — `scripts/bootstrap-roles.mjs:247`) can satisfy — the
--    bare `INSERT INTO keystone.tenant` below was refused with "new row violates row-level security
--    policy for table tenant" on EVERY execution, unexercised until now. `0018:113-120,169-179`
--    established the house pattern for exactly this — suspend FORCE for the bootstrap, act, restore
--    it IN THE SAME TRANSACTION, and ASSERT it came back — so this probe now brackets itself the
--    same way, rather than inventing a second pattern.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $booking_insert_check$
DECLARE
  v_tenant        uuid;
  v_coach_a       uuid;  -- the actor; holds engagement:edit:owned
  v_coach_b       uuid;  -- another coach — not the actor, not owned by the actor
  v_service       uuid;
  v_role_id       uuid;
  v_raised        boolean := false;
  v_booking_self  uuid;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0197-probe', 'M0197 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0197: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0197-coach-a@example.invalid', 'M0197 Coach A', 'staff', 'coach')
  RETURNING id INTO v_coach_a;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0197-coach-b@example.invalid', 'M0197 Coach B', 'staff', 'coach')
  RETURNING id INTO v_coach_b;

  INSERT INTO keystone.service (tenant_id, name, price_minor, duration_minutes)
  VALUES (v_tenant, 'M0197 probe service', 5000, 30) RETURNING id INTO v_service;

  INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
  VALUES (v_tenant, 'm0197_probe_role', 'M0197 probe role', false) RETURNING id INTO v_role_id;

  -- ★ engagement: edit, owned — the exact grant field 7 of 7.18 names.
  INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
  VALUES (v_tenant, v_role_id, 'engagement', 'edit', 'owned');

  -- ★ Only v_coach_a holds the role. v_coach_b holds nothing — that is the whole experiment.
  INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
  VALUES (v_tenant, v_coach_a, v_role_id, v_coach_a);

  PERFORM set_config('keystone.user_id', v_coach_a::text, true);

  -- ── NEGATIVE — Coach A may NOT insert a booking with Coach B as host ───────────────────────────
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
    VALUES (v_tenant, v_coach_b, v_service,
            now() + interval '1 day', now() + interval '1 day 30 minutes', v_coach_a);
    RAISE EXCEPTION '0197: Coach A (engagement: edit/owned) inserted a booking with Coach B as host — the INSERT policy did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0197: the negative control (Coach A booking Coach B) did not raise insufficient_privilege';
  END IF;

  -- ── POSITIVE CONTROL — the SAME identity may insert a booking with THEMSELVES as host ─────────
  INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
  VALUES (v_tenant, v_coach_a, v_service,
          now() + interval '1 day', now() + interval '1 day 30 minutes', v_coach_a)
  RETURNING id INTO v_booking_self;
  IF v_booking_self IS NULL THEN
    RAISE EXCEPTION '0197: Coach A (engagement: edit/owned), booking THEMSELVES as host, could not insert — the positive control failed';
  END IF;

  -- ── cleanup — nothing fabricated here survives the migration ───────────────────────────────────
  DELETE FROM keystone.booking WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.user_id', '', true);
  DELETE FROM keystone.user_role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role_permission WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.service WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0197: Coach A (engagement: edit/owned) could NOT insert a booking with Coach B as host (SQLSTATE 42501, negative control); the SAME identity could insert one with THEMSELVES as host (positive control). Probe tenant % removed.', v_tenant;
END
$booking_insert_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    tenant isolation on the root table of the whole schema, and every later migration and gate
--    would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0197: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
