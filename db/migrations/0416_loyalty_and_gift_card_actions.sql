-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0416 — NAMED ACTIONS `loyalty.manage` AND `gift_card.manage`. (Stage 14 task 14.9.)
--
-- ★★★ WHAT THIS DOES. `keystone.role_action` (CT-092, 0190) carries a closed CHECK on `action` —
--     13 values, unchanged since 0190. This file widens it to 15 (the same 13 plus the two new
--     ones), then backfills the two new actions onto every OWNER and ADMIN built-in role in every
--     practice that already exists. A brand-new practice gets them the normal way, through
--     `keystone.seed_builtin_roles` (0367), once `src/permissions/defaults.mjs`'s `OWNER_ACTIONS` /
--     `ADMIN_ACTIONS` carry the two names — that edit is task 14.15's, not this file's (STAGE-14-PLAN.md
--     14.9 field 10: "same vocabulary in JS — p6-style agreement").
--
-- ★★★ THE CHECK IS WIDENED, NEVER NARROWED. `role_action_action_check`'s CURRENT 13 values (read
--     from `db/migrations/0190_every_practice_has_the_three_roles.sql:70-74`, the only file that has
--     ever defined it — MEASURED, no later migration touches `role_action_action_check`) are
--     reproduced here VERBATIM, in the same order, and only appended to. Dropping a value in use
--     would orphan live `role_action` rows; the precondition block below refuses to run if the live
--     constraint does not already match those 13 values exactly, so a drifted assumption stops the
--     migration instead of silently rewriting the vocabulary.
--
-- ★★★ THE BACKFILL FOLLOWS THE §0.4 D PATTERN (`db/migrations/0172_idempotency_redaction_backfill.sql`,
--     M) — NOT `0367`'s existing backfill DO block (`0367:86-126`), which runs no
--     `SET LOCAL ROLE auth_owner` enumeration and sets no per-practice
--     `keystone.tenant_id` GUC at all before touching `keystone.role`/`keystone.role_action`
--     (both ENABLE + FORCE RLS, 0190:85-86). F490's shape, restated: a migration runs as `app_owner`
--     with no tenant GUC (`db/migrate.mjs:179,317`); under FORCE RLS that INSERT/SELECT touches
--     NOTHING and commits silently. `0367`'s backfill happens to still "work" only in the narrow
--     sense that `role_action`'s policies read `current_tenant_id()`, which is NULL with no GUC set,
--     and NULL never equals any `tenant_id` — so every iteration of that FOR loop over
--     `keystone.role` (itself unreadable with no GUC, meaning the loop's own cursor returns ZERO
--     rows) does nothing and reports nothing wrong. This file does NOT copy that shape: every write
--     and every count below happens per practice, under that practice's own GUC, proven to have
--     taken before anything is written, and the backfill closes with an INDEPENDENT re-read (not the
--     INSERT's own row counts) so a silent no-op cannot pass as success.
--
-- ★ GRANT TO OWNER AND ADMIN ONLY — never coach. `key IN ('owner', 'admin')` is the only filter on
--   which built-in roles receive the insert; the closing block below asserts BOTH that every
--   owner/admin built-in role holds both actions AND that zero coach built-in roles hold either —
--   the two assertions are the positive control and the negative in the same block, over the same
--   practices.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that narrows the CHECK
--   back and deletes the two actions, same reasoning as 0190/0172.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry practice ids and counts.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §a · PRECONDITIONS — refuse unless the live CHECK is exactly the 13 values field 3 quotes.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  v_def text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0416: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.role_action') IS NULL THEN
    RAISE EXCEPTION '0416: keystone.role_action does not exist — 0190 must apply first';
  END IF;

  IF to_regclass('keystone.role') IS NULL THEN
    RAISE EXCEPTION '0416: keystone.role does not exist — 0066/0190 must apply first';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.role_action'::regclass
     AND c.conname   = 'role_action_action_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '0416: role_action_action_check does not exist on keystone.role_action';
  END IF;

  -- ★ Every one of the 13 CURRENT values must already be present, and neither new value may be —
  --   a drifted live constraint (narrowed, widened by someone else, or reworded) stops this file
  --   rather than silently rewriting the vocabulary underneath it.
  IF v_def NOT LIKE '%person.create%'        OR v_def NOT LIKE '%team.invite%'
     OR v_def NOT LIKE '%team.remove%'       OR v_def NOT LIKE '%staff_role.change%'
     OR v_def NOT LIKE '%document.sign%'     OR v_def NOT LIKE '%document.execute%'
     OR v_def NOT LIKE '%template.author%'   OR v_def NOT LIKE '%record.archive%'
     OR v_def NOT LIKE '%record.restore%'    OR v_def NOT LIKE '%booking.waive_charge%'
     OR v_def NOT LIKE '%discount.apply%'    OR v_def NOT LIKE '%invoice.refund%'
     OR v_def NOT LIKE '%setting.billing%'
     OR v_def LIKE '%loyalty.manage%'        OR v_def LIKE '%gift_card.manage%' THEN
    RAISE EXCEPTION '0416: role_action_action_check does not match the expected 13-value CHECK before widening: %', v_def;
  END IF;
END
$preconditions$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §b · WIDEN THE CHECK — the same 13, verbatim, plus the two new actions.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.role_action DROP CONSTRAINT role_action_action_check;
ALTER TABLE keystone.role_action
  ADD CONSTRAINT role_action_action_check CHECK (action IN (
    'person.create', 'team.invite', 'team.remove', 'staff_role.change',
    'document.sign', 'document.execute', 'template.author',
    'record.archive', 'record.restore',
    'booking.waive_charge', 'discount.apply', 'invoice.refund', 'setting.billing',
    'loyalty.manage', 'gift_card.manage'));

-- ★ POSITIVE CONTROL, IN THE SAME TRANSACTION: the new CHECK must still name every existing value
--   AND both new ones — a constraint nobody has seen widened correctly is not yet widened correctly.
DO $prove_the_check$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'keystone.role_action'::regclass AND conname = 'role_action_action_check';
  IF v_def IS NULL
     OR v_def NOT LIKE '%person.create%'        OR v_def NOT LIKE '%team.invite%'
     OR v_def NOT LIKE '%team.remove%'          OR v_def NOT LIKE '%staff_role.change%'
     OR v_def NOT LIKE '%document.sign%'        OR v_def NOT LIKE '%document.execute%'
     OR v_def NOT LIKE '%template.author%'      OR v_def NOT LIKE '%record.archive%'
     OR v_def NOT LIKE '%record.restore%'       OR v_def NOT LIKE '%booking.waive_charge%'
     OR v_def NOT LIKE '%discount.apply%'       OR v_def NOT LIKE '%invoice.refund%'
     OR v_def NOT LIKE '%setting.billing%'
     OR v_def NOT LIKE '%loyalty.manage%'       OR v_def NOT LIKE '%gift_card.manage%' THEN
    RAISE EXCEPTION '0416: the widened role_action_action_check is not what was written: %', v_def;
  END IF;
END
$prove_the_check$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §c · BACKFILL — every EXISTING practice's owner/admin built-in role, §0.4 D pattern (F490).
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $loyalty_and_giftcard_actions_backfill$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_roles_seen   integer;
  v_after        integer;
  v_total_roles  bigint := 0;
  v_total_grants bigint := 0;
  i              integer;
BEGIN
  -- 1 · every practice, enumerated as auth_owner (F490) — 0190:259-268, 0172:96-110.
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0416: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  IF v_tenant_count = 0 THEN
    RAISE NOTICE '0416: 0 practices exist on this database — nothing to backfill. Expected on a fresh database.';
  END IF;

  -- 2 · per practice: set the GUC, prove it took, insert, then count under the SAME GUC.
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0416: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    SELECT count(*) INTO v_roles_seen
      FROM keystone.role r
     WHERE r.tenant_id = keystone.current_tenant_id()
       AND r.is_builtin = true
       AND r.key IN ('owner', 'admin');

    INSERT INTO keystone.role_action (tenant_id, role_id, action)
    SELECT keystone.current_tenant_id(), r.id, a.action
      FROM keystone.role r
      CROSS JOIN (VALUES ('loyalty.manage'), ('gift_card.manage')) AS a(action)
     WHERE r.tenant_id = keystone.current_tenant_id()
       AND r.is_builtin = true
       AND r.key IN ('owner', 'admin')
    ON CONFLICT (tenant_id, role_id, action) DO NOTHING;

    -- ★ per-practice assertion, an independent re-read (not the INSERT's own ROW_COUNT) — every
    --   owner/admin built-in role found above must now hold BOTH actions.
    SELECT count(*) INTO v_after
      FROM keystone.role r
      JOIN keystone.role_action ra
        ON ra.tenant_id = r.tenant_id AND ra.role_id = r.id
       AND ra.action IN ('loyalty.manage', 'gift_card.manage')
     WHERE r.tenant_id = keystone.current_tenant_id()
       AND r.is_builtin = true
       AND r.key IN ('owner', 'admin');

    IF v_after <> v_roles_seen * 2 THEN
      RAISE EXCEPTION '0416: practice % — % owner/admin built-in role(s) found but only % of the expected % loyalty.manage/gift_card.manage grant(s) landed',
        v_tenant_id, v_roles_seen, v_after, v_roles_seen * 2;
    END IF;

    v_total_roles  := v_total_roles + v_roles_seen;
    v_total_grants := v_total_grants + v_after;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_tenant_count > 0 THEN
    RAISE NOTICE '0416: % practice(s) backfilled — % owner/admin built-in role(s) now hold % loyalty.manage/gift_card.manage grant(s) (2 each)',
      v_tenant_count, v_total_roles, v_total_grants;
  END IF;
END
$loyalty_and_giftcard_actions_backfill$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §d · THE CLOSING ASSERTION — an INDEPENDENT re-read, not the backfill loop's own counters
--     (0172's shape). Loops and sums because it must: `keystone.role`/`keystone.role_action` are
--     ENABLE + FORCE RLS and no role this migration may assume can see them without a tenant GUC, so
--     a single global count would be the vacuous check F143/F490 are about.
--
--   ★★★ THIS BLOCK IS ALSO THE OWNER/ADMIN-ONLY PROOF: it asserts BOTH that every owner/admin
--       built-in role holds both new actions (positive) AND that zero coach built-in roles hold
--       either (negative), over the SAME practices, in the SAME block — a coach silently picking up
--       either grant would fail this migration, not slip through as a passing backfill.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $independent_reread_owner_admin_only$
DECLARE
  v_tenant_ids          uuid[];
  v_tenant_id           uuid;
  v_owner_admin_missing bigint := 0;
  v_total_owner_admin   bigint := 0;
  v_coach_holds         bigint := 0;
  i                     integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0416: the tenant context did not take effect for practice % during the closing re-read (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- positive: every owner/admin built-in role holds both actions (2 rows each, no fewer).
    v_owner_admin_missing := v_owner_admin_missing + (
      SELECT count(*) FROM keystone.role r
       WHERE r.tenant_id = keystone.current_tenant_id()
         AND r.is_builtin = true AND r.key IN ('owner', 'admin')
         AND (SELECT count(*) FROM keystone.role_action ra
               WHERE ra.tenant_id = r.tenant_id AND ra.role_id = r.id
                 AND ra.action IN ('loyalty.manage', 'gift_card.manage')) <> 2
    );
    v_total_owner_admin := v_total_owner_admin + (
      SELECT count(*) FROM keystone.role r
       WHERE r.tenant_id = keystone.current_tenant_id()
         AND r.is_builtin = true AND r.key IN ('owner', 'admin')
    );

    -- negative: zero coach built-in roles hold either action.
    v_coach_holds := v_coach_holds + (
      SELECT count(*) FROM keystone.role r
        JOIN keystone.role_action ra ON ra.tenant_id = r.tenant_id AND ra.role_id = r.id
       WHERE r.tenant_id = keystone.current_tenant_id()
         AND r.is_builtin = true AND r.key = 'coach'
         AND ra.action IN ('loyalty.manage', 'gift_card.manage')
    );
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_owner_admin_missing <> 0 THEN
    RAISE EXCEPTION '0416: % owner/admin built-in role(s) across all practices do not hold both loyalty.manage and gift_card.manage after the backfill', v_owner_admin_missing;
  END IF;
  IF v_coach_holds <> 0 THEN
    RAISE EXCEPTION '0416: % coach built-in role row(s) hold loyalty.manage or gift_card.manage — these two actions are owner/admin only', v_coach_holds;
  END IF;

  IF coalesce(array_length(v_tenant_ids, 1), 0) = 0 THEN
    RAISE NOTICE '0416: independent re-read confirmed nothing — 0 practices exist on this database. Expected on a fresh database.';
  ELSE
    RAISE NOTICE '0416: independent re-read confirmed — % owner/admin built-in role(s) across % practice(s) all hold both new actions; 0 coach built-in role(s) hold either',
      v_total_owner_admin, array_length(v_tenant_ids, 1);
  END IF;
END
$independent_reread_owner_admin_only$;
