-- 0401_availability_cache_shift_timeoff — Stage 13 task 13.6 · CT-F23 (Stage 12's staff_shift/time_off)
--   + CT-F28 (Stage 13's availability_cache, migration 0400)
--
-- 13.5's migration 0400 wired SIX invalidation triggers onto the tables that decide a host's
-- availability — booking, availability_rule, date_override, booking_policy, tenant_setting, service —
-- but 13.5 measured and reported that Stage 12's keystone.staff_shift and keystone.time_off (0382)
-- can ALSO change whether a host is working a given day, and NEITHER fired an invalidation. A coach
-- takes the afternoon off; if nothing empties the cache, the stale slot list still offers that time
-- and a client books a session the coach is not there for. This migration closes that hole — nothing
-- else.
--
-- Reuses 0400's own trigger idiom verbatim: `keystone.availability_cache_invalidate()` is a single
-- trigger function that reads TG_ARGV[0] as the name of the person-identifying column on the firing
-- table (0400:50-73, the ELSE branch: "a person column: 'host_id' or 'app_user_id'"), deletes every
-- cache row for that host, and covers INSERT/UPDATE/DELETE from ONE trigger declaration because it
-- reads OLD on delete/update and NEW on insert/update and unions both ids into the DELETE's IN (...).
-- That union is exactly what makes an UPDATE that MOVES a shift from one host to another invalidate
-- BOTH hosts in a single firing — the old host's row (from OLD.app_user_id) and the new host's row
-- (from NEW.app_user_id) are both named in the same `IN ((o->>k)::uuid, (n->>k)::uuid)` clause.
--
-- Column name: both keystone.staff_shift and keystone.time_off store the host under `app_user_id`
-- (0382:18, 0382:39, MEASURED) — the same column name the plan's field 4 names, so no correction is
-- needed here (REFRESH item R-2).
--
-- Time: staff_shift/time_off store LOCAL wall-clock dates and minutes (0382:3-10, MEASURED — "the
-- PRACTICE's wall clock, same convention as availability_rule/date_override... this migration is not
-- that caller, so it does not attempt that arithmetic"). This migration adds no time arithmetic of its
-- own: it only deletes cache rows keyed by (tenant_id, host_id, service_id, day), so it carries no
-- UTC/DST exposure to correct — the zoned conversion belongs to 13.18's readSlots, which already owns
-- turning a local wall-clock moment into a real instant in an IANA zone.

CREATE TRIGGER availability_cache_shift AFTER INSERT OR UPDATE OR DELETE ON keystone.staff_shift
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('app_user_id');
CREATE TRIGGER availability_cache_time_off AFTER INSERT OR UPDATE OR DELETE ON keystone.time_off
  FOR EACH ROW EXECUTE FUNCTION keystone.availability_cache_invalidate('app_user_id');

-- ═══ self-check, with a positive control in the same block (0369/0370's template) ══════════════════
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.staff_shift'::regclass AND tgname = 'availability_cache_shift'
     AND NOT tgisinternal AND tgenabled <> 'D';
  IF n <> 1 THEN
    RAISE EXCEPTION '0401 — availability_cache_shift must exist on keystone.staff_shift and be enabled, found %', n;
  END IF;
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'keystone.time_off'::regclass AND tgname = 'availability_cache_time_off'
     AND NOT tgisinternal AND tgenabled <> 'D';
  IF n <> 1 THEN
    RAISE EXCEPTION '0401 — availability_cache_time_off must exist on keystone.time_off and be enabled, found %', n;
  END IF;
  -- ★ positive control: the two guard triggers 0382 put on these same tables must still be there —
  --   proves this migration did not silently disable something already present, not merely that its
  --   own two triggers exist.
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = ANY (ARRAY['keystone.staff_shift'::regclass, 'keystone.time_off'::regclass])
     AND tgname LIKE '%refuse_reference%' AND tgenabled = 'A';
  IF n <> 4 THEN
    RAISE EXCEPTION '0401 — expected 4 pre-existing refuse_touch_reference_rows triggers (2 per table, ENABLE ALWAYS) still present, found %', n;
  END IF;
END $$;

-- Written, not applied.
