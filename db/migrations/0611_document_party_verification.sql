-- 0611 · CHECK WHO IS SIGNING (QUEUE §23.5.2). A send can ask each person for an email code (6 digits mailed to them) or an access code (set by the sender, shared out of band) before the document opens.
-- ★ Only HASHES are stored: the emailed code's sha256 (with an expiry) here, the access code's scrypt hash inside the send options. After five wrong tries the person is locked for 15 minutes.
ALTER TABLE keystone.document_party
  ADD COLUMN verified_at           timestamptz NULL,
  ADD COLUMN verify_code_hash      text        NULL,
  ADD COLUMN verify_code_expires_at timestamptz NULL,
  ADD COLUMN verify_code_sent_at   timestamptz NULL,
  ADD COLUMN verify_attempts       integer     NOT NULL DEFAULT 0 CHECK (verify_attempts >= 0),
  ADD COLUMN verify_locked_until   timestamptz NULL;
