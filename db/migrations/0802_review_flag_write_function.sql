-- 0802: the internal review list could never be written to (R13-D497).
-- flagForReview inserted with ON CONFLICT (kind, subject) DO NOTHING; Postgres needs SELECT on the conflict columns for that, and 0769 rightly gives the
-- application INSERT only ("the application can write, never read"). Every repeat Free sign-up, complaint pause and fair-use flag was refused with
-- "permission denied" and swallowed. This function writes with a plain INSERT and ignores a repeat: the application still cannot read the list.
CREATE OR REPLACE FUNCTION keystone.docustay_review_flag_add(p_kind text, p_subject text, p_workspace uuid, p_detail jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = keystone, pg_temp AS $f$
BEGIN
  -- A plain INSERT (the application has INSERT and nothing else); the open-once index answers a repeat, and the sub-transaction keeps a caller's transaction alive.
  INSERT INTO keystone.docustay_review_flag (kind, subject, workspace_id, detail) VALUES (p_kind, p_subject, p_workspace, COALESCE(p_detail, '{}'::jsonb));
EXCEPTION WHEN unique_violation THEN NULL;
END
$f$;
REVOKE ALL ON FUNCTION keystone.docustay_review_flag_add(text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.docustay_review_flag_add(text, text, uuid, jsonb) TO app_rw, app_worker;
DO $s$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_signup') THEN GRANT EXECUTE ON FUNCTION keystone.docustay_review_flag_add(text, text, uuid, jsonb) TO app_signup; END IF; END $s$;
DO $c$ BEGIN
  IF has_table_privilege('app_rw', 'keystone.docustay_review_flag', 'SELECT') THEN RAISE EXCEPTION '0802 self-check: the review list must still not be readable by the application'; END IF;
END $c$;
