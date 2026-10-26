-- 0692 · Scribe can propose the boxes of an uploaded PDF (PDF-FIELD-DETECTION-SPEC §5, "Scribe"): a proposal of kind pdf_fields. Additive: the kind list only grows.
ALTER TABLE keystone.document_chat_proposal DROP CONSTRAINT IF EXISTS document_chat_proposal_kind_check;
ALTER TABLE keystone.document_chat_proposal
  ADD CONSTRAINT document_chat_proposal_kind_check CHECK (kind IN ('changes','values','people','details','created','template','confirm','questions','pro','pdf_fields'));
