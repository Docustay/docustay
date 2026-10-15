-- 0049 — THE SANDBOX IS A TENANT. P19.10.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DESIGN DECISION, AND WHY IT IS THE CHEAP ONE RATHER THAN THE CLEVER ONE.
--     P19.10 asks for "a sandbox: a second instance of the tenant's own data." The tempting shapes are
--     a `sandbox boolean` column on every table, or a parallel schema. Both are wrong here:
--       · a boolean on 45 tables means EVERY policy, EVERY query and EVERY unique index has to carry
--         the flag, and the first one that forgets silently mixes test data into live reporting;
--       · a parallel schema doubles the migration surface forever.
--   ★★★ **A SANDBOX IS A TENANT.** `sandbox_of` points at the live tenant it belongs to. Isolation is
--        then the isolation the system already has — FORCE RLS on `tenant_id` — with nothing new to
--        get wrong, and a sandbox row cannot appear in a live query because it never shares a
--        tenant_id.
--
-- ★★★ AND WHAT A SANDBOX MUST **NOT** CONTAIN: CLIENT DATA.
--     "A second instance of the tenant's own data" is read here as the tenant's CONFIGURATION —
--     services, prices, document types, templates — and **never** people, documents, session notes or
--     signatures. Copying those would duplicate PHI into a space whose whole purpose is to be
--     experimented on and shared with developers, and would mean a signed instrument existed twice.
--   ★ Hard limit 4 is about deleting client data; this is the same concern from the other direction.
--     The copy helper in `src/sandbox/writes.mjs` enumerates what it copies and refuses the rest.

SET LOCAL ROLE app_owner;

ALTER TABLE keystone.tenant
  ADD COLUMN sandbox_of uuid REFERENCES keystone.tenant(id) ON DELETE CASCADE;

-- ★★ ON DELETE CASCADE is deliberate and is the ONE place in this schema where a tenant cascade is
--    right: deleting a live tenant must not leave an orphaned sandbox holding a copy of its
--    configuration. Everywhere else a tenant FK is RESTRICT, because everywhere else the child is
--    real data.

-- ★★★ NO CHAINS. A sandbox of a sandbox is a support conversation nobody can win: which one is live?
CREATE OR REPLACE FUNCTION keystone.tenant_sandbox_is_flat() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.sandbox_of IS NOT NULL THEN
    IF NEW.sandbox_of = NEW.id THEN
      RAISE EXCEPTION 'a tenant cannot be its own sandbox' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM keystone.tenant t WHERE t.id = NEW.sandbox_of AND t.sandbox_of IS NOT NULL) THEN
      RAISE EXCEPTION
        'a sandbox cannot have a sandbox — % already belongs to another tenant. Sandboxes are one '
        'level deep on purpose: with chains, "which one is live" has no answer.', NEW.sandbox_of
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION keystone.tenant_sandbox_is_flat() FROM PUBLIC;

CREATE TRIGGER tenant_sandbox_flat
  BEFORE INSERT OR UPDATE OF sandbox_of ON keystone.tenant
  FOR EACH ROW EXECUTE FUNCTION keystone.tenant_sandbox_is_flat();

-- ★ ONE sandbox per live tenant. Two would mean "the sandbox" is ambiguous in every conversation.
CREATE UNIQUE INDEX tenant_one_sandbox_per_tenant
  ON keystone.tenant (sandbox_of) WHERE sandbox_of IS NOT NULL;

COMMENT ON COLUMN keystone.tenant.sandbox_of IS
  'When set, this tenant is the SANDBOX of the tenant it points at. A sandbox is a tenant so that '
  'isolation is the FORCE-RLS isolation the system already has, with nothing new to get wrong. One '
  'level deep (a trigger refuses chains), one per live tenant (a partial unique index), and it holds '
  'CONFIGURATION ONLY — never people, documents or signatures, because a sandbox is made to be '
  'experimented on and PHI must not be duplicated into it.';

RESET ROLE;
