-- 0707 · Run 6 (10 Oct 2026) — three SECURITY DEFINER functions were executable by PUBLIC (gate s3_definers_not_public).
-- Every role, app_signup and app_embed included, could run them with their owner's rights. Revoke PUBLIC and grant only the
-- roles that call them (measured from the code):
--   · keystone.credit_event_write()            — a TRIGGER function; a trigger fires regardless of EXECUTE, so nobody needs it.
--   · keystone.document_on_team(uuid, uuid)     — read by the document lists and the visibility function (app_rw, app_worker; explicit grants already exist).
--   · keystone.redeem_handoff_session(text, bytea) — called through withCredentialLookup (src/auth/session.mjs), the app_rw pool.
SET LOCAL ROLE app_owner;
REVOKE EXECUTE ON FUNCTION keystone.credit_event_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION keystone.document_on_team(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_on_team(uuid, uuid) TO app_rw, app_worker;
SET LOCAL ROLE auth_owner;
REVOKE EXECUTE ON FUNCTION keystone.redeem_handoff_session(text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.redeem_handoff_session(text, bytea) TO app_rw;
SET LOCAL ROLE app_owner;

DO $$
BEGIN
  IF has_function_privilege('app_signup', 'keystone.redeem_handoff_session(text, bytea)', 'EXECUTE')
     OR has_function_privilege('app_signup', 'keystone.document_on_team(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0707: app_signup can still execute a definer';
  END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.redeem_handoff_session(text, bytea)', 'EXECUTE')
     OR NOT has_function_privilege('app_rw', 'keystone.document_on_team(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0707: app_rw lost a function it calls';
  END IF;
  RAISE NOTICE '0707: three definers are no longer executable by PUBLIC';
END $$;
