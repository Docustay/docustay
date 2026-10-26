-- 0005_provisioning_step_tenant_id
--
-- ★★ WRITTEN BECAUSE THE CATALOG GATE (P1.8) REJECTED 0004. It is worth recording that the gate
-- found this, not a human review: `provisioning_step` reached its tenant only indirectly, through
-- `run_id`, and its RLS policy was therefore an EXISTS subquery against provisioning_run.
--
-- ★ Denormalising tenant_id onto the step is the better design regardless of the gate:
--   1. The RLS predicate becomes a direct column comparison instead of a correlated subquery —
--      evaluated once per row on every read of this table.
--   2. ★ An EXISTS-based policy silently depends on the PARENT row remaining visible. If a future
--      policy change hid a provisioning_run row, every one of its steps would vanish too, and the
--      cause would be one table away from the symptom.
--
-- ★ NULLABLE, for the same reason as provisioning_run.tenant_id: the first step is the one that
-- CREATES the tenant, so steps exist before any tenant does. Backfilled from the parent for any
-- row that already has one.

ALTER TABLE keystone.provisioning_step
  ADD COLUMN tenant_id uuid REFERENCES keystone.tenant(id) ON DELETE RESTRICT;

UPDATE keystone.provisioning_step s
   SET tenant_id = r.tenant_id
  FROM keystone.provisioning_run r
 WHERE r.id = s.run_id AND r.tenant_id IS NOT NULL;

CREATE INDEX provisioning_step_tenant_idx ON keystone.provisioning_step (tenant_id);

-- Replace the subquery policy with a direct one.
DROP POLICY tenant_isolation ON keystone.provisioning_step;
CREATE POLICY tenant_isolation ON keystone.provisioning_step
  USING (tenant_id IS NOT NULL AND tenant_id = keystone.current_tenant_id());

-- ★ The (run_id, name) uniqueness is kept and is NOT a cross-tenant leak: `run_id` is a UUIDv7
-- surrogate key, so provoking a violation requires already possessing a run id you own. It is
-- declared in the gate's allowlist with exactly that reasoning rather than the rule being loosened.

COMMENT ON COLUMN keystone.provisioning_step.tenant_id IS
  'Denormalised from provisioning_run. NULL until the tenant exists — the first step is what creates it.';
