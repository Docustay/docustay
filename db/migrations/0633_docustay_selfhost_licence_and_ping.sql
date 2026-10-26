-- 0633 · PART 29 STEP 3 (A6) — self-hosted Docustay: the Pro licence check and the anonymous usage ping. Both tables live in the PLATFORM organisation's own rows (tenant_id = platform), like every other table.
--  · docustay_install  one row per install, keyed by a random id the install made itself. Counts only — never a document, a name, an email, or an address (the ping route does not log the request address).
--  · docustay_license  a Pro licence: the key is 32 random characters shown ONCE; only its SHA-256 is kept. `install_id` is filled in the first time an install presents the key.
CREATE TABLE IF NOT EXISTS keystone.docustay_install (
  install_id    uuid        NOT NULL,
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  version       text,
  counts        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  pings         integer     NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, install_id),
  CONSTRAINT docustay_install_counts_object CHECK (jsonb_typeof(counts) = 'object')
);
CREATE TABLE IF NOT EXISTS keystone.docustay_license (
  key_hash        text        NOT NULL,
  tenant_id       uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  subscription_id text,
  install_id      uuid,
  plan            text        NOT NULL DEFAULT 'pro' CHECK (plan IN ('pro')),
  expires_at      timestamptz NOT NULL,
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key_hash)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['docustay_install','docustay_license'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON keystone.%I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON keystone.%I USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON keystone.%I TO app_rw, app_worker', t);
  END LOOP;
END $$;
