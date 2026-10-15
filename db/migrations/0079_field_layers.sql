-- 0079 — P2.2 · THE THIRD FIELD LAYER: a tenant's OWN fields.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE THREE LAYERS, RULED BY TY, AND ONLY ONE OF THEM NEEDS A TABLE:
--   1. **FIXED** — the canonical base (P2.1's 0076). Every tenant, not removable. It is CODE: real
--      columns, declared in `src/records/shell.mjs`'s panels. A row in a table could be deleted;
--      a column cannot, which is exactly what "not removable" has to mean.
--   2. **TEMPLATE** — the vertical add-ons. Also real columns (0076 shipped the recovery four), but
--      a tenant SELECTS which packs apply. That selection is one setting, not a table.
--   3. **CUSTOM** — a tenant's own. **This is the only layer with unbounded, per-tenant shape**, so
--      it is the only one that gets storage.
--
-- ★★ THAT SPLIT IS THE POINT OF THE MODEL, NOT AN IMPLEMENTATION DETAIL. It is what lets ONE schema
--    serve sixteen verticals without becoming generic: the base does the work, a vertical differs by
--    about four fields, and the long tail is per-tenant. ★ Putting the base in a table too would make
--    every practice's schema an opinion, and a column that "every tenant has" would be a row that
--    somebody can delete.
--
-- ★★★ VALUES ARE POLYMORPHIC BY RECORD TYPE, AND THE PARENT IS NOT FOREIGN-KEYED — a deliberate,
--     recorded weakness. `custom_field_value` points at (record_type, record_id) and Postgres cannot
--     FK that. ★ P2.7 does exactly this work for `line_item`'s polymorphic parent; this table is the
--     second instance and **must be swept when P2.7 rules the pattern**. Until then the CHECK below
--     at least constrains the type to the record types that exist.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.custom_field (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★ Which object the field hangs off. The same closed vocabulary the permission axis uses, so a
  --   custom field cannot exist for something nobody can be granted access to.
  record_type text NOT NULL
    CONSTRAINT custom_field_record_type_check
    CHECK (record_type IN ('person', 'account', 'network_party', 'engagement', 'document', 'invoice')),

  -- ★★ IDENTIFIER / LABEL, the same split as `role` and `team`. Code and stored values key on `key`;
  --    the practice renames `label` freely. P4's bucket rule, third table running.
  key text NOT NULL
    CONSTRAINT custom_field_key_shape CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  label text NOT NULL
    CONSTRAINT custom_field_label_present CHECK (btrim(label) <> ''),

  -- ★ A closed set of kinds. The renderer switches on this, so an unknown kind is a field that
  --   draws as nothing — the blank-cell defect P2.1 already met once.
  kind text NOT NULL
    CONSTRAINT custom_field_kind_check CHECK (kind IN ('text', 'number', 'date', 'boolean', 'select')),

  -- ★★ Only meaningful for `select`, and the CHECK says so rather than leaving a dangling array on
  --    every text field. A `select` with no options is a control with nothing to pick.
  options text[] NOT NULL DEFAULT '{}'
    CONSTRAINT custom_field_options_shape
    CHECK ((kind = 'select' AND array_length(options, 1) >= 1)
           OR (kind <> 'select' AND options = '{}')),

  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ★ Leads with tenant_id: uniqueness checks BYPASS RLS (0001:135-139).
CREATE UNIQUE INDEX custom_field_tenant_type_key_key
  ON keystone.custom_field (tenant_id, record_type, key);
CREATE UNIQUE INDEX custom_field_tenant_id_key ON keystone.custom_field (tenant_id, id);

CREATE TRIGGER custom_field_touch BEFORE UPDATE ON keystone.custom_field
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

CREATE TABLE keystone.custom_field_value (
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  field_id uuid NOT NULL,
  -- ★★ THE POLYMORPHIC PARENT. See the header: no FK is possible, and P2.7 owns the pattern.
  record_id uuid NOT NULL,
  value jsonb,
  updated_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, field_id, record_id),
  -- ★ Composite, for the reason every cross-row FK in this schema is: RLS does not police foreign
  --   keys, so a value in tenant A could otherwise name a field in tenant B.
  CONSTRAINT custom_field_value_field_fkey
    FOREIGN KEY (tenant_id, field_id) REFERENCES keystone.custom_field (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX custom_field_value_record_idx ON keystone.custom_field_value (tenant_id, record_id);

ALTER TABLE keystone.custom_field       ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.custom_field       FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.custom_field_value ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.custom_field_value FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.custom_field
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.custom_field
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.custom_field
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_isolation ON keystone.custom_field_value
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.custom_field_value
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.custom_field_value
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.custom_field       TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.custom_field_value TO app_rw;

COMMENT ON TABLE keystone.custom_field IS
  'P2.2 — the CUSTOM layer, and the only one of the three that needs a table. FIXED is code (real '
  'columns — a row can be deleted, a column cannot, which is what "not removable" has to mean) and '
  'TEMPLATE is a per-tenant SELECTION of vertical packs, held in one setting. ★ This is what lets '
  'one schema serve sixteen verticals without becoming generic.';
