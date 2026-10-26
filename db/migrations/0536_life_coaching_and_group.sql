-- 0536_life_coaching_and_group — the maintainer, 29 Sep 2026 brief: "Every service picker asks first: Life
-- coaching or Recovery coaching?" plus the four real life-coaching offers from
-- host.example.com/pricing. The brief's 15% veterans/first-responders
-- discount is NOT built here — it already exists (see the note inside the DO block below).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ `coaching_group` IS A NEW, SEPARATE FIELD — NOT `division`. Recon (verified this session,
--     MEASURED against 30 synced catalogue rows: 13 services + 0 packages + 17 plans = 30) found
--     every existing Stripe product's `division` metadata already means WHICH BUSINESS (FOUNDRY —
--     there is only one today), set outside this app's own sync code (metadataFor's "product" key
--     set has no `division` key at all, and catalogue.mjs never sends one). Reusing it for
--     life-vs-recovery would silently redefine what an existing field means for every already-synced
--     product. `coaching_group` is new, on service/package/plan (the three catalogue subjects a
--     client actually books/buys), NOT NULL, defaulting every existing active row to 'recovery' —
--     the one thing FOUNDRY has sold until now — so this migration IS the "set all 30 existing to
--     Recovery" step, not a separate one.
-- ★★ SENT TO STRIPE AS ITS OWN NEW METADATA KEY (catalogue.mjs / metadata.mjs, this same change),
--    never folded into `category` (service-only today, and a different axis — "which service
--    category" vs "which practice line of business").
-- ★ EVERY EXISTING SYNCED ROW IS RE-EMITTED (items.service.updated / items.package.updated /
--   items.plan.updated) so the already-running production worker — with its own, already-approved
--   Stripe credentials, never this migration's — re-syncs each one and Stripe's metadata catches up
--   to the new column. This migration never calls Stripe itself.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.service ADD COLUMN coaching_group text NOT NULL DEFAULT 'recovery'
  CHECK (coaching_group IN ('life', 'recovery'));
ALTER TABLE keystone.package ADD COLUMN coaching_group text NOT NULL DEFAULT 'recovery'
  CHECK (coaching_group IN ('life', 'recovery'));
ALTER TABLE keystone.plan    ADD COLUMN coaching_group text NOT NULL DEFAULT 'recovery'
  CHECK (coaching_group IN ('life', 'recovery'));

COMMENT ON COLUMN keystone.service.coaching_group IS
  '0536: which line of business this is for — ''life'' or ''recovery'' coaching. Every service '
  'picker asks this first, then shows only that group. Synced to Stripe product metadata as '
  '''coaching_group'' (catalogue.mjs). Distinct from category_id (which service category within a '
  'group) and unrelated to ''division'' (which BUSINESS — a separate, pre-existing Stripe-only field '
  'this migration does not touch).';
COMMENT ON COLUMN keystone.package.coaching_group IS '0536: see keystone.service.coaching_group.';
COMMENT ON COLUMN keystone.plan.coaching_group IS '0536: see keystone.service.coaching_group.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ FORCE RLS APPLIES TO app_owner TOO (0525/0531's own lesson, hit again writing this one:
--     `keystone.tenant` and every catalogue table below keep FORCE ROW LEVEL SECURITY always — this
--     migration does NOT touch that, unlike notification_rule's migrations, which legitimately
--     needed NO FORCE because they write EVERY tenant. This migration writes ONE tenant, so the
--     correct fix is the one the app itself uses for exactly this: set `keystone.tenant_id`
--     transaction-local, the same GUC withTenant() (src/db/index.mjs) sets per request, and let RLS
--     pass normally. `set_config(..., true)` — LOCAL — lasts for this migration's one transaction
--     and nothing past it. `keystone.tenant` itself is read through `tenant_timezones_for_health()`
--     (0017's SECURITY DEFINER resolver, the sanctioned way a context-free connection learns a
--     tenant exists) rather than directly, same reason 0531 gives.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SELECT set_config('keystone.tenant_id', '01a09bfe-481c-7cbe-9f80-d28b613e5bba', true);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE FOUR LIFE-COACHING OFFERS, FOUNDRY ONLY (host.example.com/pricing,
--     read 29 Sep 2026). One service (the 55-minute single session) plus three packages, each a
--     multiple of it via package_line, matching how every other package in this codebase already
--     links to the service its sessions draw from.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $life_coaching_seed$
DECLARE
  glrs_tenant_id uuid := '01a09bfe-481c-7cbe-9f80-d28b613e5bba';
  single_service_id uuid;
  pkg4_id uuid;
  pkg8_id uuid;
  pkg12_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone.tenant_timezones_for_health() WHERE id = glrs_tenant_id) THEN
    RAISE NOTICE '0536: foundry tenant % not present in this database — skipping the FOUNDRY data seed (schema change above still applies)', glrs_tenant_id;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM keystone.service WHERE tenant_id = glrs_tenant_id AND lower(name) = 'single session (life coaching)') THEN
    RAISE NOTICE '0536: life-coaching catalogue already seeded for foundry — skipping (idempotent)';
    RETURN;
  END IF;

  single_service_id := keystone.uuid_generate_v7();
  INSERT INTO keystone.service
    (id, tenant_id, name, duration_minutes, price_minor, currency, bookable, active, coaching_group,
     portal_bookable, public_bookable, description)
  VALUES
    (single_service_id, glrs_tenant_id, 'Single Session (Life Coaching)', 55, 13000, 'USD', true, true, 'life',
     true, true, 'One 55-minute life coaching session.');

  pkg4_id := keystone.uuid_generate_v7();
  INSERT INTO keystone.package
    (id, tenant_id, name, price_minor, currency, active, coaching_group, portal_sellable, public_sellable, description)
  VALUES
    (pkg4_id, glrs_tenant_id, '4 Sessions (Life Coaching)', 49500, 'USD', true, 'life', true, true, 'Four 55-minute life coaching sessions.');
  INSERT INTO keystone.package_line (id, tenant_id, package_id, service_id, quantity)
  VALUES (keystone.uuid_generate_v7(), glrs_tenant_id, pkg4_id, single_service_id, 4);

  pkg8_id := keystone.uuid_generate_v7();
  INSERT INTO keystone.package
    (id, tenant_id, name, price_minor, currency, active, coaching_group, portal_sellable, public_sellable, description)
  VALUES
    (pkg8_id, glrs_tenant_id, '8 Sessions (Life Coaching)', 93500, 'USD', true, 'life', true, true, 'Eight 55-minute life coaching sessions.');
  INSERT INTO keystone.package_line (id, tenant_id, package_id, service_id, quantity)
  VALUES (keystone.uuid_generate_v7(), glrs_tenant_id, pkg8_id, single_service_id, 8);

  pkg12_id := keystone.uuid_generate_v7();
  INSERT INTO keystone.package
    (id, tenant_id, name, price_minor, currency, active, coaching_group, portal_sellable, public_sellable, description)
  VALUES
    (pkg12_id, glrs_tenant_id, '12 Sessions (Life Coaching)', 132500, 'USD', true, 'life', true, true, 'Twelve 55-minute life coaching sessions.');
  INSERT INTO keystone.package_line (id, tenant_id, package_id, service_id, quantity)
  VALUES (keystone.uuid_generate_v7(), glrs_tenant_id, pkg12_id, single_service_id, 12);

  -- ★★★ FOUND LIVE, testing this migration locally: `service.price_minor` / `package.price_minor`
  --     are NOT what the app actually charges — `keystone.current_price()` (read by every picker,
  --     AddLineRow included) reads `keystone.price`, a separate priced-history table (0264's
  --     design: a price is a ROW, so re-pricing never edits history out from under an old
  --     invoice). Setting only the denormalised column left every one of these four items pricing
  --     at $0.00 everywhere a real picker reads price from — MEASURED, not assumed: the invoice
  --     line picker showed exactly that before this block existed.
  INSERT INTO keystone.price (id, tenant_id, subject_type, subject_id, amount_minor, currency, active)
  VALUES
    (keystone.uuid_generate_v7(), glrs_tenant_id, 'service', single_service_id, 13000, 'USD', true),
    (keystone.uuid_generate_v7(), glrs_tenant_id, 'package', pkg4_id, 49500, 'USD', true),
    (keystone.uuid_generate_v7(), glrs_tenant_id, 'package', pkg8_id, 93500, 'USD', true),
    (keystone.uuid_generate_v7(), glrs_tenant_id, 'package', pkg12_id, 132500, 'USD', true);

  -- ★★★ FOUND LIVE, THIS SESSION — no veterans/first-responders discount is created here. the maintainer's
  --     brief asked for a 15% veterans-and-first-responders discount, applying to everything,
  --     "made in Workbench so it syncs to Stripe" — but `keystone.coupon` already holds TWO: "Veteran
  --     (15% off)" and "First Responder (15% off)", both kind=percent/percent_bp=1500/
  --     applies_to='any'/active=true, both already carrying a stripe_coupon_id (VETERAN,
  --     FIRSTRESPONDER), created 25 Sep 2026 — four days before this brief, already synced. This is
  --     the exact "measure, don't reason" case CLAUDE.md exists for: building a third, duplicate
  --     discount here because the brief asked for one would be a SILENT DUPLICATE-TRUTH defect the
  --     moment it shipped. Nothing to build; reported as already done.

  -- ── EMIT: the four new rows, so the production worker's own catalogue_sync listener enqueues
  --    catalogue_stripe_sync for each — the same event shape emit() (src/events/outbox.mjs) writes.
  INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
  VALUES
    (glrs_tenant_id, 'items.service.created', 'items', 'service', single_service_id, '{}'::jsonb, 'system', false),
    (glrs_tenant_id, 'items.package.created', 'items', 'package', pkg4_id, '{}'::jsonb, 'system', false),
    (glrs_tenant_id, 'items.package.created', 'items', 'package', pkg8_id, '{}'::jsonb, 'system', false),
    (glrs_tenant_id, 'items.package.created', 'items', 'package', pkg12_id, '{}'::jsonb, 'system', false);

  RAISE NOTICE '0536: seeded 1 service, 3 packages for foundry, and enqueued their Stripe sync';
END
$life_coaching_seed$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ RE-SYNC EVERY EXISTING ACTIVE, ALREADY-SYNCED CATALOGUE ROW so Stripe's metadata picks up
--   coaching_group='recovery'. Scoped to rows with a stripe_product_id already set (the 30 the
--   recon measured) — an unsynced row has nothing on Stripe to update yet and syncs on its own
--   first save, same as any other catalogue edit.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ Scoped to FOUNDRY explicitly (not just by the GUC above) — this migration's job is FOUNDRY's 30,
--   never every tenant on the platform, and a WHERE clause says so instead of relying only on RLS.
INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
SELECT tenant_id, 'items.service.updated', 'items', 'service', id, '{}'::jsonb, 'system', false
FROM keystone.service
WHERE active AND stripe_product_id IS NOT NULL AND tenant_id = '01a09bfe-481c-7cbe-9f80-d28b613e5bba';

INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
SELECT tenant_id, 'items.plan.updated', 'items', 'plan', id, '{}'::jsonb, 'system', false
FROM keystone.plan
WHERE active AND stripe_product_id IS NOT NULL AND tenant_id = '01a09bfe-481c-7cbe-9f80-d28b613e5bba';

INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor, sample)
SELECT tenant_id, 'items.package.updated', 'items', 'package', id, '{}'::jsonb, 'system', false
FROM keystone.package
WHERE active AND stripe_product_id IS NOT NULL AND tenant_id = '01a09bfe-481c-7cbe-9f80-d28b613e5bba';

-- ── SELF-CHECK ─────────────────────────────────────────────────────────────────────────────────
DO $life_coaching_check$
DECLARE
  n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'service' AND column_name = 'coaching_group'
  ) THEN
    RAISE EXCEPTION '0536: keystone.service.coaching_group was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'package' AND column_name = 'coaching_group'
  ) THEN
    RAISE EXCEPTION '0536: keystone.package.coaching_group was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'keystone' AND table_name = 'plan' AND column_name = 'coaching_group'
  ) THEN
    RAISE EXCEPTION '0536: keystone.plan.coaching_group was not created';
  END IF;
  SELECT count(*) INTO n FROM keystone.event WHERE topic LIKE 'items.%' AND created_at > now() - interval '1 minute';
  RAISE NOTICE '0536: coaching_group added to service/package/plan; % catalogue sync event(s) enqueued this run', n;
END
$life_coaching_check$;
