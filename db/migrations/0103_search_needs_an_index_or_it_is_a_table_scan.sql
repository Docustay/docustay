-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P5.11 — GLOBAL SEARCH: THE INDEXES. [MEASURED] there were NONE.
--
-- ★★★ NO `tsvector`, NO `pg_trgm`, NO GIN INDEX IN ANY OF THE 102 MIGRATIONS. A search shipped
--     without one is a sequential scan of every person, every document and every invoice on every
--     keystroke — which is fast on a seeded database and is the thing that takes a practice down
--     on the day they finally have data.
--
-- ★★ TRIGRAM, NOT FULL-TEXT, AND THE REASON IS THE DATA. `to_tsvector` is built for prose: it
--    stems, it drops stop words, and it matches on WORD boundaries. What people search for here is
--    a NAME, an INVOICE NUMBER and a DOCUMENT TITLE — "whit" must find "Whitfield", and "INV-2026"
--    must find "INV-2026-0031". Full-text finds neither, because neither is a word prefix it
--    recognises. `pg_trgm` + `ILIKE '%…%'` finds both, and the GIN index makes the contains-match
--    an index scan instead of a scan of the table.
--
-- ★ `gin_trgm_ops` specifically: it supports `LIKE`/`ILIKE` containment, which is what the route
--   issues. A btree on the same column would serve `LIKE 'prefix%'` only, and prefix-only search
--   cannot find a surname typed without the first name.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

SET ROLE app_owner;

-- ★★ THE THREE OBJECTS THE ITEM NAMES: a person, a document, an invoice.
--   ★ `lower(...)` in the index expression matches the route's `lower(x) LIKE lower($2)`, so the
--     index is actually usable — an index on the raw column would be ignored by a case-insensitive
--     predicate, which is the classic "we added an index and nothing got faster".
CREATE INDEX IF NOT EXISTS app_user_search_trgm
  ON keystone.app_user USING gin (lower(display_name) gin_trgm_ops);

-- ★★ EMAIL TOO. A practice manager looking for somebody usually has the email in front of them —
--   it is what the person wrote on a form — and searching only names makes the product feel broken
--   for the one identifier that is guaranteed unique.
CREATE INDEX IF NOT EXISTS app_user_email_trgm
  ON keystone.app_user USING gin (lower(email) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS document_instance_title_trgm
  ON keystone.document_instance USING gin (lower(title) gin_trgm_ops);

-- ★★★ THE INVOICE NUMBER IS THE POINT OF SEARCHING FOR AN INVOICE. P2.6 added the column; nothing
--     could look one up by it. A person ringing about "invoice 31" has the number and nothing else.
CREATE INDEX IF NOT EXISTS invoice_number_trgm
  ON keystone.invoice USING gin (lower(invoice_number) gin_trgm_ops);

COMMENT ON INDEX keystone.app_user_search_trgm IS
  'P5.11 — trigram GIN for global search. ★ `lower(display_name)`, matching the route''s own '
  'lower() predicate: an index on the raw column is silently unused by a case-insensitive LIKE. '
  '★★ Trigram rather than tsvector because people search for NAMES and NUMBERS, not prose — '
  '"whit" must find "Whitfield", which full-text word-stemming does not.';

RESET ROLE;
