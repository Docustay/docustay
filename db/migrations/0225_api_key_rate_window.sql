-- 0225_api_key_rate_window
-- Stage 7 task 7.29 (carried from Stage 5: R-5-17 / scenario A5 / F477) · block extension.
--
-- ★★★ NUMBER NOTE: this migration is NOT sequential with 0182-0201 (Stage 7's own block, fully
-- spent) or with 0202-0224 (Stage 8/9/10b's reserved ranges). It is the block extension named in
-- the maintainer's 21 Sep 2026 decisions file ("old 7 task 7.29 extension: 0225+") and in BUILD-PROCESS.md's
-- migration-number-blocks table. The runner tolerates the 0202-0224 gap (db/migrate.mjs, sorted
-- filename order, no contiguity check) — it applies every un-applied file and skips only what is
-- already applied.
--
-- Every developer-API request a key makes must be counted AGAINST THAT KEY, not against the
-- practice as a whole (keystone.rate_limit_window has no token id — Q5-11 — so every key on a
-- practice would otherwise share one counter, the opposite of this task's positive control).
-- A new `bucket` name is deliberately NOT used: it would widen migration 0166's
-- rate_limit_window_bucket_known CHECK and RATE_BUCKETS (src/http/rateLimit.mjs) together, and
-- this design touches neither.
--
-- No production data check is needed: a new empty table on a database that holds 0 API keys.

CREATE TABLE keystone.api_key_rate_window (
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  token_id     text        NOT NULL CHECK (token_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (tenant_id, token_id, window_start)
);

ALTER TABLE keystone.api_key_rate_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.api_key_rate_window FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.api_key_rate_window
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.api_key_rate_window
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.api_key_rate_window
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.api_key_rate_window TO app_rw;

-- No foreign key to keystone_auth.api_token: app_rw holds no privilege on that table
-- (src/auth/apiToken.mjs:28-29) and a counter for a revoked or deleted key is harmless and swept
-- by the rate_limit_retention due fact (src/time/due.mjs). The tenant scope is the isolation.
