-- 0182 — THE PERMISSION OBJECTS BECOME DATA. Stage 7 task 7.2 · CONTRACTS CT-091, from CCR-4.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS REPLACES. `keystone.role_permission.object` has always been a CHECK enumerating
--     eleven literals (`0066:92-95`) — the SET lived in three places that could each drift from
--     the other two: this CHECK, `OBJECTS` (`src/permissions/objects.mjs`) and `OWNERSHIP`
--     (`src/permissions/ownership.mjs`). MEASURED: `OWNERSHIP` already had 16 keys against
--     `OBJECTS`' 11 before this migration, and F294 is what three of those five extra keys did —
--     three whole screens permanently empty, because `keystone.user_may` matched a grant no role
--     could ever hold. This migration makes the DATABASE the one source the other two are checked
--     against, converts the CHECK into a foreign key, and adds the ten objects 05 §5 requires —
--     each with its ownership answer in `ownership.mjs` in this SAME migration, because an object
--     with no ownership expression is exactly how F294 happened.
--
-- ★★ NOT TENANT-SCOPED. The object VOCABULARY is the product's, not a practice's — every practice
--    sees the same 21 objects, the way every practice sees the same VERBS and SCOPES (which are
--    not tables at all). FORCE RLS with a `USING (true)` SELECT policy is deliberate: the table
--    has no `tenant_id` and no practice-specific content, and a policy-less table fails
--    `db/gates/catalog-conformance.mjs`'s "no table without RLS" rule.
--
-- ★★★ THE LAST CONSTRAINT CANNOT BE A CHECK. Postgres CHECK constraints may not contain a
--     subquery, and "an ownerless object may only be granted `none` or `everything`" needs one
--     (a lookup into `keystone.permission_object.ownable`). Written instead as a
--     `BEFORE INSERT OR UPDATE` trigger, `keystone.enforce_scope_is_offered()` — a reviewer
--     looking for a CHECK named `role_permission_scope_is_offered` will not find one; this note is
--     the record of why. Same shape as `keystone.enforce_super_admin_1` (`0010:105-129`): a rule
--     that needs another table cannot be a CHECK, so it is a `SECURITY DEFINER` trigger instead,
--     `SET search_path = ''`, `REVOKE ALL … FROM PUBLIC` (the stage-wide rule — every new definer
--     in schema `keystone` ends with both).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · THE TABLE — one row per object, the vocabulary itself.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.permission_object (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label        text NOT NULL CHECK (btrim(label) <> ''),
  ownable      boolean NOT NULL,
  scopes       text[] NOT NULL CHECK (scopes <@ ARRAY['none','owned','team','everything']),
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Not tenant-scoped: the object VOCABULARY is the product's, not a practice's. No tenant_id.
COMMENT ON TABLE keystone.permission_object IS
  'Stage 7 task 7.2, CT-091. The 21-object permission vocabulary — the single source OBJECTS '
  '(src/permissions/objects.mjs) and OWNERSHIP (src/permissions/ownership.mjs) are checked '
  'against. Not tenant-scoped: every practice sees the same objects.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · THE SEED — 21 rows: the original 11 (0066) plus the ten 05 §5 adds.
--     `ownable` here matches `OWNERSHIP[key].ownable` in ownership.mjs exactly, for every one of
--     the 21 — that agreement is what 7.19's gate asserts.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO keystone.permission_object (key, label, ownable, scopes) VALUES
  -- the original eleven (0066:92-95)
  ('person',       'Person',        true,  ARRAY['none','owned','team','everything']),
  ('account',      'Account',       true,  ARRAY['none','owned','team','everything']),
  ('network_party','Network party', false, ARRAY['none','everything']),
  ('engagement',   'Engagement',    true,  ARRAY['none','owned','team','everything']),
  ('item',         'Item',          false, ARRAY['none','everything']),
  ('document',     'Document',      true,  ARRAY['none','owned','team','everything']),
  ('invoice',      'Invoice',       true,  ARRAY['none','owned','team','everything']),
  ('task',         'Task',          true,  ARRAY['none','owned','team','everything']),
  ('note',         'Note',          false, ARRAY['none','everything']),
  ('report',       'Report',        false, ARRAY['none','everything']),
  ('setting',      'Setting',       false, ARRAY['none','everything']),
  -- the ten new objects (05 §5), in the order 05 §5 lists them
  ('message',      'Message',       true,  ARRAY['none','owned','team','everything']),
  ('goal',         'Goal',          true,  ARRAY['none','owned','team','everything']),
  ('referral',     'Referral',      true,  ARRAY['none','owned','team','everything']),
  ('discount',     'Discount',      false, ARRAY['none','everything']),
  ('automation',   'Automation',    false, ARRAY['none','everything']),
  ('campaign',     'Campaign',      false, ARRAY['none','everything']),
  ('site',         'Site',          false, ARRAY['none','everything']),
  ('payout',       'Payout',        true,  ARRAY['none','owned','team','everything']),
  ('dispute',      'Dispute',       true,  ARRAY['none','owned','team','everything']),
  ('audit',        'Audit',         false, ARRAY['none','everything']);

-- RLS is enabled and FORCED only after the seed above: FORCE ROW LEVEL SECURITY applies to the
-- table owner too, and with only a SELECT policy in place an INSERT run afterwards (even as
-- app_owner, which the migration runner SET ROLEs to) is refused by the row security system
-- before any INSERT policy exists to admit it. Enabling+forcing after the seed keeps the same
-- final state (RLS enabled, forced, SELECT-only policy) without that ordering trap.
ALTER TABLE keystone.permission_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.permission_object FORCE  ROW LEVEL SECURITY;
CREATE POLICY readable_to_all_tenants ON keystone.permission_object FOR SELECT USING (true);
GRANT SELECT ON keystone.permission_object TO app_rw;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · `role_permission.object` — the CHECK becomes a FOREIGN KEY.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.role_permission DROP CONSTRAINT role_permission_object_check;
ALTER TABLE keystone.role_permission
  ADD CONSTRAINT role_permission_object_fkey
  FOREIGN KEY (object) REFERENCES keystone.permission_object(key) ON DELETE RESTRICT;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 4 · `role_permission_setting_scope` GENERALISES — an ownerless object may only be
--     `none` or `everything`, not `setting` alone. See the header: a subquery CHECK is illegal, so
--     this is a trigger.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.role_permission DROP CONSTRAINT role_permission_setting_scope;

CREATE FUNCTION keystone.enforce_scope_is_offered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_ownable boolean;
BEGIN
  IF NEW.scope IN ('none', 'everything') THEN
    RETURN NEW;
  END IF;

  -- Definer rights: role_permission and permission_object may sit under different RLS visibility,
  -- and this is a vocabulary lookup, not a tenant-scoped read.
  SELECT po.ownable INTO v_ownable
    FROM keystone.permission_object po
   WHERE po.key = NEW.object;

  IF NOT coalesce(v_ownable, false) THEN
    RAISE EXCEPTION
      '"%" has no owner, so scope "%" resolves to no rows at all — use "everything" or "none"',
      NEW.object, NEW.scope
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION keystone.enforce_scope_is_offered() FROM PUBLIC;
-- ★ A trigger function needs no EXECUTE grant to fire (Postgres checks at CREATE TRIGGER time, not
--   per row — same reasoning as keystone.enforce_super_admin_1, 0021:37-41). Granted to nobody.

CREATE TRIGGER role_permission_scope_is_offered
  BEFORE INSERT OR UPDATE OF object, scope ON keystone.role_permission
  FOR EACH ROW EXECUTE FUNCTION keystone.enforce_scope_is_offered();

COMMENT ON FUNCTION keystone.enforce_scope_is_offered() IS
  'Stage 7 task 7.2. Replaces role_permission_setting_scope (0066): scope owned/team is refused '
  'for any object keystone.permission_object marks ownable = false, not only for setting. A '
  'subquery CHECK is illegal in Postgres, so this runs as a BEFORE INSERT OR UPDATE trigger.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 5 · SELF-CHECK — the shape this file claims is the shape the catalog now holds
--     (same style as db/migrations/0140:68-).
-- ───────────────────────────────────────────────────────────────────────────────────────────────
DO $permission_object_check$
DECLARE
  v_count   integer;
  v_orphans integer;
  v_rls     boolean;
  v_force   boolean;
BEGIN
  SELECT count(*) INTO v_count FROM keystone.permission_object;
  IF v_count <> 21 THEN
    RAISE EXCEPTION '0182: keystone.permission_object must hold 21 rows, found %', v_count;
  END IF;

  SELECT count(*) INTO v_orphans
    FROM keystone.role_permission rp
   WHERE NOT EXISTS (SELECT 1 FROM keystone.permission_object po WHERE po.key = rp.object);
  IF v_orphans <> 0 THEN
    RAISE EXCEPTION '0182: % role_permission row(s) reference an object outside keystone.permission_object', v_orphans;
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity INTO v_rls, v_force
    FROM pg_class c WHERE c.oid = 'keystone.permission_object'::regclass;
  IF NOT (v_rls AND v_force) THEN
    RAISE EXCEPTION '0182: permission_object must have RLS enabled AND forced (rls=%, force=%)', v_rls, v_force;
  END IF;

  RAISE NOTICE '0182: keystone.permission_object holds 21 rows; 0 role_permission rows orphaned; RLS enabled and forced.';
END $permission_object_check$;
