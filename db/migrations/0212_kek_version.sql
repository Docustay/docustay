-- ★★★ STAGE 9 TASK 9.2 / CT-063 — THE KEK GENERATION TABLE.
--     `v: 1` on a `src/secrets/envelope.mjs` envelope is a FORMAT version and never changes; it says
--     nothing about WHICH master key wrapped the row's data key. That identifier lives on the storing
--     table's own `kek_version smallint` column (`keystone.webhook_endpoint`, `keystone.google_identity` —
--     both already carry it, `DEFAULT 1 CHECK (kek_version >= 1)`) and this table is what makes "which
--     key opened this row" answerable, and what a future rotation (task 9.12) marks `retired_at` on.
-- ★★ ORDERING, LOAD-BEARING (CONTRACTS.md §0 C-5 / Q0-21; STAGE-9-PLAN.md task 9.2 field 10): this
--    migration must exist BEFORE Stage 8 task 8.3 seals its first `keystone_auth.totp_factor` row,
--    because the fingerprint algorithm changes (sha-256 → HMAC-SHA-256, same task) in the same file and
--    a row sealed under the old algorithm and read under the new one is a fingerprint nobody can prove
--    is the right one. `opus-tester` applies this migration (0212) before 0206 at step 3, even though
--    0206 sorts first numerically.
-- ★ NOT APPLIED BY THIS TASK — written only, per BUILD-PROCESS.md:171. Migrations apply at step 3.
--
-- ★ RLS/GRANTS — copied verbatim from this table's siblings in the same schema, not invented:
--   `keystone_meta.worker_heartbeat` (0127) and `keystone_meta.alert_state` (0128). Like both of them,
--   this table carries NO `tenant_id` (`keystone_meta` is platform-owned, CT-063), gets NO
--   ENABLE/FORCE ROW LEVEL SECURITY (neither sibling does — RLS in this project scopes a table to a
--   tenant, and a platform-owned table has none to scope by), and is protected the same way its
--   siblings are: REVOKE ALL FROM PUBLIC, then a narrow, explicit GRANT. The application reads it
--   (SELECT to app_rw); nothing here grants any role INSERT/UPDATE/DELETE — the one row this task
--   seeds is written by the migration itself, and the rotation write path (task 9.12's re-wrap job)
--   adds its own SECURITY DEFINER function and its own narrow EXECUTE grant when it is built, the same
--   pattern `keystone_meta.worker_beat()` and `keystone_meta.alert_transition()` already use.
CREATE TABLE keystone_meta.kek_version (
  version    smallint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  note       text
);

REVOKE ALL ON keystone_meta.kek_version FROM PUBLIC;
GRANT SELECT ON keystone_meta.kek_version TO app_rw;

-- ★ Safe: no envelope has ever been sealed against a `kek_version` other than 1 (0 sealed rows total
--   on production, MEASURED 21 Sep 2026 — see STAGE-9-PLAN.md task 9.2 field 6). No backfill needed.
INSERT INTO keystone_meta.kek_version (version, note) VALUES (1, 'initial') ON CONFLICT DO NOTHING;
