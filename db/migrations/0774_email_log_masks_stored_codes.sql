-- 0774 — mask the stored one-time codes for real (R13-D405 follow-up, 23 Oct 2026).
-- 0773 ran as app_owner, and keystone.document_email_log has FORCE ROW LEVEL SECURITY: with no tenant set its UPDATE saw zero rows and changed
-- nothing (beta: 4 code rows still held their digits after it). The same class as 0530/0531 (notification_rule): a migration under FORCE RLS
-- that "succeeds" on zero rows. As 0531 does, FORCE is lifted for this one write and put back in the same transaction, and the migration
-- checks its own result: if any code row still shows digits it fails instead of reporting ok.
ALTER TABLE keystone.document_email_log NO FORCE ROW LEVEL SECURITY;

UPDATE keystone.document_email_log
   SET subject = regexp_replace(subject, '[0-9]{4,}', '••••••', 'g'), updated_at = now()
 WHERE kind = 'code' AND subject ~ '[0-9]{4,}';

DO $$
DECLARE left_over int;
BEGIN
  SELECT count(*) INTO left_over FROM keystone.document_email_log WHERE kind = 'code' AND subject ~ '[0-9]{4,}';
  IF left_over > 0 THEN RAISE EXCEPTION '0774: % code email(s) still show digits', left_over; END IF;
END $$;

ALTER TABLE keystone.document_email_log FORCE ROW LEVEL SECURITY;
