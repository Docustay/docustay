-- 0265_a_discount_is_a_saved_reusable_definition
-- Spec 02 (Items) §3, task 2.1. Reuses the shape ~/example-rebuild/BUILD-UI.md:3466-3479 (A4.7) already
-- designed, with two additions MOCKUPS §8 needs that A4.7 predates: a required `name` (staff pick a
-- saved discount off a list, per ItemsDiscounts' "saved discounts"), and `coach_may_apply` (MOCKUPS
-- §8:257,265 — "who can apply" / "coaches only if the discount allows them" — A4.7 has no such
-- column). `code` changes from A4.7's NOT NULL to nullable, because MOCKUPS §8:257 calls it
-- "optional."

CREATE TABLE keystone.discount (
  id                uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id         uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name              text        NOT NULL,
  code              text,
  kind              text        NOT NULL CHECK (kind IN ('percent','fixed')),
  percent_bp        integer     CHECK (percent_bp BETWEEN 1 AND 10000),
  amount_minor      integer     CHECK (amount_minor > 0),
  currency          text        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  applies_to        text        NOT NULL CHECK (applies_to IN ('service','package','plan','any')),
  coach_may_apply   boolean     NOT NULL DEFAULT false,
  active            boolean     NOT NULL DEFAULT true,
  valid_from        timestamptz,
  valid_to          timestamptz,
  max_redemptions   integer     CHECK (max_redemptions > 0),
  redemption_count  integer     NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discount_kind_shape CHECK (
    (kind = 'percent' AND percent_bp IS NOT NULL AND amount_minor IS NULL AND currency IS NULL) OR
    (kind = 'fixed'   AND amount_minor IS NOT NULL AND currency IS NOT NULL AND percent_bp IS NULL)),
  CONSTRAINT discount_window_shape CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CONSTRAINT discount_redemption_shape CHECK (max_redemptions IS NULL OR redemption_count <= max_redemptions)
);
CREATE UNIQUE INDEX discount_tenant_name_key ON keystone.discount (tenant_id, lower(name));
CREATE UNIQUE INDEX discount_tenant_code_key ON keystone.discount (tenant_id, upper(code)) WHERE code IS NOT NULL;
CREATE INDEX discount_tenant_idx ON keystone.discount (tenant_id);

ALTER TABLE keystone.discount ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.discount FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.discount USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.discount FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.discount TO app_rw;
CREATE TRIGGER discount_touch BEFORE UPDATE ON keystone.discount
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- A discount is never edited into a different kind or amount after it has been used — same posture
-- as `price` (§Z4), enforced at the application layer here (not a trigger, since nothing about
-- `discount` needs the append-only history `price` needs; `active`/`code`/`name`/window/caps may all
-- change, but `kind`/`percent_bp`/`amount_minor`/`currency` do not have an UPDATE route at all in
-- this spec — retiring a discount and creating a new one is the only path to changing its value,
-- which keeps every already-used `line_item.discount_minor` snapshot meaningful.
