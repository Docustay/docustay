-- 0614 · TEMPLATES YOU CAN MANAGE (QUEUE §23.5.5) AND SHARE (§23.5.7). Additive columns on `document_template` for uploaded-document (builder 'pdf') templates:
--   folder / tags            — a place to keep them and words to find them by;
--   approval_*               — when the practice asks for approval before a template can be sent, a new template or version is `pending` until an admin approves it (existing rows are `approved`);
--   change_note / previous_version_id — the version chain: a new version is a NEW row that says what changed and which version it replaces (the old one is retired, never edited — the same rule the other builders keep);
--   self_serve_*             — a public link where anyone can fill in and sign this template (rate-limited, bot-checked).
ALTER TABLE keystone.document_template
  ADD COLUMN folder              text        NULL CHECK (folder IS NULL OR length(btrim(folder)) BETWEEN 1 AND 60),
  ADD COLUMN tags                text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  ADD COLUMN approval_status     text        NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN approval_note       text        NULL,
  ADD COLUMN approved_by         uuid        NULL,
  ADD COLUMN approved_at         timestamptz NULL,
  ADD COLUMN change_note         text        NULL,
  ADD COLUMN previous_version_id uuid        NULL REFERENCES keystone.document_template(id) ON DELETE SET NULL,
  ADD COLUMN self_serve_enabled  boolean     NOT NULL DEFAULT false,
  ADD COLUMN self_serve_slug     text        NULL CHECK (self_serve_slug IS NULL OR self_serve_slug ~ '^[a-z0-9][a-z0-9-]{2,58}[a-z0-9]$');
CREATE UNIQUE INDEX document_template_self_serve_slug_key ON keystone.document_template (tenant_id, lower(self_serve_slug)) WHERE self_serve_slug IS NOT NULL;
