-- 0644 · THE SIGNER'S OWN LANGUAGE. When a send leaves the language on "match the signer" (no explicit choice), the signing page picks the language from the signer's browser, and the language they used is remembered on their party row,
-- so the reminder and signed-copy emails to the same address in the same workspace, and the Certificate of Completion, speak it too. Additive and nullable: a row with no value means "not known yet".
ALTER TABLE keystone.document_party
  ADD COLUMN signer_language text NULL CHECK (signer_language ~ '^[a-z]{2}$');
