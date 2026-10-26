-- 0803: "Make Owner" could never hand a workspace over (R13-D502): the one-Owner index refuses a second Owner and enforce_last_owner() refuses losing the only one, so neither order of two updates works.
-- keystone.transfer_ownership(from, to) moves the Owner rank in ONE call: it tells the guard a hand-over is under way (this transaction only), demotes the old Owner, promotes the new one, then checks exactly one Owner is left.
CREATE OR REPLACE FUNCTION keystone.enforce_last_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_caller_tenant text;
  v_owners        integer;
BEGIN
  IF OLD.staff_role IS DISTINCT FROM 'owner' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.staff_role IS NOT DISTINCT FROM 'owner' AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  -- a hand-over in progress (keystone.transfer_ownership) re-checks the whole rule itself before it returns
  IF TG_OP = 'UPDATE' AND current_setting('keystone.owner_transfer', true) = 'on' THEN RETURN NEW; END IF;
  v_caller_tenant := current_setting('keystone.tenant_id', true);
  BEGIN
    PERFORM set_config('keystone.tenant_id', OLD.tenant_id::text, true);
    SELECT count(*) INTO v_owners FROM keystone.app_user u WHERE u.tenant_id = OLD.tenant_id AND u.staff_role = 'owner' AND u.id <> OLD.id;
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('keystone.tenant_id', coalesce(v_caller_tenant, ''), true);
    RAISE;
  END;
  IF v_owners = 0 THEN
    RAISE EXCEPTION 'a practice must always have an Owner'
      USING ERRCODE = 'check_violation',
            DETAIL  = format('app_user %s is the only person with staff_role = ''owner'' in practice %s', OLD.id, OLD.tenant_id),
            HINT    = 'Give the Owner rank to somebody else in this practice first, then change or remove this person.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

CREATE OR REPLACE FUNCTION keystone.transfer_ownership(p_from uuid, p_to uuid)
RETURNS void LANGUAGE plpgsql SET search_path = keystone, pg_temp AS $f$
DECLARE v_tenant uuid; v_owners integer;
BEGIN
  SELECT tenant_id INTO v_tenant FROM keystone.app_user WHERE id = p_from AND role = 'staff' AND staff_role = 'owner' FOR UPDATE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'only the Owner can hand the workspace over' USING ERRCODE = 'check_violation'; END IF;
  PERFORM 1 FROM keystone.app_user WHERE id = p_to AND tenant_id = v_tenant AND role = 'staff' AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such staff member in this organisation' USING ERRCODE = 'no_data_found'; END IF;
  PERFORM set_config('keystone.owner_transfer', 'on', true);
  UPDATE keystone.app_user SET staff_role = 'admin', updated_at = now() WHERE id = p_from;
  UPDATE keystone.app_user SET staff_role = 'owner', updated_at = now() WHERE id = p_to;
  PERFORM set_config('keystone.owner_transfer', 'off', true);
  SELECT count(*) INTO v_owners FROM keystone.app_user WHERE tenant_id = v_tenant AND staff_role = 'owner';
  IF v_owners <> 1 THEN RAISE EXCEPTION 'hand-over left % Owners', v_owners USING ERRCODE = 'check_violation'; END IF;
END
$f$;
REVOKE ALL ON FUNCTION keystone.transfer_ownership(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.transfer_ownership(uuid, uuid) TO app_rw;
