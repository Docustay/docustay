-- 0592 · THE CONTRACT HALF OF `coaching_group` (QUEUE §4, the maintainer 2 Oct 2026: "remove coaching_group everywhere").
-- Programs (0543 + 0591) replaced the hard-coded life/recovery column; every write and read of it is gone from the code in the same release
-- (src/items/*, src/money/catalogue.mjs + metadata.mjs, src/routes/app.mjs, the web editors). No view depends on it (checked in pg_depend).
-- Any row that still has no program_id is given the program its coaching_group named BEFORE the column goes — nothing is lost.
-- ★ Row-level security is FORCED, so the backfill runs one practice at a time under that practice's own tenant context (the 0543 pattern).
DO $backfill$
DECLARE
  v_ids uuid[]; v_id uuid; i integer; t text; v_left bigint;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOR i IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
    v_id := v_ids[i];
    PERFORM set_config('keystone.tenant_id', v_id::text, true);
    FOREACH t IN ARRAY ARRAY['service','package','plan'] LOOP
      EXECUTE format($q$
        UPDATE keystone.%I x SET program_id = p.id
          FROM keystone.program p
         WHERE x.tenant_id = %L AND x.program_id IS NULL AND p.tenant_id = x.tenant_id
           AND lower(p.name) = CASE x.coaching_group WHEN 'life' THEN 'life coaching' ELSE 'recovery coaching' END
      $q$, t, v_id);
    END LOOP;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $backfill$;
ALTER TABLE keystone.service DROP COLUMN coaching_group;
ALTER TABLE keystone.package DROP COLUMN coaching_group;
ALTER TABLE keystone.plan    DROP COLUMN coaching_group;
