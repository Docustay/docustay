-- 0602 · TWO LINK PURPOSES FOR UPLOADED DOCUMENTS (QUEUE §23.4.10). `pdf_signature` opens one recipient's signing page for one document (issued_to is the recipient's `document_party.id`, so a person with no account
-- can sign); `pdf_test` is the "send me a test" link — it shows the document exactly as a signer sees it and records nothing. Both are declared by Documents (src/documents/domain.mjs).
ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_purpose_check;
ALTER TABLE keystone.link_token ADD CONSTRAINT link_token_purpose_check CHECK (purpose = ANY (ARRAY[
  'document_signature','invite','client_invite','waitlist_claim','invoice_view','estimate_accept','card_update','pdf_signature','pdf_test']));
