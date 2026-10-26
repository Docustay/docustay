-- 0720_credit_transition_rls
-- Run 9 (security checks run in full). The RLS catalogue gate (db/gates/p21a_rls_pgtap.mjs) had not run its pgTAP section locally (pgTAP was not
-- installed); with it installed, it found keystone.credit_transition — the one table in the schema without row-level security ENABLED and FORCED.
-- It is not tenant data: 13 rows naming the legal credit moves (0583), read by credit_transition_guard() on every UPDATE of entitlement_credit.status.
-- It gets the same shape as the schema's other vocabulary tables (permission_object, audit_action): RLS on and forced, everyone may read, nobody may write
-- at run time. A new legal move is a migration that adds its own write policy in the same file.
ALTER TABLE keystone.credit_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.credit_transition FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_transition_read ON keystone.credit_transition;
CREATE POLICY credit_transition_read ON keystone.credit_transition FOR SELECT USING (true);
