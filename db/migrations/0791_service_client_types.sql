-- 0791 — WHICH SIGNED-IN CLIENTS SEE A SERVICE (Ty, 22 Oct 2026; specs/BOOKING-EVERYWHERE-SPEC.md §3, conflict 2).
-- `service.client_types` lists the client types a "clients can book" (portal_bookable) service is offered to:
-- 'adult', 'adolescent', 'parent'. EMPTY = every client type (so every existing service keeps its current behaviour).
-- Categories (Adults, Family, …) stay display groups only: this migration does not guess types from them.
-- Also: the First Light Call (0661) was written with no price row, so Services showed it as "No, no live price". It gets a
-- free price row like every other service 0662 made (no Stripe job: a free service is never synced, and nothing is charged).

ALTER TABLE keystone.service
  ADD COLUMN IF NOT EXISTS client_types text[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_client_types_known' AND conrelid = 'keystone.service'::regclass) THEN
    ALTER TABLE keystone.service ADD CONSTRAINT service_client_types_known
      CHECK (client_types <@ ARRAY['adult', 'adolescent', 'parent']::text[]);
  END IF;
END $$;

COMMENT ON COLUMN keystone.service.client_types IS
  'Client types a portal_bookable service is offered to (adult, adolescent, parent). Empty = all. Server-enforced by src/booking/visibility.mjs.';

DO $$
DECLARE v_t uuid := keystone.resolve_tenant_by_slug('glc'); v_s uuid;
BEGIN
  IF v_t IS NULL THEN RETURN; END IF;
  PERFORM set_config('keystone.tenant_id', v_t::text, true);
  SELECT id INTO v_s FROM keystone.service WHERE tenant_id = v_t AND booking_key = 'first-light-call';
  IF v_s IS NOT NULL THEN
    INSERT INTO keystone.price (tenant_id, subject_type, subject_id, amount_minor, currency, effective_from, active)
    SELECT v_t, 'service', v_s, 0, 'USD', now(), true
     WHERE NOT EXISTS (SELECT 1 FROM keystone.price WHERE tenant_id = v_t AND subject_type = 'service' AND subject_id = v_s AND active AND effective_to IS NULL);
  END IF;
  PERFORM set_config('keystone.tenant_id', '', true);
END $$;
