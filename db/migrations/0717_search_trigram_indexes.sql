-- 0717 · Run 9 (R9-j): ⌘K SEARCH NEEDS ITS INDEXES. src/documents/search.mjs answers "contains" (ILIKE '%…%') and near misses (pg_trgm word_similarity) over document titles,
-- template names and people. Without a trigram index both are table scans. One GIN trigram index per searched expression, on the SAME lower(...) expression the query uses
-- (an expression index only helps a query that writes the expression the same way). pg_trgm lives in the keystone schema (0103), so its operator class is keystone.gin_trgm_ops.
-- Additive, idempotent; small tables today (production has 10 workspaces), so a plain CREATE INDEX inside the runner's transaction is fine.
CREATE INDEX IF NOT EXISTS document_instance_title_trgm ON keystone.document_instance USING gin (lower(title) keystone.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_template_name_trgm ON keystone.document_template USING gin (lower(name) keystone.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_contact_name_trgm ON keystone.document_contact USING gin (lower(first_name || ' ' || last_name) keystone.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_contact_email_trgm ON keystone.document_contact USING gin (email keystone.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_party_name_trgm ON keystone.document_party USING gin (lower(name) keystone.gin_trgm_ops);
