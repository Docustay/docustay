-- 0339_a_widened_check_admits_one_new_provider_not_two
-- Spec 06 (Settings) §3, task 6.7. CT-118.
--
-- keystone_auth.webhook_source's provider CHECK widens to admit 'stripe_workbench' — the platform's own
-- platform-key Stripe billing (this spec, §9), resolved through the existing, unchanged
-- keystone.resolve_webhook_source('stripe_workbench', external_id) function (0045). The existing
-- 'stripe' value is untouched — that value is spec 05's own Connect webhooks going forward (§10
-- point 5; §3's own note) — and no existing row's provider changes meaning or value.
--
-- ★★ MEASURED, not the spec's own literal snippet: 06-settings.md §3's illustrative SQL for this
--    migration writes the new CHECK as ('stripe','documenso','resend','stripe_workbench') — i.e. it
--    widens from the table's ORIGINAL 0045 CHECK, which is stale. Migration 0132
--    (db/migrations/0132_the_database_stops_accepting_a_retired_webhook_provider.sql, applied,
--    unreverted — grepped the full migrations directory for every "documenso" mention below) already
--    DROPPED 'documenso' from this exact CHECK deliberately, with its own proof block, because the
--    application stopped supporting Documenso as a webhook provider. Copying the spec's literal SQL
--    verbatim would silently UN-DO 0132's decision and reopen a door 0132 closed on purpose — nothing
--    in task 6.7's own field block (FEATURES-COMBINED-PLAN.md:904-916) asks for that; its own words
--    are "this task only ADDS 'stripe_workbench' ... no collision with the existing value". So this
--    migration widens the CURRENT, real CHECK ('stripe','resend', per 0132) by exactly one value,
--    and proves below that 'documenso' stays refused. Flagged here in full, file:line, rather than
--    silently deviating from the spec text — see this task's build report for the same note.
--
-- ★ OWNERSHIP: keystone_auth.webhook_source is owned by auth_owner, and this file runs as app_owner
--   (db/migrate.mjs per-file SET ROLE). app_owner is a MEMBER of auth_owner (NOINHERIT since the F484
--   repair), so it may SET LOCAL ROLE auth_owner for the ALTER — the 0121/0132 pattern — and the role
--   unwinds with the transaction.

SET LOCAL ROLE auth_owner;

ALTER TABLE keystone_auth.webhook_source DROP CONSTRAINT webhook_source_provider_check;
ALTER TABLE keystone_auth.webhook_source
  ADD CONSTRAINT webhook_source_provider_check CHECK (provider IN ('stripe', 'resend', 'stripe_workbench'));

-- ★ POSITIVE CONTROL, IN THE SAME TRANSACTION (0132's own discipline, repeated): the new CHECK must
--   admit 'stripe', 'resend' and 'stripe_workbench', and it must NOT have silently readmitted
--   'documenso' — a constraint nobody has proven is not yet a constraint.
DO $prove_the_check$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'keystone_auth.webhook_source'::regclass AND conname = 'webhook_source_provider_check';
  IF v_def IS NULL
     OR v_def ILIKE '%documenso%'
     OR v_def NOT ILIKE '%stripe_workbench%'
     OR v_def NOT ILIKE '%''stripe''%'
     OR v_def NOT ILIKE '%resend%'
  THEN
    RAISE EXCEPTION '0339: the provider CHECK is not what was written: %', v_def;
  END IF;
END
$prove_the_check$;

-- ★ Back to the runner's role explicitly — NOT `RESET ROLE`, which is the session-level reset that
--   caused F482 (0132's own comment, repeated here for the same reason).
SET LOCAL ROLE app_owner;
