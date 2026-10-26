-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0191 — EVERY STAFF MEMBER HOLDS A ROLE. (Stage 7 task 7.9, part 2 of 2.)
--
-- ★★★ THIS FILE IS THE GATE ON 7.11. `keystone.scope_not_yet_configured()` (0078) is a tenant-wide
--     fail-OPEN that exists only because a staff member with no `user_role` row must not be locked
--     out of a practice that has not been seeded yet. 7.11 drops that function and both call sites
--     that OR it in. Dropping it is only safe once every staff row is covered — that is what the
--     closing self-check below proves, and it is re-asserted by 0193's own guard before the DROP.
--
-- ══ WHY BY staff_role, NOT BY RANK COMPARISON ══════════════════════════════════════════════════
-- `STAFF_ROLE_TO_ROLE_KEY` (`src/permissions/defaults.mjs`) states the correspondence; after 7.7
-- (0187/0188) the two vocabularies are literally identical (`owner`/`admin`/`coach` on both sides),
-- which is why this file runs after those two and after 0190 has seeded the matching `role` rows.
-- Each staff member's `keystone.role` grant is simply the row in THEIR OWN practice keyed
-- `app_user.staff_role`.
--
-- ══ F490 — SAME REASONING AS 0187/0190 ═════════════════════════════════════════════════════════
-- `keystone.user_role` is ENABLE and FORCE (0066:212-213). Enumerate practices as auth_owner, write
-- per practice as app_owner under its own GUC.
--
-- ★ `granted_by` is left **NULL** for every row this file writes — this is a system backfill
--   restating a practice's existing configuration (its staff_role), not a person choosing to grant
--   another person a role. `keystone.user_role.granted_by` is nullable for exactly this reason
--   (0066:151-152: `ON DELETE SET NULL`, no `NOT NULL`).
--
-- ★ NOT MARKED `-- keystone:one-way`. NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0191: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.user_role') IS NULL OR to_regclass('keystone.role') IS NULL THEN
    RAISE EXCEPTION '0191: keystone.role or keystone.user_role does not exist';
  END IF;

  IF to_regclass('keystone.role_action') IS NULL THEN
    RAISE EXCEPTION '0191: keystone.role_action does not exist — 0190 must apply first';
  END IF;
END
$preconditions$;

-- ── §b · EVERY STAFF MEMBER, GRANTED THE ROLE THEIR staff_role NAMES ──────────────────────────────
DO $every_staff_member_holds_a_role$
DECLARE
  v_tenant_ids     uuid[];
  v_tenant_count   integer;
  v_tenant_id      uuid;
  v_grants_ins     integer;
  v_unmatched      integer;
  v_total_staff    bigint := 0;
  v_total_granted  bigint := 0;
  i                integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0191: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  IF v_tenant_count = 0 THEN
    RAISE NOTICE '0191: 0 practices exist on this database — nothing to grant. Expected on a fresh database.';
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0191: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★ A staff row whose staff_role names no seeded role is a real defect (0190 seeds owner, admin,
    --   coach — the only three values app_user_staff_role_check admits after 0188) — refused loudly
    --   rather than silently skipped, the same argument seed_builtin_roles makes at 0069:90-102.
    SELECT count(*) INTO v_unmatched
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id()
       AND u.role = 'staff'
       AND NOT EXISTS (SELECT 1 FROM keystone.role r
                         WHERE r.tenant_id = keystone.current_tenant_id() AND r.key = u.staff_role);
    IF v_unmatched > 0 THEN
      RAISE EXCEPTION '0191: practice % has % staff row(s) whose staff_role names no seeded role — 0190 must seed every value app_user_staff_role_check admits',
        v_tenant_id, v_unmatched;
    END IF;

    INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
    SELECT v_tenant_id, u.id, r.id, NULL
      FROM keystone.app_user u
      JOIN keystone.role r ON r.tenant_id = v_tenant_id AND r.key = u.staff_role
     WHERE u.tenant_id = v_tenant_id AND u.role = 'staff'
    ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING;
    GET DIAGNOSTICS v_grants_ins = ROW_COUNT;

    RAISE NOTICE '0191: practice % · % user_role row(s) affected', v_tenant_id, v_grants_ins;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0191: % practice(s) processed', v_tenant_count;
END
$every_staff_member_holds_a_role$;

-- ── §c · THE SELF-CHECK — EVERY STAFF MEMBER COVERED, ACCUMULATED PER PRACTICE (F490) ─────────────
-- ★★★ THIS IS THE ASSERTION 7.11 DEPENDS ON. A blind, un-scoped
--     `SELECT count(*) FROM keystone.app_user WHERE role='staff'` after this transaction's GUC has
--     moved on to the last practice would return a number FORCE RLS makes wrong for every practice
--     but that one — the exact F490 shape this file's own header warns about. So the count is
--     accumulated PER PRACTICE, under that practice's own GUC, and compared as a total.
DO $the_self_check$
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

    SELECT count(*) INTO v_staff
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id() AND u.role = 'staff';

    SELECT count(DISTINCT ur.user_id) INTO v_covered
      FROM keystone.user_role ur
     WHERE ur.tenant_id = keystone.current_tenant_id();

    IF v_staff <> v_covered THEN
      RAISE EXCEPTION '0191: practice % has % staff row(s) but only % hold(s) a user_role row — the fail-open (7.11) cannot be removed while this disagrees',
        v_tenant_id, v_staff, v_covered;
    END IF;

    v_total_staff   := v_total_staff   + v_staff;
    v_total_covered := v_total_covered + v_covered;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_total_staff <> v_total_covered THEN
    RAISE EXCEPTION '0191: % staff row(s) total but % covered by a user_role row total — the per-practice checks above should have already caught this',
      v_total_staff, v_total_covered;
  END IF;

  IF coalesce(array_length(v_tenant_ids, 1), 0) = 0 THEN
    RAISE NOTICE '0191: self-check confirmed nothing — 0 practices exist on this database. Expected on a fresh database.';
  ELSE
    RAISE NOTICE '0191: self-check passed — % staff row(s) across % practice(s), all % covered by a user_role row. keystone.scope_not_yet_configured() may now be dropped (7.11).',
      v_total_staff, array_length(v_tenant_ids, 1), v_total_covered;
  END IF;
END
$the_self_check$;
