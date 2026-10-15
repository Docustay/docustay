-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CORRECTS 0099 — WHICH CREATED 130 TRIGGERS THAT COULD NOT SEE THE ROW THEY PROTECT.
--
-- ★★★ [EXECUTED, immediately after 0099] both probes still passed:
--       NOTICE:  F1 STILL BROKEN — truncate succeeded
--       NOTICE:  F2 STILL BROKEN — child rows deleted
--     The triggers existed and were ALWAYS-enabled — `pg_trigger` confirms
--     `tenant_refuse_truncate_trg | tgenabled A | tgtype 34`. They fired. They found nothing:
--
--       SET ROLE app_owner;
--       SELECT count(*) FROM keystone.tenant WHERE is_reference;   -->  **0**
--
--   ★★★ `SECURITY DEFINER` IS NOT AN RLS BYPASS. THE *OWNER* IS WHAT MATTERS, AND
--       `keystone.tenant` IS **FORCE** ROW LEVEL SECURITY — which applies policies to the table
--       owner too. The guard functions are owned by `app_owner`, which has no policy on that table,
--       so with no tenant GUC set `tenant_isolation` admits nothing and `EXISTS (…)` is false.
--       **A refusal that can never see its subject is not a guard; it is a comment that runs.**
--
-- ★★ THIS IS THE FOURTH TIME THIS EXACT LESSON HAS COST THIS PROJECT A WRONG ANSWER. `0031_uid_
--    resolver_owner.sql` records the first three and says it plainly: *"FORCE applies policies to
--    the table OWNER TOO, and neither SECURITY DEFINER nor owning the table buys an exemption. ONLY
--    a policy naming the definer's owner, or a BYPASSRLS role, does."* 0099 was written without
--    re-reading it, and reproduced the defect in a migration whose whole purpose was protection.
--  ★ AND IT FAILED SILENT AND OPEN. Not an error, not a refusal — the guard simply agreed with
--    every destructive statement put to it. Worse than absent, because `pg_trigger` says it is there.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FIX IS 0031'S FIX, AND IT IS AS NARROW AS THE FUNCTION'S ACTUAL JOB.
--     A policy naming `app_owner`, admitting **ONLY reference rows** — not `USING (true)`. The
--     guard's only question is "is this the reference practice?", so that is the only row it may
--     read. Every ordinary practice stays invisible to it, and a future body cannot leak what this
--     policy does not admit.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE POLICY reference_guard_read ON keystone.tenant
  FOR SELECT TO app_owner
  USING (is_reference);

COMMENT ON POLICY reference_guard_read ON keystone.tenant IS
  'P3 CLOSE / F1+F2. Lets the app_owner-owned reference guards (refuse_touch_reference_rows, '
  'refuse_truncate_tenant, refuse_delete_reference_tenant) SEE the reference practice — and NOTHING '
  'else: SELECT only, and only rows where is_reference. ★★★ Without it those triggers fired and '
  'found zero rows, because keystone.tenant is FORCE RLS and SECURITY DEFINER grants the owner no '
  'exemption (0031, D-17.27 — the fourth occurrence of this lesson in this project).';

-- ★★ AND THE DELETE GUARD FROM 0094 HAD THE SAME LATENT HOLE, FOR A DIFFERENT REASON. It reads
--    `OLD.is_reference` — a column of the row being deleted, not a lookup — so it was never blind.
--    Recorded here so a future reader does not "fix" it by symmetry: it is correct as written, and
--    the reason it is correct is that it never leaves the row it was handed.
