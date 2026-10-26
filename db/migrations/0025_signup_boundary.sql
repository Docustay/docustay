-- 0025_signup_boundary
-- P17.9 / P2.18 · P2.5 — THE SIGNUP PATH CROSSES THE RLS BOUNDARY, NARROWLY AND BY NAME.
--
-- ★★★ THE PROBLEM, WHICH IS D2.1's CHICKEN-AND-EGG IN ITS ORIGINAL FORM. `runCriticalPrefix`
-- (src/provisioning/prefix.mjs) must INSERT a `keystone.tenant` row **before any tenant context
-- exists** — there is no tenant to set a GUC to yet. But `tenant` is ENABLE + FORCE row-level
-- security, and [MEAS 2026-09-13, pg_policies] its only policies are `tenant_isolation`
-- (ALL, USING id = current_tenant_id()) and `tenant_health_read` (SELECT, TO auth_owner).
-- **THERE IS NO INSERT POLICY ON `tenant` AT ALL**, so with RLS on, nothing can create one.
--
-- ★★ SO HOW HAS IT EVER WORKED? It has not, outside a test. `test/p2_05_prefix.test.mjs:9` connects
-- with `KEYSTONE_SEED_URL`, which is a **SUPERUSER** — and a superuser bypasses RLS entirely. The
-- module's parameter is honestly named `privilegedClient`; what was never decided is what
-- "privileged" should mean in production. This migration decides it.
--
-- ★★★ IT IS NOT THE SUPERUSER. Handing the web application a superuser connection means any
-- SQL-injection anywhere, or any leaked environment variable, is total compromise of every tenant.
-- Under this migration the same accident buys the ability to insert **one provisioning-state tenant
-- and one staff user**, and nothing else, on four tables.
--
-- ★★★ AND IT IS NOT `auth_owner` EITHER, WHICH IS THE TRAP WORTH NAMING. `auth_owner` already
-- crosses this boundary for the health lister (0017) and looks reusable. **It OWNS `keystone_auth`.**
-- Letting the application assume it would hand the application the CREDENTIAL STORE — the one thing
-- D2.1's second schema exists to keep out of reach. A role that can read api_token must never be
-- the role that signs people up.
--
-- ★ SO: a dedicated LOGIN role `app_signup` — NOT superuser, NOT BYPASSRLS, NOT a member of
--   anything — admitted by EXPLICIT NAMED policies on exactly the four tables signup touches, each
--   with a `WITH CHECK` narrow enough that the grant cannot be used for anything else.
--   This is the pattern 0007/0008 (`account_seat_counts`) and 0017 (`tenant_health_read`) already
--   established: cross the boundary in the CATALOG, where it is visible, never by implicit bypass.
--
-- ★★ `app_signup` is a LOGIN role with a password, so it is created in the BOOTSTRAP (recorded in
--    HANDOFF.md §D-12.0a alongside the other five) rather than here — migrations run as `app_owner`,
--    which has no CREATEROLE. This file FAILS LOUDLY if the role is absent, so a bootstrap gap
--    surfaces at migrate time rather than at a customer's first signup.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_signup') THEN
    RAISE EXCEPTION
      'role app_signup does not exist. It is part of the ROLE BOOTSTRAP (HANDOFF.md D-12.0a), not '
      'of any migration, because it is a LOGIN role with a password and migrations run as '
      'app_owner (no CREATEROLE). Create it, then re-run: '
      'CREATE ROLE app_signup LOGIN NOBYPASSRLS PASSWORD ''…''; '
      'GRANT CONNECT ON DATABASE keystone TO app_signup; '
      'GRANT USAGE ON SCHEMA keystone TO app_signup;';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · `tenant` — INSERT ONLY, AND ONLY A PROVISIONING-STATE TENANT.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ `status = 'provisioning'` in the WITH CHECK is the narrowing that matters. A signup creates a
--    tenant that is NOT YET LIVE; the provisioning suffix activates it. So this grant cannot be
--    used to mint an active tenant, and it cannot be used to flip an existing one — there is no
--    UPDATE policy here, deliberately.
-- ★★★ AND NO SELECT. `app_signup` cannot read the tenant table. It therefore cannot enumerate
--     customers, cannot check whether a slug belongs to someone, and cannot answer any question
--     about who exists — it can only attempt an INSERT and be told by the UNIQUE constraint.
--     ★ That is why `runCriticalPrefix` reads the unique violation (23505) rather than pre-checking
--       availability: the pre-check would need a read it must not have. The code was already right.
CREATE POLICY signup_insert_tenant ON keystone.tenant
  FOR INSERT TO app_signup
  WITH CHECK (status = 'provisioning');

GRANT INSERT ON keystone.tenant TO app_signup;
-- ★ `RETURNING id` requires SELECT on that ONE column. Column-level, not table-level: the id is a
--   value the caller just created and already knows it needs; the name, slug and status are not.
GRANT SELECT (id) ON keystone.tenant TO app_signup;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · `app_user` — INSERT ONLY, AND ONLY A STAFF ROW.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ `role = 'staff'` is the narrowing. The first user of an organisation is its operator. This
--    grant cannot be used to create a client, an adolescent or a parent — those come later, through
--    the authenticated write paths of PHASE 15B where a real principal and RLS apply.
-- ★ `staff_role` is NOT constrained here beyond the schema's own `staff_role_shape` and
--   `enforce_super_admin_1()`. That is deliberate: the DATABASE already decides whether
--   `super_admin_1` is permitted (platform tenant only, globally singular), and restating the rule
--   in a policy would be a second copy of it that can drift.
CREATE POLICY signup_insert_admin ON keystone.app_user
  FOR INSERT TO app_signup
  WITH CHECK (role = 'staff');

GRANT INSERT ON keystone.app_user TO app_signup;
GRANT SELECT (id) ON keystone.app_user TO app_signup;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · `provisioning_run` / `provisioning_step` — INSERT AND UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ `createRun` inserts a run with NO tenant_id (there is no tenant yet), and the prefix then
--   UPDATEs both tables to bind them to the tenant it created. So both verbs are needed, and the
--   run must be insertable while its tenant_id is still NULL.
-- ★★ THE `WITH CHECK` IS `tenant_id IS NULL` ON INSERT — the row may be created only in the
--    unbound state. It cannot be inserted already pointing at somebody else's tenant.
CREATE POLICY signup_insert_run ON keystone.provisioning_run
  FOR INSERT TO app_signup
  WITH CHECK (tenant_id IS NULL);

-- ★★★ THE UPDATE POLICY IS THE ONE TO GET RIGHT, AND IT IS WHERE A NAIVE VERSION WOULD BE A HOLE.
--     `USING (tenant_id IS NULL)` restricts WHICH rows may be updated — only still-unbound ones.
--     Without it, `app_signup` could rebind ANY run, including a live tenant's, to a tenant of its
--     choosing. ★ A policy with only a WITH CHECK and no USING is the classic mistake P21A.4's fuzz
--     is told to hunt for ("a missing WITH CHECK, a FOR ALL where FOR SELECT was meant"); this is
--     the mirror image — a missing USING.
CREATE POLICY signup_bind_run ON keystone.provisioning_run
  FOR UPDATE TO app_signup
  USING (tenant_id IS NULL)
  WITH CHECK (tenant_id IS NOT NULL);

CREATE POLICY signup_insert_step ON keystone.provisioning_step
  FOR INSERT TO app_signup
  WITH CHECK (tenant_id IS NULL);

CREATE POLICY signup_bind_step ON keystone.provisioning_step
  FOR UPDATE TO app_signup
  USING (tenant_id IS NULL);

GRANT INSERT, UPDATE ON keystone.provisioning_run  TO app_signup;
GRANT INSERT, UPDATE ON keystone.provisioning_step TO app_signup;
-- ★ The prefix's UPDATEs are `WHERE run_id = $1` / `WHERE id = $1`, so it must be able to SELECT
--   those keys to locate the rows. `run_id` and `name` are needed to find the prefix step.
GRANT SELECT (id) ON keystone.provisioning_run TO app_signup;
GRANT SELECT (id, run_id, name) ON keystone.provisioning_step TO app_signup;

COMMENT ON POLICY signup_insert_tenant ON keystone.tenant IS
  'P17.9/P2.5. The signup path (app_signup) may INSERT a provisioning-state tenant and nothing '
  'else: no UPDATE, no DELETE, and no SELECT beyond the id it just created — so it cannot '
  'enumerate customers or test whether a slug belongs to someone. Chosen over a superuser '
  'connection (D-17.9): the same leaked credential buys one provisioning tenant instead of every '
  'tenant''s data.';
