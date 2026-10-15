-- 0080 — P2.3 · `account` GETS ITS CANONICAL FIELDS, AND AN IN-TENANT LINK TO PEOPLE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ [MEASURED] `account` HAS SEVEN COLUMNS, AND **NEVER LINKS TO `app_user`**. It reaches people
--     only through `customer_tenant_id → tenant.id` — so **there is no way to say "this person
--     belongs to this account" inside the operating tenant at all.**
--
-- ★★★ TWO DIFFERENT RELATIONS, AND THEY MUST NOT MERGE. THIS IS THE WHOLE CARE OF THIS MIGRATION.
--   · `customer_tenant_id` is the **PLATFORM** relation: this account IS another tenant, and §A3
--     rules **"counts, never names"** across that boundary (the mockup says it too, at
--     `crm-mockup.html:906-909` — *"Counts only. Never names"*). 0007/0008 exist to enforce it: the
--     seat-count definer returns five integers precisely so no name can travel back.
--   · The link added here is **IN-TENANT**: people in THIS practice who belong to this account —
--     the buyer, the billing contact, the person who answers the phone.
--   ★★ They look alike and they are opposites. Merging them — a join that walks from `account`
--      through `customer_tenant_id` into the other tenant's `app_user` — would breach the platform
--      boundary through a relation added for a different purpose, and it would look like a feature.
--   ★ Every FK below is **composite on `tenant_id`**, which makes that breach unrepresentable rather
--     than merely discouraged: an `account_contact` row cannot name a person outside its own tenant.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.account
  -- ★ The practice's own reference for this account. Free text: numbering schemes are a business
  --   decision (prefixes, years, branch codes) and a generated one would be wrong for most.
  ADD COLUMN account_number text,

  -- ★★ A parent account — holding companies, franchise groups, a school district over its schools.
  --    Composite self-FK, and `ON DELETE SET NULL (parent_account_id)` per-column: F144's lesson,
  --    applied without having to rediscover it.
  ADD COLUMN parent_account_id uuid,

  ADD COLUMN account_type text
    CONSTRAINT account_type_check
    CHECK (account_type IS NULL OR account_type IN ('prospect', 'customer', 'partner', 'vendor', 'other')),
  ADD COLUMN industry text,

  -- ★★★ THE IN-TENANT PRIMARY CONTACT. See the header: this is a person in THIS practice, never a
  --     name reached across the platform boundary.
  ADD COLUMN primary_contact_id uuid,

  ADD COLUMN phone   text,
  ADD COLUMN email   text,
  ADD COLUMN website text,

  -- ★ Billing address, separate from anything a person has. An account is billed where the ORGANISATION
  --   is, which is routinely not where its contact lives.
  ADD COLUMN billing_line1 text,
  ADD COLUMN billing_line2 text,
  ADD COLUMN billing_city  text,
  ADD COLUMN billing_state_region text,
  ADD COLUMN billing_postcode text,
  ADD COLUMN billing_country  text,

  ADD COLUMN employee_count integer
    CONSTRAINT account_employee_count_sane CHECK (employee_count IS NULL OR employee_count >= 0),
  ADD COLUMN description text,
  ADD COLUMN source text,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN created_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX account_tenant_id_key ON keystone.account (tenant_id, id);

ALTER TABLE keystone.account ADD CONSTRAINT account_parent_fkey
  FOREIGN KEY (tenant_id, parent_account_id) REFERENCES keystone.account (tenant_id, id)
  ON DELETE SET NULL (parent_account_id);

-- ★★★ COMPOSITE, AND THIS IS THE ONE THAT MATTERS. Without `tenant_id` in the key, an account in
--     tenant A could name a primary contact in tenant B — which is exactly the platform-boundary
--     breach the header is about, arriving through the door marked "contact".
ALTER TABLE keystone.account ADD CONSTRAINT account_primary_contact_fkey
  FOREIGN KEY (tenant_id, primary_contact_id) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (primary_contact_id);

CREATE INDEX account_parent_idx ON keystone.account (tenant_id, parent_account_id);

-- ★★ A team of contacts, not just one. A real account has a buyer, a billing contact and somebody
--    who answers the phone, and collapsing them into `primary_contact_id` alone is how a CRM ends
--    up with three accounts for one organisation.
CREATE TABLE keystone.account_contact (
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  app_user_id uuid NOT NULL,
  -- ★ What they do for this account. Free text for the same reason `guardian.relationship` is:
  --   nothing branches on it, and a CHECK would be a list to maintain for a displayed word.
  role_at_account text,
  added_by uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, account_id, app_user_id),
  CONSTRAINT account_contact_account_fkey
    FOREIGN KEY (tenant_id, account_id) REFERENCES keystone.account (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT account_contact_user_fkey
    FOREIGN KEY (tenant_id, app_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX account_contact_user_idx ON keystone.account_contact (tenant_id, app_user_id);

ALTER TABLE keystone.account_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.account_contact FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.account_contact
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.account_contact
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.account_contact
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.account_contact TO app_rw;

COMMENT ON TABLE keystone.account_contact IS
  'P2.3 — people in THIS tenant who belong to an account. ★★★ NOT the platform relation: '
  '`account.customer_tenant_id` says this account IS another tenant, and §A3 rules "counts, never '
  'names" across that boundary. These two look alike and are opposites. ★ Both FKs are composite on '
  'tenant_id, which makes the breach UNREPRESENTABLE rather than merely discouraged.';

COMMENT ON COLUMN keystone.account.primary_contact_id IS
  'P2.3 — an in-tenant person. ★★ Composite FK on (tenant_id, primary_contact_id): without it an '
  'account in tenant A could name a contact in tenant B, which is the platform-boundary breach '
  'arriving through the door marked "contact".';
