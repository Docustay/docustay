-- Docustay flow v3 (6 Oct 2026): a document made from WORDS keeps those words, so they stay editable until Send (the page-image view is only a preview).
-- All additive and nullable: a document made from an uploaded file has none of them; the platform's tables are untouched.
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS source jsonb;            -- the editor's source (TipTap JSON, closed node set)
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS source_facts jsonb;      -- the merge values the words were printed with ({ "custom.x": "…", "org.name": "…" })
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS source_paper text;       -- letter | a4
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS variable_values jsonb;   -- the answers to a template's "fill in the details" form (B6)
