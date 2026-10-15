-- 0006_accounts_and_network
-- P5.3 Accounts vs Network · P5.5 COUNTS NEVER NAMES · P5.6 three pipelines
--
-- ★★★ §A3: "WHAT WE SEE OF AN ACCOUNT'S PEOPLE: COUNTS, NEVER NAMES. Their CLIENT records are
-- their tenant's data — we hold a count for seat billing and nothing else. ★ THIS IS A TENANCY
-- BOUNDARY, NOT A UI CHOICE."
--
-- ★★ So it is enforced HERE, in the schema and the view, not by omitting a column in a component.
-- §K3: hiding a field renders nothing unreachable. If the only thing standing between us and
-- another tenant's client names is a React component, then anyone with the raw API has the names.

-- ─────────────────────────────────────────────────────────────────────────────
-- P5.3 — ACCOUNT and NETWORK_PARTY are DIFFERENT TABLES, not one table with a flag
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ §A1 retires `Organizations` because it "meant both and therefore neither". A single table
-- with `kind IN ('account','network')` would re-create exactly that ambiguity in the schema —
-- every query would have to remember the filter, and the one that forgets bills a school.
CREATE TABLE keystone.account (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name         text        NOT NULL,
  -- ★ The account's OWN tenant, when it is a Keystone customer. This is the seat-billing link,
  -- and the ONLY thing we may traverse it for is a COUNT — see the view below.
  customer_tenant_id uuid  REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  status       text        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('prospect','active','paused','closed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_tenant_name_key ON keystone.account (tenant_id, lower(name));
CREATE INDEX account_tenant_idx ON keystone.account (tenant_id);

COMMENT ON TABLE keystone.account IS
  'Organisations that are OUR CUSTOMERS and are billed. NOT the same thing as network_party. §A1 retires the word "Organizations" precisely because it meant both.';

CREATE TABLE keystone.network_party (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name         text        NOT NULL,
  kind         text        NOT NULL
                 CHECK (kind IN ('referral_partner','vendor','school','provider','other')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX network_party_tenant_name_key ON keystone.network_party (tenant_id, lower(name));
CREATE INDEX network_party_tenant_idx ON keystone.network_party (tenant_id);

COMMENT ON TABLE keystone.network_party IS
  'Referral partners, vendors, schools, providers. NOT billed, and NOT an account. §A1.';

-- ─────────────────────────────────────────────────────────────────────────────
-- P5.6 — THREE PIPELINES. Not one with a type column.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ §A3: BUILD is a finite project WITH STAGES. PROVISION fires ONCE. RUN is recurring, has a
-- CLOCK, and has NO STAGES. ★ "A Watch account enters at RUN having never passed through a
-- project" — a single merged pipeline cannot represent that account at all. Collapsing them is a
-- modelling error, not a simplification, so the CHECK constraint makes the illegal states
-- unrepresentable rather than merely discouraged.
CREATE TABLE keystone.account_pipeline (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  account_id   uuid        NOT NULL REFERENCES keystone.account(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('build','provision','run')),
  -- BUILD only: stages. RUN has none, by definition.
  stage        text,
  -- RUN only: the clock.
  cadence      text,
  next_run_at  timestamptz,
  -- PROVISION only: the single run it corresponds to.
  provisioning_run_id uuid REFERENCES keystone.provisioning_run(id) ON DELETE SET NULL,
  state        text        NOT NULL DEFAULT 'active'
                 CHECK (state IN ('active','paused','complete','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- ★★★ THE SHAPES ARE MUTUALLY EXCLUSIVE, ENFORCED. A RUN row carrying a `stage` is the exact
  -- confusion this item exists to prevent, and a comment would not stop it.
  CONSTRAINT pipeline_shape CHECK (
    (kind = 'build'     AND stage IS NOT NULL AND cadence IS NULL     AND provisioning_run_id IS NULL) OR
    (kind = 'run'       AND stage IS NULL     AND cadence IS NOT NULL) OR
    (kind = 'provision' AND stage IS NULL     AND cadence IS NULL)
  )
);
CREATE INDEX account_pipeline_account_idx ON keystone.account_pipeline (account_id, kind);
CREATE INDEX account_pipeline_tenant_idx ON keystone.account_pipeline (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- ★★★ P5.5 — THE COUNTS-ONLY VIEW. The tenancy boundary, in the query.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ `security_invoker = true` — §P1's rule, and it is load-bearing here more than anywhere:
-- a view defaults to running as its OWNER (app_owner), which would hand every caller every
-- tenant's rows. With security_invoker the view runs as the CALLER and RLS applies normally.
--
-- ★★★ AND NOTE WHAT IS NOT SELECTED: no name, no email, no id of any person in the customer's
-- tenant. Only counts. There is no column here that could leak a client's identity, so a
-- component CANNOT accidentally render one and an API caller cannot request one.
CREATE VIEW keystone.account_people_counts
WITH (security_invoker = true) AS
SELECT
  a.id              AS account_id,
  a.tenant_id       AS tenant_id,
  a.name            AS account_name,
  -- seat counts by role, and nothing else
  count(*) FILTER (WHERE u.role = 'staff')             AS staff_seats,
  count(*) FILTER (WHERE u.role = 'adult_client')      AS adult_client_seats,
  count(*) FILTER (WHERE u.role = 'adolescent_client') AS adolescent_client_seats,
  count(*) FILTER (WHERE u.role = 'parent')            AS parent_seats,
  count(u.id)                                          AS total_seats
FROM keystone.account a
LEFT JOIN keystone.app_user u ON u.tenant_id = a.customer_tenant_id
GROUP BY a.id, a.tenant_id, a.name;

COMMENT ON VIEW keystone.account_people_counts IS
  'P5.5 / §A3 — COUNTS, NEVER NAMES. A tenancy boundary, not a UI choice. Selects no name, email or person id from the customer tenant; there is nothing here to leak.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — same treatment as every other table (P1.7). The catalog gate enforces it.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.account           ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.account           FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.network_party     ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.network_party     FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.account_pipeline  ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.account_pipeline  FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.account
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.account
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_isolation ON keystone.network_party
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.network_party
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_isolation ON keystone.account_pipeline
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.account_pipeline
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE TRIGGER account_touch BEFORE UPDATE ON keystone.account
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER network_party_touch BEFORE UPDATE ON keystone.network_party
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.account          TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.network_party    TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.account_pipeline TO app_rw;
GRANT SELECT                         ON keystone.account_people_counts TO app_rw;
