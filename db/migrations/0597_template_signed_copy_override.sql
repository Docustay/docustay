-- 0597 · AN OPTIONAL PER-TEMPLATE OVERRIDE OF HOW A SIGNED COPY LOOKS (QUEUE §23.2.8). `document_template.signed_copy` holds a small JSON object of `signed_copy.*` / `certificate.*` settings that
-- replace the practice's defaults for documents made from THIS template (letterhead, footer, certificate on/off, signature style, font…). NULL = use the practice's settings. Additive, nullable.
ALTER TABLE keystone.document_template ADD COLUMN signed_copy jsonb NULL
  CHECK (signed_copy IS NULL OR jsonb_typeof(signed_copy) = 'object');
