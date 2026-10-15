-- 0603 · A TEMPLATE CAN HOLD A FILE (QUEUE §23.4.9 "Save as a template with roles and fields kept"). `document_file.instance_id` becomes optional and `template_id` is added: a file belongs to exactly ONE of
-- a document or a template, so a template made from an upload keeps its own copy of the pages even if the draft it came from is deleted. Additive; existing rows are all instance files.
ALTER TABLE keystone.document_file ALTER COLUMN instance_id DROP NOT NULL;
ALTER TABLE keystone.document_file ADD COLUMN template_id uuid NULL REFERENCES keystone.document_template(id) ON DELETE CASCADE;
ALTER TABLE keystone.document_file ADD CONSTRAINT document_file_one_owner CHECK ((instance_id IS NULL) <> (template_id IS NULL));
CREATE INDEX document_file_by_template ON keystone.document_file (tenant_id, template_id) WHERE template_id IS NOT NULL;
