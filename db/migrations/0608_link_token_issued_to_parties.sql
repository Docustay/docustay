-- 0608 · A SIGN LINK MAY BE ISSUED TO A DOCUMENT PARTY, NOT ONLY AN ACCOUNT (QUEUE §23.4.10). `link_token.issued_to` was a foreign key to `app_user` (ON DELETE SET NULL), which made it impossible to give a link to a person with
-- no account. The foreign key goes; its one behaviour is kept by a trigger (deleting a the platform person still blanks the links issued to them, and a link issued to nobody is refused by the signer door — R-14.4), and a
-- new trigger does the same for parties: when a party row is deleted (a draft discarded, the people list rewritten) its outstanding links are revoked. Existing rows are untouched.
ALTER TABLE keystone.link_token DROP CONSTRAINT link_token_issued_to_fkey;

CREATE FUNCTION keystone.link_token_forget_deleted_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE keystone.link_token SET issued_to = NULL WHERE issued_to = OLD.id AND purpose <> 'pdf_signature';
  RETURN OLD;
END $$;
CREATE TRIGGER link_token_forget_deleted_user AFTER DELETE ON keystone.app_user FOR EACH ROW EXECUTE FUNCTION keystone.link_token_forget_deleted_user();

CREATE FUNCTION keystone.link_token_revoke_deleted_party() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE keystone.link_token SET revoked_at = now(), revoked_reason = 'the person was removed from the document' WHERE issued_to = OLD.id AND purpose = 'pdf_signature' AND redeemed_at IS NULL AND revoked_at IS NULL;
  RETURN OLD;
END $$;
CREATE TRIGGER link_token_revoke_deleted_party AFTER DELETE ON keystone.document_party FOR EACH ROW EXECUTE FUNCTION keystone.link_token_revoke_deleted_party();
