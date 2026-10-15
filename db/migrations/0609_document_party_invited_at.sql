-- 0609 · WHEN A PERSON WAS GIVEN THEIR LINK (QUEUE §23.4.6, sequential order). The next person in a sequence is invited when the one before them finishes; this records that it happened (once), whatever the mail provider did.
ALTER TABLE keystone.document_party ADD COLUMN invited_at timestamptz NULL;
