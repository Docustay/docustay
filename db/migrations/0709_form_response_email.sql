-- 0709 · Run 7 part 2: the owner's "new form response" email is its own message type, so a workspace can word it and the email log can show it. Additive: both CHECKs gain 'form_response'.
ALTER TABLE keystone.document_email_message DROP CONSTRAINT IF EXISTS document_email_message_kind_check;
ALTER TABLE keystone.document_email_message ADD CONSTRAINT document_email_message_kind_check CHECK (kind IN ('invitation','reminder','completed','declined','voided','expired','code','receipt','form_response'));
ALTER TABLE keystone.document_email_log DROP CONSTRAINT IF EXISTS document_email_log_kind_check;
ALTER TABLE keystone.document_email_log ADD CONSTRAINT document_email_log_kind_check CHECK (kind IN ('invitation','reminder','completed','declined','voided','expired','code','receipt','form_response','other'));
