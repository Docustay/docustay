-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0317 — A STRANGER BOOKS THROUGH A DOOR THE PRACTICE OPENED, NOT THROUGH RBAC.
-- Spec 03b task 3b.3 · CT-117 (the public unauthenticated booking trust boundary, §4.2's own review).
--
-- ★★★ WHAT THIS FIXES. §4.2 step 3 (verbatim) claims: "Every table the public booking write
--     touches (`service`, `booking_policy`, `app_user`, `booking`, `booking_participant`) is read
--     and written under the ordinary `tenant_id = keystone.current_tenant_id()` policy… RLS FORCE
--     is not suspended for this path." **MEASURED FALSE for `keystone.booking` specifically.**
--     0197 (Stage 7 task 7.18, F658 fix) gave `keystone.booking`'s `tenant_insert` policy a SECOND,
--     unconditional conjunct: `AND keystone.user_may(keystone.current_user_id(), 'engagement',
--     'edit', host_id)`. `keystone.user_may(NULL, …)` is always `false` (0192, plain SQL NULL
--     comparison) — so with no actor (`withTenant(tenantId, fn, { userId: null })`, exactly what
--     §4.2 step 3 itself prescribes for this path) **every INSERT into `keystone.booking` is
--     refused with `insufficient_privilege`, for every request, regardless of which JS function
--     issues it.** This is not a gap `src/booking/publicBooking.mjs` (task 3b.3) can route around
--     in application code — 0197's own header says so explicitly: "any future writer (a script, a
--     worker, a second route) inherits the rule too, not just this one call site." That is a
--     correct design for the staff/portal path and a correct BLOCK for the public path as the
--     policy stands today.
--
-- ★★ THE FIX IS AN `OR`, NOT A REPLACEMENT. The existing `user_may` conjunct is the staff/portal
--    admission path and is UNCHANGED — a coach still needs `engagement: edit` scope covering the
--    host to book for them, exactly as 0197 left it. This migration adds a SECOND, independent way
--    to satisfy the same WITH CHECK: an anonymous actor (`current_user_id() IS NULL`) inserting a
--    row with no `created_by` (so the row itself carries no impersonation — nobody is named as
--    having created it), for a host who has opted in (`app_user.accepting_new_bookings`, 0312) AND
--    a service the practice has opted in to the public door (`service.public_bookable`, 0311). Both
--    columns default to what the practice already had: `accepting_new_bookings` defaults `true`
--    (an existing coach's link is live the moment they set one) and `public_bookable` defaults
--    `false` (the public door exposes nothing until an Owner turns a service on) — so this policy
--    admits nothing for any tenant that has not deliberately turned the public door on for at least
--    one service, exactly the same "net-new, opt-in" property 0311/0312's own headers state.
--
-- ★★★ `h.role = 'staff'` IS LOAD-BEARING AND WOULD BE MISSING FROM THE OBVIOUS FIRST DRAFT.
--     `accepting_new_bookings` (0312) is a column on `app_user`, ADDED WITH NO `WHERE role =
--     'staff'` RESTRICTION and a DEFAULT of `true` — so a CLIENT row also reads
--     `accepting_new_bookings = true` unless something has explicitly turned it off, which nothing
--     ever does for a client (the column means nothing to one). Without the `role = 'staff'`
--     check below, a public booking request naming any client's `app_user.id` as `hostId` — a
--     guessed or leaked uuid, not even a privileged one — would satisfy this policy's host half and
--     let a stranger "book a session" with another practice's client as the host. The service half
--     alone does not stop this (a real public-bookable service still exists). Caught by reading the
--     column's own ALTER (0312) rather than assuming its name implies the restriction.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that drops the OR branch,
--   same reasoning 0189/0193/0195/0197 give for their own reversible policy changes.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry counts and booleans only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  v_check text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0317: must run as app_owner (db/migrate.mjs sets it), running as %', current_user;
  END IF;

  IF to_regclass('keystone.booking') IS NULL THEN
    RAISE EXCEPTION '0317: keystone.booking does not exist';
  END IF;
  IF to_regclass('keystone.service') IS NULL THEN
    RAISE EXCEPTION '0317: keystone.service does not exist';
  END IF;

  -- ★ 0311/0312 must already have run — this policy reads columns they add.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'service' AND column_name = 'public_bookable'
  ) THEN
    RAISE EXCEPTION '0317: keystone.service.public_bookable does not exist — 0311 must run first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'app_user' AND column_name = 'accepting_new_bookings'
  ) THEN
    RAISE EXCEPTION '0317: keystone.app_user.accepting_new_bookings does not exist — 0312 must run first';
  END IF;

  SELECT with_check INTO v_check
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';

  IF v_check IS NULL THEN
    RAISE EXCEPTION '0317: keystone.booking carries no tenant_insert policy to replace — 0197 must run first';
  END IF;
  IF v_check !~ 'user_may' THEN
    RAISE EXCEPTION '0317: keystone.booking''s tenant_insert WITH CHECK does not mention user_may — 0197 must run first, or it changed shape: %', v_check;
  END IF;
  IF v_check ~ 'public_bookable' THEN
    RAISE EXCEPTION '0317: keystone.booking''s tenant_insert WITH CHECK already mentions public_bookable — changed by hand? refusing to guess: %', v_check;
  END IF;
END
$preconditions$;

-- ── §b · THE POLICY — tenant_insert gains the OR branch ────────────────────────────────────────
DROP POLICY tenant_insert ON keystone.booking;

CREATE POLICY tenant_insert ON keystone.booking
  FOR INSERT WITH CHECK (
    tenant_id = keystone.require_tenant_id()
    AND (
      -- ★ Staff/portal path — UNCHANGED from 0197.
      keystone.user_may(keystone.current_user_id(), 'engagement', 'edit', host_id)
      OR (
        -- ★ Public path — CT-117 (spec 03b task 3b.3). No RBAC applies to a stranger; the two
        --   opt-in flags below ARE the authorization, not a check layered on top of one.
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
    )
  );

COMMENT ON POLICY tenant_insert ON keystone.booking IS
  'Spec 03b / 0317 (CT-117), task 3b.3. 0197''s staff/portal conjunct (user_may engagement:edit on '
  'host_id) is kept, ORed with a public-booking admission: no actor, no created_by, a staff host '
  'with accepting_new_bookings, and a service with public_bookable/bookable/active all true. The '
  'two opt-in columns (0311/0312) ARE the authorization for a stranger — there is no RBAC to check '
  'for someone who has no session.';

-- ── §c · SELF-CHECK, PART 1 — THE CATALOG SHAPE THIS FILE CLAIMS ───────────────────────────────
DO $shape_check$
DECLARE
  v_check text;
BEGIN
  SELECT with_check INTO v_check FROM pg_catalog.pg_policies
   WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';
  IF v_check !~ 'require_tenant_id' OR v_check !~ 'user_may' OR v_check !~ 'public_bookable' THEN
    RAISE EXCEPTION '0317: keystone.booking''s tenant_insert policy does not carry all three markers: %', v_check;
  END IF;
  RAISE NOTICE '0317: keystone.booking''s tenant_insert now admits the staff/portal path (unchanged) OR the public-booking path (new).';
END
$shape_check$;

-- ── §d · SELF-CHECK, PART 2 — A FABRICATED STRANGER, FUNCTIONALLY, WITH POSITIVE CONTROLS ──────
-- ★★★ Four assertions, all against the same fabricated tenant, all against the anonymous
--     (current_user_id() unset) actor a real public request runs as:
--       1 · service NOT public_bookable → refused (negative)
--       2 · host NOT accepting_new_bookings → refused (negative)
--       3 · a CLIENT row named as host_id (accepting_new_bookings defaults true on every app_user,
--           §★★★ above) → refused, because role <> 'staff' (negative — proves the role check is
--           load-bearing, not decorative)
--       4 · a real public-bookable service, a real accepting host, no actor, no created_by →
--           SUCCEEDS (positive control, same request shape as 1–3, only the flags differ)
--     Everything fabricated is deleted at the end of this block; nothing survives the migration.
-- ★ 0197's own §d already proves the staff/portal (user_may) branch is untouched; not re-proven here.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $public_booking_insert_check$
DECLARE
  v_tenant           uuid;
  v_host             uuid;  -- staff, accepting_new_bookings = true
  v_host_not_accepting uuid;  -- staff, accepting_new_bookings = false
  v_client           uuid;  -- role = 'adult_client', accepting_new_bookings defaults true
  v_service_public   uuid;  -- public_bookable = true
  v_service_private  uuid;  -- public_bookable = false (the 0311 default)
  v_raised           boolean;
  v_booking_public    uuid;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0317-probe', 'M0317 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0317: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role, accepting_new_bookings)
  VALUES (v_tenant, 'm0317-host@example.invalid', 'M0317 Host', 'staff', 'coach', true)
  RETURNING id INTO v_host;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role, accepting_new_bookings)
  VALUES (v_tenant, 'm0317-host-closed@example.invalid', 'M0317 Host Closed', 'staff', 'coach', false)
  RETURNING id INTO v_host_not_accepting;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0317-client@example.invalid', 'M0317 Client', 'adult_client')
  RETURNING id INTO v_client;

  INSERT INTO keystone.service (tenant_id, name, price_minor, duration_minutes, public_bookable)
  VALUES (v_tenant, 'M0317 public service', 0, 30, true) RETURNING id INTO v_service_public;

  INSERT INTO keystone.service (tenant_id, name, price_minor, duration_minutes, public_bookable)
  VALUES (v_tenant, 'M0317 private service', 5000, 30, false) RETURNING id INTO v_service_private;

  -- Anonymous throughout — no keystone.user_id is ever set in this block, matching
  -- withTenant(tenantId, fn, { userId: null }), exactly the connection the public route opens.
  IF keystone.current_user_id() IS NOT NULL THEN
    RAISE EXCEPTION '0317: probe expected an anonymous actor (current_user_id() NULL) to start';
  END IF;

  -- ── NEGATIVE 1 — service not public_bookable ───────────────────────────────────────────────
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at)
    VALUES (v_tenant, v_host, v_service_private, now() + interval '1 day', now() + interval '1 day 30 minutes');
    RAISE EXCEPTION '0317: an anonymous actor inserted a booking against a NON-public_bookable service — the policy did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0317: negative control 1 (service not public_bookable) did not raise insufficient_privilege';
  END IF;

  -- ── NEGATIVE 2 — host not accepting_new_bookings ───────────────────────────────────────────
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at)
    VALUES (v_tenant, v_host_not_accepting, v_service_public, now() + interval '1 day', now() + interval '1 day 30 minutes');
    RAISE EXCEPTION '0317: an anonymous actor inserted a booking against a host with accepting_new_bookings = false — the policy did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0317: negative control 2 (host not accepting_new_bookings) did not raise insufficient_privilege';
  END IF;

  -- ── NEGATIVE 3 — a CLIENT named as host_id (role check is load-bearing) ────────────────────
  v_raised := false;
  BEGIN
    INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at)
    VALUES (v_tenant, v_client, v_service_public, now() + interval '1 day', now() + interval '1 day 30 minutes');
    RAISE EXCEPTION '0317: an anonymous actor inserted a booking naming a CLIENT as host_id — the role=staff check did not refuse it';
  EXCEPTION WHEN insufficient_privilege THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION '0317: negative control 3 (client named as host_id) did not raise insufficient_privilege';
  END IF;

  -- ── POSITIVE CONTROL — same anonymous actor, real public service, real accepting host ─────
  INSERT INTO keystone.booking (tenant_id, host_id, service_id, starts_at, ends_at)
  VALUES (v_tenant, v_host, v_service_public, now() + interval '1 day', now() + interval '1 day 30 minutes')
  RETURNING id INTO v_booking_public;
  IF v_booking_public IS NULL THEN
    RAISE EXCEPTION '0317: the positive control (public service, accepting host, anonymous actor) could not insert';
  END IF;

  -- ── cleanup — nothing fabricated here survives the migration ───────────────────────────────
  DELETE FROM keystone.booking WHERE tenant_id = v_tenant;
  DELETE FROM keystone.service WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0317: anonymous public-booking insert refused for a non-public service, a non-accepting host, and a client named as host (3 negative controls); admitted for a real public-bookable service and a real accepting staff host (positive control). Probe tenant % removed.', v_tenant;
END
$public_booking_insert_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0317: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
