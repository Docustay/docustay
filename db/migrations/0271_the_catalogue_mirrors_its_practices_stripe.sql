-- 0271_the_catalogue_mirrors_its_practices_stripe
-- Spec 02 (Items) §3, task 2.1 — B0/CT-110.

ALTER TABLE keystone.service ADD COLUMN stripe_product_id text;
ALTER TABLE keystone.package ADD COLUMN stripe_product_id text;
ALTER TABLE keystone.plan    ADD COLUMN stripe_product_id text;
ALTER TABLE keystone.price   ADD COLUMN stripe_price_id   text;

CREATE UNIQUE INDEX service_stripe_product_id_key ON keystone.service (tenant_id, stripe_product_id) WHERE stripe_product_id IS NOT NULL;
CREATE UNIQUE INDEX package_stripe_product_id_key ON keystone.package (tenant_id, stripe_product_id) WHERE stripe_product_id IS NOT NULL;
CREATE UNIQUE INDEX plan_stripe_product_id_key    ON keystone.plan    (tenant_id, stripe_product_id) WHERE stripe_product_id IS NOT NULL;
CREATE UNIQUE INDEX price_stripe_price_id_key     ON keystone.price   (tenant_id, stripe_price_id)   WHERE stripe_price_id   IS NOT NULL;

-- Nullable, no writer in this spec. CT-110's relationship 2 (each practice's own Stripe, via
-- Connect) does not exist until spec 05 builds it; these columns are the mirror TARGET spec 05/06
-- write into on "success" per CT-110's sync contract ("Stripe API call → on success, mirror the
-- result into the local table") — building the columns now, empty, means spec 05 does not need its
-- own items migration just to have somewhere to write the id.
