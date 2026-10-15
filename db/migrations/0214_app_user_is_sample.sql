-- 0214_app_user_is_sample
-- Stage 7 task 9.4 — Q9-3: `is_sample` lives on `keystone.app_user` only; everything else derives.
--
-- ★ Adds `is_sample boolean NOT NULL DEFAULT false` to `keystone.app_user`, so a person can be
--   flagged as a sample/fixture the practice explores with (MOCKUPS §21:596-598). `emit()`
--   (`src/events/outbox.mjs`) reads this in the same transaction to derive `keystone.event.sample`
--   for events about that person, instead of relying on every caller to pass `sample` explicitly
--   (F3 of the Task 8 review, carried from Stage 3).
--
-- ★ Production effect (MEASURED 21 Sep 2026): `keystone.app_user` has 3 rows, 47 columns, no
--   `is_sample` anywhere in the database. All 3 rows are real staff, so `DEFAULT false` is the
--   correct value for every existing row — this is a purely additive ALTER, never destructive.
--   A `NOT NULL DEFAULT false` add on 3 rows is instant (constant default, no per-row rewrite scan
--   needed beyond the metadata change Postgres does for this exact shape).
--
-- ★ `keystone.app_user` is owned by `app_owner` (0001_platform_skeleton.sql:122 — no `SET LOCAL
--   ROLE` precedes its CREATE TABLE, unlike `keystone_auth.session`), and `db/migrate.mjs` runs
--   every file as `app_owner`, so no role switch is needed here.
--
-- ★ No new RLS policy: the column joins a table that already has ENABLE + FORCE ROW LEVEL SECURITY
--   (0001:151-152) under `tenant_isolation` (0001:160), which already covers every column. No
--   grant change: `app_rw` already holds SELECT/INSERT/UPDATE/DELETE on this table (0001:190).
--
-- ★ The partial index (`WHERE is_sample`) keeps "list this tenant's sample people" cheap without
--   indexing the far larger set of real rows, matching the shape of every other tenant-scoped
--   partial index in this schema.

ALTER TABLE keystone.app_user
  ADD COLUMN is_sample boolean NOT NULL DEFAULT false;

CREATE INDEX app_user_is_sample_idx ON keystone.app_user (tenant_id, is_sample) WHERE is_sample;

COMMENT ON COLUMN keystone.app_user.is_sample IS
  'True for a fixture/sample person created for a practice to explore the product with. Read by keystone.event.sample derivation at emit() (src/events/outbox.mjs); never set by a client-facing login (sample people have no portal session, MOCKUPS §21).';
