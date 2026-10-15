-- 0226 — COACH MAY INVITE A CLIENT, NOT A STAFF MEMBER. (F626 gap 2, closing task 8.12's stop.)
-- `role_action` (0190) grants `team.invite` to owner/admin only; coach's three named actions are
-- person.create, template.author, document.sign (0190:232). `assertMay` (src/permissions/
-- assertMay.mjs:104-116) gates /api/people/invite on the single static action `team.invite` before
-- the handler ever runs, so a Coach's POST was refused for a CLIENT invite too, contradicting Q8-6
-- ("inviting a client is a coach's own job"). This grants the EXISTING action; the staff-vs-client
-- split stays in the handler (src/routes/writes.mjs's inviteWithRoleCheck, task 8.12), which asks a
-- SECOND existing question (staff_role.change, owner/admin only, 0190:220,226) only for a staff
-- invite — same idiom src/booking/createBooking.mjs:149-154 (task 7.18) already uses.
-- A tenant created AFTER this migration does not get this row either — keystone.seed_builtin_roles()
-- never writes role_action for any role or action (MEASURED, test/s7_api_key_actor.test.mjs:237-238,
-- true before this file too). Pre-existing, out of this fix's scope.

DO $preconditions$
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0226: must run as app_owner (db/migrate.mjs sets it), running as %', current_user;
  END IF;
  IF to_regclass('keystone.role_action') IS NULL THEN
    RAISE EXCEPTION '0226: keystone.role_action does not exist — 0190 must apply first';
  END IF;
END
$preconditions$;

DO $coach_may_invite$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_ins          integer;
  i              integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0226: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  IF v_tenant_count = 0 THEN
    RAISE NOTICE '0226: 0 practices exist on this database — nothing to grant. Expected on a fresh database.';
  END IF;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0226: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    INSERT INTO keystone.role_action (tenant_id, role_id, action)
    SELECT v_tenant_id, r.id, 'team.invite'
      FROM keystone.role r
     WHERE r.tenant_id = v_tenant_id AND r.key = 'coach'
    ON CONFLICT (tenant_id, role_id, action) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;

    RAISE NOTICE '0226: practice % · % role_action row(s) affected', v_tenant_id, v_ins;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0226: % practice(s) checked for coach/team.invite', v_tenant_count;
END
$coach_may_invite$;

-- closing self-check — every practice's coach role now holds team.invite, re-read under its own GUC
DO $closing_check$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_holds      integer;
  i            integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    SELECT count(*) INTO v_holds
      FROM keystone.role_action ra
      JOIN keystone.role r ON r.id = ra.role_id AND r.tenant_id = keystone.current_tenant_id()
     WHERE r.key = 'coach' AND ra.action = 'team.invite';
    IF v_holds <> 1 THEN
      RAISE EXCEPTION '0226: practice % coach role holds % team.invite row(s) after seeding, expected 1',
        v_tenant_id, v_holds;
    END IF;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);
  RAISE NOTICE '0226: closing check passed for every practice';
END
$closing_check$;
