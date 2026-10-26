-- 0610 · THE PUBLIC VERIFY PAGE'S ONE READ (QUEUE §23.5.1). A person who holds a signed PDF scans its certificate QR and lands on /verify/<tenant>.<document>.<code>; `document_verify_facts` answers with the few facts that page shows.
-- ★ The code is sha256(document id | original hash | last signature row hash), first 16 hex — fixed before the sealed copy is rendered (so the QR inside the PDF can carry it), unguessable without the document, and changes if anything in the chain does.
-- ★ NOT a SECURITY DEFINER function: a definer owned by `app_owner` is still filtered by FORCE RLS (0017's measurement), so it would read nothing once deployed. Instead two NARROW policies let a viewer-less transaction read exactly ONE executed pdf lead and its signature rows — and only when the
--   route has set `keystone.verify_ref` to that document's id in the same transaction. The function (INVOKER) then refuses unless the code matches, so a wrong code returns nothing even though the row was momentarily readable.
-- ★ It returns ONLY title, organisation name, dates, page count, hashes, and who signed when — never a body, email, IP or mark.
DROP FUNCTION IF EXISTS keystone.document_verify_facts(uuid, uuid, text);
DROP FUNCTION IF EXISTS keystone.document_verify_code(uuid);

CREATE FUNCTION keystone.document_verify_code(p_instance_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT left(encode(sha256(convert_to(
           i.id::text || '|' || coalesce(i.original_sha256, '') || '|' ||
           coalesce((SELECT s.row_hash FROM keystone.signature_record s WHERE s.instance_id = i.id ORDER BY s.signer_order DESC LIMIT 1), ''), 'UTF8')), 'hex'), 16)
    FROM keystone.document_instance i WHERE i.id = p_instance_id
$$;
GRANT EXECUTE ON FUNCTION keystone.document_verify_code(uuid) TO app_rw, app_owner;

CREATE FUNCTION keystone.document_verify_facts(p_tenant_id uuid, p_instance_id uuid, p_code text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
           'title', i.title,
           'organisation', (SELECT t.name FROM keystone.tenant t WHERE t.id = i.tenant_id),
           'executedAt', i.executed_at,
           'originalSha256', i.original_sha256,
           'finalSha256', i.final_sha256,
           'pageCount', (i.template_body_snapshot -> 'file' ->> 'page_count')::int,
           'signers', coalesce((SELECT jsonb_agg(jsonb_build_object('name', s.signer_name, 'signedAt', s.signed_at, 'order', s.signer_order) ORDER BY s.signer_order)
                                  FROM keystone.signature_record s WHERE s.instance_id = i.id), '[]'::jsonb))
    FROM keystone.document_instance i
   WHERE i.tenant_id = p_tenant_id AND i.id = p_instance_id AND i.builder = 'pdf' AND i.state = 'executed' AND i.package_lead_id IS NULL
     AND p_code IS NOT NULL AND length(p_code) = 16 AND p_code = keystone.document_verify_code(i.id)
$$;
GRANT EXECUTE ON FUNCTION keystone.document_verify_facts(uuid, uuid, text) TO app_rw, app_owner;

DROP POLICY IF EXISTS public_verify_read ON keystone.document_instance;
CREATE POLICY public_verify_read ON keystone.document_instance FOR SELECT
  USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL AND builder = 'pdf' AND state = 'executed' AND package_lead_id IS NULL
         AND id::text = split_part(coalesce(current_setting('keystone.verify_ref', true), ''), '.', 1));
DROP POLICY IF EXISTS public_verify_read ON keystone.signature_record;
CREATE POLICY public_verify_read ON keystone.signature_record FOR SELECT
  USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
         AND instance_id::text = split_part(coalesce(current_setting('keystone.verify_ref', true), ''), '.', 1));
