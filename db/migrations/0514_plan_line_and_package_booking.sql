-- 0514_plan_line_and_package_booking
-- B-2 (F799), CONTRACTS §1 — plan_line: the plan's own "what it grants per cycle", so a subscription's
-- invoice.paid has something to read besides sessions_included/service_id (0267), which name ONE
-- service only; package.book_at_purchase (a switch, not read by anything yet); and the two entitlement
-- columns (grant_source/grant_source_id) that make a credit-granting write REPLAY-SAFE — a grant
-- recorded by WHERE IT CAME FROM cannot be replayed into a second grant for the same purchase.
--
-- ★ plan_line MIRRORS package_line (0009) deliberately — same simple (non-composite) FKs, same
--   tenant_isolation shape: a plain tenant match, no user_may gate. A plan's own lines are catalogue
--   data, not money-gated visibility like an invoice or a payment_link.
-- ★★ quantity_per_cycle IS NULLABLE, UNLIKE package_line.quantity — NULL is a real value here:
--    "unlimited", the shape B-2's grantCredits (src/money/writes.mjs) reads as "nothing to grant,
--    this line never runs out."
-- ★ book_at_purchase on `package`: whether a package purchase should ALSO open a booking at the moment
--   it is bought (a later task's switch). This migration only adds the column, defaulting off.
-- ★ Everything below follows CT-F52 in full — structure copied from 0431_payment_links.sql:91-136 (the
--   most recent complete new-table precedent): ENABLE+FORCE RLS, the reference-guard triggers, the
--   grants, the closing self-check with positive controls — with plan_line's OWN tenant_isolation qual
--   kept in package_line's simpler (non-money-gated) shape.


-- ═══ IDEMPOTENT GUARD — a duplicate run fails loudly rather than silently duplicating ═════════════
DO $guard$
BEGIN
  IF to_regclass('keystone.plan_line') IS NOT NULL THEN
    RAISE EXCEPTION '0514: keystone.plan_line already exists — check for a duplicate run';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'package' AND column_name = 'book_at_purchase'
  ) THEN
    RAISE EXCEPTION '0514: keystone.package.book_at_purchase already exists — check for a duplicate run';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'entitlement' AND column_name = 'grant_source'
  ) THEN
    RAISE EXCEPTION '0514: keystone.entitlement.grant_source already exists — check for a duplicate run';
  END IF;
END $guard$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · plan_line — mirrors package_line; quantity_per_cycle NULL = unlimited
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE keystone.plan_line (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  plan_id            uuid        NOT NULL REFERENCES keystone.plan(id) ON DELETE CASCADE,
  service_id         uuid        NOT NULL REFERENCES keystone.service(id) ON DELETE RESTRICT,
  -- ★ NULL = unlimited (B-2 field 4: "for each {serviceId, quantity} ... with quantity !== null (NULL
  --   = unlimited, nothing to grant)"). A positive integer is a real per-cycle allotment.
  quantity_per_cycle integer     NULL CHECK (quantity_per_cycle IS NULL OR quantity_per_cycle > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plan_id, service_id)
);
CREATE INDEX plan_line_tenant_idx ON keystone.plan_line (tenant_id);

ALTER TABLE keystone.plan_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.plan_line FORCE  ROW LEVEL SECURITY;

-- ★ Like package_line (0009): a plain tenant match, no money-gating — a plan's lines are catalogue
--   data, visible to anyone who can see the tenant's catalogue at all.
CREATE POLICY tenant_isolation ON keystone.plan_line
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.plan_line
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.plan_line TO app_rw;

CREATE TRIGGER plan_line_touch BEFORE UPDATE ON keystone.plan_line
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0431:118-120 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER plan_line_refuse_reference_delete_trg AFTER DELETE ON keystone.plan_line
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.plan_line ENABLE ALWAYS TRIGGER plan_line_refuse_reference_delete_trg;
CREATE TRIGGER plan_line_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.plan_line
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.plan_line ENABLE ALWAYS TRIGGER plan_line_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.plan_line TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.plan_line FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · package.book_at_purchase
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE keystone.package
  ADD COLUMN book_at_purchase boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · backfill — one plan_line per plan that already names a service and a count (0267)
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ FORCE ROW LEVEL SECURITY on both `plan` (the read) and the new `plan_line` (the write) applies to
--   the table OWNER too (0015:331's own precedent, the subscription.contract_id backfill) — a migration
--   script sets no tenant GUC, so without this toggle the SELECT would silently match zero rows
--   (0410's own header: "a command with no matching policy matches no rows") and the INSERT would
--   hard-fail against require_tenant_id(). Toggled back on immediately after.
ALTER TABLE keystone.plan      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.plan_line NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.plan_line (tenant_id, plan_id, service_id, quantity_per_cycle)
SELECT tenant_id, id, service_id, sessions_included
  FROM keystone.plan
 WHERE service_id IS NOT NULL AND sessions_included > 0
ON CONFLICT (tenant_id, plan_id, service_id) DO NOTHING;

ALTER TABLE keystone.plan      FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.plan_line FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · entitlement.grant_source / grant_source_id — REPLAY-SAFE GRANTING (B-2, F799)
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ Both NULL is the pre-existing shape (manual/legacy grants, and every row before this migration);
--   NULLs never collide under UNIQUE, so this is safe to add with no backfill.
ALTER TABLE keystone.entitlement
  ADD COLUMN grant_source    text NULL CHECK (grant_source IN ('package','subscription','manual','document')),
  ADD COLUMN grant_source_id text NULL;

ALTER TABLE keystone.entitlement
  ADD CONSTRAINT entitlement_grant_source_id_key
  UNIQUE (tenant_id, owner_user_id, service_id, grant_source, grant_source_id);

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ══════════════════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.plan_line'::regclass) THEN
    RAISE EXCEPTION '0514 — keystone.plan_line is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'plan_line'
     AND policyname IN ('tenant_isolation','tenant_insert','reference_guard_read');
  IF n <> 3 THEN
    RAISE EXCEPTION '0514 — expected 3 policies on plan_line, found %', n;
  END IF;

  -- ★ tenant_isolation must be the PLAIN tenant match (package_line's shape), never money-gated — a
  --   qual that grew a user_may() call would silently narrow catalogue visibility below what every
  --   other catalogue table (service/package/plan) already gives.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'keystone' AND tablename = 'plan_line' AND policyname = 'tenant_isolation'
       AND qual LIKE '%user_may%'
  ) THEN
    RAISE EXCEPTION '0514 — tenant_isolation on plan_line must NOT be money-gated (package_line''s plain shape)';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.plan_line'::regclass
     AND tgname IN ('plan_line_refuse_reference_delete_trg','plan_line_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0514 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on plan_line, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.plan_line'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0514 — reference_guard_read on plan_line must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE';
  END IF;

  -- ★ Positive controls (the 0409 lesson: a check that only forbids things can forbid the very path
  --   it is testing for).
  IF NOT has_table_privilege('app_rw', 'keystone.plan_line', 'SELECT') THEN
    RAISE EXCEPTION '0514 — app_rw is missing SELECT on plan_line';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.plan_line', 'INSERT') THEN
    RAISE EXCEPTION '0514 — app_rw is missing INSERT on plan_line';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.plan_line', 'UPDATE') THEN
    RAISE EXCEPTION '0514 — app_rw lost UPDATE on plan_line';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.plan_line', 'SELECT') THEN
    RAISE EXCEPTION '0514 — reference_guard has no SELECT on plan_line; its policy would have nothing underneath it';
  END IF;

  -- ★ package.book_at_purchase — column exists, right type.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'package' AND column_name = 'book_at_purchase'
       AND data_type = 'boolean'
  ) THEN
    RAISE EXCEPTION '0514 — keystone.package.book_at_purchase missing or wrong type';
  END IF;

  -- ★ entitlement.grant_source / grant_source_id — columns and the replay-safety UNIQUE constraint.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'entitlement' AND column_name = 'grant_source'
  ) THEN
    RAISE EXCEPTION '0514 — keystone.entitlement.grant_source missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'entitlement' AND column_name = 'grant_source_id'
  ) THEN
    RAISE EXCEPTION '0514 — keystone.entitlement.grant_source_id missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'entitlement_grant_source_id_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '0514 — entitlement_grant_source_id_key UNIQUE constraint missing';
  END IF;

  -- ★ Backfill sanity: every plan that already named a service and a positive session count now has
  --   a matching plan_line (a positive control — proves the backfill ran, not merely that it did not
  --   error).
  IF EXISTS (
    SELECT 1 FROM keystone.plan p
     WHERE p.service_id IS NOT NULL AND p.sessions_included > 0
       AND NOT EXISTS (
         SELECT 1 FROM keystone.plan_line pl
          WHERE pl.tenant_id = p.tenant_id AND pl.plan_id = p.id AND pl.service_id = p.service_id
       )
  ) THEN
    RAISE EXCEPTION '0514 — a plan with service_id/sessions_included has no matching plan_line after backfill';
  END IF;
END $ct_f52_self_check$;


-- Written, not applied.
