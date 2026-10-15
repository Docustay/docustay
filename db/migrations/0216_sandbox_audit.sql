-- 0216_sandbox_audit
-- Stage 7 task 9.11 — sandbox from Platform, and the lookup a sandbox route (and its audit reads)
-- need to find sandboxes cheaply once they exist.
--
-- ★ No schema change to `keystone.tenant` itself is needed: `sandbox_of uuid REFERENCES
--   keystone.tenant(id) ON DELETE CASCADE` already exists (0049), along with the one-level-deep
--   trigger (`tenant_sandbox_is_flat`) and the one-sandbox-per-tenant unique index
--   (`tenant_one_sandbox_per_tenant`, 0049:60-61 — itself a partial index on `sandbox_of`).
--
-- ★★ THIS MIGRATION ADDS ONE THING: a second partial index on `sandbox_of`, ordered for the
--    lookups a sandbox route and an audit/listing view actually run — "does this live tenant
--    already have a sandbox, and which row is it" (`sandboxInfo`, `createSandboxTenant`'s own
--    "one sandbox per tenant" check) and "list every sandbox tenant" (a platform-side audit view).
--    `tenant_one_sandbox_per_tenant` (0049) already enforces uniqueness and already serves the
--    single-row lookup by `sandbox_of` — this index is deliberately NOT a duplicate of it: it
--    additionally carries `id` so a covering scan can answer "which sandboxes exist, and what are
--    their ids" without a heap fetch, which the uniqueness index (index-only on `sandbox_of`) does
--    not need to do and was not built to serve.
--
-- ★ Production effect (MEASURED 21 Sep 2026): `keystone.tenant` has 3 rows, none with `sandbox_of`
--   set — this task creates the first sandbox this production database will ever have had. An
--   index on an all-NULL partial predicate is instant to build and starts empty.
--
-- ★ No RLS change: `keystone.tenant` already carries ENABLE + FORCE ROW LEVEL SECURITY (0001:149-150)
--   under `tenant_isolation` (0001:157-158), which already covers every column including this one;
--   an index does not read or bypass a policy. No grant change: `app_rw` already holds
--   SELECT/INSERT/UPDATE/DELETE on `keystone.tenant` (0001:189).
--
-- ★★★ WHAT THIS MIGRATION DELIBERATELY DOES NOT DO, RECORDED RATHER THAN LEFT SILENT. Wiring a real
--     platform-side caller for `createSandboxTenant`/`copyConfigurationIntoSandbox`
--     (`src/sandbox/writes.mjs`, unedited by this task) so it actually succeeds in production needs a
--     database role or RLS policy this migration does not create — see the ★★★ FOUND AT BUILD note
--     at the sandbox POST route in `src/routes/settings.mjs` and FINDINGS.md F621 for the full
--     evidence. Task 9.11's own field 6 says "no schema change to keystone.tenant is needed" and
--     that is honoured literally here: this migration is the index, and nothing else.

CREATE INDEX tenant_sandbox_lookup_idx ON keystone.tenant (sandbox_of, id) WHERE sandbox_of IS NOT NULL;

COMMENT ON INDEX keystone.tenant_sandbox_lookup_idx IS
  'Stage 7 task 9.11. Covers "does this live tenant already have a sandbox, and which row" (sandboxInfo, createSandboxTenant''s own one-sandbox-per-tenant check) and a platform-side "list every sandbox" read, without a heap fetch. Distinct from tenant_one_sandbox_per_tenant (0049), which enforces uniqueness and does not carry id.';
