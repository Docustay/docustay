-- 0549_lead_time_and_ad_attribution
--
-- Site-readiness brief (1 Oct 2026) — the public site's lead form now sends two things 0540 did not
-- account for: an optional specific call time within the chosen window (e.g. "2:30 PM", alongside
-- the existing date/window pair), and Google Ads/Analytics attribution (gclid/gbraid/wbraid, the
-- five standard UTM params, and the landing page) captured client-side in a first-party cookie so a
-- lead's record can show which ad, if any, brought them in.
--
-- Two additions, both purely additive, nullable, no existing row affected:
--   · lead_best_time_time — a sibling to 0540's lead_best_time_date/lead_best_time_window. Free text
--     ("2:30 PM"), not a real `time` column and no CHECK: this is the site's own half-hour slots,
--     not a the platform-confirmed appointment (the site's own form footnote says so explicitly — "this
--     isn't a booked appointment"), so there is nothing to validate against.
--   · lead_attribution jsonb — ONE column for the whole attribution bundle rather than nine more
--     fixed columns (gclid/gbraid/wbraid + 5 utm_* + landing_page): these nine are optional,
--     rarely all present together, sourced verbatim from whatever the ad platform put in the URL,
--     and never queried by individual key anywhere in this app today — a jsonb bag is the honest
--     shape for "opaque attribution the site captured", the same reasoning `funnel_event.metadata`
--     already uses for this class of data. Keys are exactly the site's own field names
--     (gclid/gbraid/wbraid/utm_source/utm_medium/utm_campaign/utm_term/utm_content/landing_page) so
--     reading it back needs no translation table.

ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_best_time_time text;
ALTER TABLE keystone.app_user ADD COLUMN IF NOT EXISTS lead_attribution jsonb;

COMMENT ON COLUMN keystone.app_user.lead_best_time_time IS
  '0549: the optional half-hour slot the lead picked within lead_best_time_window (e.g. "2:30 PM") — the site''s own courtesy slot, not a confirmed appointment. NULL means no specific time was picked.';
COMMENT ON COLUMN keystone.app_user.lead_attribution IS
  '0549: ad/campaign attribution the site captured client-side (gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page) — whichever keys were present. NULL means no attribution was captured (a direct visit).';

DO $self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='keystone' AND table_name='app_user' AND column_name='lead_best_time_time') THEN
    RAISE EXCEPTION '0549: keystone.app_user.lead_best_time_time was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='keystone' AND table_name='app_user' AND column_name='lead_attribution') THEN
    RAISE EXCEPTION '0549: keystone.app_user.lead_attribution was not created';
  END IF;
  RAISE NOTICE '0549: app_user.lead_best_time_time and app_user.lead_attribution created';
END
$self_check$;
