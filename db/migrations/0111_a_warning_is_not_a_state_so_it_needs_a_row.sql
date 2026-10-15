-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P8.8 — THE LEDGER THAT STOPS THE EXPIRY WARNING FIRING EVERY SIXTY SECONDS.
--
-- ★★★ A WARNING IS NOT A STATE THE SUBJECT HAS, AND THAT IS THE WHOLE REASON THIS TABLE EXISTS.
--     Every other fact in `src/time/due.mjs` is idempotent because its action CHANGES THE ROW it
--     found: an expired entitlement stops being `active`, a lapsed document stops being `sent`, a
--     pruned rate-limit window stops existing. The `expiring` warning changes nothing — the
--     entitlement is still active, still has the same date, and is still within the window
--     tomorrow. **So the sweep would find it again on the next pass, and the next, and send the same
--     client the same warning every sixty seconds for a week.**
--   ★★ That is not a hypothetical: the sweep is enqueued from `sweep_tenants`, which the runner
--      fires on a 60s timer. Seven days of warning window is ~10,000 notifications per entitlement.
--
-- ★ SO THE FACT "WE TOLD THEM" GETS A ROW. `NOT EXISTS (… entitlement_warned …)` in the predicate is
--   what makes it fire once, and the PRIMARY KEY makes a second insert impossible even if two
--   sweeps race.
--
-- ★★ IT IS DELIBERATELY NOT A `warned_at` COLUMN ON `entitlement`. A nullable timestamp on the
--    subject would work for exactly one kind of warning and would have to be joined by another the
--    day a second one is added — and `entitlement` is a row about what somebody BOUGHT, not a place
--    to keep notes about what we have sent them. The ledger generalises; a column does not.
--   ★ `kind` is there for that second warning. Today only `expiring` is written, and the PK keys on
--     it so "we warned them it was expiring" and a future "we warned them it was nearly used up"
--     are independent facts rather than one flag that can only be set once.
--
-- ★★★ `ON DELETE CASCADE` — when the entitlement goes, so does the record of having warned about
--     it. This is a note about a live thing, not an audit trail; the audit trail is the EVENT, which
--     is in `keystone.event` and outlives everything. A ledger row surviving its subject would block
--     a re-issued entitlement from ever warning.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keystone.entitlement_warned (
  tenant_id      uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  entitlement_id uuid        NOT NULL REFERENCES keystone.entitlement(id) ON DELETE CASCADE,
  kind           text        NOT NULL DEFAULT 'expiring'
                   CHECK (kind IN ('expiring')),
  warned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entitlement_id, kind)
);

COMMENT ON TABLE keystone.entitlement_warned IS
  'P8.8. One row per warning actually sent. Exists because a warning changes nothing on its subject, so without it the due-sweep re-sends the same warning on every 60s pass.';

ALTER TABLE keystone.entitlement_warned ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.entitlement_warned FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.entitlement_warned
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.entitlement_warned
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.entitlement_warned
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- ★ `app_rw` ONLY, and NOT `app_worker` — checked rather than copied from a guess. [MEASURED
--   2026-09-15] `keystone.entitlement` itself grants to `app_owner` and `app_rw` and nothing else.
--   The worker reaches tenant tables through `withTenant()`, which uses the APP pool; the separate
--   `app_worker` role is for graphile's own queue tables and `list_active_tenant_ids()`. Granting it
--   here would widen a role for no caller — the P1 defect recorded in migration 0106's own title.
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.entitlement_warned TO app_rw;
