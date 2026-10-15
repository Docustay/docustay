-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0507 — A SIGNED-IN CLIENT BOOKS THEMSELVES, THROUGH THE PORTAL, NOT THROUGH RBAC.
-- Step-4 FIX report item: "NO signed-in client can book a session."
--
-- ★★★ WHAT THIS FIXES. `keystone.booking`'s `tenant_insert` policy (0197, widened by 0317 for the
--     anonymous public-booking path) admits an INSERT only when `keystone.user_may(current_user_id(),
--     'engagement', 'edit', host_id)` is true, OR the 0317 anonymous-stranger branch matches.
--     [MEASURED] a signed-in CLIENT holds no `user_role` at all — `user_may` for a client is always
--     false — so `POST /api/app/booking` (a REAL SESSION, not the anonymous public page) was refused
--     with 403 for every client, every time. §4.2's own public-booking path (0317) exists precisely
--     because RBAC does not apply to a stranger; a SIGNED-IN client is not a stranger and is not
--     staff either — this policy simply never gave that identity a door.
--
-- ★★ THE FIX IS A THIRD `OR` BRANCH, NOT A REPLACEMENT. The staff/portal (`user_may`) branch and the
--    0317 anonymous-public branch are BOTH UNCHANGED. This adds: a REAL session (`current_user_id()
--    IS NOT NULL`), inserting a row that names THEMSELVES as `created_by` (never anybody else — the
--    row cannot carry an impersonation), where the actor's own `app_user` row is a client role in
--    THIS tenant, the host has opted in (`accepting_new_bookings`, same column 0317 reads), and the
--    service is bookable/active AND has the client-portal door open (`portal_bookable`, 0311 — the
--    DIFFERENT flag from 0317's `public_bookable`: the portal door is for a signed-in client of this
--    practice; the public door is for a stranger with no account at all).
--
-- ★ THE JS LAYER CARRIES THE SAME THREE CONDITIONS, EXPLICITLY, BEFORE THIS POLICY IS EVER REACHED
--   (`src/booking/createBooking.mjs`, `opts.clientSelfService`, same task) — belt and braces, same
--   reasoning 0197/0317 already give for keeping both layers: this policy is the backstop that holds
--   even if a future code path skips the JS check.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that drops the OR branch,
--   same reasoning 0189/0193/0195/0197/0317 give for their own reversible policy changes.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry counts and booleans only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  v_check text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0507: must run as app_owner (db/migrate.mjs sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0507: keystone.booking does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'service' AND column_name = 'portal_bookable'
  ) THEN
    RAISE EXCEPTION '0507: keystone.service.portal_bookable does not exist — 0311 must run first';
  END IF;

  SELECT with_check INTO v_check
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';

  IF v_check IS NULL THEN
    RAISE EXCEPTION '0507: keystone.booking carries no tenant_insert policy to replace — 0197/0317 must run first';
  END IF;
  IF v_check !~ 'user_may' OR v_check !~ 'public_bookable' THEN
    RAISE EXCEPTION '0507: keystone.booking''s tenant_insert WITH CHECK is not the 0317 shape (user_may + public_bookable) — refusing to guess: %', v_check;
  END IF;
  IF v_check ~ 'portal_bookable' THEN
    RAISE EXCEPTION '0507: keystone.booking''s tenant_insert WITH CHECK already mentions portal_bookable — changed by hand? refusing to guess: %', v_check;
  END IF;
END
$preconditions$;

-- ── §b · THE POLICY — tenant_insert gains a THIRD OR branch (client self-service) ──────────────
DROP POLICY tenant_insert ON keystone.booking;

CREATE POLICY tenant_insert ON keystone.booking
  FOR INSERT WITH CHECK (
    tenant_id = keystone.require_tenant_id()
    AND (
      -- ★ Staff/portal path — UNCHANGED from 0197.
      keystone.user_may(keystone.current_user_id(), 'engagement', 'edit', host_id)
      OR (
        -- ★ Anonymous public path — UNCHANGED from 0317.
        keystone.current_user_id() IS NULL
        AND created_by IS NULL
        AND EXISTS (
          SELECT 1 FROM keystone.app_user h
           WHERE h.id = host_id
             AND h.tenant_id = keystone.require_tenant_id()
             AND h.role = 'staff'
             AND h.accepting_new_bookings = true
        )
        AND EXISTS (
          SELECT 1 FROM keystone.service s
           WHERE s.id = service_id
             AND s.tenant_id = keystone.require_tenant_id()
             AND s.public_bookable = true
             AND s.bookable = true
             AND s.active = true
        )
      )
      OR (
        -- ★ NEW — a SIGNED-IN CLIENT books THEMSELVES through the client-portal door.
        --   `created_by = current_user_id()` is the identity bind: a client can never name anybody
        --   else, and nobody else can book while impersonating this client's session.
        keystone.current_user_id() IS NOT NULL
        AND created_by = keystone.current_user_id()
        AND EXISTS (
          SELECT 1 FROM keystone.app_user c
           WHERE c.id = keystone.current_user_id()
             AND c.tenant_id = keystone.require_tenant_id()
             AND c.role IN ('adult_client', 'adolescent_client')
        )
        AND EXISTS (
          SELECT 1 FROM keystone.app_user h
           WHERE h.id = host_id
             AND h.tenant_id = keystone.require_tenant_id()
             AND h.role = 'staff'
             AND h.accepting_new_bookings = true
        )
        AND EXISTS (
          SELECT 1 FROM keystone.service s
           WHERE s.id = service_id
             AND s.tenant_id = keystone.require_tenant_id()
             AND s.portal_bookable = true
             AND s.bookable = true
             AND s.active = true
        )
      )
    )
  );

COMMENT ON POLICY tenant_insert ON keystone.booking IS
  '0507 (step-4 FIX, "no signed-in client can book"). 0197''s staff/portal conjunct and 0317''s '
  'anonymous-public branch are both kept, unchanged, ORed with a THIRD branch: a real session whose '
  'own app_user row is a client role in this tenant, inserting created_by = themselves, for a staff '
  'host with accepting_new_bookings and a service with portal_bookable/bookable/active all true. '
  'Backstop for src/booking/createBooking.mjs''s opts.clientSelfService JS-layer check (same task).';

-- ── §c · SELF-CHECK, PART 1 — THE CATALOG SHAPE THIS FILE CLAIMS ───────────────────────────────
DO $shape_check$
DECLARE
  v_check text;
BEGIN
  SELECT with_check INTO v_check FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';
  IF v_check !~ 'require_tenant_id' OR v_check !~ 'user_may' OR v_check !~ 'public_bookable'
     OR v_check !~ 'portal_bookable' THEN
    RAISE EXCEPTION '0507: keystone.booking''s tenant_insert policy does not carry all four markers: %', v_check;
  END IF;
  RAISE NOTICE '0507: keystone.booking''s tenant_insert now admits staff/portal (unchanged) OR anonymous-public (unchanged) OR signed-in-client-self-service (new).';
END
$shape_check$;

-- ── §d · SELF-CHECK, PART 2 — A FABRICATED CLIENT, FUNCTIONALLY, WITH POSITIVE CONTROLS ────────
-- ★★★ Four negatives and one positive, all against the same fabricated tenant, all run AS the
--     client session a real `POST /api/app/booking` runs under (`current_user_id()` set, matching
--     `withTenant(tenantId, fn, { userId: clientId })`):
--       1 · created_by names SOMEBODY ELSE, not the actor → refused (identity bind is load-bearing)
--       2 · the actor is a PARENT, not a client role → refused (role check is load-bearing)
--       3 · host NOT accepting_new_bookings → refused
--       4 · service NOT portal_bookable → refused
--       5 · everything true, created_by = self → SUCCEEDS (positive control, same shape as 1–4)
--     Everything fabricated is deleted at the end of this block; nothing survives the migration.
-- ★ 0197/0317's own §d already prove the staff/portal and anonymous-public branches; not re-proven here.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $client_self_booking_insert_check$
DECLARE
  v_tenant              uuid;
  v_client              uuid;  -- adult_client, the actor
  v_someone_else        uuid;  -- another client — never named as created_by by the actor
  v_parent              uuid;  -- role = 'parent' — not a bookable client role
  v_host                uuid;  -- staff, accepting_new_bookings = true
  v_host_closed         uuid;  -- staff, accepting_new_bookings = false
  v_service_portal      uuid;  -- portal_bookable = true
  v_service_not_portal  uuid;  -- portal_bookable = false
  v_raised              boolean;
  v_booking_self        uuid;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0507-probe', 'M0507 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0507: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0507-client@example.invalid', 'M0507 Client', 'adult_client')
  RETURNING id INTO v_client;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0507-other@example.invalid', 'M0507 Other Client', 'adult_client')
  RETURNING id INTO v_someone_else;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0507-parent@example.invalid', 'M0507 Parent', 'parent')
  RETURNING id INTO v_parent;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role, accepting_new_bookings)
  VALUES (v_tenant, 'm0507-host@example.invalid', 'M0507 Host', 'staff', 'coach', true)
  RETURNING id INTO v_host;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role, accepting_new_bookings)
  VALUES (v_tenant, 'm0507-host-closed@example.invalid', 'M0507 Host Closed', 'staff', 'coach', false)
  RETURNING id INTO v_host_closed;

  INSERT INTO keystone.service (tenant_id, name, price_minor, duration_minutes, portal_bookable)
  VALUES (v_tenant, 'M0507 portal service', 5000, 30, true) RETURNING id INTO v_service_portal;

  INSERT INTO keystone.service (tenant_id, name, price_minor, duration_minutes, portal_bookable)
  VALUES (v_tenant, 'M0507 non-portal service', 5000, 30, false) RETURNING id INTO v_service_not_portal;

  PERFORM set_config('keystone.user_id', v_client::text, true);
  IF keystone.current_user_id() IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION '0507: the user context did not take effect for the probe client';
  END IF;

  -- ── NEGATIVE 1 — created_by names somebody else, not the actor ─────────────────────────────
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
    VALUES (v_tenant, v_host, v_service_portal, now() + interval '1 day', now() + interval '1 day 30 minutes', v_someone_else);
    RAISE EXCEPTION '0507: client inserted a booking with created_by naming SOMEBODY ELSE — the identity bind did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0507: negative control 1 (created_by not the actor) did not raise insufficient_privilege';
  END IF;

  -- ── NEGATIVE 2 — the actor is a parent, not a bookable client role ─────────────────────────
  PERFORM set_config('keystone.user_id', v_parent::text, true);
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
    VALUES (v_tenant, v_host, v_service_portal, now() + interval '1 day', now() + interval '1 day 30 minutes', v_parent);
    RAISE EXCEPTION '0507: a PARENT inserted a self-booking — the role=client check did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0507: negative control 2 (actor is a parent) did not raise insufficient_privilege';
  END IF;
  PERFORM set_config('keystone.user_id', v_client::text, true);

  -- ── NEGATIVE 3 — host not accepting_new_bookings ────────────────────────────────────────────
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
    VALUES (v_tenant, v_host_closed, v_service_portal, now() + interval '1 day', now() + interval '1 day 30 minutes', v_client);
    RAISE EXCEPTION '0507: client inserted a self-booking against a host with accepting_new_bookings = false — the policy did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0507: negative control 3 (host not accepting) did not raise insufficient_privilege';
  END IF;

  -- ── NEGATIVE 4 — service not portal_bookable ────────────────────────────────────────────────
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
    VALUES (v_tenant, v_host, v_service_not_portal, now() + interval '1 day', now() + interval '1 day 30 minutes', v_client);
    RAISE EXCEPTION '0507: client inserted a self-booking against a NON-portal_bookable service — the policy did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0507: negative control 4 (service not portal_bookable) did not raise insufficient_privilege';
  END IF;

  -- ── POSITIVE CONTROL — same client, real portal service, real accepting host, created_by = self ──
  INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at, created_by)
  VALUES (v_tenant, v_host, v_service_portal, now() + interval '1 day', now() + interval '1 day 30 minutes', v_client)
  RETURNING id INTO v_booking_self;
  IF v_booking_self IS NULL THEN
    RAISE EXCEPTION '0507: the positive control (client self-booking, portal service, accepting host) could not insert';
  END IF;

  -- ── cleanup — nothing fabricated here survives the migration ───────────────────────────────
  PERFORM set_config('keystone.user_id', '', true);
  DELETE FROM keystone.booking WHERE tenant_id = v_tenant;
  DELETE FROM keystone.service WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0507: a signed-in client self-booking insert was refused when created_by named somebody else, when the actor was a parent, when the host was not accepting, and when the service was not portal_bookable (4 negative controls); admitted when all four held (positive control). Probe tenant % removed.', v_tenant;
END
$client_self_booking_insert_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0507: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
