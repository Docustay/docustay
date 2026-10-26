-- 0010_staff_roles_and_super_admin_1
-- P5.4 (§A2) — staff listable BY ROLE · Super Admin 1 exists ONLY in the platform tenant
--
-- ★★★ TWO AXES, NOT ONE. `role` is the PARTY a person is (staff / adult client / adolescent
-- client / parent). `staff_role` is a staff member's RANK. They are different questions and
-- collapsing them into one column breaks two things at once:
--   · seat billing — P5.5 counts `role = 'staff'`; splitting staff into admin/coach/super_admin
--     would silently make every staff seat stop counting, and an under-count invoices wrong,
--   · and the party vocabulary — §2.7's standing rule is that a party noun names one party.
--     "Admin" is not a party; it is a rank a staff member holds.
--
-- ★ [MEASURED, §A2] there was previously NO surface that showed who held which role. That is the
-- gap this closes, and it closes it in the SCHEMA so every surface answers it the same way.

-- ── The platform tenant, marked as an IDENTIFIER rather than matched by name ──────────────
-- ★★ `is_platform` is a boolean, deliberately NOT a match on slug = 'glrs'. A slug is a NAME,
-- and naming rules change; §2.7 exists because a label was load-bearing once already. Security
-- must not hang off a string anyone may rename.
ALTER TABLE keystone.tenant ADD COLUMN is_platform boolean NOT NULL DEFAULT false;

-- ★ At most ONE platform tenant, ever. Enforced, not documented.
CREATE UNIQUE INDEX tenant_single_platform_idx ON keystone.tenant (is_platform) WHERE is_platform;

COMMENT ON COLUMN keystone.tenant.is_platform IS
  'P5.4 / §A2 — the ONE tenant that operates Keystone. Super Admin 1 may exist only here. A boolean identifier, never a match on slug: security must not hang off a renameable name.';

-- ── Staff rank ────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.app_user ADD COLUMN staff_role text
  CHECK (staff_role IN ('super_admin_1','super_admin','admin','coach'));

-- ★ BACKFILL, EXPLICIT AND LEAST-PRIVILEGE. [MEASURED 2026-09-12] exactly 2 staff rows exist —
-- `alpha-staff@example.invalid` and `bravo-staff@example.invalid`, both Y1 gate fixtures on the
-- reserved `.invalid` TLD, both created in the same second by P1.9–P1.12. Neither is a person.
-- ★★ They are backfilled to `coach`, the LEAST privileged staff rank. A backfill that guessed
-- `admin` would silently grant a rank nobody granted — and this migration would then be the
-- origin of a privilege nobody can trace.
--
-- ★★★ AND THE BACKFILL MUST SUSPEND `FORCE`, OR IT SILENTLY TOUCHES NOTHING. [MEASURED
-- 2026-09-12, the first attempt at this migration] the UPDATE below matched **ZERO ROWS** and the
-- migration then died on `ADD CONSTRAINT`. The mechanism is the one 0008 documents, arriving from
-- a new direction:
--   · `migrate.mjs` connects as **app_owner**, and `app_user` is **FORCE ROW LEVEL SECURITY**,
--   · a migration sets no tenant GUC, so `keystone.current_tenant_id()` is empty,
--   · therefore the owner sees NO ROWS, and a backfill across tenants is a silent no-op.
-- ★★ WORSE, AND THE PART WORTH REMEMBERING: the "fail loud" guard originally written here counted
-- `WHERE staff_role IS NULL` through the SAME filter, saw 0, and PASSED VACUOUSLY. A guard that
-- reads through the predicate it is checking cannot see what the predicate hides.
-- ★ `ADD CONSTRAINT` was the only statement that told the truth — Postgres validates a constraint
-- by scanning the table WITHOUT RLS.
--
-- So: suspend FORCE for the backfill, and restore it in the same transaction. ★ FORCE is never
-- off outside this transaction, and the final assertion below proves it came back.
ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

UPDATE keystone.app_user SET staff_role = 'coach' WHERE role = 'staff' AND staff_role IS NULL;

-- ★ Now the guard can actually see. Run it INSIDE the window, for the reason above.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM keystone.app_user WHERE role = 'staff' AND staff_role IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % staff row(s) still have no staff_role', n;
  END IF;
  -- ★ POSITIVE CONTROL — §7. "0 remaining" is also what a blinded count returns, so prove the
  -- query can SEE the rows at all before trusting the zero.
  SELECT count(*) INTO n FROM keystone.app_user WHERE role = 'staff';
  IF n = 0 THEN
    RAISE EXCEPTION 'backfill guard is blind: it can see no staff rows at all, so its zero means nothing';
  END IF;
  RAISE NOTICE 'backfill: % staff row(s) visible and all carry a staff_role', n;
END $$;

ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;

-- ★★ Prove FORCE is back ON before going any further. Leaving it off would silently disable
-- tenant isolation on the single most sensitive table in the schema.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.app_user'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION 'FORCE ROW LEVEL SECURITY was not restored on app_user';
  END IF;
END $$;

-- ★★ THE SHAPES ARE TIED TOGETHER. A staff member MUST have a rank; a client or parent must NOT.
-- A parent row carrying `staff_role = 'admin'` is precisely the confusion that lets a client-side
-- check conclude someone is staff.
ALTER TABLE keystone.app_user ADD CONSTRAINT staff_role_shape CHECK (
  (role =  'staff' AND staff_role IS NOT NULL) OR
  (role <> 'staff' AND staff_role IS NULL)
);

CREATE INDEX app_user_staff_role_idx ON keystone.app_user (tenant_id, staff_role)
  WHERE staff_role IS NOT NULL;

-- ── ★★★ §K3 — SUPER ADMIN 1 IS A SERVER RULE. THE NAV FLAG IS NOT THE BOUNDARY. ───────────
-- `sections.mjs` carries `glrsOnly: true` and says in its own comment that it is "a hint for the
-- renderer, NOT the boundary". ★ This is the boundary. §K3: client-side role gating is not a
-- security boundary — hiding a menu item renders nothing unreachable.
--
-- ★ A CHECK constraint cannot do this: it may not read another table. A trigger can, and it runs
-- on INSERT and on UPDATE, so the rank cannot be granted after the fact either.
CREATE OR REPLACE FUNCTION keystone.enforce_super_admin_1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_is_platform boolean;
BEGIN
  IF NEW.staff_role IS DISTINCT FROM 'super_admin_1' THEN
    RETURN NEW;
  END IF;

  -- ★ Read the flag with definer rights: the tenant row belongs to the tenant being checked, and
  -- a caller in another tenant cannot see it under RLS. Refusing because the row was invisible
  -- would be the right answer for the wrong reason, and would break the platform tenant itself.
  SELECT t.is_platform INTO v_is_platform
    FROM keystone.tenant t WHERE t.id = NEW.tenant_id;

  IF NOT coalesce(v_is_platform, false) THEN
    RAISE EXCEPTION
      'Super Admin 1 may exist only in the platform tenant'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER app_user_super_admin_1_guard
  BEFORE INSERT OR UPDATE OF staff_role, tenant_id ON keystone.app_user
  FOR EACH ROW EXECUTE FUNCTION keystone.enforce_super_admin_1();

-- ★★ AND THERE IS EXACTLY ONE. §A9 treats Super Admin 1 as a singular office, not a rank several
-- people may hold. A partial unique index says so in the only place that cannot be forgotten.
CREATE UNIQUE INDEX app_user_single_super_admin_1_idx
  ON keystone.app_user (staff_role) WHERE staff_role = 'super_admin_1';

COMMENT ON FUNCTION keystone.enforce_super_admin_1() IS
  'P5.4 / §K3 — the SERVER boundary for Super Admin 1. sections.mjs glrsOnly is a renderer hint; this is the rule. Fires on INSERT and on UPDATE OF staff_role so the rank cannot be granted after the fact.';

-- ── §A2 — staff listable BY ROLE ──────────────────────────────────────────────────────────
-- ★ security_invoker so RLS applies normally: a tenant lists ITS OWN staff and no one else's.
CREATE VIEW keystone.staff_by_role
WITH (security_invoker = true) AS
SELECT u.tenant_id, u.staff_role, u.id AS app_user_id, u.display_name, u.email
  FROM keystone.app_user u
 WHERE u.role = 'staff';

COMMENT ON VIEW keystone.staff_by_role IS
  '§A2 — the surface that answers "who holds which role", which previously did not exist. security_invoker: a tenant sees only its own staff.';

GRANT SELECT ON keystone.staff_by_role TO app_rw;
