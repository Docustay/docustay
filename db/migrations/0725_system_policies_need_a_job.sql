-- Run 9 Part 4.3 — F984: THE SWEEPS' VIEW WAS ANYONE'S VIEW.
--
-- Every `system_*` policy let a tenant handle with NO signed-in person see the rows a background sweep needs: open documents for reminders and expiry, due scheduled sends, sealed
-- copies without a timestamp, paid payments without a receipt or a fee, key dates, holds, and (the platform) payments, invoices and subscriptions for the divergence sweep.
-- The worker is not the only no-person handle: public forms, the verify page and webhooks open one too. MEASURED 11 Oct (Run 8 J8): such a handle saw 11 sent documents' rows.
-- No route reached them, but nothing stopped one from doing so.
--
-- ★ Now each of those policies also requires `keystone.system_job`, which only the application's task wrapper supplies (src/queue/runLedger.mjs → src/db/jobContext.mjs →
--   withTenant, for a no-person transaction). A request never runs inside a job, so a public route's handle sees none of it.
-- ★ ALTER POLICY changes only USING: the rows a sweep may see and touch. WITH CHECK (what a row may become) is unchanged. Idempotent: a policy that already asks is left alone.
-- ★ The `public_verify_read` policies (the verify page's own narrow read) and `booking.tenant_insert` are not sweeps and are not touched.

CREATE OR REPLACE FUNCTION keystone.current_system_job() RETURNS text
  LANGUAGE sql STABLE
  SET search_path = ''
AS $$ SELECT nullif(current_setting('keystone.system_job', true), '') $$;
COMMENT ON FUNCTION keystone.current_system_job() IS 'Run 9 (F984): the background job this transaction runs for, set by withTenant from the task wrapper''s job context; NULL for every request.';
GRANT EXECUTE ON FUNCTION keystone.current_system_job() TO PUBLIC;

DO $$
DECLARE p record; n int := 0;
BEGIN
  FOR p IN
    SELECT tablename, policyname, qual FROM pg_policies
     WHERE schemaname = 'keystone' AND policyname LIKE 'system\_%'
       AND qual ILIKE '%current_user_id() IS NULL%' AND qual NOT ILIKE '%current_system_job()%'
  LOOP
    EXECUTE format('ALTER POLICY %I ON keystone.%I USING ((%s) AND keystone.current_system_job() IS NOT NULL)', p.policyname, p.tablename, p.qual);
    n := n + 1;
  END LOOP;
  RAISE NOTICE '0725: % system policies now require a job', n;
  -- the promise, checked here: no sweep policy is left that a no-person request could use
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'keystone' AND policyname LIKE 'system\_%' AND qual ILIKE '%current_user_id() IS NULL%' AND qual NOT ILIKE '%current_system_job()%') THEN
    RAISE EXCEPTION '0725: a system policy still admits a no-person handle without a job';
  END IF;
END $$;

-- ── THE ONE FEATURE THAT LEANED ON IT: a public form's "this form is full" (P10-A-5) counted its signed responses through the no-person handle, so it read other people's response rows
--    through the sweeps' policies (and, since those only show open documents, undercounted executed ones). With the sweeps' view closed it counted nothing. The count is now a narrow
--    SECURITY DEFINER read that returns ONE NUMBER for one form of the calling workspace — no row, no title — the same for the public page and the owner's screens (0713's pattern).
CREATE OR REPLACE FUNCTION keystone.form_signed_responses(p_tenant_id uuid, p_family_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_tenant_id IS DISTINCT FROM keystone.current_tenant_id() THEN 0 ELSE (
    SELECT count(*)::int FROM keystone.document_instance i
     WHERE i.tenant_id = p_tenant_id AND i.source_channel = 'form'
       AND (i.form_id = p_family_id OR (i.form_id IS NULL AND (
             i.template_id IN (SELECT t.id FROM keystone.document_template t WHERE t.tenant_id = p_tenant_id AND t.family_id = p_family_id)
             OR EXISTS (SELECT 1 FROM keystone.document_file f WHERE f.instance_id = i.id AND f.tenant_id = p_tenant_id AND f.kind = 'original'
                          AND f.meta->>'from_template' IN (SELECT t.id::text FROM keystone.document_template t WHERE t.tenant_id = p_tenant_id AND t.family_id = p_family_id)))))
       AND (i.executed_at IS NOT NULL OR (SELECT p.status FROM keystone.document_party p WHERE p.instance_id = i.id AND p.tenant_id = p_tenant_id AND p.action_role = 'signer' ORDER BY p.position LIMIT 1) IN ('signed','approved'))
  ) END
$$;
REVOKE ALL ON FUNCTION keystone.form_signed_responses(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.form_signed_responses(uuid, uuid) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.form_signed_responses(uuid, uuid) IS 'Run 9 (F984): how many signed responses one form of the calling workspace has — one number, no rows; 0 for any other workspace.';
-- the definer runs as app_owner (no BYPASSRLS, F918): it may read the rows it counts, read-only, as 0689 gave it document_instance
DROP POLICY IF EXISTS owner_lookup ON keystone.document_party;
CREATE POLICY owner_lookup ON keystone.document_party FOR SELECT TO app_owner USING (true);
DROP POLICY IF EXISTS owner_lookup ON keystone.document_file;
CREATE POLICY owner_lookup ON keystone.document_file FOR SELECT TO app_owner USING (true);
DROP POLICY IF EXISTS owner_lookup ON keystone.document_template;
CREATE POLICY owner_lookup ON keystone.document_template FOR SELECT TO app_owner USING (true);
