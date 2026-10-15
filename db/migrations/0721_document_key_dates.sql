-- 0721 · RUN 9, PART 3.4 — the contract repository's key dates (rulings R9-h, R9-i). Additive only.
--  · document_key_date: one row per signed document per KIND (start, end, notice, renewal, value). It is read from the document's own date and amount boxes when the
--    document is sealed (source 'field'); a person can correct any of them (source 'person', corrected_by/corrected_at), and the correction is what is shown. Scribe may
--    propose more once AI is configured (source 'scribe'); until then nothing is guessed. reminded_30_at / reminded_7_at make each renewal reminder go out once (Pro).
--  · document_instance.key_dates_read_at: when the boxes were read. The daily sweep reads any signed document that has none (the documents signed before this table existed).
--  · FORCED row-level security like every island table; the app and the worker read and write inside their tenant.

ALTER TABLE keystone.document_instance ADD COLUMN IF NOT EXISTS key_dates_read_at timestamptz;

CREATE TABLE IF NOT EXISTS keystone.document_key_date (
  id             uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  instance_id    uuid        NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,
  kind           text        NOT NULL CHECK (kind IN ('start', 'end', 'notice', 'renewal', 'value')),
  date_value     date,
  amount_minor   bigint      CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency       text        CHECK (currency IS NULL OR currency ~ '^[a-z]{3}$'),
  source         text        NOT NULL CHECK (source IN ('field', 'scribe', 'person')),
  field_id       text        CHECK (field_id IS NULL OR length(field_id) BETWEEN 1 AND 120),
  label          text        CHECK (label IS NULL OR length(label) <= 200),
  corrected_by   uuid,       -- the person who corrected it (an opaque host id: the island names no host table)
  corrected_at   timestamptz,
  reminded_30_at timestamptz,
  reminded_7_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- a value is an amount, everything else a date; a correction may clear it (both empty means "there is none")
  CONSTRAINT document_key_date_shape CHECK (CASE WHEN kind = 'value' THEN date_value IS NULL ELSE amount_minor IS NULL AND currency IS NULL END),
  CONSTRAINT document_key_date_person CHECK ((source = 'person') = (corrected_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS document_key_date_one_per_kind ON keystone.document_key_date (tenant_id, instance_id, kind);
CREATE INDEX IF NOT EXISTS document_key_date_due ON keystone.document_key_date (tenant_id, kind, date_value) WHERE date_value IS NOT NULL;

ALTER TABLE keystone.document_key_date ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_key_date FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation   ON keystone.document_key_date;
DROP POLICY IF EXISTS tenant_insert      ON keystone.document_key_date;
DROP POLICY IF EXISTS tenant_update      ON keystone.document_key_date;
DROP POLICY IF EXISTS workspace_deletion ON keystone.document_key_date;
-- A signed-in person sees a key date only when they can see its document: the EXISTS reads document_instance under ITS OWN policies (document_is_visible), so the
-- repository never shows a member the dates of a document their team cannot open.
CREATE POLICY tenant_isolation   ON keystone.document_key_date USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NOT NULL
                                   AND EXISTS (SELECT 1 FROM keystone.document_instance i WHERE i.id = document_key_date.instance_id));
CREATE POLICY tenant_insert      ON keystone.document_key_date FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update      ON keystone.document_key_date FOR UPDATE USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NOT NULL
                                   AND EXISTS (SELECT 1 FROM keystone.document_instance i WHERE i.id = document_key_date.instance_id))
                                   WITH CHECK (tenant_id = keystone.current_tenant_id());
-- The worker (no signed-in person) sees only what the renewal reminder needs: notice dates from today to 31 days ahead — read, and stamped as reminded.
DROP POLICY IF EXISTS system_reminder_read  ON keystone.document_key_date;
DROP POLICY IF EXISTS system_reminder_write ON keystone.document_key_date;
CREATE POLICY system_reminder_read  ON keystone.document_key_date FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                      AND kind = 'notice' AND date_value BETWEEN current_date AND current_date + 31);
CREATE POLICY system_reminder_write ON keystone.document_key_date FOR UPDATE USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                      AND kind = 'notice' AND date_value BETWEEN current_date AND current_date + 31)
                                      WITH CHECK (tenant_id = keystone.current_tenant_id() AND kind = 'notice');

-- While the worker reads a document's boxes (its key_dates_read_at still empty) it may see that document's key dates: "add it unless a person already
-- set it" (INSERT … ON CONFLICT DO NOTHING) needs the row to be visible to the one adding it.
DROP POLICY IF EXISTS system_reading ON keystone.document_key_date;
CREATE POLICY system_reading ON keystone.document_key_date FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                               AND EXISTS (SELECT 1 FROM keystone.document_instance i WHERE i.id = document_key_date.instance_id AND i.key_dates_read_at IS NULL));

-- The worker reads a signed document's boxes once, when it is sealed or (for older documents) by the daily sweep: it may see and stamp a signed, unarchived
-- uploaded document whose key dates have not been read yet — nothing else, and only that one column changes in practice (the executed-instrument trigger
-- refuses every column that matters).
DROP POLICY IF EXISTS system_key_dates_read  ON keystone.document_instance;
DROP POLICY IF EXISTS system_key_dates_write ON keystone.document_instance;
-- (an UPDATE's new row must stay visible to the one updating it: "or stamped in this very transaction" — now() is fixed for a transaction — keeps the stamp
--  visible to the worker that sets it and to nobody after)
CREATE POLICY system_key_dates_read  ON keystone.document_instance FOR SELECT USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                       AND builder = 'pdf' AND state = 'executed' AND archived_at IS NULL AND (key_dates_read_at IS NULL OR key_dates_read_at = now()));
CREATE POLICY system_key_dates_write ON keystone.document_instance FOR UPDATE USING (tenant_id = keystone.current_tenant_id() AND keystone.current_user_id() IS NULL
                                       AND builder = 'pdf' AND state = 'executed' AND archived_at IS NULL AND key_dates_read_at IS NULL)
                                       WITH CHECK (tenant_id = keystone.current_tenant_id() AND state = 'executed' AND key_dates_read_at IS NOT NULL);
CREATE POLICY workspace_deletion ON keystone.document_key_date FOR DELETE TO app_owner USING (keystone.workspace_deletion_active(tenant_id));
GRANT SELECT, INSERT, UPDATE ON keystone.document_key_date TO app_rw;
GRANT SELECT, INSERT, UPDATE ON keystone.document_key_date TO app_worker;
DROP TRIGGER IF EXISTS ks_notify_change ON keystone.document_key_date;
CREATE TRIGGER ks_notify_change AFTER INSERT OR DELETE OR UPDATE ON keystone.document_key_date FOR EACH ROW EXECUTE FUNCTION keystone.ks_notify_change('documents');
