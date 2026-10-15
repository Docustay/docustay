-- 0713 · THE DEVELOPER'S OWN REFERENCE NEVER REACHED A WEBHOOK ON THE WIRE (found 11 Oct 2026, HOTFIX-2STEP Part 3.5).
-- Every document webhook is meant to carry the developer's own reference (externalId, metadata, parties) and where it came from (source "form" or "sent", and the form) — FP-C1, added at
-- delivery by the documents enricher (src/ports/documents.mjs documentEventExtra). The delivery job reads the event under the workspace with NO viewer, and document_instance's row
-- security hides the row without one, so the enricher found nothing and every delivery went out without them (MEASURED: a real delivery to a public receiver; the same event enriched
-- with the owner as viewer has source "form"). Run 7's proof called the enricher WITH a viewer, so it passed (a guard whose test supplied the condition).
-- Same remedy as 0570/0571's worker lookups: a narrow SECURITY DEFINER read of plain developer metadata for one document of one workspace — the reference the developer gave us, not the
-- document's content. Additive.
CREATE OR REPLACE FUNCTION keystone.document_event_reference(p_tenant_id uuid, p_instance_id uuid)
RETURNS TABLE (external_id text, metadata jsonb, party_refs jsonb, form_template_id uuid, form_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT i.external_id, i.metadata, i.party_refs, f.id, f.name
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
  'externalId/metadata/parties and the form (if any) of one document, for the webhook enricher at delivery — plain developer metadata, no viewer required (migration 0713; same reasoning as 0570/0571).';
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'keystone' AND p.proname = 'document_event_reference') THEN
    RAISE EXCEPTION '0713 self-check: keystone.document_event_reference was not created';
  END IF;
END
$check$;
