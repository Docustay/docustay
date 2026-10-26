-- 0398_waitlist_preference_demand_claim — Stage 13 task 13.3 · CT-F31
--
-- A waitlist row says WHEN suits the person, can be a client-expressed demand row (kind='demand',
-- written by the client app, F15 §2.3), and remembers the claim link it was sent (claim_token_id →
-- keystone.link_token, purpose 'waitlist_claim', already seeded by 0315). This migration is
-- schema-only: it widens booking_waitlist_entry's `kind` register and adds the preference +
-- claim-token columns 13.12/13.13/13.14 read and write. The claim link's own security shape —
-- single-use via `redeemed_at`, unguessable HMAC-digested secret, tenant-blind lookup at redemption,
-- short TTL — is entirely the existing keystone.link_token machinery (CT-018, 0169/0170) and 0315's
-- 'waitlist_claim' purpose (2-hour window, per 0314's header comment); nothing here changes it.
--
-- ★ 0314/0315 are NOT touched by this migration — only booking_waitlist_entry's kind CHECK is
--   widened (drop + recreate, same idiom 0203/0309/0315 already use for link_token.purpose) and new
--   nullable columns are added alongside it.

ALTER TABLE keystone.booking_waitlist_entry DROP CONSTRAINT booking_waitlist_entry_kind_check;
ALTER TABLE keystone.booking_waitlist_entry ADD CONSTRAINT booking_waitlist_entry_kind_check
  CHECK (kind IN ('slot', 'coach_request', 'demand'));
ALTER TABLE keystone.booking_waitlist_entry
  ADD COLUMN preference text NOT NULL DEFAULT 'flexible'
    CONSTRAINT booking_waitlist_entry_preference_check
      CHECK (preference IN ('evenings', 'mornings', 'weekends', 'flexible', 'specific')),
  ADD COLUMN preference_note text NULL
    CONSTRAINT booking_waitlist_entry_preference_note_length
      CHECK (preference_note IS NULL OR char_length(preference_note) <= 200),
  ADD COLUMN preference_days smallint[] NULL
    CONSTRAINT booking_waitlist_entry_preference_days_range
      CHECK (preference_days IS NULL OR preference_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  ADD COLUMN claim_token_id uuid NULL REFERENCES keystone.link_token (id) ON DELETE SET NULL;
CREATE INDEX booking_waitlist_entry_demand_idx
  ON keystone.booking_waitlist_entry (tenant_id, preference) WHERE status = 'waiting';
COMMENT ON COLUMN keystone.booking_waitlist_entry.preference IS
  'Stage 13. When suits them — the Waitlist frame chip. demand rows (kind=demand) are written by the client app (F15 §2.3) and read by F14 §2.4.';
