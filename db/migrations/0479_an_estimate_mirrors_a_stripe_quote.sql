-- 0479 — AN ESTIMATE MIRRORS A STRIPE QUOTE (20.6 — the maintainer, 25 Sep 2026).
--
-- ★★★ STRIPE IS THE MONEY RECORD; THE PLATFORM MIRRORS AND NEVER COMPUTES. When an estimate
--     is sent, a Stripe Quote is created on the connected account and its id and state are
--     mirrored here. When accepted, Quote.accept() creates a Stripe Invoice, and its id is
--     mirrored on the invoice row. The estimate's expiry stays ours (automation layer owns it).
--
-- ★ WRITER: `src/money/estimates.mjs` (`sendEstimate` creates Quote, `acceptEstimate` accepts
--   it and stores the Stripe Invoice id on the invoice row). READERS: send email context
--   (Quote PDF URL from Stripe), estimate lifecycle state machine.
-- ★ NULLABLE ON PURPOSE: a draft estimate has no Stripe Quote yet, so new columns read NULL.
--
-- DATA: `keystone.estimate` rows exist only for the maintainer's build tenants (the platform is not live);
-- their new columns read NULL until sendEstimate lands. No UPDATE needed.

ALTER TABLE keystone.estimate NO FORCE ROW LEVEL SECURITY;

-- ★★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production). The first draft had three
--    defects in one statement: `UNIQUE (…) WHERE …` is not legal in a table constraint (a partial
--    uniqueness is an INDEX); `starts_plan_id text REFERENCES keystone.plan(id)` typed a uuid key as
--    text and skipped the (tenant_id, id) composite every other cross-table FK here uses; and the
--    control inserted under tenant 00000000-…, which fails the tenant FK before it can ever reach
--    the uniqueness it meant to prove.
ALTER TABLE keystone.estimate
  ADD COLUMN stripe_quote_id text NULL,
  ADD COLUMN stripe_quote_state text NULL,
  ADD COLUMN starts_plan_id uuid NULL,
  ADD COLUMN quote_pdf_url text NULL;
ALTER TABLE keystone.estimate
  ADD CONSTRAINT estimate_starts_plan_fkey FOREIGN KEY (tenant_id, starts_plan_id)
    REFERENCES keystone.plan (tenant_id, id) ON DELETE SET NULL (starts_plan_id);
CREATE UNIQUE INDEX estimate_stripe_quote_id_unique
  ON keystone.estimate (tenant_id, stripe_quote_id) WHERE stripe_quote_id IS NOT NULL;

-- ── Self-check, run while NO FORCE is still in effect. ──────────────────────────────────────────
DO $check$
DECLARE
  n_cols integer;
  v_tenant uuid;
  v_user uuid;
BEGIN
  SELECT count(*) INTO n_cols
    FROM information_schema.columns
   WHERE table_schema = 'keystone' AND table_name = 'estimate'
     AND column_name IN ('stripe_quote_id', 'stripe_quote_state', 'starts_plan_id', 'quote_pdf_url');
  IF n_cols <> 4 THEN
    RAISE EXCEPTION '0479 self-check: expected quote columns, starts_plan_id, and quote_pdf_url, found %', n_cols;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                  WHERE c.relname = 'estimate_stripe_quote_id_unique' AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION '0479 self-check: estimate_stripe_quote_id_unique is not a partial UNIQUE index';
  END IF;

  -- ★ Behavioural control, against a REAL practice and person so the tenant/recipient FKs pass and
  --   the insert actually reaches the uniqueness: the second insert must be refused. The sub-block's
  --   own EXCEPTION handler rolls both rows back.
  SELECT u.tenant_id, u.id INTO v_tenant, v_user FROM keystone.app_user u LIMIT 1;
  IF v_tenant IS NOT NULL THEN
    PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
    BEGIN
      INSERT INTO keystone.estimate (tenant_id, recipient_user_id, estimate_number, stripe_quote_id)
        VALUES (v_tenant, v_user, 'M0479-PROBE-1', 'qt_m0479_probe');
      INSERT INTO keystone.estimate (tenant_id, recipient_user_id, estimate_number, stripe_quote_id)
        VALUES (v_tenant, v_user, 'M0479-PROBE-2', 'qt_m0479_probe');
      RAISE EXCEPTION '0479 self-check: duplicate stripe_quote_id was ACCEPTED';
    EXCEPTION
      WHEN unique_violation THEN NULL;  -- refused: correct, and both probe rows roll back
    END;
    PERFORM set_config('keystone.tenant_id', '', true);
  END IF;
END
$check$;

ALTER TABLE keystone.estimate FORCE ROW LEVEL SECURITY;

-- ── And prove FORCE survived the ALTERs — the 0334 discipline outlives this migration. ──────────
DO $rls$
DECLARE
  forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'keystone' AND c.relname = 'estimate';
  IF NOT forced THEN
    RAISE EXCEPTION '0479 self-check: RLS is no longer FORCED on estimate';
  END IF;
END
$rls$;
