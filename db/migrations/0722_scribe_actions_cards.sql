-- Run 9 Part 3.5 — Scribe actions (Pro), ask-your-documents and "explain this clause".
-- Three new confirmation cards (remind several documents at once from a checkbox list, make a template from a document, set a document's reminders) and two read-only cards
-- (the documents a question found, and a clause explained in plain words). Additive: the checks only widen.
ALTER TABLE keystone.document_chat_proposal DROP CONSTRAINT IF EXISTS document_chat_proposal_action_check;
ALTER TABLE keystone.document_chat_proposal ADD CONSTRAINT document_chat_proposal_action_check
  CHECK (action IS NULL OR action IN ('send','remind','resend','void','copy','use_template','bulk_send','support','remind_many','make_template','set_reminders'));
ALTER TABLE keystone.document_chat_proposal DROP CONSTRAINT IF EXISTS document_chat_proposal_kind_check;
ALTER TABLE keystone.document_chat_proposal ADD CONSTRAINT document_chat_proposal_kind_check
  CHECK (kind IN ('changes','values','people','details','created','template','confirm','questions','pro','pdf_fields','results','explain'));
