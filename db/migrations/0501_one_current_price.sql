-- 0501_one_current_price
--
-- 0413 meant to widen `keystone.current_price` with location and delivery mode "existing callers
-- unchanged", but `CREATE OR REPLACE` with a longer argument list creates a SECOND function beside the
-- first. Both carry defaults, so every existing two-argument call — `current_price('service', id)`,
-- in the items list, the record queries and the online-booking summary — became
--   ERROR: function keystone.current_price(unknown, unknown) is not unique
-- It stayed invisible while a practice had no services: the calls sit in sub-selects that only run
-- per row. [MEASURED 25 Sep 2026, GET /api/engagements/online-booking as Docustay's owner after the import.]
--
-- The five-argument version returns the same columns and resolves (location AND mode) > location >
-- mode > base, so with no location or mode it is the old answer. The three-argument one goes.
-- No object depends on it (pg_depend); app_rw and app_worker already execute the survivor.

DROP FUNCTION keystone.current_price(text, uuid, timestamptz);

DO $check$
DECLARE
  n int;
  v_service uuid;
BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname = 'keystone' AND p.proname = 'current_price';
  IF n <> 1 THEN RAISE EXCEPTION '0501: expected one keystone.current_price, found %', n; END IF;
  IF NOT has_function_privilege('app_rw', 'keystone.current_price(text, uuid, timestamptz, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0501: app_rw cannot execute keystone.current_price';
  END IF;
  -- The two-argument call that failed now resolves (it plans even with no row to price).
  PERFORM * FROM keystone.current_price('service', '00000000-0000-0000-0000-000000000000'::uuid);
  RAISE NOTICE '0501: one current_price; the two-argument call resolves';
END
$check$;
