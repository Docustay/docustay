-- 0734 · Launch (G1 finding, 13 Oct 2026): a webhook receiver could not tell a practice (test-mode) document's event from a real one — `test` rode only on two events. The delivery enricher now adds `test`
-- to EVERY document event, so the function that reads a document's plain reference at delivery (0713; no viewer, narrow SECURITY DEFINER) also returns whether the document is a test document.
-- The return type changes, so the function is dropped and made again (nothing else calls it but the enricher). Additive in effect.
DROP FUNCTION IF EXISTS keystone.document_event_reference(uuid, uuid);
CREATE FUNCTION keystone.document_event_reference(p_tenant_id uuid, p_instance_id uuid)
RETURNS TABLE (external_id text, metadata jsonb, party_refs jsonb, form_template_id uuid, form_name text, is_test boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT i.external_id, i.metadata, i.party_refs, f.id, f.name, i.is_test
    FROM keystone.document_instance i
    LEFT JOIN LATERAL (
      SELECT t.id, t.name FROM keystone.document_template t
       WHERE i.source_channel = 'form' AND t.tenant_id = i.tenant_id
         AND t.family_id = coalesce(i.form_id, (SELECT x.family_id FROM keystone.document_template x WHERE x.id = i.template_id AND x.tenant_id = i.tenant_id))
       ORDER BY t.self_serve_slug IS NOT NULL DESC, t.version DESC LIMIT 1
    ) f ON true
   WHERE i.tenant_id = p_tenant_id AND i.id = p_instance_id
$$;
REVOKE ALL ON FUNCTION keystone.document_event_reference(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_event_reference(uuid, uuid) TO app_rw, app_owner;
COMMENT ON FUNCTION keystone.document_event_reference(uuid, uuid) IS
  'externalId/metadata/parties, the form (if any) and the test-mode flag of one document, for the webhook enricher at delivery: plain developer metadata, no viewer required (0713; test flag added in 0734).';
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'keystone' AND p.proname = 'document_event_reference' AND pg_get_function_result(p.oid) LIKE '%is_test boolean%') THEN
    RAISE EXCEPTION '0734 self-check: keystone.document_event_reference does not return is_test';
  END IF;
END
$check$;
