-- 0081 — P2.4 · `network_party` GETS ITS FIELDS, AND **THE REFERRAL EDGE**.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE WORST RATIO OF THE SIX OBJECTS, AND THE MOST POINTED GAP. [EXECUTED over `pg_constraint`]
--     `network_party` had **ONE outbound FK (`tenant_id`) and ZERO inbound.** `shell.mjs` sets its
--     `related: []`.
--   ★★★ **THE NETWORK SECTION COULD RECORD THAT A SCHOOL EXISTS AND COULD NEVER RECORD THAT IT SENT
--       YOU ANYBODY.** A referral network whose whole purpose is referrals, and the referral was
--       unrepresentable. [F122]
--
-- ★★ `referred by` WAS ABSENT FROM **BOTH ENDS**, and they are two different edges:
--     · person → PERSON   `app_user.referred_by_id` — P2.1's 0076 added it. A client who brought a
--       friend.
--     · person → PARTY    added HERE. A school, a clinic, a probation officer who sent somebody in.
--   ★★★ THEY ARE NOT INTERCHANGEABLE AND MUST NOT BE MERGED INTO ONE POLYMORPHIC COLUMN. "Who
--       referred this person" has two possible KINDS of answer, and a single `referred_by_id` with a
--       `referred_by_type` discriminator would be the polymorphic-parent pattern this project has
--       already flagged twice (`line_item`, `custom_field_value`) — with no FK possible on either
--       branch. **Two nullable columns, each with a real foreign key, say the same thing and are
--       checkable.** A CHECK below refuses both being set at once.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.network_party
  -- ★ The human at the other end. A party is an organisation; somebody answers the phone.
  ADD COLUMN contact_person text,
  ADD COLUMN email   text,
  ADD COLUMN phone   text,
  ADD COLUMN website text,

  ADD COLUMN address_line1 text,
  ADD COLUMN address_line2 text,
  ADD COLUMN city          text,
  ADD COLUMN state_region  text,
  ADD COLUMN postcode      text,
  ADD COLUMN country       text,

  ADD COLUMN notes text,
  -- ★ Ownership, the same axis every other object got at P1.4. `network_party` is declared
  --   un-ownable in `src/permissions/ownership.mjs` ("the referral network is the practice's, not a
  --   caseload's") — the column records WHO LOOKS AFTER THE RELATIONSHIP, which is a different
  --   question from who may read it, and P1.7's predicate is unaffected.
  ADD COLUMN owner_user_id uuid,

  -- ★★ `active`, not deleted. A school you no longer take referrals from is a fact about the past
  --    that every historical referral still points at — P2.9 rules archive-not-delete and this is
  --    an early instance of it.
  ADD COLUMN active boolean NOT NULL DEFAULT true,

  -- ★ Is there a signed agreement with this party, and which instrument is it? The BOOLEAN is not
  --   redundant beside the id: a practice can know an agreement exists before the document has been
  --   loaded into Keystone, and forcing them to lie either way is worse than two columns.
  ADD COLUMN agreement_on_file boolean NOT NULL DEFAULT false,
  ADD COLUMN agreement_document_id uuid,

  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN created_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX network_party_tenant_id_key ON keystone.network_party (tenant_id, id);

ALTER TABLE keystone.network_party ADD CONSTRAINT network_party_owner_fkey
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (owner_user_id);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ THE REFERRAL EDGE — the thing this item exists for.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.app_user
  ADD COLUMN referred_by_party_id uuid;

ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_referred_by_party_fkey
  FOREIGN KEY (tenant_id, referred_by_party_id) REFERENCES keystone.network_party (tenant_id, id)
  ON DELETE SET NULL (referred_by_party_id);

-- ★★ ONE SOURCE OF A REFERRAL, NOT TWO. A person was sent by a PERSON or by a PARTY; both at once
--    is not a richer record, it is two answers to one question and the screen would have to pick.
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_one_referrer
  CHECK (referred_by_id IS NULL OR referred_by_party_id IS NULL);

-- ★ The index the OTHER end needs: "who did this school send us?" — the question that was
--   unanswerable, and the reason `related: []` is about to stop being empty.
CREATE INDEX app_user_referred_by_party_idx
  ON keystone.app_user (tenant_id, referred_by_party_id)
  WHERE referred_by_party_id IS NOT NULL;

COMMENT ON COLUMN keystone.app_user.referred_by_party_id IS
  'P2.4 — the school/clinic/officer who sent this person in. ★★★ Before 0081 `network_party` had '
  'ZERO inbound foreign keys: the Network section could record that a school EXISTS and could never '
  'record that it sent you anybody. [F122] ★ Kept SEPARATE from `referred_by_id` (person → person) '
  'rather than merged into a polymorphic column, so both branches keep a real FK; '
  '`app_user_one_referrer` refuses both being set at once.';

COMMENT ON COLUMN keystone.network_party.active IS
  'P2.4 — ARCHIVE, NOT DELETE. A party you no longer take referrals from is a fact about the past '
  'that every historical referral still points at. P2.9 rules the pattern; this is an early instance.';
