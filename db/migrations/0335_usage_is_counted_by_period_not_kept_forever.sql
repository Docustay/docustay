-- 0335_usage_is_counted_by_period_not_kept_forever
-- Spec 06 (Settings) §3, task 6.1.
--
-- Read by SetPlans' usage meter (§2.7); incremented by spec 08 (AI drafts) and spec 09 (marketing
-- sends) — named as a cross-spec shared shape in §10 and the CONTRACTS-FEATURES.md addendum. This
-- migration builds the table only; the writers (spec 08/09) and the reader (SetPlans) are separate
-- tasks in separate specs.
CREATE TABLE keystone.mainstay_usage_counter (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  metric       text NOT NULL CHECK (metric IN ('ai_draft','marketing_email')),
  count        integer NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, period_start, metric)
);

-- ── RLS — ENABLE and FORCE, three tenant policies, same discipline every tenant-scoped table in
--    this codebase uses (0013/0065/0202/0265). No backfill: a usage counter for an existing tenant
--    is legitimately absent until the first metered event of a period occurs. ───────────────────
ALTER TABLE keystone.mainstay_usage_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.mainstay_usage_counter FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.mainstay_usage_counter
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.mainstay_usage_counter
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.mainstay_usage_counter
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.mainstay_usage_counter TO app_rw;

COMMENT ON TABLE keystone.mainstay_usage_counter IS
  'Spec 06 §3 (task 6.1). One row per (tenant, period_start, metric) — a metered count for a billing '
  'period. Read by SetPlans'' usage meter (spec 06); written by spec 08 (AI drafts) and spec 09 '
  '(marketing sends), a cross-spec shared shape.';
