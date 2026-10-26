-- 0201 — A KEY'S TOGGLES CHANGE WITHOUT ITS SECRET CHANGING. (Stage 7 task 7.25.)
--
-- ★★★ THIS IS THE LAST NUMBER IN STAGE 7'S BLOCK (0182–0201). See STAGE-7-PLAN.md §4's block
--     accounting.
-- ★ Role handling, F482. `keystone_auth.api_token` belongs to `auth_owner` (0045:39), and a
--   SECURITY DEFINER over it must be CREATED AS `auth_owner`, never created-then-transferred
--   (0017:65-68). So this file opens `SET LOCAL ROLE auth_owner` and closes `SET ROLE app_owner` —
--   NEVER `RESET ROLE` (0164:24-27; 0046 itself ends on the bare `RESET ROLE` that F482 records).
SET LOCAL ROLE auth_owner;

-- ★★★ EDIT THE TOGGLES, NEVER THE SECRET. `secret_hash` is not in the SET list and there is no
--     argument that could reach it. A capability change must not break a live integration.
-- ★ RETURNS uuid, not text[]: nothing textual travels back out of a function over the credential
--   table (db/gates/catalog-conformance.mjs:667-676 — "a credential resolver's return type IS its
--   safety argument"). The BEFORE list is read by the caller from keystone.list_api_tokens(), which
--   already returns scopes and is already the read path for this table.
-- ★ Tenant-scoped inside, like every other function in 0046: there is no p_tenant_id to get wrong.
-- ★ `revoked_at IS NULL` in the predicate: a revoked key cannot be re-scoped back into use.
CREATE FUNCTION keystone.set_api_token_scopes(p_id uuid, p_scopes text[])
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE keystone_auth.api_token
     SET scopes = p_scopes
   WHERE id = p_id
     AND tenant_id = keystone.current_tenant_id()
     AND revoked_at IS NULL
     AND scopes IS DISTINCT FROM p_scopes
  RETURNING id
$$;
REVOKE ALL ON FUNCTION keystone.set_api_token_scopes(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.set_api_token_scopes(uuid, text[]) TO app_rw;

COMMENT ON FUNCTION keystone.set_api_token_scopes(uuid, text[]) IS
  'STAGE-5-PLAN §9.4 item 8. Changes a key''s capability toggles WITHOUT rotating its secret. '
  'Returns NULL when no row changed (not this tenant''s, already revoked, or the same scopes) — the '
  'caller must not emit an event on a no-op. The two scope CHECKs on the table (0045:78-80) still '
  'apply, so an empty array and a malformed scope are refused by the database as well as by the route.';

SET ROLE app_owner;   -- ★ F482: hand the role back explicitly. NEVER `RESET ROLE`.
