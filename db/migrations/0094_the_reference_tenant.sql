-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P3.1 — THE PERMANENT REFERENCE TENANT, AND A GUARD THE TEARDOWN CANNOT SWITCH OFF.
--
-- ★★★ THE MEASURED STATE OF THE DEPLOYED DATABASE: **49 of 56 tables are EMPTY.** `app_user` has
--     THREE rows — one per tenant. `account`, `booking`, `document_instance`, `document_template`,
--     `invoice`, `service`, `price`, `task`, `notification` and `signature_record` are all ZERO.
--   ★★ THE EMPTINESS IS GOOD HYGIENE, NOT NEGLECT — `seedWorld` builds a whole practice through the
--      real routes and `teardownWorld` removes it. **The sharper fact is that no human has ever
--      created a row in this system**, so every claim of the form *"this screen shows real data"* is
--      currently a claim about a fixture's lifetime.
--   ★ And *"every coach sees all 186 people in the tenant"* is **not true of this system.** There is
--     ONE person in the Docustay tenant. The 186 belongs to the legacy product.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THE GUARD IS `ENABLE ALWAYS` AND WHY THAT IS THE WHOLE POINT OF THIS MIGRATION.
--
--   P3 CLOSE requires the reference tenant to **survive a gate run**. A plain BEFORE DELETE trigger
--   would not: `db/gates/fixtures/suppressTriggers.mjs` sets `session_replication_role = replica`
--   for its session precisely so teardown can remove rows that immutability triggers protect. That
--   mechanism is correct and must keep working — **and it would switch this guard off with it.**
--
--   ★★ `session_replication_role = replica` suppresses ORIGIN-firing triggers. A trigger declared
--      **`ENABLE ALWAYS`** fires in replica mode too. So the one guard in this schema that must
--      outlive a teardown is the one that is not suppressible by the teardown's own mechanism.
--   ★★★ **"NEVER TORN DOWN" AS A CONVENTION IS EXACTLY WHAT THIS PROJECT KEEPS FINDING FAILS.** A
--       comment asking future sessions not to delete something is not a guarantee; a trigger that
--       cannot be turned off by the only tool that turns triggers off is.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.tenant ADD COLUMN is_reference boolean NOT NULL DEFAULT false;

-- ★★ EXACTLY ONE. A second reference tenant is two answers to "where do I look to see the product
--    working", and the screens that read it would have to pick one. A partial unique index says so
--    in the only place that can enforce it.
CREATE UNIQUE INDEX tenant_one_reference ON keystone.tenant ((is_reference)) WHERE is_reference;

-- ★ A reference tenant is never the platform tenant. The platform namespace is checked server-side
--   and holds no practice data; conflating the two would put demo rows behind the foundryOnly boundary.
ALTER TABLE keystone.tenant
  ADD CONSTRAINT tenant_reference_is_not_platform
  CHECK (NOT (is_reference AND is_platform));

CREATE OR REPLACE FUNCTION keystone.refuse_delete_reference_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_reference THEN
    RAISE EXCEPTION
      'the reference practice (%) is permanent and cannot be deleted. It is the one tenant in this '
      'system whose rows were created by the real write paths and are meant to outlive every test '
      'run — if you are trying to clean up after a gate, you are deleting the wrong tenant.',
      OLD.slug
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

-- ★ NOT `SECURITY DEFINER`, deliberately, and unlike every other definer in this schema. This
--   function reads only the row being deleted — `OLD.is_reference` — and needs no privilege the
--   caller does not already have. A definer here would be privilege for nothing.
REVOKE ALL ON FUNCTION keystone.refuse_delete_reference_tenant() FROM PUBLIC;

CREATE TRIGGER tenant_refuse_delete_reference_trg
  BEFORE DELETE ON keystone.tenant
  FOR EACH ROW EXECUTE FUNCTION keystone.refuse_delete_reference_tenant();

-- ★★★ THE LINE THIS WHOLE MIGRATION IS FOR. Without it, the first gate teardown that sets
--     `session_replication_role = replica` walks straight past the guard above.
ALTER TABLE keystone.tenant ENABLE ALWAYS TRIGGER tenant_refuse_delete_reference_trg;

COMMENT ON COLUMN keystone.tenant.is_reference IS
  'P3.1 — the ONE permanent practice, seeded through the real write paths and never torn down. '
  '★★★ Protected by tenant_refuse_delete_reference_trg, which is ENABLE ALWAYS so that '
  'session_replication_role = replica — the mechanism gate teardowns use to remove protected rows — '
  'cannot switch it off. "Never delete this" as a convention is what this project keeps finding fails.';
