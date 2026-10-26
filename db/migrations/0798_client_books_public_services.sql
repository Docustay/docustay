-- 0798_client_books_public_services — A SIGNED-IN CLIENT MAY ALSO BOOK THE PRACTICE'S PUBLIC SERVICES (Booking everywhere,
-- 22 Oct 2026; plan frame 21 "Also available", spec §3).
--
-- 0507's client branch admits only `portal_bookable` services. The client app now lists two groups: "Your sessions"
-- (clients-can-book, filtered by client type) and "Also available" (the practice's public services, which any stranger can
-- book on the website). Refusing a signed-in client what an anonymous visitor may book makes no sense, so the client branch
-- becomes `portal_bookable OR public_bookable`. Everything else is 0507's policy verbatim: the identity bind
-- (created_by = current_user_id()), the client-role check, the accepting host, bookable and active. The JS twin is
-- src/booking/createBooking.mjs opts.clientSelfService (same change, same commit).

DO $pre$
DECLARE v_check text;
BEGIN
  SELECT with_check INTO v_check FROM pg_policies WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';
  IF v_check IS NULL OR v_check !~ 'portal_bookable' OR v_check !~ 'adult_client' THEN
    RAISE EXCEPTION '0798: keystone.booking tenant_insert is not the 0507 shape — refusing to guess: %', v_check;
  END IF;
END
$pre$;

DROP POLICY tenant_insert ON keystone.booking;

CREATE POLICY tenant_insert ON keystone.booking
  FOR INSERT WITH CHECK (
    tenant_id = keystone.require_tenant_id()
    AND (
      keystone.user_may(keystone.current_user_id(), 'engagement', 'edit', host_id)
      OR (
        keystone.current_user_id() IS NULL
        AND created_by IS NULL
        AND EXISTS (
          SELECT 1 FROM keystone.app_user h
           WHERE h.id = host_id AND h.tenant_id = keystone.require_tenant_id()
             AND h.role = 'staff' AND h.accepting_new_bookings = true
        )
        AND EXISTS (
          SELECT 1 FROM keystone.service s
           WHERE s.id = service_id AND s.tenant_id = keystone.require_tenant_id()
             AND s.public_bookable = true AND s.bookable = true AND s.active = true
        )
      )
      OR (
        keystone.current_user_id() IS NOT NULL
        AND created_by = keystone.current_user_id()
        AND EXISTS (
          SELECT 1 FROM keystone.app_user c
           WHERE c.id = keystone.current_user_id() AND c.tenant_id = keystone.require_tenant_id()
             AND c.role IN ('adult_client', 'adolescent_client')
        )
        AND EXISTS (
          SELECT 1 FROM keystone.app_user h
           WHERE h.id = host_id AND h.tenant_id = keystone.require_tenant_id()
             AND h.role = 'staff' AND h.accepting_new_bookings = true
        )
        AND EXISTS (
          SELECT 1 FROM keystone.service s
           WHERE s.id = service_id AND s.tenant_id = keystone.require_tenant_id()
             AND (s.portal_bookable = true OR s.public_bookable = true)
             AND s.bookable = true AND s.active = true
        )
      )
    )
  );

COMMENT ON POLICY tenant_insert ON keystone.booking IS
  '0798 (booking everywhere): 0507 with the client branch widened to portal_bookable OR public_bookable (a signed-in client '
  'may book what a stranger may). Staff branch (0197) and anonymous public branch (0317) unchanged. JS twin: '
  'src/booking/createBooking.mjs opts.clientSelfService.';

DO $check$
DECLARE v_check text;
BEGIN
  SELECT with_check INTO v_check FROM pg_policies WHERE schemaname = 'keystone' AND tablename = 'booking' AND policyname = 'tenant_insert';
  IF v_check !~ 'portal_bookable = true\) OR \(s\.public_bookable = true' THEN
    RAISE EXCEPTION '0798: the widened client branch is not in place: %', v_check;
  END IF;
  IF v_check !~ 'user_may' OR v_check !~ 'created_by IS NULL' THEN
    RAISE EXCEPTION '0798: a 0507 branch went missing: %', v_check;
  END IF;
  RAISE NOTICE '0798: client branch admits portal or public services';
END
$check$;
