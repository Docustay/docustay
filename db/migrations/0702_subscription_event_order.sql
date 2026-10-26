-- 0702 · A STRIPE EVENT THAT ARRIVES LATE MUST NOT UNDO A NEWER ONE (Run 6, 10 Oct 2026). Additive.
-- Stripe does not promise delivery order. A delayed `invoice.payment_failed` that lands after `invoice.paid` used to turn a paid, active subscription into past_due (measured with Stripe's own events), and
-- the 14-day grace would then take Pro away from a customer Stripe says is paid. The mirror now remembers the time of the newest Stripe event it has seen for the subscription (Stripe's `event.created`) and
-- ignores an older one. The event id is still recorded, so a replay changes nothing either.
ALTER TABLE keystone.mainstay_subscription ADD COLUMN IF NOT EXISTS stripe_event_at timestamptz;
