-- 0026_signup_no_returning
-- P17.9 — D-17.17. TIGHTENS 0025. `app_signup` loses its last read access.
--
-- ★★★ WHY: `INSERT … RETURNING id` IS SUBJECT TO RLS, and `app_signup` has no SELECT policy, so the
-- row it just created is not visible to it and the statement fails. [EXECUTED 2026-09-13] the SAME
-- insert succeeds without `RETURNING` and fails with it.
-- ★★ AND POSTGRES REPORTS IT AS *"new row violates row-level security policy"* — the WITH CHECK
--    wording — which points the reader at the insert policy, where nothing is wrong. That misleading
--    message cost four rounds of investigation. Written down here because the next role to cross
--    this boundary (P19.8's `app_embed`) will hit it too; 0025's own comment already predicted it.
--
-- ★★★ THE FIX IS NOT A NEW SELECT POLICY. That is the tempting move and it is the wrong one: it
-- would give the signup role standing read access to `tenant` and `app_user` forever, to serve a
-- convenience in one statement. Instead the CALLER GENERATES THE IDS — `app_signup` can execute
-- `keystone.uuid_generate_v7()` [EXECUTED], so `RETURNING` is simply unnecessary.
-- ★ v7 and not a client-side v4: every `id` in this schema is `uuid_generate_v7()` and the
--   time-ordering is load-bearing for index locality. A v4 in the same column would be silently
--   worse forever.
--
-- ★ RESULT: `app_signup` can INSERT a provisioning tenant and a staff user and **cannot read one
--   column of either table**. It cannot enumerate customers, cannot confirm whether an email is
--   registered, and cannot read back what it wrote.

REVOKE SELECT (id) ON keystone.tenant   FROM app_signup;
REVOKE SELECT (id) ON keystone.app_user FROM app_signup;

-- ★★ WHAT IS DELIBERATELY KEPT, AND WHY EACH IS UNAVOIDABLE:
--   · provisioning_run  SELECT (id)            — `UPDATE … WHERE id = $1` requires SELECT on the
--                                                columns in its WHERE clause.
--   · provisioning_step SELECT (run_id, name)  — same, for `WHERE run_id = $1`, plus the CASE on
--                                                `name` that marks the prefix step succeeded.
--   Both are on tables that hold no customer data — a run records a signup ATTEMPT — and both are
--   single-column grants, not table-wide.

COMMENT ON POLICY signup_insert_tenant ON keystone.tenant IS
  'P17.9/P2.5. app_signup may INSERT a provisioning-state tenant and NOTHING else: no UPDATE, no '
  'DELETE, and — after 0026 — no SELECT on any column. It cannot enumerate customers, cannot test '
  'whether a slug or email belongs to someone, and cannot read back what it wrote (which is why the '
  'signup path generates ids with uuid_generate_v7() instead of using RETURNING — D-17.17).';
