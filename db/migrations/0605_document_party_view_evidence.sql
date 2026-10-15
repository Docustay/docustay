-- 0605 · WHAT A RECIPIENT'S FIRST LOOK LEAVES BEHIND (QUEUE §23.4.11 "evidence at every step"). The certificate states, per person, when they first opened the document and from where; for a person with no
-- account that fact lives on their own `document_party` row (IP address and device, like the signature record's).
ALTER TABLE keystone.document_party ADD COLUMN viewed_ip text NULL, ADD COLUMN viewed_user_agent text NULL;
