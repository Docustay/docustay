-- 0729 · Launch step 3 (13 Oct 2026): the welcome series for a new Docustay account — one row per account owner, nothing else. `step` is the last email handled (-1 none, 0 welcome, 1/2/3 the day-1/3/6 mails; a step the person had
-- already done is handled by being skipped, never sent). `last_sent_at` is what keeps it to at most one email a day. `opted_out_at` is the Account switch and the one-click unsubscribe link; a person who opted out is never mailed again.
-- Additive and idempotent. Holds no email text and no address (the address is read from app_user at send time).
CREATE TABLE IF NOT EXISTS keystone.docustay_welcome (
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  lang         text        NOT NULL DEFAULT 'en' CHECK (lang ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'),
  step         smallint    NOT NULL DEFAULT -1 CHECK (step BETWEEN -1 AND 3),
  last_sent_at timestamptz,
  opted_out_at timestamptz,
  finished_at  timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);
ALTER TABLE keystone.docustay_welcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.docustay_welcome FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON keystone.docustay_welcome;
CREATE POLICY tenant_isolation ON keystone.docustay_welcome USING (tenant_id = keystone.current_tenant_id()) WITH CHECK (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON keystone.docustay_welcome TO app_rw;
