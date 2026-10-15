-- specs/STRIPE-MIRROR.md §3.4 — the `stripe` schema (created by @supabase/stripe-sync-engine's own
-- runMigrations, hooked into db/migrate.mjs right after this file) is NEVER granted to `app_rw`
-- directly: a tenant-scoped request must not be able to reach it even by accident, and the schema
-- itself carries no RLS (it mirrors Stripe's own object shape, which has no concept of a the platform
-- tenant). Instead: a NOLOGIN group role that `app_rw` is a MEMBER of, so
-- `src/money/stripeMirror.mjs#queryMirror` can `SET ROLE app_stripe_mirror` for the duration of one
-- read and nothing else on the request pool ever does.
--
-- ★★★ FOLLOWING 0025/0044's OWN PRECEDENT, NOT A NEW MECHANISM. [MEASURED against the local
--     database: `CREATE ROLE app_stripe_mirror NOLOGIN` run through this migration fails —
--     `permission denied to create role` — for the exact reason 0044's header already recorded:
--     `db/migrate.mjs` issues `SET ROLE app_owner`, and `app_owner` has no CREATEROLE. A superuser
--     connection loses the attribute the moment it assumes the role, so role creation cannot live
--     in the migration stream at all — it is part of the ROLE BOOTSTRAP, run once by a superuser,
--     same as `app_signup` (0025) and `app_worker` (0044). This file FAILS LOUDLY if the role is
--     absent, so the gap surfaces at migrate/deploy time rather than as a silent missing grant.
--
-- The actual `GRANT USAGE ON SCHEMA stripe` / `GRANT SELECT ON ALL TABLES IN SCHEMA stripe` also
-- cannot live here — the schema does not exist until the sync engine's own migrations run,
-- immediately after this file in db/migrate.mjs's `up()`. Those grants are issued from
-- db/migrate.mjs itself, right after that call.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_stripe_mirror') THEN
    RAISE EXCEPTION
      'role app_stripe_mirror does not exist. It is part of the ROLE BOOTSTRAP, not of any '
      'migration, because migrations run as app_owner (no CREATEROLE). Create it as a SUPERUSER '
      '(e.g. via KEYSTONE_VERIFY_PG_URL/KEYSTONE_DEPLOYED_SUPERUSER_PG_URL — never app_owner), '
      'then re-run: '
      'CREATE ROLE app_stripe_mirror NOLOGIN; '
      'GRANT app_stripe_mirror TO app_rw; '
      '-- ★ NOLOGIN on purpose: nothing connects AS this role directly. app_rw SET ROLEs into it '
      'for the one query in src/money/stripeMirror.mjs#queryMirror, then RESETs — the same shape '
      '0044''s app_worker bootstrap uses for a role that is reached by membership, not by its own '
      'credential.';
  END IF;
END $$;
