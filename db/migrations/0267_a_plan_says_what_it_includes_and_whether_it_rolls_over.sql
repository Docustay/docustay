-- 0267_a_plan_says_what_it_includes_and_whether_it_rolls_over
-- Spec 02 (Items) §3, task 2.1.

ALTER TABLE keystone.plan
  ADD COLUMN service_id        uuid    REFERENCES keystone.service(id) ON DELETE RESTRICT,
  ADD COLUMN sessions_included integer NOT NULL DEFAULT 0 CHECK (sessions_included >= 0),
  ADD COLUMN rollover_mode     text    NOT NULL DEFAULT 'none' CHECK (rollover_mode IN ('none','cap')),
  ADD COLUMN rollover_cap      integer CHECK (rollover_cap IS NULL OR rollover_cap > 0);

ALTER TABLE keystone.plan ADD CONSTRAINT plan_rollover_shape CHECK (
  (rollover_mode = 'cap'  AND rollover_cap IS NOT NULL) OR
  (rollover_mode = 'none' AND rollover_cap IS NULL));
-- ★ a plan may legitimately grant no sessions at all (a flat access/membership plan) — sessions_included
--   defaults to 0 and needs no service_id. The moment it grants ANY sessions it has to say which
--   service they are sessions OF, or "Session 4 of 12" (A10) has nothing to count against.
ALTER TABLE keystone.plan ADD CONSTRAINT plan_sessions_need_service CHECK (
  sessions_included = 0 OR service_id IS NOT NULL);

-- rollover_mode = 'none' is MOCKUPS §8's "use them or lose them"; 'cap' is "roll over up to a cap."
-- Both read from the EXISTING entitlement.status CHECK, which already includes 'expired'
-- (db/migrations/0015_prices_snapshots_entitlements.sql:188) and the EXISTING due-sweep
-- entitlement_expired (src/time/due.mjs:112-143) that moves an entitlement to that status once
-- expires_at passes — no new job is built for this (spec 02 §7).
