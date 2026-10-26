-- Stage 15 Task 15.13 — STRIPE ACCOUNT WEBHOOK SOURCE MAPPING
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- When a practice connects a Stripe account, we record the mapping from the Stripe account id
-- (acct_...) to the practice, stored in `keystone_auth.webhook_source` with provider = 'stripe'.
-- This ensures that:
--   1. Account-level Stripe events (like customer.subscription.updated routed via account webhooks)
--      route to the correct practice without tenant selection by the attacker.
--   2. The mapping is unique per practice (no account can be claimed by two practices).
--   3. Disconnection clears the mapping so reconnection is possible.
--
-- The functions below manage this mapping: ensure_stripe_account_source inserts or reuses an
-- existing row, retire_stripe_account_source marks it as disconnected. Both are SECURITY DEFINER
-- to enforce the tenant boundary at the database level, not relying on application logic.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
SET LOCAL ROLE auth_owner;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- Ensure a webhook source row exists for a Stripe account id in the current tenant.
-- Returns the webhook_source id (creating one if necessary, reusing if already exists).
-- Raises if the account id is already mapped to a different practice.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.ensure_stripe_account_source(p_account text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := keystone.current_tenant_id();
  v_owner uuid;
  v_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'ensure_stripe_account_source requires tenant context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_account !~ '^acct_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'not a Stripe account id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT tenant_id, id INTO v_owner, v_id
    FROM keystone_auth.webhook_source
   WHERE provider = 'stripe' AND external_id = p_account AND retired_at IS NULL;
  IF v_id IS NOT NULL THEN
    IF v_owner <> v_tenant THEN
      RAISE EXCEPTION 'that Stripe account is mapped to another practice'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN v_id;
  END IF;
  INSERT INTO keystone_auth.webhook_source (tenant_id, provider, external_id)
    VALUES (v_tenant, 'stripe', p_account) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION keystone.ensure_stripe_account_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.ensure_stripe_account_source(text) TO app_rw;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- Retire the webhook source mapping for a Stripe account id.
-- Marks the row as retired (sets retired_at to now) so it is no longer active.
-- ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION keystone.retire_stripe_account_source(p_account text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE keystone_auth.webhook_source
     SET retired_at = now()
   WHERE provider = 'stripe' AND external_id = p_account
     AND tenant_id = keystone.current_tenant_id() AND retired_at IS NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION keystone.retire_stripe_account_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION keystone.retire_stripe_account_source(text) TO app_rw;

-- ★ REHEARSAL FIX (25 Sep 2026, MEASURED against a copy of production): the backfill below runs as
--   app_owner and calls ensure_stripe_account_source, which only app_rw may EXECUTE ("permission
--   denied for function ensure_stripe_account_source"). Lent to app_owner for this file and handed
--   straight back at the end — the 0402/0381 idiom. And `RESET ROLE` (which lands on the connecting
--   superuser for the rest of the file) became SET LOCAL ROLE app_owner, the role the runner set.
GRANT EXECUTE ON FUNCTION keystone.ensure_stripe_account_source(text) TO app_owner;

SET LOCAL ROLE app_owner;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL LOOP: for every practice with a connect_account row that holds a stripe_account_id,
-- ensure a webhook_source row exists mapping that account to the practice.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $stripe_account_source_backfill$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_before       integer;
  v_changed      integer;
  v_total        integer := 0;
  v_practices    integer := 0;
  i              integer;
BEGIN
  -- Enumerate every practice as auth_owner
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0424: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  -- Per practice: set the GUC, count connect_account rows with stripe_account_id, ensure webhook_source rows
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0424: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- Count how many connect_account rows in this practice have a stripe_account_id
    SELECT count(*) INTO v_before
      FROM keystone.connect_account ca
     WHERE ca.tenant_id = keystone.current_tenant_id()
       AND ca.stripe_account_id IS NOT NULL;

    -- Ensure webhook_source rows exist for each of those accounts
    -- (each call is idempotent: reuses existing, creates new if needed)
    WITH accounts_to_ensure AS (
      SELECT DISTINCT ca.stripe_account_id
        FROM keystone.connect_account ca
       WHERE ca.tenant_id = keystone.current_tenant_id()
         AND ca.stripe_account_id IS NOT NULL
    )
    SELECT count(*) INTO v_changed
      FROM accounts_to_ensure aca
      CROSS JOIN LATERAL (
        SELECT keystone.ensure_stripe_account_source(aca.stripe_account_id) AS id
      ) ensured;

    -- The count of ensure_stripe_account_source calls should equal the count of connect_account rows with stripe_account_id
    IF v_changed <> v_before THEN
      RAISE EXCEPTION '0424: practice % — expected to ensure % webhook_source row(s), ensured % — the ensure calls did not match the connect_account row count',
        v_tenant_id, v_before, v_changed;
    END IF;

    IF v_changed > 0 THEN
      v_practices := v_practices + 1;
    END IF;
    v_total := v_total + v_changed;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0424: % practice(s) enumerated · % Stripe account(s) ensured in webhook_source · % practice(s) held one',
    v_tenant_count, v_total, v_practices;
END
$stripe_account_source_backfill$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CLOSING ASSERTION: for each practice, count the active Stripe webhook_source rows and compare
-- with the connect_account rows that hold a stripe_account_id. They must match.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $stripe_account_source_assertion$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_connect_count integer;
  v_webhook_count integer;
  v_total_match   bigint := 0;
  v_total_mismatch bigint := 0;
  i integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0424: the tenant context did not take effect for practice % during closing assertion (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- Count connect_account rows in this practice with a stripe_account_id
    SELECT count(*) INTO v_connect_count
      FROM keystone.connect_account ca
     WHERE ca.tenant_id = keystone.current_tenant_id()
       AND ca.stripe_account_id IS NOT NULL;

    -- Count active Stripe webhook_source rows for this practice
    -- ★ REHEARSAL FIX: read as auth_owner — app_owner has no USAGE on keystone_auth ("permission
    --   denied for schema keystone_auth"); the tenant is named explicitly rather than via RLS.
    SET LOCAL ROLE auth_owner;
    SELECT count(*) INTO v_webhook_count
      FROM keystone_auth.webhook_source ws
     WHERE ws.tenant_id = v_tenant_id
       AND ws.provider = 'stripe'
       AND ws.retired_at IS NULL;
    SET LOCAL ROLE app_owner;

    -- They must match
    IF v_connect_count = v_webhook_count THEN
      v_total_match := v_total_match + v_connect_count;
    ELSE
      v_total_mismatch := v_total_mismatch + 1;
    END IF;

    IF v_connect_count <> v_webhook_count THEN
      RAISE EXCEPTION '0424: practice % — % connect_account row(s) with stripe_account_id but % active Stripe webhook_source row(s) — counts do not match',
        v_tenant_id, v_connect_count, v_webhook_count;
    END IF;
  END LOOP;

  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0424: confirmed — all % practice(s) match: % total Stripe account(s) mapped, 0 mismatched practice(s)',
    coalesce(array_length(v_tenant_ids, 1), 0), v_total_match;
END
$stripe_account_source_assertion$;

-- ★ The lend handed back (see the GRANT above).
SET LOCAL ROLE auth_owner;
REVOKE EXECUTE ON FUNCTION keystone.ensure_stripe_account_source(text) FROM app_owner;
SET LOCAL ROLE app_owner;
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)