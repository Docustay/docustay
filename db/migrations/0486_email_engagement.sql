-- 0486 — EMAIL ENGAGEMENT: OPENS, CLICKS, AND LEDGER (Task 20.45)
--
-- ★★★ CLICKS ARE A LEDGER, NOT A COUNT: `email_click` is append-only, one row per click
--     (url, clicked_at). `click_count` and `open_count` on `app_user` are CACHES of the ledger —
--     the ledger is the record. A count that disagrees with the ledger is the count's bug.
--
-- WRITER: `src/routes/webhooks.mjs` (`handleEmailWebhook`), on every verified
-- `email.opened` and `email.clicked` Resend webhook — the same single-writer discipline
-- CT-110 already binds this table to.
-- READERS: campaign engagement, performance reporting.
--
-- ADDITIONS TO app_user:
-- • opened_at: timestamp of first open (NULL until opened once)
-- • open_count: cache of distinct opens (for rendering "engagement")
-- • first_clicked_at: timestamp of first click (NULL until clicked once)
-- • click_count: cache of distinct clicks (for rendering "engagement")
--
-- Bounce exclusion: resolveSegment() adds `email_bounced_at IS NULL` to the audience filter
-- WITHOUT touching `do_not_email` — deliverability (bounce) is not consent (unsubscribe).
--
-- Template freezing: campaign_send_batch stores template_key and template_version active
-- at the time the batch was queued, so a later template change does not rewrite history.
--

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 1: Add engagement tracking columns to app_user (first opens/clicks + caches)
-- ────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE keystone.app_user NO FORCE ROW LEVEL SECURITY;

ALTER TABLE keystone.app_user
  ADD COLUMN opened_at timestamptz NULL,
  ADD COLUMN open_count integer NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  ADD COLUMN first_clicked_at timestamptz NULL,
  ADD COLUMN click_count integer NOT NULL DEFAULT 0 CHECK (click_count >= 0);

-- ────────────────────────────────────────────────────────────────────────────────────────
-- Self-check: both engagement columns exist on app_user
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'app_user'
     AND column_name IN ('opened_at', 'open_count', 'first_clicked_at', 'click_count');
  IF n_cols <> 4 THEN
    RAISE EXCEPTION '0486 self-check: expected 4 engagement columns on app_user, found %', n_cols;
  END IF;
END
$check$;

ALTER TABLE keystone.app_user FORCE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 2: Create email_click ledger table (append-only per-click record)
-- ────────────────────────────────────────────────────────────────────────────────────────
-- ★★ ONE ROW PER CLICK. Idempotent by provider event id (duplicate delivery → one ledger row).
--    The ledger is the record; counts are caches of it.

CREATE TABLE keystone.email_click (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  app_user_id   uuid        NOT NULL REFERENCES keystone.app_user(id) ON DELETE CASCADE,
  url           text        NOT NULL,
  clicked_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_click_user_idx ON keystone.email_click (tenant_id, app_user_id);
CREATE INDEX email_click_user_date_idx ON keystone.email_click (tenant_id, app_user_id, clicked_at DESC);

-- ────────────────────────────────────────────────────────────────────────────────────────
-- RLS — ENABLE and FORCE, three tenant policies (same discipline every tenant-scoped table)
-- ────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE keystone.email_click ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.email_click FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.email_click
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.email_click
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.email_click
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
          WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_delete ON keystone.email_click
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.email_click TO app_rw;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 3: Add template freezing columns to campaign_send_batch
-- ────────────────────────────────────────────────────────────────────────────────────────
-- ★★ TEMPLATE FREEZING: template_key and template_version capture the active template at
--    send time, so a later template change (0484) does not rewrite what was actually sent.

ALTER TABLE keystone.campaign_send_batch
  ADD COLUMN template_key text NULL,
  ADD COLUMN template_version integer NULL;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- Self-check: template freezing columns exist on campaign_send_batch
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
  forced boolean;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'campaign_send_batch'
     AND column_name IN ('template_key', 'template_version');
  IF n_cols <> 2 THEN
    RAISE EXCEPTION '0486 self-check: expected 2 template columns on campaign_send_batch, found %', n_cols;
  END IF;

  -- ★ RLS FORCE still in place on campaign_send_batch (0358)
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'campaign_send_batch';
  IF NOT forced THEN
    RAISE EXCEPTION '0486 self-check: RLS is no longer FORCED on campaign_send_batch';
  END IF;
END
$check$;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- And prove RLS FORCE survived the ALTERs on app_user and campaign_send_batch
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'app_user';
  IF NOT forced THEN
    RAISE EXCEPTION '0486 self-check: RLS is no longer FORCED on app_user';
  END IF;

  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'email_click';
  IF NOT forced THEN
    RAISE EXCEPTION '0486 self-check: RLS is no longer FORCED on email_click';
  END IF;

  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'campaign_send_batch';
  IF NOT forced THEN
    RAISE EXCEPTION '0486 self-check: RLS is no longer FORCED on campaign_send_batch';
  END IF;
END
$rls$;

COMMENT ON TABLE keystone.email_click IS
  'F20.45: Email engagement ledger. One append-only row per click (url, clicked_at). '
  'click_count on app_user is a cache of this ledger; the ledger is the record. '
  'Idempotent per provider event (duplicate delivery → one ledger row).';

COMMENT ON COLUMN keystone.app_user.opened_at IS
  'F20.45: Timestamp of first email open, NULL until opened once. Populated by email.opened webhook.';
COMMENT ON COLUMN keystone.app_user.open_count IS
  'F20.45: Cache of email open count. Incremented by email.opened webhook.';
COMMENT ON COLUMN keystone.app_user.first_clicked_at IS
  'F20.45: Timestamp of first email click, NULL until clicked once. Populated by email.clicked webhook.';
COMMENT ON COLUMN keystone.app_user.click_count IS
  'F20.45: Cache of email click count. Incremented by email.clicked webhook.';
COMMENT ON COLUMN keystone.campaign_send_batch.template_key IS
  'F20.45: Email template key active at send time (template freezing). Null for non-email sends.';
COMMENT ON COLUMN keystone.campaign_send_batch.template_version IS
  'F20.45: Email template version active at send time (template freezing). Null for non-email sends.';

-- ────────────────────────────────────────────────────────────────────────────────────────
-- STEP 4: Add template_key column to campaign table (Task 20.46)
-- ────────────────────────────────────────────────────────────────────────────────────────
-- ★★★ TEMPLATE FREEZING SOURCE: the campaign row stores which template was picked by the
--    editor (if any). At send time, sendCampaign resolves this key and stamps the resolved
--    version on the batch, so a later template change (0484) does not rewrite what was sent.
--    If no template was picked (free-typed subject/body), template_key is NULL.

ALTER TABLE keystone.campaign
  ADD COLUMN template_key text NULL;

-- ────────────────────────────────────────────────────────────────────────────────────────
-- Self-check: template_key column exists on campaign
-- ────────────────────────────────────────────────────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
  forced boolean;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'campaign'
     AND column_name = 'template_key';
  IF n_cols <> 1 THEN
    RAISE EXCEPTION '0486 self-check: expected 1 template_key column on campaign, found %', n_cols;
  END IF;

  -- ★ RLS FORCE still in place on campaign (0358)
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'campaign';
  IF NOT forced THEN
    RAISE EXCEPTION '0486 self-check: RLS is no longer FORCED on campaign';
  END IF;
END
$check$;

COMMENT ON COLUMN keystone.campaign.template_key IS
  'F20.46: Email template key picked by editor at draft time. NULL for free-typed subject/body. '
  'Resolved at send time to stamp the batch columns. A later template change does not rewrite history.';
