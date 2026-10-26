-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P8.8 — A SENT DOCUMENT CAN NOW LAPSE. THE TOPIC EXISTED; THE STATE DID NOT.
--
-- ★★★ `documents.document.expired` HAS BEEN IN THE CATALOGUE SINCE P20.3a AND HAS NEVER BEEN
--     EMITTED — `F309`'s third unproduced topic. Its own declaration (`src/events/outbox.mjs:76-85`)
--     explains why it matters better than this comment can: the `sent → executed OR expired` chain
--     was HALF a chain, and the missing half is **the branch that requires nobody to act**. A
--     document that simply lapses emits nothing, so the task "chase the Alvarez signature" has no
--     closer and sits on somebody's screen forever.
--
-- ★★★ AND IT COULD NOT HAVE BEEN EMITTED, WHICH IS THE PART THE FINDING DID NOT SAY. [MEASURED
--     2026-09-15] `document_instance` has **no expiry column of any kind** — its timestamps are
--     `sent_at`, `executed_at`, `created_at`, `updated_at`, `archived_at` — and
--     `document_instance_state_check` permits exactly six states, none of them `expired`. So the
--     gap was not a missing sweep over existing data. There was nothing to sweep and nowhere to
--     record the outcome. **A topic with no column behind it cannot be "wired up"; the fact it
--     reports has to be given somewhere to live first.** This migration is that.
--   ★ Emitting without a state change would also have no idempotency: every sweep would re-find the
--     same overdue document and emit again, forever.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ONLY A `sent` DOCUMENT MAY LAPSE. NOT `partially_signed`. THIS IS A RULING, MADE EXPLICITLY.
--
--     `expired_shape` below refuses any other origin, and the reason is the standing limit that
--     **nothing changes on a signed instrument**. A `partially_signed` document is one where a real
--     person has already put their name to the words in front of them. Letting a clock void that
--     silently would destroy the context of a signature somebody actually gave, with no human in
--     the loop and no record of a decision.
--   ★★ So a half-signed document that goes past its date STAYS `partially_signed` and stays on
--      somebody's list. That is the correct outcome: it needs a person, and the whole point of this
--      feature is to clear the things that DON'T.
--   ★ The narrower rule is also the reversible one. Widening it later is a migration; a signature
--      voided by a sweep that ran last month is not recoverable by anything.
--
-- ★★ `expires_at` IS NULLABLE AND NULL MEANS NEVER LAPSES. Every document that exists today has no
--    expiry, keeps none, and is untouched by this change — the sweep cannot find a row whose
--    `expires_at` is null. The value is set at SEND, from a per-tenant setting, and stored on the
--    row. ★ That is the same shape as `booking.reminder_minutes_before` and `invoice.due_at`: read
--    the setting ONCE, write the resulting moment onto the row, because a row that re-asked the
--    setting at fire time would have its deadline moved by an edit made after the document went
--    out — and the instrument would no longer record what the recipient was told.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.document_instance
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN keystone.document_instance.expires_at IS
  'When an unsigned sent instrument lapses. NULL = never. Set once at send from the tenant setting documents.signature_validity_days; never re-read from the setting afterwards.';

-- ★ Widening a CHECK is additive: every existing row already satisfies the new one, because the new
--   set is a superset of the old. No row is rewritten and nothing is lost.
ALTER TABLE keystone.document_instance DROP CONSTRAINT document_instance_state_check;
ALTER TABLE keystone.document_instance ADD CONSTRAINT document_instance_state_check
  CHECK (state = ANY (ARRAY['draft', 'sent', 'partially_signed', 'executed', 'declined', 'void', 'expired']));

-- ★★★ THE SHAPE OF AN EXPIRED ROW, AND IT IS THE RULING ABOVE WRITTEN AS A CONSTRAINT RATHER THAN
--     AS AN INTENTION IN A SWEEP. A future path that sets `expired` on an executed instrument — or
--     on one with no deadline to have passed — is refused by the database, not by remembering.
ALTER TABLE keystone.document_instance ADD CONSTRAINT expired_shape
  CHECK (state <> 'expired'
         OR (expires_at IS NOT NULL AND executed_at IS NULL AND template_snapshot IS NULL));

-- ★★ A PARTIAL INDEX ON EXACTLY WHAT THE SWEEP ASKS FOR. The sweep runs per tenant on every pass,
--    and the rows it wants are a vanishing fraction of the table — an unsent document has no
--    deadline and an executed one is finished. Indexing the whole column would grow with every
--    document ever sent; this one holds only the instruments still waiting on somebody.
CREATE INDEX IF NOT EXISTS document_instance_awaiting_signature_deadline
  ON keystone.document_instance (tenant_id, expires_at)
  WHERE state = 'sent' AND expires_at IS NOT NULL AND archived_at IS NULL;
