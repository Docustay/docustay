-- 0635 · PART 30 item 5 — "put the audit log inside the signed PDF" can be turned off: the certificate of completion is then its own sealed PDF, stored as a file of kind 'certificate' beside the 'final' one.
ALTER TABLE keystone.document_file DROP CONSTRAINT document_file_kind_check;
ALTER TABLE keystone.document_file ADD CONSTRAINT document_file_kind_check CHECK (kind = ANY (ARRAY['original','converted','final','attachment','certificate']));
