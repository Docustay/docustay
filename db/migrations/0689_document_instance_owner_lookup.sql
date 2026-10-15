-- 0689 · the worker's "who made this document / what is it called" lookups (0570 document_created_by, 0571 document_notification_facts, person_has_recent_document, people_with_recent_documents)
-- are SECURITY DEFINER functions owned by app_owner, written on the belief that the owner reads past row security. document_instance is FORCED, and app_owner has no BYPASSRLS, so with no viewer
-- (a worker) they returned nothing: a declined document raised "the instrument is not readable" and the sender was never told (found 8 Oct 2026 driving a decline in the sandbox; the event went `dead`).
-- Same remedy as 0688: one explicit, read-only door for app_owner. app_rw and app_worker stay confined to their tenant and their viewer; the functions still filter by the tenant they are given.
DROP POLICY IF EXISTS owner_lookup ON keystone.document_instance;
CREATE POLICY owner_lookup ON keystone.document_instance FOR SELECT TO app_owner USING (true);
