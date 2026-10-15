-- The sealed signed copy is asked for at the moment of signing. The web roles cannot reach graphile_worker (no schema USAGE), so the direct add_job in pdfSigning always failed and was swallowed; the copy then waited for the event dispatcher (measured 22 s to 199 s).
-- This function does ONE thing with the queue's privilege: queue archive_document_pdf, with the fixed job key, for a document. It cannot queue anything else. Additive.
CREATE OR REPLACE FUNCTION keystone.request_document_archive(p_tenant uuid, p_instance uuid, p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM graphile_worker.add_job('archive_document_pdf', json_build_object('tenantId', p_tenant, 'instanceId', p_instance, 'actorUserId', p_actor),
    job_key => 'archive:' || p_instance::text, job_key_mode => 'replace', priority => -20);
END $$;
REVOKE ALL ON FUNCTION keystone.request_document_archive(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.request_document_archive(uuid, uuid, uuid) TO app_rw, app_signup, app_worker;
