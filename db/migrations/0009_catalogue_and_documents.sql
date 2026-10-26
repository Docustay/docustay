-- 0009_catalogue_and_documents
-- P5.7 Items and services (§A4) · P5.8 Documents shell (§A5)
--
-- ★★ §A4's four words are FOUR THINGS, and the plan is explicit that they must never collapse:
--     Service      — priced, has a DURATION, has a BOOKABLE switch
--     Package      — services bundled and sold as one item, with a VALIDITY WINDOW
--     Plan         — a recurring price DEFINITION
--     Subscription — ONE CLIENT on ONE PLAN. ★ "Deliberately a different word from Plan so the
--                    two never read as the same page."
-- ★ Every tenant creates their own. Nothing here is GLRS-specific; the Run tiers are simply
-- plans GLRS happens to sell.

-- ─────────────────────────────────────────────────────────────────────────────
-- SERVICE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.service (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name          text        NOT NULL,
  -- ★ Money in MINOR UNITS as an integer. Never a float — 0.1 + 0.2 is not 0.3, and an invoice
  -- that is a cent out is a conversation with a client about whether we can count.
  price_minor   integer     NOT NULL CHECK (price_minor >= 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- ★ §A4: "Booking reads duration and deliverer."
  duration_minutes integer  NOT NULL CHECK (duration_minutes > 0),
  -- ★★ §A4: "Turning booking off removes the slot and LEAVES EXISTING APPOINTMENTS ALONE."
  -- So this is a switch on the CATALOGUE ITEM, never a cascade onto booked appointments.
  bookable      boolean     NOT NULL DEFAULT true,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX service_tenant_name_key ON keystone.service (tenant_id, lower(name));
CREATE INDEX service_tenant_idx ON keystone.service (tenant_id);

COMMENT ON COLUMN keystone.service.bookable IS
  '§A4 — turning this off removes the SLOT and leaves existing appointments alone. Never cascade.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PACKAGE — services bundled, sold as one item, with a validity window
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.package (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name          text        NOT NULL,
  price_minor   integer     NOT NULL CHECK (price_minor >= 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  -- ★ The validity WINDOW, not an expiry date: a package bought today and one bought in March
  -- must expire on different days, so the window is a duration, resolved per purchase.
  validity_days integer     CHECK (validity_days IS NULL OR validity_days > 0),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX package_tenant_name_key ON keystone.package (tenant_id, lower(name));
CREATE INDEX package_tenant_idx ON keystone.package (tenant_id);

CREATE TABLE keystone.package_line (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  package_id    uuid        NOT NULL REFERENCES keystone.package(id) ON DELETE CASCADE,
  service_id    uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE RESTRICT,
  -- ★ "Sessions draw down the package balance" — so a line carries a QUANTITY, and the balance
  -- is quantity minus what has been drawn.
  quantity      integer     NOT NULL CHECK (quantity > 0),
  UNIQUE (tenant_id, package_id, service_id)
);
CREATE INDEX package_line_tenant_idx ON keystone.package_line (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- PLAN — a recurring price DEFINITION.  ★ NOT a subscription.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.plan (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name          text        NOT NULL,
  price_minor   integer     NOT NULL CHECK (price_minor >= 0),
  currency      text        NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  interval      text        NOT NULL CHECK (interval IN ('week','month','quarter','year')),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan_tenant_name_key ON keystone.plan (tenant_id, lower(name));
CREATE INDEX plan_tenant_idx ON keystone.plan (tenant_id);

COMMENT ON TABLE keystone.plan IS
  '§A4 — a recurring price DEFINITION. Family coaching and the Run tiers are both plans. A plan is NOT a subscription; see keystone.subscription.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SUBSCRIPTION — ONE client on ONE plan. ★ Lives under Money, not under Items.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.subscription (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  plan_id       uuid        NOT NULL REFERENCES keystone.plan(id) ON DELETE RESTRICT,
  -- ★ ONE client. The singular is the point — §A4 keeps the words apart so the two never read as
  -- the same page, and the schema keeps them apart so they cannot BE the same page.
  app_user_id   uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  state         text        NOT NULL DEFAULT 'active'
                  CHECK (state IN ('active','paused','cancelled','past_due')),
  started_on    date        NOT NULL DEFAULT current_date,
  cancelled_on  date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- ★ One active subscription per (client, plan). A partial index so a CANCELLED one does not
  -- block re-subscribing — a client who leaves and returns is a normal story.
  CONSTRAINT subscription_cancelled_shape CHECK (
    (state = 'cancelled' AND cancelled_on IS NOT NULL) OR
    (state <> 'cancelled' AND cancelled_on IS NULL)
  )
);
CREATE UNIQUE INDEX subscription_tenant_active_key
  ON keystone.subscription (tenant_id, app_user_id, plan_id)
  WHERE state <> 'cancelled';
CREATE INDEX subscription_tenant_idx ON keystone.subscription (tenant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- P5.8 — DOCUMENTS: TWO BUILDERS, and PIPELINE replaces "awaiting signature"
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ §A5: "The contract builder and the form builder are SEPARATE tools with SEPARATE template
-- sets." So `builder` is on the TEMPLATE and is immutable in spirit — a contract template can
-- never become a form template, because they are made by different tools with different rules.
CREATE TABLE keystone.document_template (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  builder       text        NOT NULL CHECK (builder IN ('contract','form')),
  name          text        NOT NULL,
  version       integer     NOT NULL DEFAULT 1 CHECK (version > 0),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX document_template_tenant_key
  ON keystone.document_template (tenant_id, builder, lower(name), version);
CREATE INDEX document_template_tenant_idx ON keystone.document_template (tenant_id);

-- ★★★ PIPELINE = "everything in motion, contracts and forms together, because the question is
-- 'what is out', not 'what needs a signature'." So the state machine is about MOTION, and
-- `executed` is a terminal state rather than a separate table.
CREATE TABLE keystone.document_instance (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  template_id   uuid        REFERENCES keystone.document_template(id) ON DELETE RESTRICT,
  builder       text        NOT NULL CHECK (builder IN ('contract','form')),
  subject_user_id uuid      REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  state         text        NOT NULL DEFAULT 'draft'
                  CHECK (state IN ('draft','sent','partially_signed','executed','declined','void')),
  -- ★ The frozen copy, built by buildTemplateSnapshot (P4.9) — terminology resolved INTO it at
  -- SEND, never at render. A signed instrument says the same words forever.
  template_snapshot jsonb,
  sent_at       timestamptz,
  executed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- ★★ HARD LIMIT 3 lives here. An executed instrument must carry its snapshot and its timestamp;
  -- a state that claims execution without the frozen words is not evidence of anything.
  CONSTRAINT executed_shape CHECK (
    state <> 'executed' OR (template_snapshot IS NOT NULL AND executed_at IS NOT NULL)
  ),
  CONSTRAINT sent_shape CHECK (state = 'draft' OR sent_at IS NOT NULL)
);
CREATE INDEX document_instance_tenant_idx ON keystone.document_instance (tenant_id);
-- ★ The PIPELINE query: everything in motion, both builders together.
CREATE INDEX document_instance_pipeline_idx ON keystone.document_instance (tenant_id, state)
  WHERE state IN ('sent','partially_signed');

COMMENT ON TABLE keystone.document_instance IS
  '§A5 — Pipeline is everything in motion, contracts and forms TOGETHER: the question is "what is out", not "what needs a signature". executed is a terminal state, not a separate table.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS on all of it (P1.7). The catalog gate will assert it whether or not it is remembered here.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service','package','package_line','plan','subscription',
                           'document_template','document_instance'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

CREATE TRIGGER service_touch  BEFORE UPDATE ON keystone.service
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER package_touch  BEFORE UPDATE ON keystone.package
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER plan_touch     BEFORE UPDATE ON keystone.plan
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER subscription_touch BEFORE UPDATE ON keystone.subscription
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER document_template_touch BEFORE UPDATE ON keystone.document_template
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
CREATE TRIGGER document_instance_touch BEFORE UPDATE ON keystone.document_instance
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();
