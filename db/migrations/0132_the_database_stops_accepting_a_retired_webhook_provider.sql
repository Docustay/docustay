-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0132 — THE DATABASE STOPS ACCEPTING A RETIRED WEBHOOK PROVIDER.
--
-- ★ Spec 01 default 9 retired Documenso; Stage 2 removed it from `PROVIDERS` in src/webhooks/verify.mjs,
--   so the APPLICATION already refuses an inbound Documenso webhook. But the table that routes inbound
--   webhooks still said, in its own CHECK (0045:124), that 'documenso' is a valid provider — two sources
--   of truth that disagreed (Stage 2 final review, M6). The CHECK now matches the code: stripe, resend.
--
-- ★★ IT REFUSES RATHER THAN DELETES. [MEASURED 17 Sep 2026: 0 'documenso' rows on production, 0 locally.]
--    If a row ever exists, this migration stops with the count — it never deletes or rewrites a row to make
--    a constraint fit. A person decides what to do with that row.
--
-- ★ OWNERSHIP: keystone_auth.webhook_source is owned by auth_owner, and this file runs as app_owner
--   (db/migrate.mjs per-file SET ROLE). app_owner is a MEMBER of auth_owner (NOINHERIT since the F484 repair),
--   so it may SET LOCAL ROLE auth_owner for the ALTER — the 0121 pattern — and the role unwinds with the
--   transaction.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL ROLE auth_owner;

DO $refuse_if_used$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM keystone_auth.webhook_source WHERE provider = 'documenso';
  IF v_count <> 0 THEN
    RAISE EXCEPTION '0132: % webhook_source row(s) still name provider documenso — refusing to narrow the CHECK; nothing was changed', v_count;
  END IF;
END
$refuse_if_used$;

ALTER TABLE keystone_auth.webhook_source DROP CONSTRAINT webhook_source_provider_check;
ALTER TABLE keystone_auth.webhook_source
  ADD CONSTRAINT webhook_source_provider_check CHECK (provider IN ('stripe', 'resend'));

-- ★ POSITIVE CONTROL, IN THE SAME TRANSACTION: the new CHECK must refuse 'documenso' and admit 'stripe'.
--   A constraint nobody has seen reject anything is not yet a constraint.
DO $prove_the_check$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'keystone_auth.webhook_source'::regclass AND conname = 'webhook_source_provider_check';
  IF v_def IS NULL OR v_def ILIKE '%documenso%' OR v_def NOT ILIKE '%stripe%' OR v_def NOT ILIKE '%resend%' THEN
    RAISE EXCEPTION '0132: the provider CHECK is not what was written: %', v_def;
  END IF;
END
$prove_the_check$;

-- ★ Back to the runner's role explicitly — NOT `RESET ROLE`, which is the session-level reset that caused F482.
SET LOCAL ROLE app_owner;
