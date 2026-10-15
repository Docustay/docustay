-- 0414_loyalty — Stage 14 task 14.7 · CT-F52 (all three tables) · CT-F41 (loyalty_entry is the
-- append-only-ledger MODEL the checklist itself cites, CONTRACTS.md:1202-1204).
--
-- Earn rules (`keystone.loyalty_rule`), rewards (`keystone.loyalty_reward`) and an append-only
-- points ledger (`keystone.loyalty_entry`) — balance is ALWAYS `SUM(points)`, never a counter.
--
-- ★★★ `loyalty_entry` IS AN APPEND-ONLY LEDGER AND THAT IS THE POINT.
--     No touch/updated_at trigger (there is no `updated_at` column — a row is never updated).
--     app_rw grants are SELECT, INSERT ONLY — no UPDATE, no DELETE. A ledger you can rewrite is
--     not a ledger. `UNIQUE (tenant_id, reason, source_type, source_id, app_user_id)` is what makes
--     an event earn ONCE (nullable source_type/source_id give 'adjust' rows their own identity each
--     time, since NULL <> NULL in a unique constraint — deliberate, not an oversight).
--
-- ★★ THE RISKY PART — `loyalty_entry_never_negative` (BEFORE INSERT, FOR EACH ROW). It takes a
--    transaction-scoped advisory lock ON THE PERSON before reading the running balance, using the
--    SAME idiom `src/money/invoiceNumbers.mjs` uses for invoice numbers:
--      · `pg_advisory_xact_lock` (not the session form) — released automatically at COMMIT or
--        ROLLBACK, with no unlock call to strand (invoiceNumbers.mjs:16-18, `nextInvoiceNumber`
--        at :120 takes the lock BEFORE its balance-determining read, exactly mirrored below).
--      · The lock is taken BEFORE the SUM read, so two concurrent claims for the SAME person
--        serialise for the microsecond it takes to read the balance, instead of both reading the
--        same balance and both passing — which is precisely how a balance guard ships looking
--        correct and is not (invoiceNumbers.mjs:4-11's race, restated here for points instead of
--        invoice numbers).
--      · The lock key is derived from `hashtextextended(tenant_id || ':' || app_user_id, 0)` — the
--        SQL-side expression of the same "stable 64-bit key, scoped so unrelated entities never
--        serialise with each other" idea invoiceNumbers.mjs:35 expresses in JS for the tenant alone;
--        here it is scoped to (tenant, person) since balance is per-person, not per-tenant. The
--        precedent for expressing this JS idiom AS SQL inside a trigger, rather than inventing a new
--        form, is `db/migrations/0156_a_give_up_is_counted_once_and_shown_to_the_platform.sql:83-84`
--        (`record_job_failure`'s "one writer per (task, practice) at a time" lock, MEASURED).
--    The function is SECURITY INVOKER (plain — not DEFINER): app_rw already holds SELECT+INSERT on
--    `loyalty_entry` directly (CT-F52 point 4 below), so nothing here needs to run as a different
--    owner, and `db/gates/p21a_definer_search_path.mjs` (which requires an empty search_path + full
--    qualification) applies only to `prosecdef` functions, which this one is not. `SET search_path =
--    pg_catalog, keystone` is still pinned, and every identifier is schema-qualified regardless, on
--    the same "do not leave it to chance" footing as `keystone.availability_cache_invalidate()`
--    (`0400_availability_cache.sql:50-51`).
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, for ALL THREE tables below.
-- `db/gates/p21a_cross_tenant_fuzz.mjs` enumerates tables from `pg_class`, so all three are picked
-- up automatically and all three must pass independently.
--
-- `loyalty_rule` and `loyalty_reward` both carry an `active` boolean — same "toggled off, never
-- deleted" shape as `keystone.unit` (`0409_service_category_and_unit.sql:130,218` — "units are
-- toggled off (active=false), never deleted"). Field 4 names no delete path for either table, so
-- app_rw gets SELECT, INSERT, UPDATE only (no DELETE, no tenant_delete policy) — CT-F52 point 4:
-- "grant only what the module actually does."
--
-- THE EXECUTE LEND for `keystone.refuse_touch_reference_rows()` (owned by `reference_guard` since
-- 0144:245, ACL revoked from PUBLIC at 0099:83) is borrowed and given back around each table's own
-- guard-trigger pair — `0151_the_senders_are_part_of_the_reference_practice.sql:84-93,109-111`
-- (MEASURED: "[EXECUTED, first draft of this file] 'permission denied for function
-- keystone.refuse_touch_reference_rows()'... EXECUTE is checked at CREATE time only (firing does
-- not re-check)"), mirrored verbatim by this stage's own `0408_image_library.sql:63-65,78-80` and
-- `0402_booking_block.sql:32-34,44-46`.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §A — keystone.loyalty_rule
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.loyalty_rule (
  id          uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id   uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  kind        text        NOT NULL CHECK (kind IN ('per_dollar','per_visit','per_referral')),
  points      integer     NOT NULL CHECK (points > 0),
  active      boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_rule_tenant_id_key   ON keystone.loyalty_rule (tenant_id, id);
CREATE UNIQUE INDEX loyalty_rule_tenant_kind_key ON keystone.loyalty_rule (tenant_id, kind);

ALTER TABLE keystone.loyalty_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.loyalty_rule FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.loyalty_rule USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.loyalty_rule FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.loyalty_rule FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                         WITH CHECK (tenant_id = keystone.require_tenant_id());
-- CT-F52 point 3 — the reference guard. Without it catalog-conformance's SET-EQUALITY check fails.
CREATE POLICY reference_guard_read ON keystone.loyalty_rule FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- CT-F52 point 4 — no delete path this stage (see header): SELECT, INSERT, UPDATE only.
GRANT SELECT, INSERT, UPDATE ON keystone.loyalty_rule TO app_rw;
GRANT SELECT ON keystone.loyalty_rule TO reference_guard;

CREATE TRIGGER loyalty_rule_touch BEFORE UPDATE ON keystone.loyalty_rule
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers, ENABLE ALWAYS. The lend/give-back.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER loyalty_rule_refuse_reference_delete_trg AFTER DELETE ON keystone.loyalty_rule
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.loyalty_rule ENABLE ALWAYS TRIGGER loyalty_rule_refuse_reference_delete_trg;
CREATE TRIGGER loyalty_rule_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.loyalty_rule
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.loyalty_rule ENABLE ALWAYS TRIGGER loyalty_rule_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

COMMENT ON TABLE keystone.loyalty_rule IS '14.7 — earn rules: how many points per dollar/visit/referral. Toggled active=false, never deleted (CT-F52 point 4).';

-- CT-F52 point 6 — the closing self-check, WITH ITS POSITIVE CONTROL INSIDE THE SQL (0408/0409's template).
DO $loyalty_rule_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.loyalty_rule'::regclass) THEN
    RAISE EXCEPTION '0414: keystone.loyalty_rule does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.loyalty_rule'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0414: keystone.loyalty_rule does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='loyalty_rule' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0414: loyalty_rule has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.loyalty_rule'::regclass
     AND tgname IN ('loyalty_rule_refuse_reference_delete_trg', 'loyalty_rule_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0414: keystone.loyalty_rule does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.loyalty_rule'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])
     <> 1 THEN
    RAISE EXCEPTION '0414: reference_guard_read on keystone.loyalty_rule is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_rule', 'SELECT') THEN
    RAISE EXCEPTION '0414: app_rw is missing SELECT on keystone.loyalty_rule';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_rule', 'INSERT') THEN
    RAISE EXCEPTION '0414: app_rw is missing INSERT on keystone.loyalty_rule';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_rule', 'UPDATE') THEN
    RAISE EXCEPTION '0414: app_rw is missing UPDATE on keystone.loyalty_rule';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.loyalty_rule', 'DELETE') THEN
    RAISE EXCEPTION '0414: app_rw must not hold DELETE on keystone.loyalty_rule — a rule is toggled active=false, never deleted';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.loyalty_rule', 'SELECT') THEN
    RAISE EXCEPTION '0414: reference_guard is missing SELECT on keystone.loyalty_rule';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0414: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the loyalty_rule lend was not revoked';
  END IF;
END
$loyalty_rule_ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §B — keystone.loyalty_reward
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.loyalty_reward (
  id           uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id    uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  name         text        NOT NULL,
  points_cost  integer     NOT NULL CHECK (points_cost > 0),
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_reward_tenant_id_key ON keystone.loyalty_reward (tenant_id, id);

ALTER TABLE keystone.loyalty_reward ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.loyalty_reward FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.loyalty_reward USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.loyalty_reward FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.loyalty_reward FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                           WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY reference_guard_read ON keystone.loyalty_reward FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- CT-F52 point 4 — no delete path this stage (see header): SELECT, INSERT, UPDATE only.
GRANT SELECT, INSERT, UPDATE ON keystone.loyalty_reward TO app_rw;
GRANT SELECT ON keystone.loyalty_reward TO reference_guard;

CREATE TRIGGER loyalty_reward_touch BEFORE UPDATE ON keystone.loyalty_reward
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER loyalty_reward_refuse_reference_delete_trg AFTER DELETE ON keystone.loyalty_reward
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.loyalty_reward ENABLE ALWAYS TRIGGER loyalty_reward_refuse_reference_delete_trg;
CREATE TRIGGER loyalty_reward_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.loyalty_reward
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.loyalty_reward ENABLE ALWAYS TRIGGER loyalty_reward_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

COMMENT ON TABLE keystone.loyalty_reward IS '14.7 — rewards a person can claim with points. Toggled active=false, never deleted (CT-F52 point 4).';

DO $loyalty_reward_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.loyalty_reward'::regclass) THEN
    RAISE EXCEPTION '0414: keystone.loyalty_reward does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.loyalty_reward'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'reference_guard_read');
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION '0414: keystone.loyalty_reward does not carry exactly the four expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='loyalty_reward' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0414: loyalty_reward has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.loyalty_reward'::regclass
     AND tgname IN ('loyalty_reward_refuse_reference_delete_trg', 'loyalty_reward_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0414: keystone.loyalty_reward does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.loyalty_reward'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])
     <> 1 THEN
    RAISE EXCEPTION '0414: reference_guard_read on keystone.loyalty_reward is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_reward', 'SELECT') THEN
    RAISE EXCEPTION '0414: app_rw is missing SELECT on keystone.loyalty_reward';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_reward', 'INSERT') THEN
    RAISE EXCEPTION '0414: app_rw is missing INSERT on keystone.loyalty_reward';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_reward', 'UPDATE') THEN
    RAISE EXCEPTION '0414: app_rw is missing UPDATE on keystone.loyalty_reward';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.loyalty_reward', 'DELETE') THEN
    RAISE EXCEPTION '0414: app_rw must not hold DELETE on keystone.loyalty_reward — a reward is toggled active=false, never deleted';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.loyalty_reward', 'SELECT') THEN
    RAISE EXCEPTION '0414: reference_guard is missing SELECT on keystone.loyalty_reward';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0414: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the loyalty_reward lend was not revoked';
  END IF;
END
$loyalty_reward_ct_f52_self_check$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §C — keystone.loyalty_entry — the append-only ledger. Balance is SUM(points), never a counter.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.loyalty_entry (
  id                 uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id          uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id        uuid        NOT NULL,
  points             integer     NOT NULL CHECK (points <> 0),
  reason             text        NOT NULL CHECK (reason IN ('earn_payment','earn_visit','earn_referral','claim','adjust')),
  source_type        text        NULL,
  source_id          uuid        NULL,
  claimed_reward_id  uuid        NULL,
  created_by         uuid        NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loyalty_entry_app_user_fkey FOREIGN KEY (tenant_id, app_user_id)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE RESTRICT,
  -- ★ NOT SET NULL: claimed_reward_id's presence is load-bearing for loyalty_entry_claim_shape
  --   below — nulling it out from under an executed claim would break that CHECK on a row that
  --   already satisfied it, which a delete must never do to an append-only ledger row.
  CONSTRAINT loyalty_entry_claimed_reward_fkey FOREIGN KEY (tenant_id, claimed_reward_id)
    REFERENCES keystone.loyalty_reward (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT loyalty_entry_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by),
  CONSTRAINT loyalty_entry_claim_shape  CHECK ((reason = 'claim') = (claimed_reward_id IS NOT NULL)),
  CONSTRAINT loyalty_entry_points_shape CHECK (reason IN ('claim','adjust') OR points > 0),
  CONSTRAINT loyalty_entry_earns_once_key UNIQUE (tenant_id, reason, source_type, source_id, app_user_id)
);
CREATE INDEX loyalty_entry_tenant_person_idx ON keystone.loyalty_entry (tenant_id, app_user_id);

ALTER TABLE keystone.loyalty_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.loyalty_entry FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.loyalty_entry USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.loyalty_entry FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
-- ★★★ No tenant_update, no tenant_delete: this is the append-only ledger (CT-F41's model, header).
CREATE POLICY reference_guard_read ON keystone.loyalty_entry FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- CT-F52 point 4 — SELECT, INSERT ONLY. No UPDATE, no DELETE. A ledger you can rewrite is not one.
GRANT SELECT, INSERT ON keystone.loyalty_entry TO app_rw;
GRANT SELECT ON keystone.loyalty_entry TO reference_guard;

-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers, ENABLE ALWAYS, even on an append-only
-- ledger: they guard DELETE/TRUNCATE, neither of which app_rw can do anyway, but a superuser or
-- app_owner still could without them — the reference practice must never lose ledger rows either way.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER loyalty_entry_refuse_reference_delete_trg AFTER DELETE ON keystone.loyalty_entry
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.loyalty_entry ENABLE ALWAYS TRIGGER loyalty_entry_refuse_reference_delete_trg;
CREATE TRIGGER loyalty_entry_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.loyalty_entry
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.loyalty_entry ENABLE ALWAYS TRIGGER loyalty_entry_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §D — keystone.loyalty_entry_never_negative() + its BEFORE INSERT trigger — the risky part.
-- See the header block for the full idiom citation (invoiceNumbers.mjs:16-18,35,120; 0156:83-84).
-- SECURITY INVOKER (plain): owned by app_owner, which already has implicit EXECUTE on its own
-- function, so no lend/give-back is needed here (unlike §A-C's refuse_touch_reference_rows above,
-- which is owned by a DIFFERENT role). app_rw already holds SELECT+INSERT on loyalty_entry directly.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION keystone.loyalty_entry_never_negative() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, keystone AS $fn$
DECLARE
  v_balance integer;
BEGIN
  -- ★★★ THE INVOICENUMBERS IDIOM — a transaction-scoped advisory lock, keyed to the PERSON, taken
  --     BEFORE the balance-determining read. Two concurrent claims for the SAME person serialise on
  --     this lock instead of both reading the same balance and both passing (invoiceNumbers.mjs:4-18,
  --     120). Released automatically at COMMIT or ROLLBACK — no unlock call to strand.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.tenant_id::text || ':' || NEW.app_user_id::text, 0));

  SELECT coalesce(pg_catalog.sum(e.points), 0) INTO v_balance
    FROM keystone.loyalty_entry e
   WHERE e.tenant_id = NEW.tenant_id AND e.app_user_id = NEW.app_user_id;

  IF v_balance + NEW.points < 0 THEN
    RAISE EXCEPTION 'Not enough points — % short.', (-(v_balance + NEW.points))
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER loyalty_entry_never_negative BEFORE INSERT ON keystone.loyalty_entry
  FOR EACH ROW EXECUTE FUNCTION keystone.loyalty_entry_never_negative();

COMMENT ON TABLE keystone.loyalty_entry IS '14.7 — append-only points ledger. Balance is SUM(points), never a counter. app_rw: SELECT, INSERT only. loyalty_entry_never_negative refuses an insert that would take a person''s balance below zero, under a transaction-scoped advisory lock on the person (invoiceNumbers.mjs idiom).';
COMMENT ON FUNCTION keystone.loyalty_entry_never_negative() IS '14.7 — BEFORE INSERT guard: SUM(points) + NEW.points must stay >= 0 for the person, checked under pg_advisory_xact_lock(hashtextextended(tenant:person)) taken first (invoiceNumbers.mjs idiom, invoiceNumbers.mjs:16-18,35,120). SECURITY INVOKER — app_rw already holds SELECT+INSERT on loyalty_entry.';

DO $loyalty_entry_ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.loyalty_entry'::regclass) THEN
    RAISE EXCEPTION '0414: keystone.loyalty_entry does not have FORCE ROW LEVEL SECURITY';
  END IF;

  -- ★ Exactly three named policies — NO tenant_update, NO tenant_delete (append-only ledger).
  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.loyalty_entry'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'reference_guard_read');
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION '0414: keystone.loyalty_entry does not carry exactly the three expected policies (found %)', v_policy_count;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='loyalty_entry' AND policyname IN ('tenant_update','tenant_delete')) THEN
    RAISE EXCEPTION '0414: loyalty_entry must not carry a tenant_update or tenant_delete policy — it is append-only (CT-F41)';
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.loyalty_entry'::regclass
     AND tgname IN ('loyalty_entry_refuse_reference_delete_trg', 'loyalty_entry_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0414: keystone.loyalty_entry does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'keystone.loyalty_entry'::regclass
                    AND tgname = 'loyalty_entry_never_negative' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0414: keystone.loyalty_entry is missing its enabled loyalty_entry_never_negative trigger';
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.loyalty_entry'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'
         AND p.polpermissive
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])
     <> 1 THEN
    RAISE EXCEPTION '0414: reference_guard_read on keystone.loyalty_entry is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot (field 8's own check).
  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_entry', 'SELECT') THEN
    RAISE EXCEPTION '0414: app_rw is missing SELECT on keystone.loyalty_entry';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.loyalty_entry', 'INSERT') THEN
    RAISE EXCEPTION '0414: app_rw is missing INSERT on keystone.loyalty_entry';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.loyalty_entry', 'UPDATE') THEN
    RAISE EXCEPTION '0414: app_rw must NOT hold UPDATE on keystone.loyalty_entry — it is an append-only ledger';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.loyalty_entry', 'DELETE') THEN
    RAISE EXCEPTION '0414: app_rw must NOT hold DELETE on keystone.loyalty_entry — it is an append-only ledger';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.loyalty_entry', 'SELECT') THEN
    RAISE EXCEPTION '0414: reference_guard is missing SELECT on keystone.loyalty_entry';
  END IF;
  IF has_function_privilege('app_owner', 'keystone.refuse_touch_reference_rows()', 'EXECUTE') THEN
    RAISE EXCEPTION '0414: app_owner still holds EXECUTE on keystone.refuse_touch_reference_rows() — the loyalty_entry lend was not revoked';
  END IF;
END
$loyalty_entry_ct_f52_self_check$;

-- Written, not applied.
