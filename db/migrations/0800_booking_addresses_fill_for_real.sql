-- 0800 — the booking-address and First Light Call writes, done for real (23 Oct 2026; F173, the F143/F709 class).
-- 0790 and 0795 ran as app_owner with only a tenant set. keystone.service, keystone.app_user and keystone.booking_policy have FORCE ROW
-- LEVEL SECURITY and their UPDATE policies need a signed-in viewer, so those UPDATEs changed ZERO rows (measured on a copy of production:
-- an UPDATE of glc's 20 services, 3 staff and 1 policy as app_owner with the tenant set reached 0 rows). Their INSERTs into
-- keystone.booking_address did land, so an address can exist while the service's booking_key or the person's booking_slug is still empty.
-- This file lifts FORCE for its own writes and puts it back in the same transaction (as 0531 and 0774 do), fills only what is empty from
-- the live address 0790 already recorded, applies 0795's rule, and checks its own result.

ALTER TABLE keystone.service NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_policy NO FORCE ROW LEVEL SECURITY;
-- read, not written: its rows are just as invisible to app_owner under FORCE with no tenant set
ALTER TABLE keystone.booking_address NO FORCE ROW LEVEL SECURITY;

-- a service whose live address 0790 recorded, but whose booking_key it could not fill
UPDATE keystone.service s
   SET booking_key = a.path
  FROM keystone.booking_address a
 WHERE a.tenant_id = s.tenant_id AND a.kind = 'service' AND a.target_id = s.id AND a.state = 'live'
   AND s.booking_key IS NULL;

-- a person whose live address 0790 recorded, but whose booking_slug it could not fill
UPDATE keystone.app_user u
   SET booking_slug = a.path
  FROM keystone.booking_address a
 WHERE a.tenant_id = u.tenant_id AND a.kind = 'person' AND a.target_id = u.id AND a.state = 'live'
   AND u.booking_slug IS NULL;

-- 0795: glc's First Light Call, free to change or cancel online until 2 hours before (no-op where it already is, and in every other practice)
UPDATE keystone.booking_policy p
   SET reschedule_notice_minutes = 120, cancellation_notice_minutes = 120,
       late_cancel_behaviour = 'free', late_cancel_charge_percent = 0
  FROM keystone.service s
 WHERE s.id = p.service_id AND s.tenant_id = p.tenant_id
   AND p.tenant_id = keystone.resolve_tenant_by_slug('glc') AND s.booking_key = 'first-light-call'
   AND (p.reschedule_notice_minutes IS DISTINCT FROM 120 OR p.cancellation_notice_minutes IS DISTINCT FROM 120
        OR p.late_cancel_behaviour IS DISTINCT FROM 'free');

DO $$
DECLARE n_svc int; n_person int;
BEGIN
  SELECT count(*) INTO n_svc FROM keystone.booking_address a JOIN keystone.service s ON s.tenant_id = a.tenant_id AND s.id = a.target_id
   WHERE a.kind = 'service' AND a.state = 'live' AND s.booking_key IS NULL;
  SELECT count(*) INTO n_person FROM keystone.booking_address a JOIN keystone.app_user u ON u.tenant_id = a.tenant_id AND u.id = a.target_id
   WHERE a.kind = 'person' AND a.state = 'live' AND u.booking_slug IS NULL;
  IF n_svc > 0 OR n_person > 0 THEN
    RAISE EXCEPTION '0800: % service(s) and % person(s) still have a live address and an empty key', n_svc, n_person;
  END IF;
END $$;

ALTER TABLE keystone.service FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE keystone.booking_address FORCE ROW LEVEL SECURITY;
