-- 0648 · Docustay pricing follow-up (6 Oct 2026): one number per workspace per day — how many people who sign in to send or manage (never a signer) the workspace had. Count and date only: no names, no emails.
-- It exists so the 30-to-60-day review can see real seats per workspace before anyone decides whether seats should ever be priced. Nothing reads it to charge or to limit. Additive and idempotent.
CREATE TABLE IF NOT EXISTS keystone.docustay_seat_day (
  tenant_id  uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  day        date        NOT NULL,
  seat_count integer     NOT NULL CHECK (seat_count >= 0),
  logged_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day)
);
ALTER TABLE keystone.docustay_seat_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_seat_day FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_seat_day;
CREATE POLICY tenant_isolation ON keystone.docustay_seat_day USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.docustay_seat_day TO app_rw;
