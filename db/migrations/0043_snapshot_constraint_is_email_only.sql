-- 0043_snapshot_constraint_is_email_only
-- P18.2 — ★★★ 0042 PUT AN EMAIL-SHAPED CONSTRAINT ON A TABLE THAT SERVES THREE CHANNELS.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ MY DEFECT, CAUGHT BY AN EXISTING GATE, MEASURED BEFORE BEING FIXED.
--
-- `db/gates/p9_outbox_and_notifications.mjs` and `p9_end_to_end.mjs` both went from green to
-- `GATE ERROR: current transaction is aborted` the moment 0042 landed. [MEASURED] the cause is
-- `delivery_sent_carries_its_snapshot`, which requires `rendered ? 'subject'` on any `sent` row —
-- and `notification_delivery` carries **three channels**, not one:
--
--     CHECK (channel = ANY (ARRAY['in_app', 'email', 'push']))
--
-- ★★ `src/notifications/send.mjs` — the §X6 fan-out, built in PHASE 9 and correct — marks `in_app`
--    and `push` deliveries `sent` with NO `rendered`, because **their content is not a subject and a
--    body.** An in-app notification's text lives on the `notification` row (`title`, `body`); a push
--    payload is assembled by the sender. There is nothing email-shaped to freeze, and demanding a
--    `subject` key of a push row is demanding a field that has no meaning for it.
--
-- ★★★ SO THE CONSTRAINT IS SCOPED, NOT RELAXED — and the distinction matters under hard limit 5.
--     For EMAIL it is byte-for-byte the same requirement it was. What changes is that it stops making
--     a claim about two channels it was never reasoned about. **A constraint that is wrong about its
--     own domain is not a strict constraint; it is a broken one**, and the correct repair is to say
--     which rows it governs.
--   ★ I wrote it unscoped because I was thinking about email and the table's name did not stop me.
--     The gate that stopped me belongs to a phase finished weeks earlier, which is the argument for
--     running the WHOLE suite after every change rather than the gate for the item in hand.
ALTER TABLE keystone.notification_delivery
  DROP CONSTRAINT delivery_sent_carries_its_snapshot;

ALTER TABLE keystone.notification_delivery
  ADD CONSTRAINT delivery_sent_email_carries_its_snapshot
  CHECK (
    channel <> 'email'
    OR status NOT IN ('sent', 'delivered')
    OR (rendered IS NOT NULL AND rendered ? 'subject' AND rendered ? 'text')
  );

COMMENT ON CONSTRAINT delivery_sent_email_carries_its_snapshot ON keystone.notification_delivery IS
  'P18.2 — an EMAIL that reached sent/delivered must carry what was sent. Scoped to email at 0043: '
  'in_app and push deliveries have no subject/text to freeze — their content is on the notification row.';

-- ★★ THE OTHER TWO 0042 CONSTRAINTS STAY UNIVERSAL, and that is deliberate rather than left alone:
--    [MEASURED] `src/notifications/send.mjs:133/143/159` already writes an `error` on every failure and
--    a `completed_at` on every terminal status, so both rules were ALREADY TRUE of the push and in-app
--    paths before 0042 asserted them. A rule the existing code already satisfies is a rule worth
--    keeping for every channel — "a failed delivery says why" is not an email-specific idea.
