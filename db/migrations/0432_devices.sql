-- 0432_devices — Stage 15 task 15.11 · CT-F09
--
-- keystone.device — readers (Stripe Terminal card-present hardware) and phones (Tap to Pay on a
-- staff phone) are ROWS: a practice's card-present equipment inventory. Also widens
-- keystone.connect_account with `terminal_location_id`, the Stripe Terminal Location a device's
-- readers register against.
--
-- ★★ THE SELECT POLICY IS TENANT-ONLY (unlike 0431's payment_link, which is money-gated) — a
--    device row is equipment (a reader's serial, a phone's registration), not money data. Field 6:
--    "equipment, not money data; routes gate owner/admin (D13)." The permission narrowing happens
--    in the route layer, not in RLS.
--
-- ★★★ `location_id` HAS NO FOREIGN KEY — THAT IS DELIBERATE (D13). Do not add one.
--
-- ★ `device_stripe_reader` is a PARTIAL unique index (`WHERE stripe_reader_id IS NOT NULL`) — most
--   devices (ordered phones, unregistered readers) have no `stripe_reader_id` yet, and a plain
--   UNIQUE constraint would collide every one of those NULLs against each other under some
--   engines; Postgres treats NULLs as distinct in a plain unique index too, so the predicate here
--   is not working around a NULL-collision bug — it is keeping the index itself small and reading
--   as "no two REGISTERED readers share a Stripe reader id", which is the actual invariant, rather
--   than a broader claim about every unregistered row. Keep the predicate.
--
-- ★★ `CHECK ((state = 'deactivated') = (deactivated_at IS NOT NULL))` is a BICONDITIONAL — a
--    deactivated device MUST carry `deactivated_at`, and a NON-deactivated device MUST NOT.
--
-- Shape follows CT-F52 in full, copied from the two most recent complete precedents
-- (`0415_gift_card.sql`, `0402_booking_block.sql`): ENABLE+FORCE RLS, tenant-only policies (SELECT,
-- INSERT, UPDATE — no DELETE, a device is deactivated/lost, never removed), the reference-guard
-- read policy, the refuse_touch_reference_rows triggers (ENABLE ALWAYS, with the temporary EXECUTE
-- lend — 0402's header: not optional), a tenant-leading unique index, the grants, and a closing
-- self-check DO block with positive controls.

CREATE TABLE keystone.device (
  id               uuid        PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id        uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  name             text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  kind             text        NOT NULL CHECK (kind IN ('reader','phone')),

  -- ★★★ NO FK — deliberate (D13). Do not add one.
  location_id      uuid        NULL,

  state            text        NOT NULL DEFAULT 'ordered'
                     CHECK (state IN ('ordered','active','offline','deactivated','lost')),

  stripe_reader_id text        NULL,
  model            text        NULL,
  serial           text        NULL,
  app_user_id      uuid        NULL,

  last_seen        timestamptz NULL,
  registered_by    uuid        NULL,
  deactivated_at   timestamptz NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, id),

  CONSTRAINT device_deactivated_shape
    CHECK ((state = 'deactivated') = (deactivated_at IS NOT NULL))
);

-- ★ Partial — see header. Keep the predicate.
CREATE UNIQUE INDEX device_stripe_reader ON keystone.device (tenant_id, stripe_reader_id)
  WHERE stripe_reader_id IS NOT NULL;

-- the Stripe Terminal Location readers on this connected account register against.
ALTER TABLE keystone.connect_account ADD COLUMN terminal_location_id text NULL;

ALTER TABLE keystone.device ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.device FORCE  ROW LEVEL SECURITY;

-- ★ TENANT-ONLY — equipment, not money data (field 6); owner/admin gating is the route's job (D13).
CREATE POLICY tenant_isolation ON keystone.device
  USING (tenant_id = keystone.current_tenant_id());

CREATE POLICY tenant_insert ON keystone.device
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_update ON keystone.device
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

-- No tenant_delete: a device is deactivated or marked lost (state), never deleted (field 6: no DELETE grant).
GRANT SELECT, INSERT, UPDATE ON keystone.device TO app_rw;

CREATE TRIGGER device_touch BEFORE UPDATE ON keystone.device
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══ CT-F52 §3.2 points (3)(4)(5) — THE REFERENCE-PRACTICE GUARD HALF ═══════════════════════════
-- ★★★ THE EXECUTE LEND IS NOT OPTIONAL. `keystone.refuse_touch_reference_rows()` is owned by
--     `reference_guard` (0144:245) and 0099:83 revoked ALL on it FROM PUBLIC. 0151:91-110 verbatim.
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER device_refuse_reference_delete_trg AFTER DELETE ON keystone.device
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.device ENABLE ALWAYS TRIGGER device_refuse_reference_delete_trg;
CREATE TRIGGER device_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.device
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.device ENABLE ALWAYS TRIGGER device_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

GRANT SELECT ON keystone.device TO reference_guard;
CREATE POLICY reference_guard_read ON keystone.device FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));

-- ═══ CT-F52 §3.2 point (6) — THE SELF-CHECK, WITH POSITIVE CONTROLS ══════════════════════════════
DO $ct_f52_self_check$
DECLARE n int;
BEGIN
  IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'keystone.device'::regclass) THEN
    RAISE EXCEPTION '0432 — keystone.device is not FORCE ROW LEVEL SECURITY';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'device'
     AND policyname IN ('tenant_isolation','tenant_insert','tenant_update','reference_guard_read');
  IF n <> 4 THEN
    RAISE EXCEPTION '0432 — expected 4 policies on device, found %', n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='keystone'
              AND tablename='device' AND policyname='tenant_delete') THEN
    RAISE EXCEPTION '0432 — device has a tenant_delete policy but no delete path; remove one or the other';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.device'::regclass
     AND tgname IN ('device_refuse_reference_delete_trg','device_refuse_reference_truncate_trg')
     AND tgenabled = 'A';
  IF n <> 2 THEN
    RAISE EXCEPTION '0432 — both refuse_touch_reference_rows triggers must exist and be ENABLE ALWAYS on device, found %', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'keystone.device'::regclass
       AND polname = 'reference_guard_read'
       AND polroles = ARRAY['reference_guard'::regrole::oid]
       AND polcmd = 'r'
       AND polpermissive
  ) THEN
    RAISE EXCEPTION '0432 — reference_guard_read on device must be TO reference_guard ONLY, FOR SELECT, PERMISSIVE (CT-F52 point 4b)';
  END IF;

  -- ★ Positive controls, in the same block — assert what SHOULD be true, not merely what should be
  --   absent (the 0409 lesson: a check that only forbids things can forbid the very path it's
  --   testing for).
  IF NOT has_table_privilege('app_rw', 'keystone.device', 'SELECT') THEN
    RAISE EXCEPTION '0432 — app_rw is missing SELECT on device';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.device', 'INSERT') THEN
    RAISE EXCEPTION '0432 — app_rw is missing INSERT on device';
  END IF;
  IF NOT has_table_privilege('app_rw', 'keystone.device', 'UPDATE') THEN
    RAISE EXCEPTION '0432 — app_rw lost UPDATE on device; this check is not merely asserting absences';
  END IF;
  IF NOT has_table_privilege('reference_guard', 'keystone.device', 'SELECT') THEN
    RAISE EXCEPTION '0432 — reference_guard has no SELECT on device; its policy would have nothing underneath it';
  END IF;
  IF has_table_privilege('app_rw', 'keystone.device', 'DELETE') THEN
    RAISE EXCEPTION '0432 — app_rw must NOT hold DELETE on device (a device is deactivated/lost, never deleted)';
  END IF;

  -- ★ connect_account's new column exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'connect_account'
       AND column_name = 'terminal_location_id'
  ) THEN
    RAISE EXCEPTION '0432 — keystone.connect_account is missing terminal_location_id';
  END IF;
END $ct_f52_self_check$;

-- Written, not applied.
