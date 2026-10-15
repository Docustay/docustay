-- 0593 · EVERY PRACTICE STARTS WITH A PROGRAM (QUEUE §4). Same footing as seed_units (0409): a SECURITY DEFINER the signup role can call for the tenant it is
-- already inside. A practice with exactly one program shows no program pickers (ProgramGate hides itself at 0–1), so "General" costs a one-program practice nothing;
-- it gives every new service/package/plan somewhere to live and every report a program to group by. Rename or add more in Settings → Programs & client types.
CREATE OR REPLACE FUNCTION keystone.seed_programs(p_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE v_inserted integer := 0;
BEGIN
  IF p_tenant_id IS DISTINCT FROM keystone.current_tenant_id() THEN
    RAISE EXCEPTION 'seed_programs refused: asked to seed tenant % while the transaction is in tenant %', p_tenant_id, coalesce(keystone.current_tenant_id()::text, '(none)');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM keystone.program WHERE tenant_id = p_tenant_id) THEN
    INSERT INTO keystone.program (tenant_id, name, position) VALUES (p_tenant_id, 'General', 0) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  END IF;
  RETURN v_inserted;
END $f$;
REVOKE ALL ON FUNCTION keystone.seed_programs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.seed_programs(uuid) TO app_owner, app_rw, app_signup;

-- Existing practices with NO program at all get the same one row (test practices created after 0543).
DO $b$
DECLARE v_ids uuid[]; i integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id), '{}') INTO v_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;
  FOR i IN 1 .. coalesce(array_length(v_ids, 1), 0) LOOP
    PERFORM set_config('keystone.tenant_id', v_ids[i]::text, true);
    PERFORM keystone.seed_programs(v_ids[i]);
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END $b$;
