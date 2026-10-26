-- Docustay flow v2: a document written with a "Sender only" section keeps the FULL text for the sender (source + html) here, while the PDF, the signing page, the sealed copy and the certificate are made
-- from the text WITHOUT that section. Nothing a signer receives ever reads this column (the staff document view does). Additive and nullable; Mainstay's documents leave it empty.
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS sender_view jsonb;
