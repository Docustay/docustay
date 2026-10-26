-- 0042_email_delivery_snapshot
-- P18.2 — ★★★ A SENT EMAIL MUST BE SHOWABLE LATER. §P4.9: TEMPLATES READ LIVE, A SEND SNAPSHOTS.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY A SNAPSHOT COLUMN AND NOT "JUST RE-RENDER IT".
--     A template is editable and terminology is per-tenant configurable, so re-rendering an old message
--     shows **what the template says today**, not what the person received. For a booking reminder that
--     is merely wrong; for anything about money, a document, or a session it is a support conversation
--     nobody can win — "we sent you X" against a screen that now says Y.
--   ★★ THIS IS THE SAME RULE AS §M0 LAW 3, one subsystem over. An executed instrument freezes its price,
--      its terms AND its disclosure version; a sent message freezes its subject, its body and **the
--      terminology it resolved**. In both cases the frozen copy is the record, and the live object is
--      only the thing that produced it.
--
-- ★ `notification_delivery` already existed (0016) with status/provider/provider_response/error. What it
--   could not do is say WHAT WAS SENT.
ALTER TABLE keystone.notification_delivery
  ADD COLUMN rendered jsonb;

COMMENT ON COLUMN keystone.notification_delivery.rendered IS
  'P18.2 — WHAT WAS ACTUALLY SENT: {subject, text, terms, template, template_version}. Frozen at send '
  'time. Re-rendering the template later shows what it says TODAY, which is not what the person got.';

-- ★★★ AND A `sent` ROW WITHOUT ONE IS REFUSED. Otherwise the column is optional in practice and the
--     first path that forgets it produces a delivery nobody can reconstruct — which is indistinguishable
--     from never having sent anything, and is the failure shape this project keeps meeting.
--   ★ `attempted` and `failed` rows may have no snapshot: a send that never rendered has nothing to
--     freeze, and forcing one would mean inventing content for a message that does not exist.
--   ★★ `delivered` is included because it is a LATER state of the same row — a provider webhook
--      upgrading `sent` to `delivered` must not be able to arrive at a snapshot-less delivered row.
ALTER TABLE keystone.notification_delivery
  ADD CONSTRAINT delivery_sent_carries_its_snapshot
  CHECK (
    status NOT IN ('sent', 'delivered')
    OR (rendered IS NOT NULL AND rendered ? 'subject' AND rendered ? 'text')
  );

-- ★★ AND A `failed` ROW MUST SAY WHY. §P18.2: "A send failure must be RECORDED, never inferred from
--    silence." A `failed` row with a NULL `error` is silence wearing a status — the reader knows only
--    that something went wrong, which is the half of the information that does not help.
ALTER TABLE keystone.notification_delivery
  ADD CONSTRAINT delivery_failure_states_its_reason
  CHECK (status <> 'failed' OR (error IS NOT NULL AND length(btrim(error)) > 0));

-- ★ A completed row (sent/delivered/failed/skipped) has a completion time; an `attempted` one does not
--   yet. Without this, `completed_at` drifts into being decorative and "how long did that take" becomes
--   unanswerable for exactly the sends somebody is investigating.
ALTER TABLE keystone.notification_delivery
  ADD CONSTRAINT delivery_completion_time_matches_status
  CHECK (
    (status = 'attempted' AND completed_at IS NULL)
    OR (status <> 'attempted' AND completed_at IS NOT NULL)
  );
