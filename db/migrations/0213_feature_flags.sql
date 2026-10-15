-- 0213_feature_flags
-- Stage 9 task 9.3 · CT-071 (the three tables) · CT-072 (flagIsOn, src/platform/flags.mjs).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE NAV ROW STAYS CUT HERE. `src/nav/sections.mjs:230` / `src/nav/buildState.mjs:222` say
--     "OUT OF SCOPE (Part G). No table" — that reason string stops being literally true the moment
--     this migration applies, but the screen behind the row is task 9.13's, not this one's.
--     Un-cutting the row here would ship a nav entry with nothing behind it — CLAUDE.md failure #1
--     ("built and wired to nothing") in the other direction. This migration builds the table and
--     `flagIsOn`/`setFlagForPractice` (same task, `src/platform/flags.mjs`) only.
--
-- ★★ NO ROWS ARE SEEDED HERE. `feature_flag` is created empty; the first real flag (`n8n_send`) is
--    seeded by task 9.13's `0218_flag_seed.sql`, alongside the screen that can actually set it.
--
-- ★ THREE DIFFERENT ACCESS SHAPES, EACH COPIED FROM A NAMED SIBLING RATHER THAN INVENTED:
--   · `keystone.feature_flag` — platform-owned, no tenant_id. Same shape as
--     `keystone.permission_object` (0182) and `keystone.audit_action` (0183:54-66): ENABLE+FORCE,
--     one `USING (true)` SELECT policy, `GRANT SELECT` only to app_rw. No INSERT/UPDATE/DELETE
--     grant to app_rw at all — the only writer of this table is a migration (app_owner), same as
--     both siblings. "Writes restricted to the platform role" (the plan's own words) is enforced
--     by the ABSENCE of a grant, not by a policy that admits one: there is nothing for a policy to
--     admit when app_rw never held the privilege to begin with.
--   · `keystone.feature_flag_practice` — tenant-scoped, the project's standard three-policy shape
--     copied verbatim from `keystone.idempotency_key` (0003:35-40): tenant_isolation (SELECT),
--     tenant_insert (INSERT), tenant_update (UPDATE). `GRANT SELECT, INSERT, UPDATE` to app_rw —
--     no DELETE; an override is flipped, never removed, which is exactly what an UPDATE is for.
--   · `keystone.feature_flag_change` — tenant-scoped and append-only, copied verbatim from
--     `keystone.audit_entry` (0183:220-232): ENABLE+FORCE, tenant_isolation (SELECT) +
--     tenant_insert (INSERT) ONLY — no UPDATE policy, no DELETE policy, and `GRANT SELECT, INSERT`
--     with NO UPDATE/DELETE grant. ★★★ WHO SUPPLIES THE CONDITION (CLAUDE.md failure #1): the
--     append-only guarantee is supplied by the grants and the missing policies THIS MIGRATION
--     writes, never by application code and never by a test — the closing DO block below proves
--     both halves the same way 0183's does.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1 · keystone.feature_flag — the catalog. Platform-owned, no tenant_id. CT-071 exactly.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.feature_flag (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  description text NOT NULL,
  default_on  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE keystone.feature_flag ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.feature_flag FORCE  ROW LEVEL SECURITY;

CREATE POLICY feature_flag_read ON keystone.feature_flag
  AS PERMISSIVE FOR SELECT USING (true);

GRANT SELECT ON keystone.feature_flag TO app_rw;
-- ★ No INSERT, UPDATE or DELETE grant to app_rw or anyone but app_owner (the migration role) —
--   same idiom as keystone.permission_object (0182) and keystone.audit_action (0183): the
--   vocabulary of WHAT FLAGS EXIST is frozen by a migration, never minted at run time.

COMMENT ON TABLE keystone.feature_flag IS
  'Stage 9 task 9.3, CT-071. The feature-flag catalog: one row per flag, with its practice-wide
   default. Platform-owned, no tenant_id — every practice sees the same set of flags exist.
   SELECT only to app_rw (same shape as keystone.permission_object / keystone.audit_action): the
   only writer is a migration. Per-practice overrides live in keystone.feature_flag_practice.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2 · keystone.feature_flag_practice — the per-practice override. CT-071 exactly.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.feature_flag_practice (
  flag_key  text NOT NULL REFERENCES keystone.feature_flag(key) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  "on"      boolean NOT NULL,
  set_by    text NOT NULL,
  set_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, tenant_id)
);

ALTER TABLE keystone.feature_flag_practice ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.feature_flag_practice FORCE  ROW LEVEL SECURITY;

-- ★ The project's standard three-policy FORCED tenant shape, copied verbatim from
--   keystone.idempotency_key (0003:35-40) — not retyped from memory.
CREATE POLICY tenant_isolation ON keystone.feature_flag_practice
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.feature_flag_practice
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.feature_flag_practice
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.feature_flag_practice TO app_rw;  -- no DELETE

COMMENT ON TABLE keystone.feature_flag_practice IS
  'Stage 9 task 9.3, CT-071. One row per (flag, practice) that has an explicit override — a row
   here beats keystone.feature_flag.default_on for that practice; no row means the default
   applies. FORCED tenant policy copied verbatim from keystone.idempotency_key (0003). Written
   only through setFlagForPractice (src/platform/flags.mjs, CT-072), which appends the matching
   keystone.feature_flag_change row in the same transaction. No DELETE grant: an override is
   flipped, never removed.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 3 · keystone.feature_flag_change — the append-only history. CT-071 exactly.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.feature_flag_change (
  id        bigserial PRIMARY KEY,
  flag_key  text NOT NULL REFERENCES keystone.feature_flag(key) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  "on"      boolean NOT NULL,
  previous  boolean,
  reason    text,
  set_by    text NOT NULL,
  set_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE keystone.feature_flag_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.feature_flag_change FORCE  ROW LEVEL SECURITY;

-- ★ Append-only, copied verbatim from keystone.audit_entry (0183:223-232): SELECT + INSERT
--   policies only — no UPDATE policy, no DELETE policy, deliberately.
CREATE POLICY tenant_isolation ON keystone.feature_flag_change
  FOR SELECT USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.feature_flag_change
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No UPDATE policy and no DELETE policy, deliberately — this table has no way to be changed once
-- written, at the database layer, regardless of what application code is ever written against it.

GRANT SELECT, INSERT ON keystone.feature_flag_change TO app_rw;  -- no UPDATE, no DELETE
-- ★★★ WHO SUPPLIES THE CONDITION: explicit, even though app_rw was never granted UPDATE/DELETE
--     above — so a later migration that widens the GRANT line by accident still meets a REVOKE
--     naming exactly what must never be held, not silence that a diff could miss.
REVOKE UPDATE, DELETE ON keystone.feature_flag_change FROM app_rw;

COMMENT ON TABLE keystone.feature_flag_change IS
  'Stage 9 task 9.3, CT-071. Append-only history of every keystone.feature_flag_practice write:
   one row per setFlagForPractice call (src/platform/flags.mjs, CT-072), previous carrying the
   value that was replaced (the prior override, or the flag''s default_on when there was none).
   Append-only copied verbatim from keystone.audit_entry (0183): SELECT+INSERT policies and
   grants only, no UPDATE/DELETE policy, no UPDATE/DELETE grant, and an explicit REVOKE besides.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- ★★ PROVE THE CATALOG FACTS THIS MIGRATION CAN GET WRONG SILENTLY, AT APPLY TIME
--    (0183's closing DO block is the template).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n integer;
  r record;
BEGIN
  -- ── feature_flag: ENABLE + FORCE, 1 policy (SELECT), SELECT-only to app_rw ────────────────────
  SELECT relrowsecurity, relforcerowsecurity INTO r
    FROM pg_catalog.pg_class WHERE oid = 'keystone.feature_flag'::regclass;
  IF NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN
    RAISE EXCEPTION '0213: keystone.feature_flag is not ENABLE+FORCE row-level security (enable=%, force=%)', r.relrowsecurity, r.relforcerowsecurity;
  END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'feature_flag';
  IF n <> 1 THEN
    RAISE EXCEPTION '0213: keystone.feature_flag carries % policies, not the 1 named (feature_flag_read)', n;
  END IF;

  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag', 'SELECT') THEN
    RAISE EXCEPTION '0213: app_rw cannot SELECT keystone.feature_flag — flagIsOn could never read a flag';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag', 'INSERT') THEN
    RAISE EXCEPTION '0213: app_rw holds INSERT on keystone.feature_flag — the flag vocabulary must be migration-only';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag', 'UPDATE') THEN
    RAISE EXCEPTION '0213: app_rw holds UPDATE on keystone.feature_flag — the flag vocabulary must be migration-only';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag', 'DELETE') THEN
    RAISE EXCEPTION '0213: app_rw holds DELETE on keystone.feature_flag — the flag vocabulary must be migration-only';
  END IF;

  -- ── feature_flag_practice: ENABLE + FORCE, 3 policies, SELECT+INSERT+UPDATE (not DELETE) ──────
  SELECT relrowsecurity, relforcerowsecurity INTO r
    FROM pg_catalog.pg_class WHERE oid = 'keystone.feature_flag_practice'::regclass;
  IF NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN
    RAISE EXCEPTION '0213: keystone.feature_flag_practice is not ENABLE+FORCE row-level security (enable=%, force=%)', r.relrowsecurity, r.relforcerowsecurity;
  END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'feature_flag_practice';
  IF n <> 3 THEN
    RAISE EXCEPTION '0213: keystone.feature_flag_practice carries % policies, not the 3 named (tenant_isolation, tenant_insert, tenant_update)', n;
  END IF;

  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_practice', 'SELECT') THEN
    RAISE EXCEPTION '0213: app_rw cannot SELECT keystone.feature_flag_practice — flagIsOn could never read an override';
  END IF;
  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_practice', 'INSERT') THEN
    RAISE EXCEPTION '0213: app_rw cannot INSERT keystone.feature_flag_practice — setFlagForPractice could never set a new override';
  END IF;
  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_practice', 'UPDATE') THEN
    RAISE EXCEPTION '0213: app_rw cannot UPDATE keystone.feature_flag_practice — setFlagForPractice could never flip an existing override';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_practice', 'DELETE') THEN
    RAISE EXCEPTION '0213: app_rw holds DELETE on keystone.feature_flag_practice — an override must be flipped, never removed';
  END IF;

  -- ── feature_flag_change: ENABLE + FORCE, 2 policies (SELECT+INSERT only) ───────────────────────
  SELECT relrowsecurity, relforcerowsecurity INTO r
    FROM pg_catalog.pg_class WHERE oid = 'keystone.feature_flag_change'::regclass;
  IF NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN
    RAISE EXCEPTION '0213: keystone.feature_flag_change is not ENABLE+FORCE row-level security (enable=%, force=%)', r.relrowsecurity, r.relforcerowsecurity;
  END IF;

  SELECT count(*) INTO n FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'feature_flag_change';
  IF n <> 2 THEN
    RAISE EXCEPTION '0213: keystone.feature_flag_change carries % policies, not the 2 named (tenant_isolation, tenant_insert) — an UPDATE or DELETE policy here would break "append-only"', n;
  END IF;

  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_change', 'SELECT') THEN
    RAISE EXCEPTION '0213: app_rw cannot SELECT keystone.feature_flag_change — the change log would be unreadable';
  END IF;
  IF NOT pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_change', 'INSERT') THEN
    RAISE EXCEPTION '0213: app_rw cannot INSERT keystone.feature_flag_change — setFlagForPractice could never append a row';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_change', 'UPDATE') THEN
    RAISE EXCEPTION '0213: app_rw holds UPDATE on keystone.feature_flag_change — this table must be append-only';
  END IF;
  IF pg_catalog.has_table_privilege('app_rw', 'keystone.feature_flag_change', 'DELETE') THEN
    RAISE EXCEPTION '0213: app_rw holds DELETE on keystone.feature_flag_change — this table must be append-only';
  END IF;

  RAISE NOTICE '0213: feature_flag / feature_flag_practice / feature_flag_change created, ENABLE+FORCE, with exactly the policies and grants named above; no rows seeded.';
END $$;
