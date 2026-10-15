-- 0269_an_item_may_require_its_agreement_before_it_can_be_bought
-- Spec 02 (Items) §3, task 2.1 — ItemsAttachAgreement link table.

CREATE TABLE keystone.item_agreement_requirement (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★ POLYMORPHIC, no FK on (item_type, item_id) — the same shape keystone.price
  --   (subject_type/subject_id, PRICE_SUBJECTS) and line_item (source_type/source_id) already use
  --   for "one of three catalogue tables," validated in application code, not the database.
  item_type   text        NOT NULL CHECK (item_type IN ('service','package','plan')),
  item_id     uuid        NOT NULL,
  template_id uuid        NOT NULL REFERENCES keystone.document_template(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- ★ ONE REQUIRED AGREEMENT PER ITEM. Presence of the row IS "required" — MOCKUPS shows this as a
  --   single on/off toggle (§8:260), not a list of optional vs. required agreements per item.
  UNIQUE (tenant_id, item_type, item_id)
);
CREATE INDEX item_agreement_requirement_template_idx ON keystone.item_agreement_requirement (tenant_id, template_id);

ALTER TABLE keystone.item_agreement_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.item_agreement_requirement FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.item_agreement_requirement USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.item_agreement_requirement FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.item_agreement_requirement TO app_rw;
CREATE TRIGGER item_agreement_requirement_touch BEFORE UPDATE ON keystone.item_agreement_requirement
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- template_id must reference a builder = 'contract' template — checked in the write function
-- (src/items/agreements.mjs, new), not the database, because document_template.builder already has
-- its own CHECK and duplicating "is this a contract" as a second constraint on a different table is
-- the two-places-the-same-fact-can-drift shape CLAUDE.md's failure #3 warns about; one read at write
-- time is enough.
