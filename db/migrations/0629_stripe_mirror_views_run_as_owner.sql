-- 0629 · THE STRIPE LOGIN SPLIT, DATABASE SIDE (part 28, item 7). The application's login (`app_rw`) is to hold NO privilege on the `stripe` schema (the sync engine writes on its own login — db/migrate.mjs#splitStripeSyncLogin).
-- Two things read `stripe.*` as `app_rw` today, and both are moved here:
--  (a) the eight `*_effective` views were `security_invoker = true`, so they read the mirror AS THE CALLER. They now run as their OWNER (`app_owner`, which already has SELECT on `stripe.*`). Nothing about tenant isolation moves:
--      every mirror-driven branch already states tenant + viewer scope itself (through `stripe_customer_person`), and the `keystone.*` tables they touch still enforce FORCED row-level security on the session's tenant setting
--      for the owner too. `test/b_stripe_wall.test.mjs` proves it with a second organisation and a positive control.
--  (b) the raw `stripe.` reads the money code made inside a tenant's transaction (invoice payments, charges, invoices by id, a subscription's products, a person's cards) become six small views, each scoped to the current
--      tenant by the same customer -> person mapping, with only the columns those readers use (named, not `*`, so the sync engine's own migrations can still change the rest).
-- Additive and idempotent. The REVOKE on `app_rw` is not here (it needs the superuser connection): db/migrate.mjs, behind KEYSTONE_STRIPE_SYNC_SPLIT=enforce, after a deploy whose code already uses the new login.

ALTER VIEW keystone.invoice_effective       SET (security_invoker = false);
ALTER VIEW keystone.payment_effective       SET (security_invoker = false);
ALTER VIEW keystone.refund_effective        SET (security_invoker = false);
ALTER VIEW keystone.dispute_effective       SET (security_invoker = false);
ALTER VIEW keystone.credit_note_effective   SET (security_invoker = false);
ALTER VIEW keystone.subscription_effective  SET (security_invoker = false);
ALTER VIEW keystone.payout_effective        SET (security_invoker = false);
ALTER VIEW keystone.person_card_effective   SET (security_invoker = false);

CREATE OR REPLACE VIEW keystone.mirror_invoice WITH (security_invoker = false) AS
SELECT si.id, si.status, si.status_transitions, si.subscription, si.period_end, si.customer
  FROM stripe.invoices si
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = si.customer;

CREATE OR REPLACE VIEW keystone.mirror_invoice_payment WITH (security_invoker = false) AS
SELECT ip.invoice, ip.payment
  FROM stripe.invoice_payments ip
  JOIN stripe.invoices si ON si.id = ip.invoice
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = si.customer;

CREATE OR REPLACE VIEW keystone.mirror_charge WITH (security_invoker = false) AS
SELECT ch.id, ch.invoice, ch.payment_intent, ch.amount, ch.amount_refunded, ch.customer
  FROM stripe.charges ch
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = ch.customer;

CREATE OR REPLACE VIEW keystone.mirror_subscription WITH (security_invoker = false) AS
SELECT s.id, s.items, s.customer
  FROM stripe.subscriptions s
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = s.customer;

-- products: only those a subscription of the current tenant's people refers to (a product has no customer of its own)
CREATE OR REPLACE VIEW keystone.mirror_product WITH (security_invoker = false) AS
SELECT p.id, p.name
  FROM stripe.products p
 WHERE p.id IN (SELECT it->'price'->>'product'
                  FROM stripe.subscriptions s
                  JOIN keystone.stripe_customer_person scp ON scp.customer_id = s.customer,
                       LATERAL jsonb_array_elements(s.items->'data') it);

CREATE OR REPLACE VIEW keystone.mirror_payment_method WITH (security_invoker = false) AS
SELECT pm.id, pm.customer, pm.type, pm.card,
       (pm.id = c.invoice_settings->>'default_payment_method') AS is_default
  FROM stripe.payment_methods pm
  JOIN stripe.customers c ON c.id = pm.customer
  JOIN keystone.stripe_customer_person scp ON scp.customer_id = pm.customer;

GRANT SELECT ON keystone.mirror_invoice, keystone.mirror_invoice_payment, keystone.mirror_charge, keystone.mirror_subscription, keystone.mirror_product, keystone.mirror_payment_method TO app_rw;
