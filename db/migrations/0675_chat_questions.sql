-- FINAL PUSH Stage 3 (7 Oct 2026): the assistant can ask the person a short set of clickable questions. The card is stored like any other proposal, so a resumed conversation shows it (and whether it was answered).
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'keystone.document_chat_proposal'::regclass AND contype = 'c' AND (pg_get_constraintdef(oid) ILIKE '%kind%' OR pg_get_constraintdef(oid) ILIKE '%state%') LOOP
    EXECUTE format('ALTER TABLE keystone.document_chat_proposal DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE keystone.document_chat_proposal
  ADD CONSTRAINT document_chat_proposal_kind_check  CHECK (kind IN ('changes','values','people','details','created','template','confirm','questions')),
  ADD CONSTRAINT document_chat_proposal_state_check CHECK (state IN ('proposed','accepted','rejected','undone','confirmed','failed'));
