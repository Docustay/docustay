-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0189 — `front_desk` LEAVES THE PRODUCT. (Stage 7 task 7.8.)
--
-- ★★★ RULED BY TY, 21 SEP 2026 — plan's recommendation taken; Q0-13 settled, no approval outstanding.
--     [EXECUTED against production, 19 Sep 2026] `keystone.role` holds **0 rows** — no practice has
--     ever been seeded with a `front_desk` role, so nobody holds it and nothing converts to another
--     role. **TELL TY AT DEPLOY: zero holders, zero role rows, in three practices** (05 §2b.8's
--     requirement is this report; it is not a gate).
--
-- ══ WHAT LEAVES, AND WHY ══════════════════════════════════════════════════════════════════════
-- The role that could book and bill across the whole practice but was refused `note` entirely
-- (`src/permissions/defaults.mjs`'s old header: *"the person who books the appointment and takes
-- the payment has no business reading what was said in the session"*) is retired from the built-in
-- set. It leaves `keystone.role`, `keystone.role_permission` and `keystone.user_role` for every
-- practice that happens to hold it, and a CHECK stops a **built-in** row from using the key again.
--
-- ★ IDEMPOTENT, DELIBERATELY, EVEN THOUGH PRODUCTION HOLDS ZERO ROWS TODAY: every DELETE below is
--   keyed and re-runnable, and the CHECK uses `ADD CONSTRAINT … CHECK (…) ` which is a no-op to
--   re-apply only in the sense that a second `ALTER TABLE ADD CONSTRAINT` with the same name would
--   fail — guarded by a precondition below rather than `IF NOT EXISTS`, which `ADD CONSTRAINT` does
--   not support.
--
-- ★★ THE CHECK IS ON **BUILT-IN** ROWS ONLY. `0066`'s header is explicit that the four shipped
--    roles are "a STARTING POINT: every one of them is editable and deletable by the tenant"
--    (`0066:53-56`). A practice may still create its own custom role and call it `front_desk`, or
--    anything else — `is_builtin = false` rows are untouched by this rule. Refusing a practice's own
--    naming would be a new rule nobody asked for.
--
-- ★★ F490 FIX [MEASURED 22 Sep 2026, local build-verification pass — same shape already fixed four
--    times this stage in 0182/0183/0185/0186, and flagged again in 0208]: `keystone.role`,
--    `keystone.role_permission` and `keystone.user_role` are `ENABLE` **AND `FORCE`** row level
--    security (`0066:208-213` — all six statements, not just the three `ENABLE` ones this note used
--    to cite). `db/migrate.mjs` runs every file as `app_owner`, the table OWNER — FORCE applies to
--    the owner too, so a bare DELETE with no tenant GUC set matches `tenant_id = current_tenant_id()`
--    against a NULL and sees **zero rows**, on ANY database that actually holds `front_desk` rows,
--    not just production's empty one. EXECUTED against a local copy carrying 26 `front_desk` role
--    rows: the original single global `DELETE FROM keystone.role WHERE key = 'front_desk'` (no GUC)
--    matched 0 of them and would have committed silently, then failed downstream at `role_
--    builtin_key_is_current` (which scans WITHOUT RLS and so still sees the leftover rows) — the
--    F143/F490 shape CLAUDE.md's failure #1 describes. §b below enumerates practices as `auth_owner`
--    and deletes per practice under its own GUC, exactly as `0187`/`0190` do it, instead of trusting
--    `ENABLE`-only RLS this table does not have.
--
-- ★ NOT MARKED `-- keystone:one-way`: the runner refuses a one-way file unless
--   `KEYSTONE_ALLOW_ONE_WAY=yes` (`db/migrate.mjs:291-299`), and both step 3 and step 5 apply
--   through a plain `node db/migrate.mjs up`. The change is reversible only by a forward migration
--   that re-inserts the role, which is stated here rather than enforced by a flag that would stop
--   the deploy.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. The NOTICEs carry row counts only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0189: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.role') IS NULL
     OR to_regclass('keystone.role_permission') IS NULL
     OR to_regclass('keystone.user_role') IS NULL THEN
    RAISE EXCEPTION '0189: keystone.role, keystone.role_permission or keystone.user_role does not exist — 0066 must be applied first';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'keystone.role'::regclass
                AND conname  = 'role_builtin_key_is_current') THEN
    RAISE EXCEPTION '0189: role_builtin_key_is_current already exists — this file has already been applied';
  END IF;
END
$preconditions$;

-- ── §b · THE ROLE LEAVES, WHEREVER IT WAS HELD (zero rows in production; idempotent anyway) ──────
-- ★★ F490-SAFE: enumerated as `auth_owner` (`tenant_health_read`, `0017:54-57` — `app_owner` sees
--    none), then per practice the GUC is set, PROVEN to have taken, and the deletes run as `app_owner`
--    under that practice's own `tenant_isolation`/`tenant_update` policy — the same shape `0187:140-
--    263` and `0190 §d` use, because `role`/`role_permission`/`user_role` are FORCE RLS (0066:208-213).
DO $front_desk_leaves$
DECLARE
  v_tenant_ids          uuid[];
  v_tenant_count        integer;
  v_tenant_id           uuid;
  v_p                   integer;
  v_g                   integer;
  v_r                   integer;
  v_permissions_removed bigint := 0;
  v_grants_removed      bigint := 0;
  v_roles_removed       bigint := 0;
  i                     integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0189: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0189: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    DELETE FROM keystone.role_permission rp
     USING keystone.role r
     WHERE rp.role_id = r.id AND r.key = 'front_desk' AND rp.tenant_id = keystone.current_tenant_id();
    GET DIAGNOSTICS v_p = ROW_COUNT;

    DELETE FROM keystone.user_role ur
     USING keystone.role r
     WHERE ur.role_id = r.id AND r.key = 'front_desk' AND ur.tenant_id = keystone.current_tenant_id();
    GET DIAGNOSTICS v_g = ROW_COUNT;

    DELETE FROM keystone.role WHERE key = 'front_desk' AND tenant_id = keystone.current_tenant_id();
    GET DIAGNOSTICS v_r = ROW_COUNT;

    v_permissions_removed := v_permissions_removed + v_p;
    v_grants_removed      := v_grants_removed + v_g;
    v_roles_removed       := v_roles_removed + v_r;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0189: front_desk removed — % role_permission row(s), % user_role grant(s), % role row(s) (production measured 0/0/0 on 19 Sep 2026)',
    v_permissions_removed, v_grants_removed, v_roles_removed;
END
$front_desk_leaves$;

-- ── §c · A BUILT-IN ROLE MAY NEVER AGAIN BE KEYED front_desk ──────────────────────────────────────
ALTER TABLE keystone.role ADD CONSTRAINT role_builtin_key_is_current CHECK (
  NOT is_builtin OR key IN ('owner','admin','coach'));

-- ── §d · THE SELF-CHECK ─────────────────────────────────────────────────────────────────────────
DO $the_shape_is_what_it_claims$
DECLARE
  v_def      text;
  v_leftover integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'keystone.role'::regclass
                    AND conname  = 'role_builtin_key_is_current') THEN
    RAISE EXCEPTION '0189: role_builtin_key_is_current was not created';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'keystone.role'::regclass
     AND c.conname  = 'role_builtin_key_is_current';
  IF v_def NOT LIKE '%is_builtin%' OR v_def NOT LIKE '%owner%' OR v_def NOT LIKE '%admin%' OR v_def NOT LIKE '%coach%' THEN
    RAISE EXCEPTION '0189: role_builtin_key_is_current does not have the expected shape: %', v_def;
  END IF;

  SELECT count(*) INTO v_leftover
    FROM keystone.role
   WHERE is_builtin AND key = 'front_desk';
  IF v_leftover <> 0 THEN
    RAISE EXCEPTION '0189: % built-in row(s) still hold key = front_desk after the constraint was added', v_leftover;
  END IF;

  RAISE NOTICE '0189: shape confirmed — role_builtin_key_is_current in place (%), 0 built-in front_desk row(s) remain', v_def;
END
$the_shape_is_what_it_claims$;

-- ── §e · THE RULE, EXERCISED, WITH ITS POSITIVE CONTROL ───────────────────────────────────────────
-- ★★★ A GUARD THAT NOBODY HAS SEEN FIRE IS A GUARD NOBODY HAS SEEN FIRE. This proves the CHECK
--     refuses a built-in `front_desk` row, and carries its positive control in the same block: the
--     SAME INSERT, `is_builtin = false`, must SUCCEED — a practice's own naming is untouched. Both
--     probes run in their own subtransaction and leave nothing behind.
DO $the_rule_is_live$
DECLARE
  v_tenant_id uuid;
  v_refused   boolean := false;
  v_control   boolean := false;
BEGIN
  -- ★★ F490 FIX (same 22 Sep 2026 pass): the probe below both INSERTs and then DELETEs its own
  --    control row. `0099`'s `refuse_touch_reference_rows()` trigger refuses EVERY DELETE on ANY
  --    row belonging to the reference practice, ENABLE ALWAYS, regardless of `is_builtin` — so
  --    picking "the first tenant by id" is unsafe whenever the reference practice is the earliest-
  --    created tenant, which it normally is (it is provisioned before any other practice). EXECUTED:
  --    this is exactly the failure this block hit once §b's own bug (above) was fixed. The probe
  --    therefore excludes `is_reference` explicitly and skips, rather than crashes, if the only
  --    practice on the database is the reference one.
  SET LOCAL ROLE auth_owner;
  SELECT id INTO v_tenant_id FROM keystone.tenant WHERE NOT is_reference ORDER BY id LIMIT 1;
  SET LOCAL ROLE app_owner;

  IF v_tenant_id IS NULL THEN
    RAISE NOTICE '0189: the live probe did NOT run — no non-reference practice exists on this database (expected on a fresh database, or one seeded with only the reference practice). test/s7_front_desk_is_gone.test.mjs exercises it at step 3.';
    RETURN;
  END IF;

  -- ★★ F490 FIX (same 22 Sep 2026 pass as §b): `tenant_insert ON keystone.role` is `WITH CHECK
  --    (tenant_id = keystone.require_tenant_id())`, and `require_tenant_id()` RAISES when the GUC is
  --    unset rather than returning NULL — so BOTH inserts below need the GUC set to `v_tenant_id`
  --    first, or every probe in this block raises `no tenant context` before it ever reaches the
  --    CHECK it is meant to exercise. EXECUTED: this is exactly the failure this block hit, first run.
  PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
    RAISE EXCEPTION '0189: the tenant context did not take effect for the probe (current_tenant_id() is %)',
      keystone.current_tenant_id();
  END IF;

  -- ★ THE RULE ITSELF — a built-in row keyed front_desk must be refused.
  BEGIN
    INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
      VALUES (v_tenant_id, 'front_desk', 'Front desk (probe)', true);
  EXCEPTION WHEN check_violation THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION '0189: inserting a BUILT-IN role keyed front_desk was ALLOWED — role_builtin_key_is_current is inert';
  END IF;

  -- ★ POSITIVE CONTROL, IN THE SAME BLOCK — the same key, `is_builtin = false`, must SUCCEED and is
  --   then removed, proving the CHECK is scoped to built-ins rather than to the key alone.
  BEGIN
    INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
      VALUES (v_tenant_id, 'front_desk', 'Front desk (probe)', false);
    v_control := true;
  EXCEPTION WHEN check_violation THEN
    v_control := false;
  END;
  IF NOT v_control THEN
    RAISE EXCEPTION '0189: a NON-built-in role keyed front_desk was refused — the refusal above would prove nothing about is_builtin scoping';
  END IF;
  DELETE FROM keystone.role WHERE tenant_id = v_tenant_id AND key = 'front_desk' AND is_builtin = false;

  RAISE NOTICE '0189: the rule is live — a built-in role keyed front_desk was refused, and the same key with is_builtin = false was accepted and cleaned up';
END
$the_rule_is_live$;
