-- 0498_availability_controls
--
-- Stage 20 run 2 — AVAILABILITY (Ty, 25 Sep 2026). Researched against Acuity, Square, Calendly,
-- Cal.com: five controls are standard everywhere. MEASURED against this codebase before writing a
-- line, three of the five already existed and are NOT rebuilt here:
--   · date overrides — `keystone.date_override` (0013) + `upsertDateOverride` + `POST
--     /api/engagements/date-overrides` + `readSlots` reads it. Missing only a SCREEN.
--   · breaks — `availability_rule` holds several windows per day; `setWeekHours` (13.22) saves a
--     whole week with multiple non-overlapping ranges per day. A break IS the gap between two
--     ranges — the Calendly/Cal.com model. Missing only a SCREEN affordance.
--   · minimum notice — `booking_policy.minimum_notice_minutes` (per service) over
--     `booking.notice_minutes` (practice, default 120), applied when slots are OFFERED
--     (`read.mjs`) and re-checked on BOTH client write doors (`publicBooking.mjs`, `routes/app.mjs`).
--     Staff doors are deliberately exempt (a coach may book a walk-in).
-- This migration adds the two that genuinely did not exist:
--
--   §1  START-TIME INTERVAL — `booking_policy.start_interval_minutes` (per service, NULL = the
--       practice's `booking.start_interval_minutes`, default 30). Before this, `readSlots` passed
--       NO duration and NO step, so `generateSlots` fell back to 60/60 for every service: a
--       50-minute service was offered as 60-minute slots on the hour. [MEASURED read.mjs:178-183]
--   §2  DAILY CAP — `keystone.host_booking_limit`: the most sessions one host takes in a LOCAL day,
--       regardless of open hours. No row = no cap.
--
-- CT-F52 — the new-tenant-table checklist for §2 (idiom from 0381/0496/0497).

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §1 · start-time interval, per service
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.booking_policy
  ADD COLUMN start_interval_minutes integer NULL
    CONSTRAINT booking_policy_start_interval_check
      CHECK (start_interval_minutes IS NULL OR start_interval_minutes IN (5, 10, 15, 20, 30, 45, 60, 90, 120));
COMMENT ON COLUMN keystone.booking_policy.start_interval_minutes IS
  '0498. How often a slot may START for this service (9:00, 9:30…). NULL = the practice''s
   booking.start_interval_minutes (default 30). Independent of duration: a 50-minute session on a
   30-minute interval is offered at 9:00, 9:30, 10:00 — never 9:50.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- §2 · keystone.host_booking_limit — the daily cap
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE keystone.host_booking_limit (
  tenant_id    uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  host_id      uuid NOT NULL,
  max_per_day  integer NOT NULL CHECK (max_per_day BETWEEN 1 AND 48),
  updated_by   uuid NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, host_id),
  CONSTRAINT host_booking_limit_host_fkey FOREIGN KEY (tenant_id, host_id)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT host_booking_limit_updated_by_fkey FOREIGN KEY (tenant_id, updated_by)
    REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (updated_by)
);
COMMENT ON TABLE keystone.host_booking_limit IS
  '0498. The most sessions this host takes in one LOCAL (practice-zone) day, counted over the
   occupying states (read.mjs BUSY_STATES). No row = no cap. Enforced where slots are offered, so
   both client doors refuse a full day through the same offer check.';

ALTER TABLE keystone.host_booking_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.host_booking_limit FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON keystone.host_booking_limit USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.host_booking_limit FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.host_booking_limit FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
  WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.host_booking_limit FOR DELETE USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY reference_guard_read ON keystone.host_booking_limit FOR SELECT TO reference_guard
  USING (tenant_id IN (SELECT tenant.id FROM keystone.tenant WHERE tenant.is_reference));
GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.host_booking_limit TO app_rw;
GRANT SELECT ON keystone.host_booking_limit TO reference_guard;

-- ★ A cap change changes which slots are offered — invalidate that host's cached days, through the
--   same function every other slot input uses (0400).
CREATE TRIGGER availability_cache_host_limit AFTER INSERT OR UPDATE OR DELETE ON keystone.host_booking_limit
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('host_id');

-- ★★★ THE EXECUTE LEND (0381's idiom).
SET LOCAL ROLE reference_guard;
GRANT EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() TO app_owner;
SET LOCAL ROLE app_owner;

CREATE TRIGGER host_booking_limit_refuse_reference_delete_trg AFTER DELETE ON keystone.host_booking_limit
  REFERENCING OLD TABLE AS deleted_rows FOR EACH STATEMENT
  EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.host_booking_limit ENABLE ALWAYS TRIGGER host_booking_limit_refuse_reference_delete_trg;
CREATE TRIGGER host_booking_limit_refuse_reference_truncate_trg BEFORE TRUNCATE ON keystone.host_booking_limit
  FOR EACH STATEMENT EXECUTE FUNCTION keystone.refuse_touch_reference_rows();
ALTER TABLE keystone.host_booking_limit ENABLE ALWAYS TRIGGER host_booking_limit_refuse_reference_truncate_trg;

SET LOCAL ROLE reference_guard;
REVOKE EXECUTE ON FUNCTION keystone.refuse_touch_reference_rows() FROM app_owner;
SET LOCAL ROLE app_owner;

-- self-check — by content
DO $check$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'keystone' AND table_name = 'booking_policy'
                    AND column_name = 'start_interval_minutes') THEN
    RAISE EXCEPTION '0498: booking_policy.start_interval_minutes missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'keystone.host_booking_limit'::regclass
                   AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '0498: host_booking_limit is not ENABLE + FORCE RLS';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.host_booking_limit'::regclass AND NOT tgisinternal AND tgenabled = 'A';
  IF n <> 2 THEN RAISE EXCEPTION '0498: host_booking_limit has % ENABLE ALWAYS triggers, expected 2', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'availability_cache_host_limit'
                   AND tgrelid = 'keystone.host_booking_limit'::regclass) THEN
    RAISE EXCEPTION '0498: cache invalidation trigger missing on host_booking_limit';
  END IF;
END
$check$;
