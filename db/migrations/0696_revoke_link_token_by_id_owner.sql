-- 0696 — A REVOKE-BY-ID THAT REVOKED NOTHING. [MEASURED 10 Oct 2026, Run 4 journey round 2]
--
-- ★★★ THE FINDING: `keystone.revoke_link_token_by_id(uuid, text)` (0404) was created by the migration
--     runner, so it is owned by `app_owner`. `keystone.link_token` has FORCE row-level security and
--     its only UPDATE policy is `link_token_spend_update … TO auth_owner` (0169). The function is
--     SECURITY DEFINER, so its UPDATE runs as `app_owner`, matches NO policy, touches zero rows and
--     returns NULL — which `revokeLinkTokenById` reports as `{ revoked: false }` and nobody checks.
--   ★★ CONSEQUENCE, MEASURED ON THE LOCAL STACK: send a document, remind a signer, then "Change"
--      who signs — three live signing links existed for that seat afterwards. The person whose
--      address was wrong (the usual reason to change a signer) could still open and sign with the
--      OLD link. `mintPartyLink` ("exactly one link is live per person per document") and
--      `voidPdfDocument` ("every outstanding link is revoked") both call this function, so both
--      promises were false. (A voided document still refused signing because the page also checks
--      the document's state; a replaced link did not have that second check.)
--
-- ★★ THE FIX: the sibling `revoke_link_token(text, text)` (0170) is owned by `auth_owner` and works.
--    The same rule applies here: the function is created AS auth_owner, never created and then
--    re-owned (0017:65-76, F482), with the same body, the same grant and the same empty search_path.

-- the runner's session role is a superuser (db/migrate.mjs), so the drops below work whoever owns the old copy
DROP FUNCTION IF EXISTS keystone.revoke_link_token_by_id(uuid, text);

SET LOCAL ROLE auth_owner;
CREATE FUNCTION keystone.revoke_link_token_by_id(p_id uuid, p_reason text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE keystone.link_token t
     SET revoked_at = now(), revoked_reason = p_reason
   WHERE t.id          = p_id
     AND t.tenant_id   = keystone.current_tenant_id()
     AND t.revoked_at  IS NULL
     AND t.redeemed_at IS NULL
  RETURNING t.id
$$;

REVOKE ALL ON FUNCTION keystone.revoke_link_token_by_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.revoke_link_token_by_id(uuid, text) TO app_rw;

COMMENT ON FUNCTION keystone.revoke_link_token_by_id(uuid, text) IS
  '0404 (B-29), re-created by 0696 as auth_owner. Kills an unspent link token by its PRIMARY KEY, in the current practice only, and returns its id or nothing. Owned by auth_owner because that is the only role link_token''s UPDATE policy admits; owned by app_owner it matched no row and revoked nothing.';

-- ★★ SAME DEFECT, TWO MORE PLACES (found by sweeping every SECURITY DEFINER function that writes a table
--    whose policies do not admit the function's owner — scripts/tmp-style catalog sweep, 10 Oct 2026):
--    0608's `link_token_forget_deleted_user` (deleting a person blanks the links issued to them) and
--    `link_token_revoke_deleted_party` (removing a person from a document revokes their outstanding
--    signing links) were created by the migration runner, so they are owned by `app_owner` and update
--    ZERO rows: a removed person's signing link stayed live. Re-created the same way, as `auth_owner`.
--    The first needs to write `issued_to`, which `auth_owner` was never granted: that one column grant
--    is added (the UPDATE policy `link_token_spend_update` already admits auth_owner on every row).
RESET ROLE;
GRANT UPDATE (issued_to) ON keystone.link_token TO auth_owner;
DROP TRIGGER IF EXISTS link_token_forget_deleted_user ON keystone.app_user;
DROP TRIGGER IF EXISTS link_token_revoke_deleted_party ON keystone.document_party;
DROP FUNCTION IF EXISTS keystone.link_token_forget_deleted_user();
DROP FUNCTION IF EXISTS keystone.link_token_revoke_deleted_party();

SET LOCAL ROLE auth_owner;
CREATE FUNCTION keystone.link_token_forget_deleted_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE keystone.link_token SET issued_to = NULL WHERE issued_to = OLD.id AND purpose <> 'pdf_signature';
  RETURN OLD;
END $$;
CREATE FUNCTION keystone.link_token_revoke_deleted_party() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE keystone.link_token SET revoked_at = now(), revoked_reason = 'the person was removed from the document' WHERE issued_to = OLD.id AND purpose = 'pdf_signature' AND redeemed_at IS NULL AND revoked_at IS NULL;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION keystone.link_token_forget_deleted_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION keystone.link_token_revoke_deleted_party() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.link_token_forget_deleted_user() TO app_owner;
GRANT EXECUTE ON FUNCTION keystone.link_token_revoke_deleted_party() TO app_owner;

SET LOCAL ROLE app_owner;
CREATE TRIGGER link_token_forget_deleted_user AFTER DELETE ON keystone.app_user FOR EACH ROW EXECUTE FUNCTION keystone.link_token_forget_deleted_user();
CREATE TRIGGER link_token_revoke_deleted_party AFTER DELETE ON keystone.document_party FOR EACH ROW EXECUTE FUNCTION keystone.link_token_revoke_deleted_party();

-- ★★ THE SELF-CHECK PROVES THE FUNCTION WORKS, NOT JUST THAT IT EXISTS (the 0404 self-check proved
--    existence and the grant, and the function was dead on arrival).
SET LOCAL ROLE app_owner;
DO $$
DECLARE
  v_owner text;
  v_acl   aclitem[];
BEGIN
  SELECT pg_get_userbyid(p.proowner), p.proacl INTO v_owner, v_acl
    FROM pg_proc p WHERE p.oid = to_regprocedure('keystone.revoke_link_token_by_id(uuid, text)');
  IF v_owner IS DISTINCT FROM 'auth_owner' THEN
    RAISE EXCEPTION '0696 — revoke_link_token_by_id is owned by %, it must be auth_owner or the revoke matches no row', v_owner;
  END IF;
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '0696 — revoke_link_token_by_id has a NULL proacl, which means EXECUTE to PUBLIC';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.revoke_link_token_by_id(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0696 — app_rw cannot EXECUTE revoke_link_token_by_id';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname IN ('link_token_forget_deleted_user','link_token_revoke_deleted_party') AND pg_get_userbyid(p.proowner) <> 'auth_owner') THEN
    RAISE EXCEPTION '0696 — a link_token trigger function is not owned by auth_owner';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('link_token_forget_deleted_user','link_token_revoke_deleted_party') AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION '0696 — the two link_token triggers were not re-created';
  END IF;
END $$;
