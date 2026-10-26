-- 0004_provisioning
-- P2.2 provisioning state machine · P2.3 forward-only · P2.4 idempotency per provider
--
-- ★★ FORWARD-ONLY WITH A DESIGNED PARTIAL STATE. §P2. Compensation exists but is invoked ONLY
-- DELIBERATELY, never as an automatic reaction — and the measured reason is that the vendors
-- cannot be rolled back cleanly:
--     Twenty     — workspace delete is SOFT ONLY and holds the subdomain FOREVER
--     Documenso  — NO DELETE API AT ALL
--     Stripe     — customer delete is PERMANENT, on a LIVE account
-- ★ "Automatic rollback turns one stuck step into six."
--
-- ★★ THE CRITICAL PREFIX. The organisation + admin user step is all-or-nothing and LOCAL, so it
-- is a real transaction. Everything after it is a remote call that CANNOT join that transaction.
-- The design consequence: a run may legitimately sit half-finished, and that state is a first-
-- class thing the schema represents — not an error to be cleaned up.

-- ─────────────────────────────────────────────────────────────────────────────
-- The run
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.provisioning_run (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  -- ★ NULLABLE on purpose: the run EXISTS BEFORE THE TENANT DOES. The very first step is what
  -- creates the tenant. A NOT NULL here would make it impossible to record that step failing —
  -- which is precisely the failure you most need a record of.
  requested_slug text      NOT NULL,
  requested_name text      NOT NULL,
  state        text        NOT NULL DEFAULT 'running'
                 CHECK (state IN ('running','succeeded','partial','failed')),
  -- ★ 'partial' is NOT a synonym for 'failed'. It means: the critical prefix committed, the tenant
  -- is REAL and usable, and one or more suffix steps are pending or need a human. Conflating the
  -- two is how a working tenant gets "cleaned up".
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX provisioning_run_state_idx ON keystone.provisioning_run (state, created_at);
CREATE UNIQUE INDEX provisioning_run_slug_active_idx
  ON keystone.provisioning_run (lower(requested_slug))
  WHERE state IN ('running','partial');
-- ★ Two concurrent signups for the same subdomain must not both proceed. Partial-unique so a
-- FAILED run does not permanently reserve a name the customer may retry with.

-- ─────────────────────────────────────────────────────────────────────────────
-- The steps
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.provisioning_step (
  id            uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  run_id        uuid        NOT NULL REFERENCES keystone.provisioning_run(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  ordinal       integer     NOT NULL,
  -- ★ Steps are either part of the all-or-nothing critical PREFIX, or of the SUFFIX where a
  -- partial state is acceptable and a human step does no harm.
  segment       text        NOT NULL CHECK (segment IN ('prefix','suffix')),
  state         text        NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending','running','succeeded','failed','awaiting_human','skipped')),
  -- ★ 'awaiting_human' is a FIRST-CLASS STATE, not a failure. Documenso's step is manual BY
  -- DESIGN: [MEAS] all 12 team-router and 17 organisation-router openapi metas are commented
  -- out, and createTeamRoute requires a session, not an API key. A step that can only be done by
  -- a person is not an error, and must never be retried in a loop.
  attempts      integer     NOT NULL DEFAULT 0,
  max_attempts  integer     NOT NULL DEFAULT 5,
  -- ★ The vendor's own identifier, captured the moment it is known. THIS is what makes
  -- `already_exists` recoverable: on a retry after a timeout, find() looks the object up and
  -- writes the id here rather than creating a second one.
  external_id   text,
  external_ref  text,
  last_error    text,
  -- ★ Retryability is stored, not recomputed from a message string at read time. It is decided
  -- once, by the error taxonomy (P1.13), at the moment of failure.
  last_error_retryable boolean,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (run_id, name)
);

CREATE INDEX provisioning_step_run_idx ON keystone.provisioning_step (run_id, ordinal);

COMMENT ON COLUMN keystone.provisioning_step.state IS
  'awaiting_human is a first-class state, not a failure — Documenso has no create-team API.';
COMMENT ON COLUMN keystone.provisioning_step.external_id IS
  'Captured as soon as known. This is what makes already_exists recoverable via find() instead of creating a duplicate.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — ★ these tables are tenant-scoped but tenant_id may be NULL before the tenant exists
-- ─────────────────────────────────────────────────────────────────────────────
-- ★★ THE PREDICATE MUST HANDLE THE NULL CASE EXPLICITLY. `tenant_id = current_tenant_id()` is
-- NULL when tenant_id is NULL, which is NOT TRUE — so a pre-tenant run row would be invisible to
-- everyone including the process that just created it. The platform-level provisioning surface
-- reads these rows through a privileged path (Super Admin 1, P2.16), never as a tenant.
ALTER TABLE keystone.provisioning_run  ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.provisioning_run  FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.provisioning_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.provisioning_step FORCE  ROW LEVEL SECURITY;

-- A tenant may read its OWN provisioning history (the onboarding checklist, P2.12) and nothing else.
CREATE POLICY tenant_isolation ON keystone.provisioning_run
  USING (tenant_id IS NOT NULL AND tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_isolation ON keystone.provisioning_step
  USING (EXISTS (
    SELECT 1 FROM keystone.provisioning_run r
     WHERE r.id = keystone.provisioning_step.run_id
       AND r.tenant_id IS NOT NULL
       AND r.tenant_id = keystone.current_tenant_id()
  ));

CREATE TRIGGER provisioning_run_touch BEFORE UPDATE ON keystone.provisioning_run
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.provisioning_run  TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.provisioning_step TO app_rw;
