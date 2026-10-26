-- 0548_payment_method_expiry_alert_guard
--
-- Saved-card brief (1 Oct 2026), Part 3 — wiring `cardsExpiringNextMonth` (existed with zero
-- callers) into the daily automation sweep needs a per-card, per-month idempotency guard: without
-- one, a card expiring next month would be emailed once a day for the whole month, not once.
--
-- Purely additive — one nullable column, no default that changes any existing row's behaviour.

ALTER TABLE keystone.payment_method ADD COLUMN expiring_alerted_for text NULL
  CHECK (expiring_alerted_for IS NULL OR expiring_alerted_for ~ '^[0-9]{4}-[0-9]{2}$');
COMMENT ON COLUMN keystone.payment_method.expiring_alerted_for IS
  '0548: the year-month (YYYY-MM) this card''s expiry alert was already sent for — set once per
  month so the daily automation sweep (src/automations/sweeps.mjs) never re-sends it.';

DO $self_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='keystone' AND table_name='payment_method' AND column_name='expiring_alerted_for') THEN
    RAISE EXCEPTION '0548: keystone.payment_method.expiring_alerted_for was not created';
  END IF;
  RAISE NOTICE '0548: payment_method.expiring_alerted_for created';
END
$self_check$;
