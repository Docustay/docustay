-- 0757_document_analytics_facts — PH1 fix (Dashboard, 17 Oct 2026), found on the sandbox before production.
-- ★★ WHY. The PostHog outbox listener (src/product/posthogListener.mjs) needs four plain facts about a document: who created it, when it
--    was sent and executed, and whether it is a test document. It read them with a raw query on keystone.document_instance, which
--    (1) crossed the documents wall (db/gates/documents_wall.mjs) and (2) returned NOTHING in the worker: there is no viewer there, so the
--    table's own RLS (document_is_visible) hides the row, and the listener fell back to the workspace owner instead of the sender.
--    Same no-viewer reasoning and the same narrow SECURITY DEFINER shape as document_created_by (0570) and document_notification_facts
--    (0571): ids, timestamps and one boolean. No title, no content, no party.
CREATE OR REPLACE FUNCTION keystone.document_analytics_facts(p_tenant_id uuid, p_instance_id uuid)
RETURNS TABLE (created_by uuid, sent_at timestamptz, executed_at timestamptz, is_test boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT created_by, sent_at, executed_at, is_test FROM keystone.document_instance
   WHERE tenant_id = p_tenant_id AND id = p_instance_id
$$;

REVOKE ALL ON FUNCTION keystone.document_analytics_facts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.document_analytics_facts(uuid, uuid) TO app_rw, app_owner;

COMMENT ON FUNCTION keystone.document_analytics_facts(uuid, uuid) IS
  'created_by / sent_at / executed_at / is_test for the PostHog outbox listener: plain metadata, no viewer required (same reasoning as
   document_created_by, 0570). Never a title, content or party.';
