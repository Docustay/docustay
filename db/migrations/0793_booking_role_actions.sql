-- 0793 — COACH BOOKING SWITCHES (Ty, 22 Oct 2026; plan §3, spec BOOKING-EVERYWHERE §6, conflict 5). Four named actions:
--   booking.own_page         Manage their own booking page      (Coach default ON)
--   booking.view_all         See everyone's bookings            (Coach default off; view only, edit stays their own)
--   booking.services_manage  Edit services and who delivers them (Coach default off)
--   booking.pages_manage     Create and edit custom pages        (Coach default off)
-- Owner and Admin hold all four in every practice. "Manage their own hours" and "See their own bookings" are the existing
-- engagement edit/owned grant, not switches.
-- ★ THE CHECK IS WIDENED, NEVER NARROWED, and it is widened FROM THE LIVE DEFINITION (whatever other branches have appended),
--   so this file never has to restate, and can never drop, a value another migration added.

DO $widen$
DECLARE v_def text; v_vals text[]; v_new text[] := ARRAY['booking.own_page','booking.view_all','booking.services_manage','booking.pages_manage']; v text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'keystone.role_action'::regclass AND c.conname = 'role_action_action_check';
  IF v_def IS NULL THEN RAISE EXCEPTION '0793: role_action_action_check does not exist'; END IF;
  SELECT array_agg(m[1] ORDER BY ord) INTO v_vals FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, ord);
  IF coalesce(array_length(v_vals, 1), 0) < 10 THEN RAISE EXCEPTION '0793: could not read the current action list: %', v_def; END IF;
  FOREACH v IN ARRAY v_new LOOP
    IF NOT v = ANY (v_vals) THEN v_vals := v_vals || v; END IF;
  END LOOP;
  ALTER TABLE keystone.role_action DROP CONSTRAINT role_action_action_check;
  EXECUTE format('ALTER TABLE keystone.role_action ADD CONSTRAINT role_action_action_check CHECK (action = ANY (%L::text[]))', v_vals);
END
$widen$;

-- the defaults, in every practice: Owner and Admin all four; Coach (key 'member') only booking.own_page.
-- role_action has no "allowed" column: holding a row IS holding the action (0190; seed_builtin_roles writes the same rows
-- for new practices from src/permissions/defaults.mjs, which carries these four too).
DO $seed$
DECLARE v_t record;
BEGIN
  FOR v_t IN SELECT id FROM keystone.tenant_timezones_for_health() LOOP
    PERFORM set_config('keystone.tenant_id', v_t.id::text, true);
    INSERT INTO keystone.role_action (tenant_id, role_id, action)
    SELECT r.tenant_id, r.id, a.action
      FROM keystone.role r
      CROSS JOIN (VALUES ('booking.own_page'), ('booking.view_all'), ('booking.services_manage'), ('booking.pages_manage')) AS a(action)
     WHERE r.tenant_id = v_t.id AND r.personal_for_user_id IS NULL
       AND (r.key IN ('owner', 'admin') OR (r.key = 'member' AND a.action = 'booking.own_page'))
       AND NOT EXISTS (SELECT 1 FROM keystone.role_action x WHERE x.tenant_id = r.tenant_id AND x.role_id = r.id AND x.action = a.action);
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);
END
$seed$;
