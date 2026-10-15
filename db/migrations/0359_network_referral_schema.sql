-- 0359_network_referral_schema
-- Network: referral and data release records with consent enforcement.
--
-- ★★ REFERRAL + RELEASE RECORD. When one practice refers a person to another network party
--    (referral partner, vendor, school, provider), this table records what person was referred,
--    to which party, what data was shared, and CRITICALLY — the consent record that authorized
--    the release. A release without recorded consent is REFUSED AT THE DATABASE LEVEL via NOT NULL
--    foreign key: every row MUST have a valid consent_record_id.
--
-- ★ TENANT-SCOPED WITH FORCE ROW LEVEL SECURITY, following every other table in the schema.

CREATE TABLE keystone.network_referral (
  id                         uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id                  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  referred_person_id         uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  receiving_network_party_id uuid        NOT NULL REFERENCES keystone.network_party(id) ON DELETE RESTRICT,
  data_released              text        NOT NULL,
  consent_record_id          uuid        NOT NULL REFERENCES keystone.consent_record(id) ON DELETE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX network_referral_tenant_idx ON keystone.network_referral (tenant_id);
CREATE INDEX network_referral_person_idx ON keystone.network_referral (referred_person_id);
CREATE INDEX network_referral_party_idx ON keystone.network_referral (receiving_network_party_id);
CREATE INDEX network_referral_consent_idx ON keystone.network_referral (consent_record_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: ENABLE and FORCE
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.network_referral ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.network_referral FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.network_referral
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.network_referral
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON keystone.network_referral TO app_rw;

-- ★ Prove FORCE RLS is on (same safety check as every other table).
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.network_referral'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0359: FORCE ROW LEVEL SECURITY was not enabled on keystone.network_referral';
  END IF;
END
$$;
