-- 0382_staff_shift_and_time_off
--
-- 12.3 — the Scheduling object (F02 §2.5): keystone.staff_shift and keystone.time_off. A shift is a
-- staff member's working block on one calendar day, stored as a plain `date` plus integer minutes
-- from midnight — the PRACTICE's wall clock, same convention as `availability_rule`/`date_override`
-- (MEASURED columns). Time off is a date range with no time component. Neither table stores a
-- computed UTC instant: that conversion belongs to 13.18's `readSlots`/12.4's widened
-- `generateSlots`, which already know how to turn a local wall-clock moment into a real instant in
-- an IANA zone (`src/booking/slots.mjs:zonedLocalToUtc`) — this migration is not that caller, so it
-- does not attempt that arithmetic.
--
-- CT-F52 — THE NEW-TENANT-TABLE CHECKLIST, all eight points, applied to BOTH tables. Every clause is
-- written twice, once per table — a loop is not available in DDL.

CREATE TABLE keystone.staff_shift (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id uuid NOT NULL,
  on_date date NOT NULL,                      -- F02 §2.5 "date"; named like date_override.on_date
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute   integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  location_id uuid NULL,
  video_only boolean NOT NULL DEFAULT false,
  label text NULL CHECK (label IS NULL OR char_length(label) <= 40),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shift_window CHECK (end_minute > start_minute),
  CONSTRAINT staff_shift_video_has_no_place CHECK (NOT (video_only AND location_id IS NOT NULL)),
  CONSTRAINT staff_shift_person_fkey FOREIGN KEY (tenant_id, app_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT staff_shift_location_fkey FOREIGN KEY (tenant_id, location_id) REFERENCES keystone.location (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE UNIQUE INDEX staff_shift_person_day_start_key ON keystone.staff_shift (tenant_id, app_user_id, on_date, start_minute);
CREATE INDEX staff_shift_tenant_day_idx ON keystone.staff_shift (tenant_id, on_date);

CREATE TABLE keystone.time_off (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id uuid NOT NULL,
  starts_on date NOT NULL, ends_on date NOT NULL,
  reason text NULL CHECK (reason IS NULL OR char_length(reason) <= 200),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_off_range CHECK (ends_on >= starts_on),
  CONSTRAINT time_off_person_fkey FOREIGN KEY (tenant_id, app_user_id) REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT time_off_created_by_fkey FOREIGN KEY (tenant_id, created_by) REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (created_by)
);
CREATE INDEX time_off_person_range_idx ON keystone.time_off (tenant_id, app_user_id, starts_on, ends_on);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 1 — ENABLE and FORCE ROW LEVEL SECURITY, both tables.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.staff_shift ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.staff_shift FORCE  ROW LEVEL SECURITY;
ALTER TABLE keystone.time_off    ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.time_off    FORCE  ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 2 — the tenant policies, including tenant_delete (both tables have a delete path:
-- deleteShift, removeTimeOff).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY tenant_isolation ON keystone.staff_shift USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.staff_shift FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.staff_shift FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                        WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.staff_shift FOR DELETE USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_isolation ON keystone.time_off USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert    ON keystone.time_off FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update    ON keystone.time_off FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
                                                     WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete    ON keystone.time_off FOR DELETE USING (tenant_id = keystone.current_tenant_id());

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 3 — the reference guard. Without it catalog-conformance's SET-EQUALITY check fails.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE POLICY reference_guard_read ON keystone.staff_shift FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
CREATE POLICY reference_guard_read ON keystone.time_off FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 4 — grants. Both tables have a delete path, so app_rw gets DELETE too.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.staff_shift TO app_rw;
GRANT SELECT ON keystone.staff_shift TO reference_guard;
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.time_off TO app_rw;
GRANT SELECT ON keystone.time_off TO reference_guard;

-- CT-F52 point 4b, bullet 1: the reference_guard_read policy above is the PLAIN form (point 3) —
-- its USING clause calls no function — so there is nothing for a GRANT EXECUTE to name, on either
-- table. Bullet 2: keystone.refuse_touch_reference_rows() is owned BY reference_guard (0144:245),
-- so the trigger functions below need no per-table grant either; no redundant grant added, function
-- not re-owned. Bullet 3 is asserted below, in the closing DO block, once per table.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 5 — BOTH refuse_touch_reference_rows triggers per table, each ENABLE ALWAYS.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE EXECUTE LEND — ADDED 25 Sep 2026, BEFORE THIS MIGRATION HAD EVER BEEN APPLIED.
--     WITHOUT IT THE `CREATE TRIGGER` STATEMENTS BELOW FAIL: "permission denied for function
--     keystone.refuse_touch_reference_rows()". CREATE TRIGGER requires EXECUTE on the trigger
--     function, checked at CREATE time (0151:91-110, EXECUTED — that migration hit this exact
--     failure in its own first draft and recorded it).
--   ★★ MEASURED, the three facts that make it unavoidable: `0099:83` REVOKEd ALL on the function
--      FROM PUBLIC, so the default grant every new function gets is gone; `0144:245` ALTERed it
--      OWNER TO `reference_guard`, so app_owner does not own it; and every migration that has ever
--      borrowed it (0151, 0400, 0402, 0408, 0414, 0415) REVOKEs it again at the end, so **there is
--      no standing grant to inherit.** The migration runner does `SET ROLE app_owner`
--      (`db/migrate.mjs:179`) — it is not superuser, so the privilege check is real.
--   ★ CONTRACTS.md CT-F52 point 4b says the trigger functions "need no per-table grant". That is
--     true of a PERSISTENT grant and was read here as ruling out this temporary borrow too — which
--     is how five pending migrations came to be written without it. The borrow is not a per-table
--     grant; it is held for the CREATE and handed straight back.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;


CREATE TRIGGER staff_shift_refuse_reference_delete_trg AFTER DELETE ON keystone.staff_shift
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.staff_shift ENABLE ALWAYS TRIGGER staff_shift_refuse_reference_delete_trg;
CREATE TRIGGER staff_shift_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.staff_shift
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.staff_shift ENABLE ALWAYS TRIGGER staff_shift_refuse_reference_truncate_trg;

CREATE TRIGGER time_off_refuse_reference_delete_trg AFTER DELETE ON keystone.time_off
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.time_off ENABLE ALWAYS TRIGGER time_off_refuse_reference_delete_trg;
CREATE TRIGGER time_off_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.time_off
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.time_off ENABLE ALWAYS TRIGGER time_off_refuse_reference_truncate_trg;

-- ★ Handed straight back — app_owner must not keep EXECUTE on the reference guard's own function.
SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;


-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CT-F52 point 6 — ONE closing self-check DO block covering BOTH tables, with its positive control
-- inside the SQL (0369/0370 are the template). Written twice, once per table — a loop is not
-- available in DDL, and a copy-paste that silently covers only the first table is exactly the
-- defect this checklist exists to stop.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $ct_f52_self_check$
DECLARE
  v_policy_count  int;
  v_trigger_count int;
BEGIN
  -- ── keystone.staff_shift ──────────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.staff_shift'::regclass) THEN
    RAISE EXCEPTION '0382: keystone.staff_shift does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.staff_shift'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION '0382: keystone.staff_shift does not carry exactly the five expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.staff_shift'::regclass
     AND tgname IN ('staff_shift_refuse_reference_delete_trg', 'staff_shift_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0382: keystone.staff_shift does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  -- CT-F52 point 4b, bullet 3 / 0144 §e's end state: reference_guard_read on this table is exactly
  -- (TO reference_guard, FOR SELECT, PERMISSIVE) and nothing else.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.staff_shift'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0382: reference_guard_read on keystone.staff_shift is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  -- Positive control: a self-check made only of negative assertions passes on a database where
  -- nothing exists at all. Assert what app_rw CAN do, alongside what it cannot.
  IF NOT has_table_privilege('app_rw', 'keystone.staff_shift', 'SELECT') THEN
    RAISE EXCEPTION '0382: app_rw is missing SELECT on keystone.staff_shift';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.staff_shift', 'INSERT') THEN
    RAISE EXCEPTION '0382: app_rw is missing INSERT on keystone.staff_shift';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.staff_shift', 'UPDATE') THEN
    RAISE EXCEPTION '0382: app_rw is missing UPDATE on keystone.staff_shift';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.staff_shift', 'DELETE') THEN
    RAISE EXCEPTION '0382: app_rw is missing DELETE on keystone.staff_shift';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.staff_shift', 'SELECT') THEN
    RAISE EXCEPTION '0382: reference_guard is missing SELECT on keystone.staff_shift';
  END IF;

  -- ── keystone.time_off ─────────────────────────────────────────────────────────────────────────
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.time_off'::regclass) THEN
    RAISE EXCEPTION '0382: keystone.time_off does not have FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO v_policy_count
    FROM pg_policy
   WHERE polrelid = 'keystone.time_off'::regclass
     AND polname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete', 'reference_guard_read');
  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION '0382: keystone.time_off does not carry exactly the five expected policies (found %)', v_policy_count;
  END IF;

  SELECT count(*) INTO v_trigger_count
    FROM pg_trigger
   WHERE tgrelid = 'keystone.time_off'::regclass
     AND tgname IN ('time_off_refuse_reference_delete_trg', 'time_off_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF v_trigger_count <> 2 THEN
    RAISE EXCEPTION '0382: keystone.time_off does not carry both guard triggers, ENABLE ALWAYS (found %)', v_trigger_count;
  END IF;

  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'keystone.time_off'::regclass
         AND p.polname  = 'reference_guard_read'
         AND p.polcmd   = 'r'                                       -- FOR SELECT, not FOR ALL
         AND p.polpermissive                                        -- PERMISSIVE, not RESTRICTIVE
         AND p.polroles = ARRAY['reference_guard'::regrole::oid])   -- TO reference_guard ONLY
     <> 1 THEN
    RAISE EXCEPTION '0382: reference_guard_read on keystone.time_off is not exactly (TO reference_guard, FOR SELECT, PERMISSIVE) — CT-F52 point 4b / 0144 §e';
  END IF;

  IF NOT has_table_privilege('app_rw', 'keystone.time_off', 'SELECT') THEN
    RAISE EXCEPTION '0382: app_rw is missing SELECT on keystone.time_off';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.time_off', 'INSERT') THEN
    RAISE EXCEPTION '0382: app_rw is missing INSERT on keystone.time_off';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.time_off', 'UPDATE') THEN
    RAISE EXCEPTION '0382: app_rw is missing UPDATE on keystone.time_off';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.time_off', 'DELETE') THEN
    RAISE EXCEPTION '0382: app_rw is missing DELETE on keystone.time_off';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.time_off', 'SELECT') THEN
    RAISE EXCEPTION '0382: reference_guard is missing SELECT on keystone.time_off';
  END IF;
END
$ct_f52_self_check$;

-- CT-F52 point 7 — the census entry (src/people/scheduling.mjs → DOMAIN_WRITERS) is added by 12.1,
-- not by this migration.

-- Written, not applied.
