-- 0065 — THE PER-TENANT CONFIGURATION STORE. P1.1, AND FOUR BACKLOG ITEMS HAVE BEEN WAITING ON IT.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE PREREQUISITE NOBODY NAMED. [MEASURED 2026-09-14, RECON.5 §5] `keystone.tenant` has NINE
--     columns and exactly ONE of them — `timezone` — is configuration. There is no per-tenant
--     settings store of any kind: no JSONB column, no table, nothing. And FOUR separate backlog
--     items each assume one exists:
--         item 4  · the terminology store        (P1.5)
--         item 5  · tenant branding upload       (P6.61)
--         item 10 · Keystone's own billing tier  (P6.69)
--         and every `/settings/*` nav row in P6 — EIGHT of which have no table at all.
--     ★★ Naming it once is cheaper than discovering it four times, which is what RECON.5 §5 said
--        and what this migration finally acts on.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE SHAPE/SET SPLIT, COPIED DELIBERATELY FROM THE TOPIC CATALOGUE. This project already
--     settled how a closed vocabulary is enforced, at 0016 and restated at 0023, 0054 and 0064:
--         event_topic_check       CHECK (topic ~ '…')                ← a SHAPE, in the database
--         TOPICS in src/events/…  the closed SET, asserted by a gate  ← a LIST, in code
--     `tenant_setting.key` follows it exactly: the DATABASE enforces the shape
--     (`section.name`, lowercase, two segments) and `SETTING_KEYS` in
--     `src/settings/keys.mjs` holds the closed set, asserted by `db/gates/setting-catalogue.mjs`.
--   ★★ WHY NOT AN ENUMERATED CHECK ON THE KEY: adding a setting would then be a MIGRATION, and
--      settings are the one thing a tenant-facing product adds constantly. The topic catalogue made
--      the opposite call for the opposite reason — an event topic is a contract with consumers, a
--      setting is not. ★ The two are different on purpose and the difference is written down here
--      so nobody "fixes" one to match the other.
--
-- ★★★ WHY `value jsonb` AND NOT `text`. A setting is a brand colour, a boolean, a phone number and a
--     nested booking rule. `jsonb` holds all four without a second column per type, and the SHAPE of
--     each key's value is validated in `src/settings/keys.mjs` beside the key that owns it — one
--     place, not a column per kind.
--   ★ NOT NULL: a key that exists with no value is indistinguishable from an unset key, and "unset"
--     is already expressible by the row's absence. Two ways to say nothing is one too many.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE keystone.tenant_setting (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★ THE SHAPE, NOT THE SET. Two lowercase segments: `practice.name`, `branding.logo_url`.
  --   The closed set is SETTING_KEYS in src/settings/keys.mjs, asserted by a gate.
  key text NOT NULL
    CONSTRAINT tenant_setting_key_shape
    CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),

  value jsonb NOT NULL,

  -- ★★ WHO CHANGED IT. A settings table with no actor cannot answer "who turned this off", which is
  --    the first question asked the morning after something stops working.
  updated_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ★★ ONE ROW PER KEY PER TENANT. Without this, "the" value of a setting is whichever row a query
--    happened to return first — the same defect as two catalogues holding one price.
--  ★ Leads with tenant_id because uniqueness checks BYPASS RLS (0001:135-139).
CREATE UNIQUE INDEX tenant_setting_tenant_key_key ON keystone.tenant_setting (tenant_id, key);

CREATE TRIGGER tenant_setting_touch BEFORE UPDATE ON keystone.tenant_setting
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- RLS — ENABLE **AND** FORCE, three policies, exactly as every other tenant-scoped table.
--   ★★ FORCE matters here specifically: settings are read by privileged paths (provisioning, the
--      worker), and FORCE is what stops a table OWNER from reading across tenants by accident.
--   ★ `tenant_update` is not optional. A setting is UPDATEd on its hot path far more often than it is
--      inserted — a missing update policy would expose it exactly where it matters, which is the
--      note 0061 already wrote for `campaign`.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.tenant_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_setting FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.tenant_setting
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.tenant_setting
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.tenant_setting
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.tenant_setting TO app_rw;

COMMENT ON TABLE keystone.tenant_setting IS
  'P1.1 — the per-tenant configuration store. Added at 0065 because keystone.tenant had NINE columns '
  'and exactly one (timezone) was configuration, while FOUR backlog items each assumed a settings '
  'store existed: the terminology store, tenant branding, Keystone''s own billing tier, and eight '
  '/settings/* nav rows with no table. ★ The KEY SHAPE is enforced here; the closed KEY SET lives in '
  'SETTING_KEYS in src/settings/keys.mjs and is asserted by db/gates/setting-catalogue.mjs — the same '
  'shape/set split the topic catalogue uses, for the opposite reason: a topic is a contract with '
  'consumers so adding one is a migration, a setting is not.';

COMMENT ON COLUMN keystone.tenant_setting.value IS
  'jsonb, NOT NULL. One column for booleans, colours, phone numbers and nested booking rules; the '
  'per-key value shape is validated in src/settings/keys.mjs beside the key that owns it. ★ NOT NULL '
  'because a key present with no value is indistinguishable from an unset key, and absence already '
  'says that.';
