-- 0229_a_practice_answers_once
-- 12-signup-first-run-people.md §3.1 (A3, task 12.3) — `keystone.tenant_intake`.
--
-- One row per tenant, written exactly once by `POST /api/signup/questions`. The PRIMARY KEY on
-- `tenant_id` alone is what makes the route idempotent-by-schema: a second submission for the same
-- tenant hits the PK and the route turns that into 409, not a second row.
--
-- FORCED RLS, `tenant_isolation` on `tenant_id = current_tenant_id()`, same shape as every other
-- tenant-scoped table (CT pattern, unchanged) — one policy, no explicit WITH CHECK, so Postgres
-- reuses the USING expression for the INSERT check too (the row's own `tenant_id` is the primary
-- key here, so that check is exactly "you may only ever write your own row").
--
-- `GRANT SELECT, INSERT ON keystone.tenant_intake TO app_rw` — deliberately NO UPDATE/DELETE grant:
-- the answers are a one-time record of what the practice said at signup, not an editable settings
-- row. A practice that wants to change its coaching type later does that through Settings, a
-- different surface, not by rewriting its own intake history.
--
-- ★ NOTE — this migration does NOT add a `role_permission` seed row for a `tenant_intake.create`
--   action, though 12-signup-first-run-people.md §4 describes one. [MEASURED, 22 Sep 2026, against
--   `src/permissions/assertMay.mjs:41-48`] `keystone.role_permission` holds (tenant_id, role_id,
--   object, verb, scope) rows — a VERB (view/edit/delete) per object, never a dot-named ACTION —
--   and `assertMay`'s NAMED_ACTIONS closed vocabulary (the table that DOES hold dot-named actions,
--   `keystone.role_action`, 0190) does not include `tenant_intake.create` and is not this task's
--   file to extend. `"create"` is not a legal `role_permission.verb` value either. The literal call
--   the spec quotes would therefore either violate this table's own CHECK or throw inside
--   `assertMay` before any query ran. `POST /api/signup/questions` (task 12.3, `src/routes/
--   signup.mjs`) enforces "Owner only" with a direct role check instead — see that route's own
--   comment for the measured reason. Flagged for whoever next touches the permission vocabulary,
--   not silently worked around.

CREATE TABLE keystone.tenant_intake (
  tenant_id                uuid PRIMARY KEY REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  coaching_type            text NOT NULL
    CHECK (coaching_type IN ('life','recovery','health_and_wellness','fitness',
                              'family_and_parenting','career','other')),
  -- 'small' = MOCKUPS' "2-5", 'large' = "more than 5" — stored as a band, not a number, because the
  -- question itself is a band (§21:598) and a band answered as an int invites a false precision
  -- nobody asked.
  team_size                text NOT NULL CHECK (team_size IN ('just_me','small','large')),
  moving_from               text NOT NULL
    CHECK (moving_from IN ('no','carepatron','simplepractice','square','spreadsheet','other')),
  sample_clients_requested boolean NOT NULL,
  submitted_by              uuid NOT NULL REFERENCES keystone.app_user(id) ON DELETE RESTRICT,
  submitted_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE keystone.tenant_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.tenant_intake FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.tenant_intake
  USING (tenant_id = keystone.current_tenant_id());
GRANT SELECT, INSERT ON keystone.tenant_intake TO app_rw;

COMMENT ON TABLE keystone.tenant_intake IS
  '12-signup-first-run-people.md §3.1 — one row per tenant, written exactly once by POST /api/signup/questions. No UPDATE/DELETE grant: this is a one-time record of what the practice said at signup, not an editable settings row.';
