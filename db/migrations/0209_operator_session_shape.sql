-- 0209_operator_session_shape
-- Stage 8 task 8.5 — Q8-3 / CCR-6. A Platform session carries no practice membership (spec 04 §8a)
-- and an operator has no app_user row in any practice (CT-039). `keystone_auth.session.tenant_id`
-- and `.app_user_id` are NOT NULL today (0020:111-113) and Stage 6 (0173) did not touch that —
-- it only ADDED `kind`, `user_agent` and `ip_first_seen` and widened `revoked_reason`. This
-- migration is the one that makes the operator shape possible: both columns become nullable, and
-- the CHECKs make that nullability mean EXACTLY ONE THING, so 'operator' is the only kind that can
-- be practice-less and every other kind is still forced to name a practice and a person.
--
-- ★ `keystone_auth.session` is OWNED BY auth_owner (0020:53, `SET LOCAL ROLE auth_owner` before the
--   CREATE TABLE), and this file runs as app_owner (db/migrate.mjs per-file `SET ROLE app_owner`),
--   a NOINHERIT member of auth_owner (0173 header). ALTER TABLE needs ownership, so the role is
--   switched exactly as 0173 and 0186 do, and put back explicitly — never a bare `RESET ROLE`
--   (F482).
--
-- ★ Production check (EXECUTED, STAGE-8-PLAN.md §11 task 8.5 field 6): 447 session rows, 0 live,
--   `tenant_id` and `app_user_id` non-null on every one. Dropping NOT NULL is catalogue-only in
--   Postgres and does not rewrite the table. The two new CHECKs are validated over existing rows
--   where `kind` is Stage 6's default `'app'` and both columns are non-null, so
--   `(kind = 'operator') = (tenant_id IS NULL)` and `(kind = 'operator') = (app_user_id IS NULL)`
--   both hold for every existing row without a table rewrite.
--
-- ★ What this file does NOT touch: every other column, all four indexes (session_token_id_key,
--   session_live_idx, session_by_uid_idx, session_expiry_idx), the deny_all policy (0020:178), the
--   NOT-FORCE RLS stance (0020:167-176), and keystone.create_session / resolve_session /
--   revoke_sessions_for_uid (0020:221-267) — those resolvers are Stage 6's (CT-022, CT-025,
--   CT-033) and Task 8.9's caller, not this task's. This task only reshapes the table.

SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.session ALTER COLUMN tenant_id   DROP NOT NULL;
ALTER TABLE keystone_auth.session ALTER COLUMN app_user_id DROP NOT NULL;

ALTER TABLE keystone_auth.session
  ADD CONSTRAINT session_operator_has_no_practice
    CHECK ((kind = 'operator') = (tenant_id IS NULL));
ALTER TABLE keystone_auth.session
  ADD CONSTRAINT session_operator_has_no_person
    CHECK ((kind = 'operator') = (app_user_id IS NULL));

COMMENT ON CONSTRAINT session_operator_has_no_practice ON keystone_auth.session IS
  'spec 04 §8a — a Platform session is re-scoped AWAY from every practice. Pointing it at the '
  'platform practice would hand it that practice''s rows through keystone.current_tenant_id(), '
  'which is the exact arrangement §8a replaces.';
COMMENT ON CONSTRAINT session_operator_has_no_person ON keystone_auth.session IS
  'CT-039 — an operator has no app_user row in any practice, so an operator session cannot name '
  'one either. Paired with session_operator_has_no_practice so the nullability introduced by '
  'DROP NOT NULL above means exactly one thing: kind=''operator'', and nothing else, may omit '
  'either column.';

SET LOCAL ROLE app_owner;
