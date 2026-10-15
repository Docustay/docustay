-- 0606 · THE WORKER MAY SEE WHICH SCHEDULED DOCUMENTS ARE DUE (QUEUE §23.4.6 "now or scheduled"). A draft is invisible to everyone but its authors, and the periodic sweep has no viewer; this lets that sweep — and only it
-- (no viewer, tenant-scoped) — SEE the id and author of an uploaded document whose chosen send time has arrived. The send itself is then done as the author, exactly like the archive job.
CREATE POLICY system_scheduled_read ON keystone.document_instance FOR SELECT USING (
  tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL AND builder = 'pdf' AND state = 'draft'
  AND scheduled_send_at IS NOT NULL AND scheduled_send_at <= now() AND archived_at IS NULL);
