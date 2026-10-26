-- 0773 — a one-time code is never readable in the email log (R13-D405, 23 Oct 2026).
-- The log of email about documents is shown to the workspace (Settings > Email events, its CSV, a document's Emails tab, GET /api/documents/email-events).
-- A signer's verification email kept its subject as sent ("227422 is your code for …"), so the sender could read a code meant to prove the signer
-- controls their own inbox. New rows are masked when written (src/documents/emailLog.mjs maskSubject); this masks the rows written before.
UPDATE keystone.document_email_log
   SET subject = regexp_replace(subject, '[0-9]{4,}', '••••••', 'g'), updated_at = now()
 WHERE kind = 'code' AND subject ~ '[0-9]{4,}';
