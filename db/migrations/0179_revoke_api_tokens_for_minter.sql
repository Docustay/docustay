-- 0179_revoke_api_tokens_for_minter
-- Stage 6 task 6.15 · CCR-7-18, from the maintainer's ruling on Q7-13, 21 Sep 2026: "a key is revoked when its
-- minter's rank falls below its rank_ceiling, and when its minter is archived."
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE ARCHIVAL HALF OF Q7-13. The RANK half (a key revoked when its minter's rank falls below
--     its rank_ceiling) is old 7's task 7.13, inside `setStaffRole`. This is the other half:
--     without it, archiving a person leaves a standing programmatic credential they minted, at the
--     rank they held when they minted it, and nothing ever revisits it.
--
-- ★★★ WHY A NEW FUNCTION, NOT A LOOP OVER `list_api_tokens()` + `revoke_api_token()`.
--     `keystone.list_api_tokens()`'s `RETURNS TABLE` deliberately does NOT include `created_by`
--     (0046:98-110) — `created_by` never leaves the database, which is also why `app_rw` never
--     learns who minted what. So the application cannot tell which rows are this person's without
--     either widening that return shape (which the developer API-keys screen and
--     `src/routes/developer.mjs` both read) or adding a definer that already knows. This is that
--     definer.
--
-- ★★ SAME SHAPE AS `keystone.list_api_tokens` (0046:98-116): tenant-scoped INSIDE the function on
--    `keystone.current_tenant_id()`, never on a caller-supplied tenant id, so a caller cannot sweep
--    another tenant's keys. Return type is a bare `integer` — the count of rows changed — which is
--    narrow enough that the catalog gate's return-type rule admits it as a credential resolver
--    (6.7 adds it to `CREDENTIAL_RESOLVERS`, 17 → 18; that count literal is 6.7's, not this
--    migration's).
--
-- ★ IDEMPOTENT, LIKE `revoke_api_token`: `revoked_at IS NULL` in the predicate means a key already
--   revoked (by this sweep, by the rank half, or by hand) is simply not touched again, and the
--   function returns how many rows it actually changed — 0 is a legitimate, expected answer, not
--   an error.
-- ★ `keystone_auth.api_token` is OWNED BY `auth_owner` (0045:39, `SET LOCAL ROLE auth_owner`
--   before the CREATE TABLE), and this file runs as `app_owner` (db/migrate.mjs per-file
--   `SET ROLE app_owner`), a NOINHERIT member of `auth_owner` (0132 header). CREATE FUNCTION needs
--   ownership, so the role is switched exactly as 0167/0176 do and put back explicitly — NOT
--   `RESET ROLE`, the session-level reset that caused F482 (db/migrate.mjs:301-316).
-- ★ `revoked_reason` (0167) has no CHECK — free text — so no enum to widen here.
-- ★ Production exposure: zero. `keystone_auth.api_token` holds 0 rows (EXECUTED, read-only, count
--   only, 21 Sep 2026). This is a rule built before the first key exists, not a clean-up.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE auth_owner;

CREATE FUNCTION keystone.revoke_api_tokens_for_minter(p_app_user_id uuid, p_revoked_by uuid)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
  WITH done AS (
    UPDATE keystone_auth.api_token
       SET revoked_at = now(), revoked_by = p_revoked_by, revoked_reason = 'archived'
     WHERE created_by = p_app_user_id
       AND tenant_id = keystone.current_tenant_id()
       AND revoked_at IS NULL
     RETURNING 1)
  SELECT count(*)::integer FROM done
$$;
REVOKE ALL ON FUNCTION keystone.revoke_api_tokens_for_minter(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_api_tokens_for_minter(uuid, uuid) TO app_rw, app_owner;

SET LOCAL ROLE app_owner;
