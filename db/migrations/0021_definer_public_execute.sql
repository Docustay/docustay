-- 0021_definer_public_execute
-- ★★★ A REAL PRE-EXISTING HOLE, FOUND BY CATALOG CHECK 10 THE FIRST TIME IT RAN.
--
-- [MEAS 2026-09-12] Two SECURITY DEFINER functions in schema `keystone` carried a NULL `proacl` —
-- which is not "no grants". **Postgres's DEFAULT ACL for a FUNCTION is `EXECUTE TO PUBLIC`**, and
-- a NULL proacl means exactly that default is in force. So both were callable by EVERY role in
-- the cluster, running with `app_owner`'s privileges:
--
--   keystone.document_is_visible(keystone.document_instance)
--                                   — the per-document visibility PREDICATE (0011). ★ Its real
--                                     signature takes the ROW, not two uuids; the first draft of
--                                     this migration guessed `(uuid, uuid)` and failed with
--                                     "function does not exist". Dump the signature, never assume
--                                     it. It is the
--                                     function §R3/U19 rests on: "visibility is per document TYPE
--                                     … and it is document_is_visible() in Postgres, not a hidden
--                                     component." ★ A definer predicate that anyone may call
--                                     directly is an ORACLE: it answers "is this document visible
--                                     to this person" for arbitrary arguments, with the owner's
--                                     sight, outside any policy.
--   keystone.enforce_super_admin_1  — the §K3 SERVER boundary for the Super Admin 1 office (0010).
--
-- ★★ WHY IT MATTERS NOW RATHER THAN BEFORE: `app_embed` exists as of the P12.0 bootstrap, and
-- P19.8's entire design is that a publishable key reaches exactly one table BY GRANT — "an
-- application-code `if (token.class === 'publishable') reject` is one refactor away from absent."
-- A PUBLIC EXECUTE on a definer predicate is a second door into that design, opened by a default
-- nobody chose.
--
-- ★ It is not a catastrophe and it is not presented as one: the only LOGIN roles are app_rw and
--   app_embed, and both of these functions require caller-supplied ids to say anything. It is a
--   default that was never examined, in the one place where defaults must be.
--
-- ★★★ AND THE LESSON IS THE FILE'S REAL CONTENT: EVERY `CREATE FUNCTION` IN THIS PROJECT MUST BE
-- FOLLOWED BY `REVOKE ALL ... FROM PUBLIC`. The migrations that created these two did not, and
-- nothing noticed for eleven phases, because the catalog was never asked. It is asked now.

-- ─────────────────────────────────────────────────────────────────────────────
-- document_is_visible — used inside RLS policies, so app_rw MUST retain EXECUTE.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION keystone.document_is_visible(keystone.document_instance) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_is_visible(keystone.document_instance) TO app_rw, app_owner;

-- ─────────────────────────────────────────────────────────────────────────────
-- enforce_super_admin_1 — a TRIGGER function.
-- ★★ A trigger function needs NO EXECUTE grant to fire: Postgres checks the privilege at
--    CREATE TRIGGER time, not on every row. So this one is revoked from PUBLIC and granted to
--    NOBODY — there is no legitimate direct caller, and outside a trigger context it would error
--    anyway. Granting it "just in case" would be the reflex that produced the default.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION keystone.enforce_super_admin_1() FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE THE TRIGGER STILL FIRES. Revoking EXECUTE on a trigger function is safe in theory;
--    this asserts it in fact, because "safe in theory" is how the PUBLIC default got here.
--    §K3: Super Admin 1 is a SERVER rule — if this trigger stopped firing, the rank could be
--    granted in any tenant and nothing would say so.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.tenant   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE t uuid; refused boolean := false; msg text;
BEGIN
  INSERT INTO keystone.tenant (slug,name,timezone,status)
  VALUES ('m0021-probe','M0021 probe','UTC','active') RETURNING id INTO t;

  BEGIN
    -- A NON-platform tenant must not be able to hold Super Admin 1.
    INSERT INTO keystone.app_user (tenant_id,email,display_name,role,staff_role)
    VALUES (t,'sa1@example.invalid','SA1 probe','staff','super_admin_1');
  EXCEPTION WHEN OTHERS THEN
    refused := true; msg := SQLERRM;
  END;

  IF NOT refused THEN
    RAISE EXCEPTION 'enforce_super_admin_1 did NOT fire after REVOKE — the §K3 server boundary is inert and the rank can be granted in any tenant';
  END IF;
  RAISE NOTICE 'enforce_super_admin_1 still fires after REVOKE: %', msg;

  DELETE FROM keystone.app_user WHERE tenant_id = t;
  DELETE FROM keystone.tenant   WHERE id = t;
END $$;

ALTER TABLE keystone.tenant   FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='keystone' AND c.relname IN ('app_user','tenant') AND NOT c.relforcerowsecurity;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FORCE was not restored on: %', bad; END IF;
END $$;
