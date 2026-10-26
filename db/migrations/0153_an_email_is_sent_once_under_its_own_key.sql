-- 0153_an_email_is_sent_once_under_its_own_key
-- Stage 4 Task 6 fix round 1 · ruling R66 (review I-3) · spec 02 §2.6 (no double emails) · 07 §4.1a.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE GAP. An email whose outcome is IN DOUBT (our 15 s timeout fired, the connection dropped after the request
--     was written, Resend's edge answered 502/504) could not be retried safely: a retry might be the second email.
--     So it was never retried, and a person had to check Resend's log for every blip.
--
-- ★★ THE FIX (R66). Every send carries `Idempotency-Key: ks-nd-<notification_delivery.id>`. [MEASURED, resend.com
--    docs, 18 Sep 2026] Resend keeps a key 24 h; the same key with the SAME body returns the original email's id and
--    sends nothing; the same key with a DIFFERENT body is refused (409 invalid_idempotent_request). So a retry is
--    safe ONLY if it sends the byte-identical body — which means the body must be STORED at the first attempt and
--    re-used, never re-rendered (a renamed document, a changed display name, an edited template would all drift).
--
-- WHAT THIS ADDS (two nullable columns; no existing row is rewritten):
--   request_body        the exact JSON text sent to Resend, written by the send claim on the FIRST attempt and never
--                       changed after. `text`, not jsonb: jsonb re-orders keys and drops whitespace, and "the same
--                       payload" is judged on the bytes.
--   first_attempted_at  when that first attempt was made. `attempted_at` moves on every claim; this does not. An
--                       in-doubt send is retried only while now() - first_attempted_at < 23 h — an hour inside
--                       Resend's 24 h, so the key is certain to still be held.
-- ★ Rows written before this migration have neither. Such a row in doubt is NOT retried (there is no stored body
--   to send byte-identically, and it was sent without a key): it gives up in doubt exactly as before.
-- ★ Grants and RLS are table-level (0016, FORCE RLS, tenant_isolation); new columns inherit them.

ALTER TABLE keystone.notification_delivery
  ADD COLUMN request_body text,
  ADD COLUMN first_attempted_at timestamptz;

COMMENT ON COLUMN keystone.notification_delivery.request_body IS
  'R66 (0153) — the exact JSON body sent to Resend, stored by the send claim on the FIRST attempt and re-sent '
  'byte-identical on every retry under Idempotency-Key ks-nd-<id>. Never re-rendered: Resend refuses a changed '
  'body under a used key (409 invalid_idempotent_request). NULL on rows written before 0153.';

COMMENT ON COLUMN keystone.notification_delivery.first_attempted_at IS
  'R66 (0153) — when the first attempt at this delivery was made (attempted_at moves on every attempt). An '
  'in-doubt send is retried only within 23 h of this — inside Resend''s 24 h idempotency window.';

-- ★ Every attempt from 0153 on carries both, or neither (a legacy row). Half would mean a key without a body.
ALTER TABLE keystone.notification_delivery
  ADD CONSTRAINT delivery_request_body_has_its_first_attempt
  CHECK ((request_body IS NULL) = (first_attempted_at IS NULL));
