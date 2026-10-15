-- 0155_a_delivery_once_in_doubt_stays_in_doubt
-- Stage 4 Task 6 fix round 2 · review task-6-fix1-review.md I-1 and M-1 · ruling R66 · spec 02 §2.6 (no double emails).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE GAP (I-1). An email's first attempt can be IN DOUBT (Resend took it, our 15 s timer fired). Its retry can
--     then get a DEFINITE failure (a 500 from Resend's own trouble, which does not replay the key). The row became
--     failed, the in-doubt note was overwritten, and a failed row was claimable with no time limit — so a claim
--     more than 24 h after the first attempt (Task 10's "Retry now", a worker outage, a long 429 Retry-After) sent
--     the stored body under a key Resend had FORGOTTEN: a second email.
--
-- ★★ THE FIX. A sticky fact on the row: ever_in_doubt. Set when an attempt's outcome is in doubt, and when the
--    claim takes back an interrupted attempted row (a crash mid-send); NEVER cleared. The send claim then takes a
--    failed/skipped row that was ever in doubt ONLY while it has its stored body and its first attempt is < 23 h
--    old — the same window an attempted row already had. A row that was never in doubt (every attempt a definite
--    failure, or the connection refused so nothing left) stays sendable at any age: Resend never took it.
--
-- ★★ M-1. 0153's CHECK tied the body and its first-attempt time both ways, so Task 12's privacy prune of the body
--    (after the 24 h key window) would have had to erase first_attempted_at too — the window's anchor. It is now
--    one-directional: a stored body needs its first-attempt time; the time may outlive a pruned body.
--
-- WHAT THIS CHANGES
--   · ADD COLUMN ever_in_doubt boolean NOT NULL DEFAULT false — a constant default: catalog-only in PG ≥ 11, no table
--     rewrite. Existing rows read false. ★ A pre-0153 row that was in doubt has no stored body and is already refused
--     by its state (attempted, no body); a pre-0153 failed row that was really a timeout is review M9's, handed to
--     Task 10 — nothing here can tell it apart.
--   · The CHECK is replaced. ★ The new one is weaker than the old, so every existing row satisfies it; the scan is
--     under the ALTER's lock and the table is small (production: 0 rows when last measured).
-- ★ Grants and RLS are table-level (0016, FORCE RLS, tenant_isolation); the new column inherits them.

SET LOCAL lock_timeout = '5s';

ALTER TABLE keystone.notification_delivery
  ADD COLUMN ever_in_doubt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN keystone.notification_delivery.ever_in_doubt IS
  'I-1 (0155) — true once any attempt at this delivery was IN DOUBT (the request may have been accepted: our timeout, '
  'a dropped connection, a 502/504, a 409 under the key, or a send interrupted mid-flight). Never cleared. A row that '
  'was ever in doubt is re-sent only under its stored body within 23 h of first_attempted_at (Resend keeps a key 24 h).';

ALTER TABLE keystone.notification_delivery
  DROP CONSTRAINT delivery_request_body_has_its_first_attempt;

-- ★ A body without its first-attempt time would be a key with no window. The time without a body is a pruned row.
ALTER TABLE keystone.notification_delivery
  ADD CONSTRAINT delivery_request_body_has_its_first_attempt
  CHECK (request_body IS NULL OR first_attempted_at IS NOT NULL);

-- ★ An attempted row existing now is in flight or in doubt; either way it may have gone. Marking it is the safe
--   direction (a row that then completes sent is unaffected). Production held 0 rows when last measured.
UPDATE keystone.notification_delivery SET ever_in_doubt = true WHERE status = 'attempted';
