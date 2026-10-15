-- 0027_signup_read_own_run
-- P17.9 — D-17.19. THE THIRD FACE OF ONE RULE: RLS VISIBILITY GATES *UPDATE* ROW MATCHING.
--
-- ★★★ THE MEASUREMENT THAT FORCED THIS FILE. [EXECUTED 2026-09-13] after 0025 + 0026 the signup path
-- reported SUCCESS and had written a tenant and a super_admin_1 correctly — and yet:
--     provisioning_run.tenant_id   → NOT BOUND
--     provisioning_step (all five) → still `pending`, still unbound
--     organisation_and_admin       → `pending`, never `succeeded`
-- **All three UPDATEs matched ZERO ROWS and raised nothing.** An UPDATE that affects no rows is not
-- an error, so the transaction committed and the code returned success over work it had not done.
--
-- ★★★ WHY: `UPDATE … WHERE id = $1` must first FIND the row, and finding it is a READ. RLS SELECT
-- policies apply to that read. `app_signup` has no SELECT policy, and `tenant_isolation`'s predicate
-- (`tenant_id = current_tenant_id()`) does not admit a row whose `tenant_id` is still NULL — so the
-- WHERE clause matched nothing. The UPDATE policies (`signup_bind_run`, `signup_bind_step`) were
-- correct and were never reached, because there was no row to apply them to.
--
-- ★★ THIS IS THE SAME RULE AS D-17.17's `RETURNING` FAILURE, WEARING A THIRD FACE:
--      1. INSERT … RETURNING  → needs the NEW row to be visible        → hard ERROR
--      2. UPDATE … WHERE      → needs the EXISTING row to be visible   → SILENT ZERO ROWS
--    The first announces itself. **The second does not**, and it is the dangerous one: it is exactly
--    this project's signature failure — "a number that looks like a measurement and is the absence of
--    one." A grant that is too narrow does not always fail loudly.
--
-- ★ THE FIX IS THE NARROWEST POSSIBLE SELECT POLICY: the signup role may read a provisioning row
--   ONLY WHILE IT IS STILL UNBOUND. Once `tenant_id` is set the row belongs to a tenant and
--   `tenant_isolation` governs it; `app_signup` can never see it again.
--   ★★ So this admits exactly "signup attempts in flight" — rows that hold a requested slug and a
--      step name, and no customer data of any kind.

CREATE POLICY signup_read_unbound_run ON keystone.provisioning_run
  FOR SELECT TO app_signup
  USING (tenant_id IS NULL);

CREATE POLICY signup_read_unbound_step ON keystone.provisioning_step
  FOR SELECT TO app_signup
  USING (tenant_id IS NULL);

-- ★★★ AND THE SECOND STEP-UPDATE STILL NEEDS ITS ROW VISIBLE AFTER BINDING.
-- The prefix binds `tenant_id` and then marks `organisation_and_admin` succeeded. After the first
-- statement the row is no longer `tenant_id IS NULL`, so `signup_read_unbound_step` stops admitting
-- it — and the second UPDATE would silently match zero rows all over again.
-- ★ It IS visible under `tenant_isolation` at that point, because `prefix.mjs` sets
--   `keystone.tenant_id` to the new tenant before these statements (D-17.18) — so the ordinary
--   policy carries it, and no further grant is needed. **That is asserted by the P17.9 verifier,
--   which now checks the step reached `succeeded` rather than trusting the absence of an error.**

COMMENT ON POLICY signup_read_unbound_run ON keystone.provisioning_run IS
  'P17.9 / D-17.19. app_signup may READ a provisioning run only while tenant_id IS NULL — i.e. a '
  'signup attempt in flight. Required because UPDATE … WHERE must FIND the row, and finding it is a '
  'read subject to RLS; without this the bind UPDATEs matched zero rows AND RAISED NOTHING. Once '
  'bound, the row belongs to a tenant and tenant_isolation governs it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ★ THE COLUMN THE PREFIX'S SECOND STEP-UPDATE READS.
-- ─────────────────────────────────────────────────────────────────────────────
-- `SET attempts = attempts + 1 … WHERE run_id = $1 AND name = '…'` READS `attempts`. An UPDATE needs
-- SELECT privilege on every column it reads, INCLUDING inside its own SET expression — [EXECUTED]
-- without this it fails with `permission denied for table provisioning_step`, which reads like a
-- missing TABLE grant and is a missing COLUMN grant.
-- ★ This lives in 0027 and not 0026 because 0026 WAS ALREADY APPLIED, and `db/migrate.mjs` correctly
--   refuses a changed checksum: "An applied migration is immutable. Write a NEW migration instead."
--   Appending to a shipped migration is how two databases silently stop matching.
GRANT SELECT (attempts) ON keystone.provisioning_step TO app_signup;
