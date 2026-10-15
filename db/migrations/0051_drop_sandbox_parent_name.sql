-- 0051 — DROP keystone.sandbox_parent_name(). It cannot work, and 0008 already said why.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 0050 ADDED A SECURITY DEFINER FUNCTION TO READ THE PARENT TENANT'S NAME. IT RETURNS NULL, AND
--     IT ALWAYS WILL. [EXECUTED — the P19.10 gate, immediately after 0050 was applied:
--     `parentName: null`.]
--
--     The reason is written down in this project already, in 0008:8-16 and quoted again in A4.1:
--     **FORCE ROW LEVEL SECURITY APPLIES TO THE TABLE'S OWNER TOO.** `keystone.tenant` is FORCE RLS
--     with the policy `id = keystone.current_tenant_id()`. A SECURITY DEFINER function owned by
--     `app_owner` therefore reads that table **through the same policy**, so the parent row — whose
--     `id` is by definition NOT the current tenant — is invisible to it. Changing the owner does not
--     help: only BYPASSRLS or a superuser would see it, and the catalog gate bans both.
--
--   ★★ SO THE DESIGN WAS WRONG, NOT THE PLUMBING. I reached for a definer function to work around a
--      policy that was doing exactly its job. **The correct answer needs no cross-tenant read at all:**
--      a sandbox's own `name` is set at creation to "<live practice> (sandbox)", and a tenant can
--      always read its own row. `sandboxInfo()` now builds the banner from that.
--
--   ★ THE HONEST COST OF LEAVING IT IN PLACE: a function that silently returns NULL is worse than no
--     function — the next reader would assume the parent genuinely has no name, or "fix" it by
--     granting BYPASSRLS. Dropping it is the fix.
--   ★★★ AND THE ASSERTION THAT CAUGHT THIS WAS ITSELF TOO WEAK FIRST. It was `/^Sandbox of /`, which
--      **passed on the string "Sandbox of null"**. A prefix match is not a check that a label is
--      readable. Tightened to require the live practice's actual name and to refuse `null`,
--      `undefined` and anything uuid-shaped.

SET LOCAL ROLE app_owner;

DROP FUNCTION IF EXISTS keystone.sandbox_parent_name();

RESET ROLE;
