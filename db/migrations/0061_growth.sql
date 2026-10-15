-- 0061 — GROWTH: `segment` and `campaign`. P20.11, to ADDENDUM 4 §A4.6.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ A LIST IS A SAVED FILTER OVER `app_user`, NOT A SECOND SUBSCRIBER STORE.
--     ADD3-4 and P20.11 both say it, and the reason is the objection this project has already made to
--     Novu, OpenFGA and SpiceDB: **a second store is a second copy of the truth, and it drifts.** A
--     `segment_member` table would start correct and be wrong within a week — somebody's email changes,
--     a client is archived, a parent is added — and the campaign would then be sent to the copy rather
--     than to the practice.
--   ★★ SO `segment.filter` IS A QUERY (jsonb), AND THERE IS DELIBERATELY **NO** `segment_member` TABLE.
--      P20.11's red-first asserts that no such table can be added, and `db/gates/p20_growth.mjs`
--      refuses one BY NAME.
--
-- ★★ AND SENDING WRITES ONE `notification` + ONE `notification_delivery` PER RECIPIENT, through the
--    EXISTING fan-out. "Did it actually send" is already answerable there (P18.2/P18.9 proved that
--    path end-to-end against Resend), so Growth adds no delivery bookkeeping of its own — a second
--    delivery record would be the same drift defect one layer down.

CREATE TABLE keystone.segment (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name text NOT NULL CONSTRAINT segment_name_nonempty CHECK (btrim(name) <> ''),

  -- ★★★ A QUERY, NOT A MEMBERSHIP LIST. Evaluated against `app_user` at SEND time, so the audience is
  --     whatever the practice actually looks like at that moment.
  filter jsonb NOT NULL,

  created_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ★ `lower(name)` so "Active clients" and "active clients" are one segment. Leads with tenant_id
--   because uniqueness checks BYPASS RLS (0001:135-139).
CREATE UNIQUE INDEX segment_tenant_name_key ON keystone.segment (tenant_id, lower(name));

CREATE TRIGGER segment_touch BEFORE UPDATE ON keystone.segment
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

CREATE TABLE keystone.campaign (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name text NOT NULL CONSTRAINT campaign_name_nonempty CHECK (btrim(name) <> ''),

  -- ★★ RESTRICT: deleting the segment must not orphan the record of WHO WAS TARGETED. A sent campaign
  --    pointing at nothing cannot answer "who got this", which is the first question anybody asks.
  segment_id uuid NOT NULL REFERENCES keystone.segment(id) ON DELETE RESTRICT,

  subject text NOT NULL CONSTRAINT campaign_subject_nonempty CHECK (btrim(subject) <> ''),
  body text NOT NULL CONSTRAINT campaign_body_nonempty CHECK (btrim(body) <> ''),

  state text NOT NULL DEFAULT 'draft' CONSTRAINT campaign_state_check
    CHECK (state IN ('draft','sending','sent','failed')),
  sent_at timestamptz,
  sent_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,

  -- ★★★ `recipient_count` IS FROZEN AT SEND, and that is the point of storing it at all. The segment is
  --     a QUERY, so re-evaluating it next month gives a different number — and "how many people got
  --     this" must not change after the fact. It is the one thing about a send that a saved filter
  --     cannot reconstruct.
  recipient_count integer CONSTRAINT campaign_recipient_count_check CHECK (recipient_count >= 0),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaign_sent_shape CHECK (
    (state = 'sent' AND sent_at IS NOT NULL AND recipient_count IS NOT NULL) OR
    (state <> 'sent' AND sent_at IS NULL))
);

CREATE UNIQUE INDEX campaign_tenant_name_key ON keystone.campaign (tenant_id, lower(name));

CREATE TRIGGER campaign_touch BEFORE UPDATE ON keystone.campaign
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- RLS — ENABLE + FORCE + all THREE policies, per ADDENDUM 4's ★ about 0016 omitting tenant_update.
-- A campaign is UPDATEd on its hot path (draft → sending → sent), so a missing tenant_update would
-- expose it exactly where it matters.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['segment','campaign']
  LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON keystone.%I FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON keystone.%I FOR UPDATE USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.require_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

COMMENT ON COLUMN keystone.segment.filter IS
  'ADD3-4 / P20.11 — ★★★ A QUERY, NOT A MEMBERSHIP LIST, evaluated against app_user at SEND time. '
  'There is deliberately NO segment_member table: a second subscriber store is a second copy of the '
  'truth that drifts — the objection already made to Novu, OpenFGA and SpiceDB. It would start correct '
  'and be wrong within a week, and the campaign would then be sent to the copy rather than to the '
  'practice.';

COMMENT ON COLUMN keystone.campaign.recipient_count IS
  'FROZEN AT SEND, and that is why it is stored at all. The segment is a QUERY, so re-evaluating it '
  'next month gives a different number — and "how many people got this" must not change after the '
  'fact. It is the one thing about a send that a saved filter cannot reconstruct.';

COMMENT ON CONSTRAINT campaign_sent_shape ON keystone.campaign IS
  'A campaign claiming to be sent must carry WHEN and TO HOW MANY. ★ And a campaign that is NOT sent '
  'must have no sent_at: a timestamp on a draft is a send nobody can find.';
