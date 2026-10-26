-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0187 — EVERY PRACTICE GETS AN OWNER. (Stage 7 task 7.7, part 1 of 2: THE DATA.)
--
-- ★★★ RULED BY TY, 21 SEP 2026 (Q7-1), plan's recommendation taken: *promote the single staff member
--     in each practice to `owner` in 0187, and make the last-Owner trigger apply only from 0188
--     onward.* This file is the first half; `0188_one_owner_per_practice_not_one_per_database.sql`
--     is the second and MUST follow it.
--
-- ══ WHY A RELABEL IS NOT ENOUGH, MEASURED ══════════════════════════════════════════════════════
-- [EXECUTED 21 Sep 2026, read-only against the deployed database, counts only] production holds
-- **3 practices** and **3 `app_user` rows, one per practice**: `staff_role` = `coach` ×2 and
-- `super_admin_1` ×1. There is **no `super_admin` row anywhere**, so a straight
-- `UPDATE … SET staff_role = 'owner' WHERE staff_role = 'super_admin'` would match **ZERO ROWS** and
-- commit silently — the F143/F490 shape this project has shipped four times. Hence Q7-1's rule, which
-- this file implements per practice and refuses to guess at:
--
--   · the practice's single `super_admin_1` or `super_admin` row becomes `owner`;
--   · a practice with neither, but with exactly ONE staff member, promotes that person;
--   · a practice with several staff and no owner-eligible row **RAISES and names the practice**
--     rather than choosing who owns somebody's business;
--   · a practice with no staff at all is left alone and SAID SO in a NOTICE (there is nobody to
--     promote; that is a fact about the data, not a failure, and it is printed rather than hidden).
--
-- ★★ TELL TY AT DEPLOY: **3 rows / 3 practices.** A report, not a gate (task 7.7, field 1).
-- ★★ The `super_admin_1` identity (the platform tenant's) stops being a platform operator BY VIRTUE
--    OF ITS RANK when this lands. That authority moves to the grant created by 0184/0186 (tasks 7.4
--    and 7.6), which is seeded IN THE SAME DEPLOY. If 0186 is not applied with this file, Platform
--    becomes unreachable. The migration runner applies un-applied files in filename order, so
--    0184 and 0186 precede this one on any database that is level with disk.
--
-- ══ THE CHECK CONSTRAINT IS WIDENED HERE, AND NARROWED IN 0188 ═════════════════════════════════
-- ★★★ `0010:28-29` is `CHECK (staff_role IN ('super_admin_1','super_admin','admin','coach'))`. It
--     does NOT admit `'owner'`, so the promotion below cannot run until the constraint is widened —
--     the plan's "widen-then-narrow" (7.7 field 4), with the WIDEN necessarily in the file that
--     writes the new value and the NARROW in the structural file that follows. The intermediate set
--     is the UNION of old and new, so this file alone leaves a database that is still legal under
--     every old rule and is already legal under the new one.
-- ★ The constraint keeps its exact name, `app_user_staff_role_check`. It is read BY NAME by
--   `test/p15b_people_writes.test.mjs:216`, which parses its definition and compares it with
--   `STAFF_ROLES` (`src/people/vocab.mjs:25`). Renaming it would break that test for the wrong
--   reason.
--
-- ══ F490 — A MIGRATION CANNOT SEE THE ROWS IT IS BACKFILLING ══════════════════════════════════
-- `keystone.app_user` is ENABLE **and FORCE** row level security (`0001:151-152`) under
-- `tenant_isolation USING (tenant_id = keystone.current_tenant_id())` (`0001:160-161`), with
-- `tenant_update` governing UPDATE (`0001:170-172`). FORCE applies to the OWNER, and
-- `db/migrate.mjs:317` runs every file as `app_owner` with no tenant GUC — so a global UPDATE here
-- would touch nothing and commit (`0010:38-49` is the first recorded sighting; F143, F490).
-- ★ Therefore, exactly as `0168:84-96` and `0172:96-102` do it: enumerate the practices as
--   **`auth_owner`** (it holds `tenant_health_read FOR SELECT USING (true)` on `keystone.tenant`,
--   `0017:54-56`; `app_owner` sees none), collect into a PL/pgSQL array, then per practice set
--   `keystone.tenant_id`, PROVE the context took, and read and write as `app_owner` under its own
--   policy. `SET LOCAL ROLE app_owner` to come back — **never a bare `RESET ROLE`** (F482), which
--   would leave the connection as the superuser.
-- ★ `SET LOCAL` and `set_config(…, true)` are transaction-local, and `db/migrate.mjs:328-336` wraps
--   each file in its own BEGIN/COMMIT, so neither the role nor the GUC leaks past this file.
--
-- ★ NOT MARKED `-- keystone:one-way`, deliberately and for `0172:33-36`'s reason: the runner REFUSES
--   a one-way file unless `KEYSTONE_ALLOW_ONE_WAY=yes` (`db/migrate.mjs:291-299`), and both step 3
--   and step 5 apply through a plain `node db/migrate.mjs up`. The change is reversible only by a
--   forward migration; that is stated here rather than enforced by a flag that would stop the deploy.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. The NOTICEs carry practice ids, row
--   ids and COUNTS only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS, AND THE WIDENING ────────────────────────────────────────────────────────
DO $widen_the_rank_vocabulary$
DECLARE
  v_matches integer;
  v_name    text;
  v_def     text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0187: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  -- ★ Find the rank CHECK by what it SAYS, not by a remembered name: `0010:28-29` created it inline
  --   with `ADD COLUMN`, so its name is Postgres's own. Then assert the name anyway, because a test
  --   reads it by name (header). Two constraints naming the same value would make the choice below
  --   arbitrary, so that is a refusal rather than a `LIMIT 1`.
  SELECT count(*) INTO v_matches
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.app_user'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%super_admin_1%';

  IF v_matches = 0 THEN
    RAISE EXCEPTION '0187: no CHECK constraint on keystone.app_user names super_admin_1 — 0010:28-29 is not in effect on this database, so this file does not know what it is widening';
  ELSIF v_matches > 1 THEN
    RAISE EXCEPTION '0187: % CHECK constraints on keystone.app_user name super_admin_1 — expected exactly the one 0010:28-29 created', v_matches;
  END IF;

  SELECT c.conname, pg_get_constraintdef(c.oid)
    INTO v_name, v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.app_user'::regclass
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%super_admin_1%';

  IF v_name <> 'app_user_staff_role_check' THEN
    RAISE EXCEPTION '0187: the rank CHECK is named % — test/p15b_people_writes.test.mjs:216 reads it as app_user_staff_role_check, and 0188 narrows it by that name', v_name;
  END IF;

  RAISE NOTICE '0187: widening % · was %', v_name, v_def;

  -- ★★ THE INTERMEDIATE SET IS THE UNION. Nothing is allowed to become illegal in this file; 0188
  --    subtracts the three retired values in one statement, after every row has moved.
  ALTER TABLE keystone.app_user DROP CONSTRAINT app_user_staff_role_check;
  ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_staff_role_check
    CHECK (staff_role IN ('super_admin_1','super_admin','admin','coach','owner'));

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.app_user'::regclass AND c.conname = 'app_user_staff_role_check';
  IF v_def NOT LIKE '%owner%' THEN
    RAISE EXCEPTION '0187: app_user_staff_role_check does not admit owner after the widening (%) — the promotion below would fail on every row', v_def;
  END IF;
  RAISE NOTICE '0187: widened  % · now %', 'app_user_staff_role_check', v_def;
END
$widen_the_rank_vocabulary$;

-- ── §b · EVERY PRACTICE, ONE OWNER ──────────────────────────────────────────────────────────────
DO $every_practice_gets_an_owner$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_staff        integer;
  v_owners       integer;
  v_owners_after integer;
  v_eligible     integer;
  v_target       uuid;
  v_changed      integer;
  v_promoted     integer := 0;
  v_already      integer := 0;
  v_staffless    integer := 0;
  v_seen_staff   bigint  := 0;
  i              integer;
BEGIN
  -- 1 · EVERY PRACTICE, ENUMERATED AS auth_owner (F490) — 0168:84-96, 0172:96-102.
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  -- ★ F490's own rule as an assertion: what was collected equals what was counted, both read by the
  --   role that CAN see practices. A silent truncation here would make a clean-looking run vacuous.
  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0187: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  -- ★★ A FRESH DATABASE HAS NO PRACTICES (scripts/prepare-fresh-database.mjs applies migrations
  --    before anything is provisioned). That is legitimate and must not RAISE — but it must also not
  --    read as "3 practices now have an Owner", so the closing NOTICE says how many it saw.
  IF v_tenant_count = 0 THEN
    RAISE NOTICE '0187: 0 practices exist on this database — nothing to promote. Expected on a fresh database; on production this would mean the enumeration is blind (F490).';
  END IF;

  -- 2 · PER PRACTICE: SET THE GUC, PROVE IT TOOK, COUNT BEFORE, PROMOTE, COUNT AFTER.
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★★★ THE ANTI-F490 ASSERTION PROPER (0168:127-133, 0172:119-126): without this, every count and
    --     every UPDATE below would be zero, would AGREE with each other, and this file would report a
    --     clean run having promoted nobody.
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0187: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★ The `tenant_id = current_tenant_id()` predicate is kept on every READ for 0172:128-134's
    --   reason: a second permissive SELECT policy (0133/0151's reference-practice read) OR-combines
    --   with `tenant_isolation`, and a bare count would then see another practice's rows from inside
    --   this practice's turn while the UPDATE, governed by `tenant_update`, would not.
    SELECT count(*) FILTER (WHERE u.role = 'staff'),
           count(*) FILTER (WHERE u.staff_role = 'owner'),
           count(*) FILTER (WHERE u.staff_role IN ('super_admin_1','super_admin'))
      INTO v_staff, v_owners, v_eligible
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id();

    v_seen_staff := v_seen_staff + v_staff;

    RAISE NOTICE '0187: practice % · before: % staff, % owner(s), % owner-eligible (super_admin_1/super_admin)',
      v_tenant_id, v_staff, v_owners, v_eligible;

    -- ── The cases, in the order Q7-1 states them. Every branch either acts or refuses BY NAME. ──
    IF v_owners > 1 THEN
      RAISE EXCEPTION '0187: practice % already holds % rows with staff_role = ''owner'' — 0188''s one-Owner index could not be created and this file will not choose which to keep',
        v_tenant_id, v_owners;

    ELSIF v_owners = 1 THEN
      -- Re-run, or a database seeded with the new vocabulary. Nothing to promote — unless a legacy
      -- rank ALSO survives here, in which case promoting it would make a second Owner.
      IF v_eligible > 0 THEN
        RAISE EXCEPTION '0187: practice % already has an Owner AND % super_admin_1/super_admin row(s) — promoting one would make a second Owner. Decide who owns this practice first.',
          v_tenant_id, v_eligible;
      END IF;
      v_already := v_already + 1;
      RAISE NOTICE '0187: practice % · after:  1 owner (already held one; nothing changed)', v_tenant_id;
      CONTINUE;

    ELSIF v_staff = 0 THEN
      -- ★ Nobody to promote. Said out loud rather than passed over: `staff_role_shape` (0010:90-93)
      --   means only `role = 'staff'` rows carry a rank at all, so a practice with no staff has no
      --   candidate. 0188's self-check exempts exactly this case, by the same reasoning.
      v_staffless := v_staffless + 1;
      RAISE NOTICE '0187: practice % · after:  0 owners — the practice has NO staff member at all, so there is nobody to promote', v_tenant_id;
      CONTINUE;

    ELSIF v_eligible > 1 THEN
      RAISE EXCEPTION '0187: practice % holds % owner-eligible rows (super_admin_1/super_admin) — Q7-1 promotes ONE and this file will not choose between them. Leave exactly one, then re-run.',
        v_tenant_id, v_eligible;

    ELSIF v_eligible = 1 THEN
      SELECT u.id INTO v_target
        FROM keystone.app_user u
       WHERE u.tenant_id = keystone.current_tenant_id()
         AND u.staff_role IN ('super_admin_1','super_admin');

    ELSIF v_staff = 1 THEN
      -- ★★ Q7-1, RULED by Ty 21 Sep 2026: the single remaining staff member becomes the Owner. This
      --    is the branch production's two `coach`-only practices take.
      SELECT u.id INTO v_target
        FROM keystone.app_user u
       WHERE u.tenant_id = keystone.current_tenant_id()
         AND u.role = 'staff';

    ELSE
      RAISE EXCEPTION '0187: practice % has % staff member(s) and none of them is a super_admin_1 or super_admin — Q7-1 promotes the SINGLE remaining staff member and will not choose between several. Name the Owner (set one row to super_admin) and re-run.',
        v_tenant_id, v_staff;
    END IF;

    IF v_target IS NULL THEN
      RAISE EXCEPTION '0187: practice % — the counts named a person to promote but the row could not be read back (RLS?)', v_tenant_id;
    END IF;

    -- ★ Targeted BY ID, and the row count is checked: "0 rows updated" and "there were 0 rows to
    --   update" must never be indistinguishable (0168:49-51). The UPDATE carries no tenant predicate
    --   of its own — there the POLICY is the scoping, which is what makes this an RLS check rather
    --   than two copies of one WHERE clause (0172:135-136).
    UPDATE keystone.app_user SET staff_role = 'owner' WHERE id = v_target;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed <> 1 THEN
      RAISE EXCEPTION '0187: practice % — promoting app_user % changed % row(s), not 1. The row was counted under this practice''s GUC and must be writable under the same one (tenant_update, 0001:170-172).',
        v_tenant_id, v_target, v_changed;
    END IF;
    v_promoted := v_promoted + 1;
    v_target := NULL;

    SELECT count(*) INTO v_owners_after
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id()
       AND u.staff_role = 'owner';
    IF v_owners_after <> 1 THEN
      RAISE EXCEPTION '0187: practice % holds % Owner(s) after the promotion, expected exactly 1', v_tenant_id, v_owners_after;
    END IF;

    RAISE NOTICE '0187: practice % · after:  % owner(s) — 1 promotion', v_tenant_id, v_owners_after;
  END LOOP;

  -- ★ Transaction-local anyway; cleared explicitly so nothing later in this transaction runs under
  --   the last practice's context.
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0187: % practice(s) enumerated · % staff row(s) visible · % promoted to owner · % already had one · % with no staff at all',
    v_tenant_count, v_seen_staff, v_promoted, v_already, v_staffless;
END
$every_practice_gets_an_owner$;

-- ── §c · THE CLOSING ASSERTION — AN INDEPENDENT RE-READ, NOT THE COUNTERS ABOVE ─────────────────
-- ★★ It enumerates the practices AGAIN as `auth_owner` and re-reads each one under its own GUC as
--    `app_owner` (0168:210-217, 0172:194-206). If §b had promoted nobody while reporting success —
--    F143/F490's shape — its own totals would still have read 0; this one would not.
-- ★★ ITS OWN POSITIVE CONTROL, IN THE SAME BLOCK AND IN THE NOTICE: it also counts the staff rows it
--    CAN see. A blind re-read prints `0 staff row(s) visible` — visibly vacuous — instead of a
--    clean-looking "confirmed".
DO $every_practice_with_staff_now_has_an_owner$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_staff      integer;
  v_owners     integer;
  v_legacy     integer;
  v_seen_staff bigint := 0;
  v_owned      integer := 0;
  v_staffless  integer := 0;
  v_legacy_all bigint := 0;
  v_bad        text[] := '{}';
  i            integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0187: the tenant context did not take effect for practice % during the closing re-read (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    SELECT count(*) FILTER (WHERE u.role = 'staff'),
           count(*) FILTER (WHERE u.staff_role = 'owner'),
           count(*) FILTER (WHERE u.staff_role IN ('super_admin_1','super_admin'))
      INTO v_staff, v_owners, v_legacy
      FROM keystone.app_user u
     WHERE u.tenant_id = keystone.current_tenant_id();

    v_seen_staff := v_seen_staff + v_staff;
    v_legacy_all := v_legacy_all + v_legacy;

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
    RAISE EXCEPTION '0187: % practice(s) with staff do not hold exactly one Owner: %',
      array_length(v_bad, 1), array_to_string(v_bad, ' · ');
  END IF;

  -- ★ 0188 narrows the CHECK to three values, and `ADD CONSTRAINT` scans the table WITHOUT RLS
  --   (0010:48-49) — so a surviving legacy rank would fail there anyway. It is caught HERE, where
  --   the message can name the practice, instead of there, where it cannot.
  IF v_legacy_all <> 0 THEN
    RAISE EXCEPTION '0187: % row(s) still carry super_admin_1 or super_admin — 0188 would fail on them', v_legacy_all;
  END IF;

  RAISE NOTICE '0187: confirmed — % practice(s) with staff hold exactly one Owner, % practice(s) hold no staff at all, 0 rows carry a retired rank, across % staff row(s) visible in % practice(s)',
    v_owned, v_staffless, v_seen_staff, coalesce(array_length(v_tenant_ids, 1), 0);
END
$every_practice_with_staff_now_has_an_owner$;
