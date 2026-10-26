-- 0795 — THE FIRST LIGHT CALL'S CHANGE AND CANCEL RULE (Ty, 22 Oct 2026; plan §8 decision 4). glc only, matched by slug,
-- a no-op in every other practice. Free to cancel or move online until 2 hours before; no late-cancel charge.
-- Online changes close at max(reschedule notice, cancellation notice) = 120 minutes. Also the website's change page, which
-- the confirmation and reminder emails link to for website bookings (booking.manage_url_base).

DO $$
DECLARE v_t uuid := keystone.resolve_tenant_by_slug('glc'); v_s uuid;
BEGIN
  IF v_t IS NULL THEN RETURN; END IF;
  PERFORM set_config('keystone.tenant_id', v_t::text, true);
  SELECT id INTO v_s FROM keystone.service WHERE tenant_id = v_t AND booking_key = 'first-light-call';
  IF v_s IS NOT NULL THEN
    UPDATE keystone.booking_policy
       SET reschedule_notice_minutes = 120, cancellation_notice_minutes = 120,
           late_cancel_behaviour = 'free', late_cancel_charge_percent = 0
     WHERE tenant_id = v_t AND service_id = v_s
       AND (reschedule_notice_minutes IS DISTINCT FROM 120 OR cancellation_notice_minutes IS DISTINCT FROM 120
            OR late_cancel_behaviour IS DISTINCT FROM 'free');
  END IF;
  INSERT INTO keystone.tenant_setting (tenant_id, key, value)
  VALUES (v_t, 'booking.manage_url_base', to_jsonb('https://glcoachingsc.com/consultation/change'::text))
  ON CONFLICT (tenant_id, key) DO NOTHING;
  PERFORM set_config('keystone.tenant_id', '', true);
END $$;
