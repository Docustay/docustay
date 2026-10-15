-- 0539 — SQUARE CONTRACTS OVERHAUL PART 2, 29 Sep 2026 — TEMPLATE AND DOCUMENT DESCRIPTION/MESSAGE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ [MEASURED, 29 Sep 2026 recon, information_schema introspection against the real deployed
--     columns] `keystone.document_template` has no description and no message — only name, version,
--     active and the body. `keystone.document_instance` has a `title` (added after 0009 by a later
--     migration) but no description or message of its own. `src/documents/sendDocument.mjs`'s own
--     header states the email vars are "exactly practiceName, recipientName, documentTitle, link,
--     senderName" — nothing from the document's own content. the maintainer's ask — a template's own
--     description (for staff) and the client-facing description/message that ride along with the
--     document it produces, editable per send without touching the template — needs all four.
--
-- ★ FOUR NEW COLUMNS, ALL NULLABLE, ALL TEXT. Nullable because every existing template and instance
--   has none of these facts recorded — a NOT NULL would need a value invented for rows that never
--   had one, and inventing template descriptions/messages for the practice's existing library is not
--   this migration's job.
--   · document_template.description       — INTERNAL, "for you": why this template exists, never
--     shown to a client. Distinct from document_template.name, which already IS the default
--     client-facing document name (unchanged: `sendDocument.mjs` already passes `title: tpl.name`).
--   · document_template.client_description — the DEFAULT description a client sees on a document
--     made from this template.
--   · document_template.message           — the DEFAULT email body sent with a document made from
--     this template.
--   · document_instance.description / document_instance.message — the SAME two client-facing facts,
--     copied from the template at creation (exactly how `document_instance.title` already copies
--     `document_template.name`, src/documents/sendDocument.mjs), then independently editable per
--     send — the identical "copied once, edited without touching the source" shape
--     `template_body_snapshot`/`body_overridden` (0009+) already established for the document's BODY.
--     Editing one sent document's message never changes the template, and vice versa.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS client_description text;
ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS message text;

ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS message text;
