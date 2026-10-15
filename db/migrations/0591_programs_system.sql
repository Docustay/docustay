-- 0591 · PROGRAMS AS ONE SYSTEM (QUEUE §4, the maintainer 2 Oct 2026). Purely additive (expand); `coaching_group` is dropped in 0592 after the code stopped reading it.
--  · program.colour               — a named hex colour shown on chips, calendar and lists
--  · person_program               — which programs a person (client OR team member) belongs to; a person may be in several
--  · document_template.labels     — Documents' OWN generic labels ("used for"); empty = used for everyone. the platform maps programs/client types onto them.
--  · line_item_program / booking_program / subscription_program — a program is DERIVED for bookings/invoices/subscriptions (never stored twice)
--  · report_revenue_by_program    — invoiced + paid by program by month; the rounding remainder lands on the first line so the programs ALWAYS add to the practice total

ALTER TABLE keystone.program ADD COLUMN IF NOT EXISTS colour text NULL
  CONSTRAINT program_colour_hex CHECK (colour IS NULL OR colour ~ '^#[0-9a-fA-F]{6}$');

CREATE TABLE keystone.person_program (
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  person_id  uuid        NOT NULL,
  program_id uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, person_id, program_id),
  FOREIGN KEY (tenant_id, person_id)  REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, program_id) REFERENCES keystone.program (tenant_id, id)  ON DELETE CASCADE
);
CREATE INDEX person_program_by_program ON keystone.person_program (tenant_id, program_id);
ALTER TABLE keystone.person_program ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.person_program FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.person_program USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.person_program FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.person_program FOR DELETE USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, DELETE ON keystone.person_program TO app_rw;
GRANT SELECT ON keystone.person_program TO app_worker;

ALTER TABLE keystone.document_template ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN keystone.document_template.labels IS
  '0591: Documents'' own generic "used for" labels. Empty = used for everyone. The host maps programs / client types onto labels through the front door; Documents never names a program.';

-- ── derived program ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW keystone.line_item_program WITH (security_invoker = true) AS
  SELECT li.id AS line_item_id, li.tenant_id, li.invoice_id,
         coalesce(s.program_id, p.program_id, pl.program_id) AS program_id
    FROM keystone.line_item li
    LEFT JOIN keystone.service s  ON s.id  = li.service_id
    LEFT JOIN keystone.package p  ON p.id  = li.package_id
    LEFT JOIN keystone.plan    pl ON pl.id = li.plan_id;

CREATE OR REPLACE VIEW keystone.booking_program WITH (security_invoker = true) AS
  SELECT b.id AS booking_id, b.tenant_id, s.program_id
    FROM keystone.booking b LEFT JOIN keystone.service s ON s.id = b.service_id;

CREATE OR REPLACE VIEW keystone.subscription_program WITH (security_invoker = true) AS
  SELECT sub.id AS subscription_id, sub.tenant_id, pl.program_id
    FROM keystone.subscription sub LEFT JOIN keystone.plan pl ON pl.id = sub.plan_id;

-- ── revenue by program ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW keystone.report_revenue_by_program WITH (security_invoker = true) AS
WITH lines AS (
  SELECT li.invoice_id, lp.program_id, li.position, li.id AS line_id,
         greatest(li.unit_amount_minor * li.quantity - li.discount_minor, 0)::numeric AS net
    FROM keystone.line_item li JOIN keystone.line_item_program lp ON lp.line_item_id = li.id
   WHERE li.invoice_id IS NOT NULL
),
inv AS (
  SELECT i.id AS invoice_id, i.tenant_id, i.currency, (date_trunc('month', i.created_at))::date AS month,
         ie.amount_minor, coalesce(ie.paid_minor, 0) AS paid_minor
    FROM keystone.invoice i JOIN keystone.invoice_effective ie ON ie.id = i.id
   WHERE ie.status <> ALL (ARRAY['draft','void'])
),
alloc AS (
  SELECT inv.*, l.program_id, l.line_id, l.position,
         sum(l.net) OVER w AS total_net, l.net,
         row_number() OVER (PARTITION BY inv.invoice_id ORDER BY l.position NULLS LAST, l.line_id) AS rn
    FROM inv JOIN lines l ON l.invoice_id = inv.invoice_id
  WINDOW w AS (PARTITION BY inv.invoice_id)
),
shares AS (
  SELECT a.*,
    CASE WHEN a.total_net = 0 THEN (CASE WHEN a.rn = 1 THEN a.amount_minor ELSE 0 END)
         ELSE round(a.amount_minor * a.net / a.total_net) END AS inv_share,
    CASE WHEN a.total_net = 0 THEN (CASE WHEN a.rn = 1 THEN a.paid_minor ELSE 0 END)
         ELSE round(a.paid_minor * a.net / a.total_net) END AS paid_share
    FROM alloc a
),
fixed AS (
  SELECT s.*,
    s.inv_share  + CASE WHEN s.rn = 1 THEN s.amount_minor - sum(s.inv_share)  OVER (PARTITION BY s.invoice_id) ELSE 0 END AS inv_final,
    s.paid_share + CASE WHEN s.rn = 1 THEN s.paid_minor   - sum(s.paid_share) OVER (PARTITION BY s.invoice_id) ELSE 0 END AS paid_final
    FROM shares s
),
no_lines AS (  -- invoices with no line items still count toward the practice total, under "no program"
  SELECT inv.tenant_id, inv.month, inv.currency, NULL::uuid AS program_id, inv.invoice_id, inv.amount_minor AS inv_final, inv.paid_minor AS paid_final
    FROM inv WHERE NOT EXISTS (SELECT 1 FROM lines l WHERE l.invoice_id = inv.invoice_id)
)
SELECT tenant_id, month, currency, program_id,
       count(DISTINCT invoice_id)::integer AS invoice_count,
       sum(inv_final)::bigint AS invoiced_minor, sum(paid_final)::bigint AS paid_minor
  FROM (
    SELECT tenant_id, month, currency, program_id, invoice_id, inv_final, paid_final FROM fixed
    UNION ALL SELECT * FROM no_lines
  ) u
 GROUP BY tenant_id, month, currency, program_id;
GRANT SELECT ON keystone.line_item_program, keystone.booking_program, keystone.subscription_program, keystone.report_revenue_by_program TO app_rw, app_worker;
