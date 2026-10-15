-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- PART 1 (worker-failures brief, 1 Oct 2026) — NO WORKER OR WEBHOOK HANDLER COULD EVER SEE A
-- REAL ROW ON FIVE MONEY TABLES, AND EVERY ONE OF THEM FAILED SILENTLY.
--
-- ★★★ MEASURED: `keystone.invoice`, `keystone.subscription`, `keystone.payment`,
--     `keystone.payment_allocation` and `keystone.subscription_schedule` each have exactly one
--     SELECT policy admitting a real row (`tenant_isolation`), and every one of the five requires a
--     person — `user_may(current_user_id(), 'invoice', 'view', owner-or-NULL) OR <payer column> =
--     current_user_id()`. `keystone.user_may`'s own body does `WHERE ur.user_id = p_user_id`, which
--     can never match a NULL `p_user_id` (SQL NULL comparison) — so `user_may(NULL, ...)` is
--     unconditionally false, and `<payer column> = NULL` is also never true. A worker or a Stripe
--     webhook has no user (src/db/index.mjs's own comment, already correct: "a predicate about a
--     viewer must refuse rather than invent one"). Same shape as 0112's document_instance fix,
--     found live on FIVE tables while auditing every worker/webhook-reachable read for Part 1:
--
--   · `src/money/divergence.mjs` (nightly `money_divergence_sweep`) reads invoice+subscription —
--     ZERO rows every run, every tenant, forever: `invoiceFieldsChanged`/`subscriptionFieldsChanged`
--     were always 0, indistinguishable from "nothing has ever diverged" (THE backstop CLAUDE.md
--     names for "Stripe is the money record" had no backstop).
--   · `notifyPaymentReceived` and the `MONEY_EMAILS` listener (src/queue/tasks.mjs) look up a
--     payment's own `payer_user_id` by id for the three PAYMENT_TOPICS whose event payload carries
--     neither `payer_user_id` nor `recipient_user_id` — ZERO rows, so a receipt for
--     `money.payment.succeeded` / `money.payment.recorded_offline` has never had anyone to send to
--     (a LOCKED, always-on notification topic per src/notifications/topics.mjs, meaning practices
--     cannot even turn this off — and it has never worked).
--   · The `invoice.payment_succeeded` Stripe webhook's own partial/full/overpaid reconciliation
--     (Task 20.73, src/payments/webhook.mjs) reads the invoice AND sums `payment_allocation` to find
--     what was already paid — both ZERO rows, so `amount_remaining_minor`/`amount_overpaid_minor`
--     have never been reconciled from a webhook; the whole block is wrapped in try/catch ("best
--     effort"), so it failed every time with no error surfaced anywhere.
--   · `handleStripeScheduleStatusEvent` (src/money/paymentPlans.mjs) looks up a payment plan's
--     `subscription_schedule` row by its Stripe id on `.completed`/`.canceled`/`.released` — ZERO
--     rows, so a payment plan's lifecycle has never actually updated from Stripe's own webhook.
--
-- ★★ SAME NARROWEST-POSSIBLE-WIDENING AS 0112 AND THIS MIGRATION'S OWN invoice/subscription
--    policies below: `invoice` and `subscription` are scoped to rows that already have a Stripe id
--    (and, for invoice, are not a protected real-client row) — exactly the shape every one of the
--    callers above already needs and nothing wider. `payment`, `payment_allocation` and
--    `subscription_schedule` have no equivalent narrowing column available (an offline-recorded
--    payment has no Stripe id at all, and `money.payment.recorded_offline` is one of the three
--    topics this fixes) — their policies are tenant + null-viewer only, the same floor every
--    `system_*` policy in this schema already stands on, and SELECT-only: nothing here grants a
--    worker or webhook the ability to WRITE a row it could not already write (payment/
--    payment_allocation/subscription_schedule's own `tenant_update` policies, where they exist, are
--    already `tenant_id = current_tenant_id()` with no viewer check).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE POLICY system_divergence_read ON keystone.invoice
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND stripe_invoice_id IS NOT NULL
         AND protected_real_client = false);

CREATE POLICY system_divergence_read ON keystone.subscription
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         AND stripe_subscription_id IS NOT NULL);

CREATE POLICY system_worker_read ON keystone.payment
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL);

CREATE POLICY system_worker_read ON keystone.payment_allocation
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL);

CREATE POLICY system_worker_read ON keystone.subscription_schedule
  FOR SELECT
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL);
