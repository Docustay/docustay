-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0190 — EVERY PRACTICE GETS THE THREE ROLES, AND THEIR 63 GRANTS. (Stage 7 task 7.9, part 1 of 2.)
--
-- ★★★ WHAT THIS FIXES, MEASURED. `keystone.role`, `keystone.role_permission` and `keystone.user_role`
--     hold **0 / 0 / 0** rows in production (EXECUTED, re-confirmed 21 Sep 2026) — F262. Every read
--     that has ever asked `keystone.user_may()` a question has been answered `false` for every real
--     grant, and stayed alive only because `keystone.scope_not_yet_configured()` (0078) ORs a
--     tenant-wide `true` into the same predicate whenever a tenant holds no roles at all — a
--     fail-OPEN, not a fail-closed. **7.11 removes that fallback; this file is what makes removing it
--     safe**, and 0191's self-check is the second half of that safety.
--
-- ══ THE GRANT MATRIX — 05 §4 + §5, WRITTEN ONCE, MIRRORED IN src/permissions/defaults.mjs ═══════
-- ★★★ THE OWNERLESS RULE (RULED 21 Sep 2026, F584/F575). Ten of the 21 objects are `ownable = false`
--     in `keystone.permission_object` (0182): `network_party`, `item`, `note`, `report`, `setting`,
--     `discount`, `automation`, `campaign`, `site`, `audit`. For those ten the only two legal scopes
--     are `none` and `everything` — `keystone.enforce_scope_is_offered()` (0182) RAISEs on `owned` or
--     `team`. Every row below respects that; test (c2) of `test/s7_role_seeds.test.mjs` asserts it
--     with a positive control.
-- ★ `note`'s Coach and Admin cells are `none/none`, not `edit/owned` or `view/owned` — a Coach's real
--   access to their own caseload's notes arrives through 7.14's writer/assigned-coach disjuncts,
--   never through this grant (05 §6: "no role or grid can override"). `report`'s three cells are all
--   `view/everything` — reports are computed, not stored, and the money figures inside them are
--   narrowed by the `invoice: none/none` Coach grant below, not by `report`'s own scope.
--
-- ══ F490 — A MIGRATION CANNOT SEE THE ROWS IT IS BACKFILLING ══════════════════════════════════════
-- `keystone.role`, `role_permission` and `role_action` (created here) are ENABLE **and FORCE** row
-- level security (0066:208-213; this file matches it for the new table). `db/migrate.mjs` runs every
-- file as `app_owner` with no tenant GUC, so a global INSERT here would touch nothing and commit
-- silently (0010:38-49, F143/F490). Exactly as 0187/0189 do it: enumerate practices as **auth_owner**
-- (`tenant_health_read`, 0017:54-57 — `app_owner` sees none), then per practice set
-- `keystone.tenant_id`, PROVE the context took, and write as `app_owner` under its own policy.
--
-- ══ keystone.role_action — CT-092, Q7-3 ═══════════════════════════════════════════════════════════
-- The six named actions of 05 §2b.7 (and the seven more `src/permissions/audit.mjs`'s `ROUTE_ACTIONS`
-- names for 7.1's route table — 13 in total) have no scope ladder; `role_permission` carries a
-- coherence CHECK on `(object, verb, scope)` (0066:110) that a scopeless action cannot satisfy.
-- `keystone.role_action (tenant_id, role_id, action)` is CT-092's shape, structured like
-- `keystone.permission_object`/`keystone.audit_action` (0182/0183) — a closed CHECK on `action` here,
-- because the action vocabulary is `ROUTE_ACTIONS`, not `AUDIT_ACTIONS`, and the two must not be
-- confused by sharing one lookup table. Same RLS shape and the same three tenant policies as
-- `role_permission` (0066:223-227); `GRANT SELECT, INSERT, DELETE` only — an action grant is present
-- or absent, never edited in place, so no `UPDATE` grant and no `tenant_update`-governed column.
--
-- ══ IDEMPOTENT ══════════════════════════════════════════════════════════════════════════════════
-- `role` inserts are `ON CONFLICT (tenant_id, key) DO NOTHING` (KS-11: never overwrite a practice's
-- own edit — this is 0067/0069's `seed_builtin_roles` rule, restated for the same reason).
-- `role_permission` inserts are `ON CONFLICT (tenant_id, role_id, object) DO UPDATE` — DELIBERATELY
-- different from `seed_builtin_roles`'s `DO NOTHING`, and only because production holds 0 rows today
-- (EXECUTED): a `DO UPDATE` is a re-run of THIS FILE re-asserting the matrix it just shipped, not a
-- signup re-seed years later that must never clobber an operator's edit. A second run of 0190 must
-- correct a matrix row this file got wrong the first time, not freeze it.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration, same reasoning as 0189.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry practice ids and counts.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §a · keystone.role_action — CT-092.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.role_action (
  id         uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  role_id    uuid NOT NULL,

  -- ★ The closed vocabulary is `ROUTE_ACTIONS` (`src/permissions/audit.mjs`), not `AUDIT_ACTIONS` —
  --   a role holds an action; an audit_entry row records that it was exercised. Kept as a plain CHECK
  --   (not a lookup table) because CT-092 names three columns only and a fourth table with no
  --   contracted shape is not this task's to invent.
  action     text NOT NULL
    CONSTRAINT role_action_action_check CHECK (action IN (
      'person.create', 'team.invite', 'team.remove', 'staff_role.change',
      'document.sign', 'document.execute', 'template.author',
      'record.archive', 'record.restore',
      'booking.waive_charge', 'discount.apply', 'invoice.refund', 'setting.billing')),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT role_action_role_fkey
    FOREIGN KEY (tenant_id, role_id) REFERENCES keystone.role (tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX role_action_role_action_key
  ON keystone.role_action (tenant_id, role_id, action);

ALTER TABLE keystone.role_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.role_action FORCE  ROW LEVEL SECURITY;

-- ★ Same three policies as role_permission (0066:223-227), so a table with the same shape reads the
--   same way to the next engineer — even though only tenant_isolation and tenant_insert are ever
--   exercised (no UPDATE grant below).
CREATE POLICY tenant_isolation ON keystone.role_action
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.role_action
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.role_action
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, DELETE ON keystone.role_action TO app_rw;

COMMENT ON TABLE keystone.role_action IS
  'Stage 7 task 7.9, CT-092, Q7-3. Named actions with no scope ladder (may waive a charge, may bill).'
  ' (tenant_id, role_id, action) — present or absent, never edited in place. Vocabulary is'
  ' ROUTE_ACTIONS (src/permissions/audit.mjs), not AUDIT_ACTIONS — a role HOLDS an action; an'
  ' audit_entry row records it was EXERCISED.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §b · PRECONDITIONS.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0190: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.role') IS NULL
     OR to_regclass('keystone.role_permission') IS NULL
     OR to_regclass('keystone.role_action') IS NULL THEN
    RAISE EXCEPTION '0190: keystone.role, keystone.role_permission or keystone.role_action does not exist';
  END IF;

  -- ★ 0187/0188 must have already relabelled the rank vocabulary to owner/admin/coach — this file's
  --   role keys are written in that vocabulary and a database still on the old one would silently
  --   seed roles nobody's staff_role can ever match.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'keystone.app_user'::regclass
                    AND c.conname  = 'app_user_staff_role_check'
                    AND pg_get_constraintdef(c.oid) LIKE '%owner%'
                    AND pg_get_constraintdef(c.oid) NOT LIKE '%super_admin_1%') THEN
    RAISE EXCEPTION '0190: keystone.app_user.staff_role is not yet narrowed to (owner,admin,coach) — 0187 and 0188 must apply first';
  END IF;
END
$preconditions$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §c · THE MATRIX, WRITTEN ONCE, AS DATA — 3 roles × 21 objects = 63 rows; 28 named actions.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _s7_grant_matrix (role_key text, object text, verb text, scope text) ON COMMIT DROP;
INSERT INTO _s7_grant_matrix (role_key, object, verb, scope) VALUES
  -- ── owner — delete/everything on every object except the three view-only ownerless ones ────────
  ('owner', 'person',        'delete', 'everything'),
  ('owner', 'account',       'delete', 'everything'),
  ('owner', 'network_party', 'delete', 'everything'),
  ('owner', 'engagement',    'delete', 'everything'),
  ('owner', 'item',          'delete', 'everything'),
  ('owner', 'document',      'delete', 'everything'),
  ('owner', 'invoice',       'delete', 'everything'),
  ('owner', 'task',          'delete', 'everything'),
  ('owner', 'note',          'view',   'everything'),
  ('owner', 'report',        'view',   'everything'),
  ('owner', 'setting',       'delete', 'everything'),
  ('owner', 'message',       'view',   'everything'),
  ('owner', 'goal',          'view',   'everything'),
  ('owner', 'referral',      'delete', 'everything'),
  ('owner', 'discount',      'delete', 'everything'),
  ('owner', 'automation',    'delete', 'everything'),
  ('owner', 'campaign',      'delete', 'everything'),
  ('owner', 'site',          'delete', 'everything'),
  ('owner', 'payout',        'delete', 'everything'),
  ('owner', 'dispute',       'delete', 'everything'),
  ('owner', 'audit',         'view',   'everything'),
  -- ── admin — same as owner except settings (edit, not delete), and the notes/money/messaging carve-outs ──
  ('admin', 'person',        'delete', 'everything'),
  ('admin', 'account',       'delete', 'everything'),
  ('admin', 'network_party', 'delete', 'everything'),
  ('admin', 'engagement',    'delete', 'everything'),
  ('admin', 'item',          'delete', 'everything'),
  ('admin', 'document',      'delete', 'everything'),
  ('admin', 'invoice',       'delete', 'everything'),
  ('admin', 'task',          'delete', 'everything'),
  ('admin', 'note',          'none',   'none'),
  ('admin', 'report',        'view',   'everything'),
  ('admin', 'setting',       'edit',   'everything'),
  ('admin', 'message',       'none',   'none'),
  ('admin', 'goal',          'none',   'none'),
  ('admin', 'referral',      'delete', 'everything'),
  ('admin', 'discount',      'delete', 'everything'),
  ('admin', 'automation',    'delete', 'everything'),
  ('admin', 'campaign',      'delete', 'everything'),
  ('admin', 'site',          'delete', 'everything'),
  ('admin', 'payout',        'delete', 'everything'),
  ('admin', 'dispute',       'delete', 'everything'),
  ('admin', 'audit',         'view',   'everything'),
  -- ── coach — the caseload, own-scoped; the catalogue, read-only; money and notes, none ───────────
  ('coach', 'person',        'edit',   'owned'),
  ('coach', 'account',       'view',   'owned'),
  ('coach', 'network_party', 'view',   'everything'),
  ('coach', 'engagement',    'edit',   'owned'),
  ('coach', 'item',          'view',   'everything'),
  ('coach', 'document',      'edit',   'owned'),
  ('coach', 'invoice',       'none',   'none'),
  ('coach', 'task',          'edit',   'owned'),
  ('coach', 'note',          'none',   'none'),
  ('coach', 'report',        'view',   'everything'),
  ('coach', 'setting',       'none',   'none'),
  ('coach', 'message',       'edit',   'owned'),
  ('coach', 'goal',          'edit',   'owned'),
  ('coach', 'referral',      'edit',   'owned'),
  ('coach', 'discount',      'none',   'none'),
  ('coach', 'automation',    'none',   'none'),
  ('coach', 'campaign',      'none',   'none'),
  ('coach', 'site',          'none',   'none'),
  ('coach', 'payout',        'none',   'none'),
  ('coach', 'dispute',       'none',   'none'),
  ('coach', 'audit',         'none',   'none');

DO $matrix_row_count$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM _s7_grant_matrix;
  IF v_n <> 63 THEN
    RAISE EXCEPTION '0190: the grant matrix has % rows, not 63 (3 roles x 21 objects)', v_n;
  END IF;
END
$matrix_row_count$;

CREATE TEMP TABLE _s7_role_actions (role_key text, action text) ON COMMIT DROP;
INSERT INTO _s7_role_actions (role_key, action) VALUES
  -- ── owner — all 13 named actions ────────────────────────────────────────────────────────────────
  ('owner', 'person.create'), ('owner', 'team.invite'), ('owner', 'team.remove'),
  ('owner', 'staff_role.change'), ('owner', 'document.sign'), ('owner', 'document.execute'),
  ('owner', 'template.author'), ('owner', 'record.archive'), ('owner', 'record.restore'),
  ('owner', 'booking.waive_charge'), ('owner', 'discount.apply'), ('owner', 'invoice.refund'),
  ('owner', 'setting.billing'),
  -- ── admin — all 13 except setting.billing (Q7-3/Q7-9) ──────────────────────────────────────────
  ('admin', 'person.create'), ('admin', 'team.invite'), ('admin', 'team.remove'),
  ('admin', 'staff_role.change'), ('admin', 'document.sign'), ('admin', 'document.execute'),
  ('admin', 'template.author'), ('admin', 'record.archive'), ('admin', 'record.restore'),
  ('admin', 'booking.waive_charge'), ('admin', 'discount.apply'), ('admin', 'invoice.refund'),
  -- ── coach — three (Q7-3/Q7-9) ───────────────────────────────────────────────────────────────────
  ('coach', 'person.create'), ('coach', 'template.author'), ('coach', 'document.sign');

DO $actions_row_count$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM _s7_role_actions;
  IF v_n <> 28 THEN
    RAISE EXCEPTION '0190: the role_action seed has % rows, not 28 (13 owner + 12 admin + 3 coach)', v_n;
  END IF;
END
$actions_row_count$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §d · EVERY PRACTICE, SEEDED — F490 per-tenant enumeration.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $every_practice_has_the_three_roles$
DECLARE
  v_tenant_ids     uuid[];
  v_tenant_count   integer;
  v_tenant_id      uuid;
  v_roles_ins      integer;
  v_perms_ins      integer;
  v_actions_ins    integer;
  v_seen_roles     bigint := 0;
  v_seen_perms     bigint := 0;
  v_seen_actions   bigint := 0;
  i                integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0190: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  IF v_tenant_count = 0 THEN
    RAISE NOTICE '0190: 0 practices exist on this database — nothing to seed. Expected on a fresh database.';
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0190: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    INSERT INTO keystone.role (tenant_id, key, label, description, is_builtin) VALUES
      (v_tenant_id, 'owner', 'Owner',
       'Full access to everything in the practice, including settings and billing.', true),
      (v_tenant_id, 'admin', 'Admin',
       'Runs the practice day to day. Everything except changing practice settings.', true),
      (v_tenant_id, 'coach', 'Coach',
       'Sees and works their own caseload. The practice''s catalogue is visible but read-only.', true)
    ON CONFLICT (tenant_id, key) DO NOTHING;
    GET DIAGNOSTICS v_roles_ins = ROW_COUNT;

    INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
    SELECT v_tenant_id, r.id, m.object, m.verb, m.scope
      FROM _s7_grant_matrix m
      JOIN keystone.role r ON r.tenant_id = v_tenant_id AND r.key = m.role_key
    ON CONFLICT (tenant_id, role_id, object)
      DO UPDATE SET verb = EXCLUDED.verb, scope = EXCLUDED.scope, updated_at = now();
    GET DIAGNOSTICS v_perms_ins = ROW_COUNT;

    INSERT INTO keystone.role_action (tenant_id, role_id, action)
    SELECT v_tenant_id, r.id, a.action
      FROM _s7_role_actions a
      JOIN keystone.role r ON r.tenant_id = v_tenant_id AND r.key = a.role_key
    ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
    GET DIAGNOSTICS v_actions_ins = ROW_COUNT;

    -- ★ Re-read, under this practice's own GUC, rather than trust the counters above — the same
    --   anti-vacuous argument 0187 makes (:254-260).
    SELECT count(*) INTO v_seen_roles FROM keystone.role
     WHERE tenant_id = keystone.current_tenant_id();
    IF v_seen_roles <> 3 THEN
      RAISE EXCEPTION '0190: practice % holds % role(s) after seeding, expected 3', v_tenant_id, v_seen_roles;
    END IF;

    RAISE NOTICE '0190: practice % · % role row(s) affected, % role_permission row(s) affected, % role_action row(s) affected',
      v_tenant_id, v_roles_ins, v_perms_ins, v_actions_ins;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0190: % practice(s) seeded with the three roles', v_tenant_count;
END
$every_practice_has_the_three_roles$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- §e · THE CLOSING ASSERTION — AN INDEPENDENT RE-READ, ACCUMULATED PER PRACTICE (F490).
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $every_practice_now_holds_the_matrix$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_id    uuid;
  v_roles        integer;
  v_perms        integer;
  v_actions      integer;
  v_total_roles  bigint := 0;
  v_total_perms  bigint := 0;
  v_total_action bigint := 0;
  i              integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    SELECT count(*) INTO v_roles   FROM keystone.role            WHERE tenant_id = keystone.current_tenant_id();
    SELECT count(*) INTO v_perms   FROM keystone.role_permission WHERE tenant_id = keystone.current_tenant_id();
    SELECT count(*) INTO v_actions FROM keystone.role_action     WHERE tenant_id = keystone.current_tenant_id();

    IF v_roles <> 3 THEN
      RAISE EXCEPTION '0190: independent re-read: practice % holds % role(s), expected 3', v_tenant_id, v_roles;
    END IF;
    IF v_perms <> 63 THEN
      RAISE EXCEPTION '0190: independent re-read: practice % holds % role_permission row(s), expected 63', v_tenant_id, v_perms;
    END IF;
    IF v_actions <> 28 THEN
      RAISE EXCEPTION '0190: independent re-read: practice % holds % role_action row(s), expected 28', v_tenant_id, v_actions;
    END IF;

    v_total_roles  := v_total_roles  + v_roles;
    v_total_perms  := v_total_perms  + v_perms;
    v_total_action := v_total_action + v_actions;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  IF coalesce(array_length(v_tenant_ids, 1), 0) = 0 THEN
    RAISE NOTICE '0190: independent re-read confirmed nothing — 0 practices exist on this database. Expected on a fresh database.';
  ELSE
    RAISE NOTICE '0190: independent re-read confirmed — % practice(s), % role row(s), % role_permission row(s), % role_action row(s)',
      array_length(v_tenant_ids, 1), v_total_roles, v_total_perms, v_total_action;
  END IF;
END
$every_practice_now_holds_the_matrix$;
