-- 0003_idempotency_and_limits
-- P1.15 idempotency · P1.14 rate-limit counters
--
-- ★ Both tables are tenant-scoped and carry the same ENABLE + FORCE + policy treatment as every
-- other table, because P1.8's catalog gate asserts it on EVERY table in the schema — including
-- infrastructure tables. Infrastructure is not exempt from tenancy: an idempotency key is
-- request content, and a rate-limit counter reveals a tenant's traffic shape.

-- ─────────────────────────────────────────────────────────────────────────────
-- P1.15 — IDEMPOTENCY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.idempotency_key (
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  key            text        NOT NULL,
  -- ★ The request FINGERPRINT. Replaying a key with a DIFFERENT body is a client bug and must be
  -- a 409, not a silent return of the first response. Without this, "retry with the same key"
  -- and "reuse a key for a different operation" are indistinguishable.
  request_fingerprint text  NOT NULL,
  state          text        NOT NULL DEFAULT 'in_flight'
                   CHECK (state IN ('in_flight','succeeded','failed')),
  -- The STORED REPLAY. A retry after success must return the original response, not re-execute.
  response_status integer,
  response_body   jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,

  -- ★★ (tenant_id, key) — SCOPED, never a global unique on `key`. A global key space would let
  -- one tenant's chosen key collide with another's, which both leaks existence (via the
  -- violation) and lets tenant A block tenant B's request by guessing a key. This is the same
  -- rule as UNIQUE (tenant_id, …) elsewhere, and it leads with tenant_id so P1.8's index check
  -- passes for the right reason.
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX idempotency_key_created_idx ON keystone.idempotency_key (created_at);

COMMENT ON TABLE keystone.idempotency_key IS
  'P1.15. (tenant_id,key) scoped — never a global key space. Stores the replay so a retry returns the original response instead of re-executing.';

ALTER TABLE keystone.idempotency_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.idempotency_key FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.idempotency_key
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.idempotency_key
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.idempotency_key
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- P1.14 — RATE LIMIT COUNTERS (per tenant)
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixed-window counters. ★ Per-IP limiting is NOT stored here — it is deliberately in-process
-- (see src/http/rateLimit.mjs) because an unauthenticated flood must be rejected BEFORE it costs
-- a database round trip. A per-IP limiter that queries Postgres is an amplifier, not a limiter.
CREATE TABLE keystone.rate_limit_window (
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, bucket, window_start)
);

COMMENT ON TABLE keystone.rate_limit_window IS
  'P1.14 per-tenant fixed-window counters. Per-IP limiting is in-process on purpose — a per-IP limiter that hits the DB amplifies the flood it exists to stop.';

ALTER TABLE keystone.rate_limit_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.rate_limit_window FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.rate_limit_window
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.rate_limit_window
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.rate_limit_window
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.idempotency_key   TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.rate_limit_window TO app_rw;
