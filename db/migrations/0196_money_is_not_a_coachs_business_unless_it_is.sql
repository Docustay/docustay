-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0196 — MONEY IS NOT A COACH'S BUSINESS UNLESS IT IS. (Stage 7 task 7.17.)
--
-- ★★★ WHAT THIS FIXES. `keystone.invoice`, `keystone.payment` and `keystone.subscription` each carry
--     exactly ONE predicate on their `tenant_isolation` policy — the tenant (0015:355-368 for invoice
--     and payment, 0009:174-187 for subscription). Every list that reads them applies its OWN viewer
--     predicate at the SQL layer (`src/records/lists/money.mjs`'s `scoped('invoice'|'payment'|
--     'subscription', …)`), which is correct for those three screens — but it means the ANSWER
--     depends on the QUERY asking it nicely, not on the ROW refusing to be read. Any other reader —
--     a report, a related-list join, a future route that selects straight from the table — gets every
--     row in the tenant, money included, with no grant check at all. R45/CCR-7 name the same gap from
--     the read side (History's `ACTIVITY_SQL`, `src/records/queries.mjs`, a sibling part of this same
--     task); this migration closes it at the table, which is the part neither a query nor a route can
--     route around.
--
-- ★★ THE FIX. Each table's `tenant_isolation` policy (currently `FOR ALL`, USING only) is DROPPED and
--    replaced by FOUR command-scoped policies:
--      · `tenant_isolation` — now `FOR SELECT` ONLY, gains the second conjunct:
--            AND (keystone.user_may(keystone.current_user_id(), 'invoice', 'view', <the row's owning
--                 coach, via the payer's own owner_user_id — the same subselect
--                 src/permissions/ownership.mjs's OWNERSHIP[...].ownerVia already resolves for these
--                 three objects, so the RLS predicate and the list predicate ask the identical
--                 question, not two that can drift>)
--                 OR <the row names THIS viewer as the payer themselves>)
--        The OR branch is 05 §6: "payer (client/parent/account) for their own" — a client reading
--        their own invoice through the portal never needs an `invoice` grant of their own; they need
--        to BE the payer. `keystone.user_may(...,NULL owner arg,...)` is NOT used here — a real owner
--        is always resolvable for these three (every row has a payer), unlike 7.17's OTHER part
--        (`reports.mjs`, this same task), which asks the coarser "everything" question because a
--        report is not one row.
--      · `tenant_update` and `tenant_delete` — NEW, both tenant-only (`tenant_id =
--        keystone.current_tenant_id()`/`require_tenant_id()`), reproducing EXACTLY what the dropped
--        `FOR ALL` policy already allowed for those two commands. ★★★ WITHOUT THESE, UPDATE and
--        DELETE would have ZERO applicable policies the instant `tenant_isolation` narrows to `FOR
--        SELECT` — Postgres does not fall back to a SELECT-only policy for other commands, it denies
--        them outright — and `src/payments/webhook.mjs` (payment status, invoice status) and
--        `src/money/writes.mjs` (subscription cancel) update these tables with NO viewer set at all
--        (`keystone.current_user_id()` is NULL on a webhook-driven write), which `user_may(NULL, …)`
--        always answers `false` for. Gating UPDATE the same way the SELECT gains would have silently
--        broken every webhook-driven money write. So UPDATE/DELETE keep the OLD, tenant-only answer —
--        this migration changes the READ policy, not who may write.
--      · `tenant_insert` — UNCHANGED. Still `FOR INSERT WITH CHECK (tenant_id =
--        keystone.require_tenant_id())`, exactly as 0015/0009 left it.
--
-- ★ WHO SUPPLIES THE CONDITION. `keystone.current_user_id()` reads the `keystone.user_id` GUC set at
--   `src/db/index.mjs:115` on every request — the application, not a test fixture. The grant itself
--   (`invoice: view/…`) is a `role_permission` row written by the roles screen — also the application.
--
-- ★★ WHY `tenant_isolation` KEEPS ITS NAME. `db/gates/p21a_cross_tenant_fuzz.mjs` weakens whichever
--    table it picks as its "red first" proof by `ALTER POLICY tenant_isolation ON keystone.<t> USING
--    (true)` and expects that ALTER to be the one controlling SELECT visibility. Renaming the
--    SELECT-governing policy to anything else would make that proof silently target the wrong policy
--    on these three tables if the fuzz ever picks one of them — so the SELECT policy keeps the name
--    `tenant_isolation` and the two NEW ones are named after the command they govern, following the
--    `tenant_insert`/`tenant_update` convention `db/migrations/0055_task.sql:112-127` already set.
--
-- ★ NOT MARKED `-- keystone:one-way` — reversible by a forward migration that restores the single
--   tenant predicate, same reasoning 0189/0193/0195/0197 give for their own reversible drops.
-- ★ NO SECRET, NO EMAIL, NO DISPLAY NAME IS READ OR PRINTED. NOTICEs carry counts and SQLSTATEs only.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── §a · PRECONDITIONS ──────────────────────────────────────────────────────────────────────────
DO $preconditions$
DECLARE
  v_qual text;
  t      text;
BEGIN
  IF current_user <> 'app_owner' THEN
    RAISE EXCEPTION '0196: must run as app_owner (db/migrate.mjs:317 sets it), running as %', current_user;
  END IF;

  IF to_regprocedure('keystone.user_may(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION '0196: keystone.user_may(uuid, text, text, uuid) does not exist — 7.10/0192 must run first';
  END IF;

  FOREACH t IN ARRAY ARRAY['invoice', 'payment', 'subscription'] LOOP
    IF to_regclass('keystone.' || t) IS NULL THEN
      RAISE EXCEPTION '0196: keystone.% does not exist', t;
    END IF;

    SELECT qual INTO v_qual FROM pg_catalog.pg_policies
     WHERE schemaname = 'keystone' AND tablename = t AND policyname = 'tenant_isolation';
    IF v_qual IS NULL THEN
      RAISE EXCEPTION '0196: keystone.% carries no tenant_isolation policy to replace', t;
    END IF;
    IF v_qual !~ 'current_tenant_id' THEN
      RAISE EXCEPTION '0196: keystone.%''s tenant_isolation USING does not mention current_tenant_id — changed by hand? refusing to guess: %', t, v_qual;
    END IF;
    IF v_qual ~ 'user_may' THEN
      RAISE EXCEPTION '0196: keystone.%''s tenant_isolation USING already mentions user_may — changed by hand? refusing to guess: %', t, v_qual;
    END IF;
  END LOOP;
END
$preconditions$;

-- ── §b · THE POLICIES — invoice ─────────────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON keystone.invoice;

CREATE POLICY tenant_isolation ON keystone.invoice
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND (
      keystone.user_may(keystone.current_user_id(), 'invoice', 'view',
        (SELECT ao.owner_user_id FROM keystone.app_user ao WHERE ao.id = invoice.payer_user_id))
      OR payer_user_id = keystone.current_user_id()
    )
  );

CREATE POLICY tenant_update ON keystone.invoice
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_delete ON keystone.invoice
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

COMMENT ON POLICY tenant_isolation ON keystone.invoice IS
  'Stage 7 task 7.17. FOR SELECT only (was FOR ALL). Tenant conjunct kept, plus '
  'keystone.user_may(current_user_id(), ''invoice'', ''view'', <payer''s owning coach>) OR '
  'payer_user_id = current_user_id() — the payer''s own client access (05 §6), preserved as an OR '
  'branch. UPDATE/DELETE keep the old tenant-only answer via the new tenant_update/tenant_delete '
  'policies — webhook-driven writes carry no viewer at all and must not be gated on one.';

-- ── §b · THE POLICIES — payment ─────────────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON keystone.payment;

CREATE POLICY tenant_isolation ON keystone.payment
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND (
      keystone.user_may(keystone.current_user_id(), 'invoice', 'view',
        (SELECT ao.owner_user_id FROM keystone.app_user ao WHERE ao.id = payment.payer_user_id))
      OR payer_user_id = keystone.current_user_id()
    )
  );

CREATE POLICY tenant_update ON keystone.payment
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_delete ON keystone.payment
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

COMMENT ON POLICY tenant_isolation ON keystone.payment IS
  'Stage 7 task 7.17. FOR SELECT only (was FOR ALL). Tenant conjunct kept, plus '
  'keystone.user_may(current_user_id(), ''invoice'', ''view'', <payer''s owning coach>) — '
  'OWNERSHIP[''payment''].ridesOn = ''invoice'' — OR payer_user_id = current_user_id() (05 §6). '
  'UPDATE/DELETE keep the old tenant-only answer; same reasoning as keystone.invoice.';

-- ── §b · THE POLICIES — subscription ────────────────────────────────────────────────────────────
DROP POLICY tenant_isolation ON keystone.subscription;

CREATE POLICY tenant_isolation ON keystone.subscription
  FOR SELECT USING (
    tenant_id = keystone.current_tenant_id()
    AND (
      keystone.user_may(keystone.current_user_id(), 'invoice', 'view',
        (SELECT ao.owner_user_id FROM keystone.app_user ao WHERE ao.id = subscription.app_user_id))
      OR app_user_id = keystone.current_user_id()
    )
  );

CREATE POLICY tenant_update ON keystone.subscription
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

CREATE POLICY tenant_delete ON keystone.subscription
  FOR DELETE USING (tenant_id = keystone.current_tenant_id());

COMMENT ON POLICY tenant_isolation ON keystone.subscription IS
  'Stage 7 task 7.17. FOR SELECT only (was FOR ALL). Tenant conjunct kept, plus '
  'keystone.user_may(current_user_id(), ''invoice'', ''view'', <the client''s owning coach>) — '
  'OWNERSHIP[''subscription''].ridesOn = ''invoice'' — OR app_user_id = current_user_id() (05 §6, the '
  'client on their own subscription). UPDATE/DELETE keep the old tenant-only answer; same reasoning '
  'as keystone.invoice.';

-- ── §c · SELF-CHECK, PART 1 — THE CATALOG SHAPE THIS FILE CLAIMS ───────────────────────────────
DO $shape_check$
DECLARE
  t text;
  n integer;
  v_qual text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice', 'payment', 'subscription'] LOOP
    -- ★★ FIX [MEASURED 22 Sep 2026]: this used to require EXACTLY 4 policies total and always
    --    failed — `reference_guard_read` (the reference-practice protection system's own SELECT
    --    policy, present on every FORCE RLS tenant table, `invoice` included) is a 5th policy this
    --    count never accounted for. Never exercised before now. Counting the 4 NAMED policies by
    --    name, rather than the table's total policy count, is what the exception message already
    --    claimed to check.
    SELECT count(*) INTO n FROM pg_catalog.pg_policies
     WHERE schemaname = 'keystone' AND tablename = t
       AND policyname IN ('tenant_isolation', 'tenant_insert', 'tenant_update', 'tenant_delete');
    IF n <> 4 THEN
      RAISE EXCEPTION '0196: keystone.% carries % of the 4 named policies (tenant_isolation, tenant_insert, tenant_update, tenant_delete)', t, n;
    END IF;

    SELECT qual INTO v_qual FROM pg_catalog.pg_policies
     WHERE schemaname = 'keystone' AND tablename = t AND policyname = 'tenant_isolation';
    IF v_qual !~ 'user_may' THEN
      RAISE EXCEPTION '0196: keystone.%''s tenant_isolation policy does not mention user_may: %', t, v_qual;
    END IF;

    -- app_rw's grants are UNCHANGED — still SELECT, INSERT, UPDATE, DELETE, exactly as 0015/0009 left them.
    IF NOT (pg_catalog.has_table_privilege('app_rw', 'keystone.' || t, 'SELECT')
            AND pg_catalog.has_table_privilege('app_rw', 'keystone.' || t, 'INSERT')
            AND pg_catalog.has_table_privilege('app_rw', 'keystone.' || t, 'UPDATE')
            AND pg_catalog.has_table_privilege('app_rw', 'keystone.' || t, 'DELETE')) THEN
      RAISE EXCEPTION '0196: app_rw lost a grant on keystone.%', t;
    END IF;
  END LOOP;

  RAISE NOTICE '0196: keystone.invoice, keystone.payment and keystone.subscription each carry 4 policies; tenant_isolation now FOR SELECT and reads user_may(...); app_rw''s grants are unchanged.';
END
$shape_check$;

-- ── §d · SELF-CHECK, PART 2 — A FABRICATED COACH, FUNCTIONALLY, WITH A POSITIVE CONTROL ────────
-- ★★★ Field 6: a coach holding `invoice: none` sees 0 invoices; the SAME coach, holding
--     `invoice: view/everything`, sees the one seeded row — the positive control this migration
--     must not ship without. Everything fabricated here is deleted at the end of this block;
--     nothing survives the migration. Modelled on 0195 §e / 0197 §d's probe-tenant-and-delete shape.
--
-- ★★ F490 FIX [MEASURED 22 Sep 2026]: `keystone.tenant` is FORCE RLS (`0001:151-152`) with no
--    INSERT policy `app_owner` (NOBYPASSRLS — `scripts/bootstrap-roles.mjs:247`) can satisfy — the
--    bare `INSERT INTO keystone.tenant` below was refused with "new row violates row-level security
--    policy for table tenant" on EVERY execution, unexercised until now. `0018:113-120,169-179`
--    established the house pattern for exactly this — suspend FORCE for the bootstrap, act, restore
--    it IN THE SAME TRANSACTION, and ASSERT it came back — so this probe now brackets itself the
--    same way, rather than inventing a second pattern.
ALTER TABLE keystone.tenant NO FORCE ROW LEVEL SECURITY;

DO $invoice_visibility_check$
DECLARE
  v_tenant   uuid;
  v_coach    uuid;  -- the actor
  v_payer    uuid;  -- the invoice's payer; NOT owned by v_coach — the grant, not ownership, is the
                     -- experiment here, so 'everything' is what must do the work
  v_role_id  uuid;
  v_invoice  uuid;
  v_seen     integer;
BEGIN
  INSERT INTO keystone.tenant (slug, name, timezone, status)
  VALUES ('m0196-probe', 'M0196 probe', 'UTC', 'active') RETURNING id INTO v_tenant;

  PERFORM set_config('keystone.tenant_id', v_tenant::text, true);
  IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION '0196: the tenant context did not take effect for the probe tenant';
  END IF;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role, staff_role)
  VALUES (v_tenant, 'm0196-coach@example.invalid', 'M0196 Coach', 'staff', 'coach')
  RETURNING id INTO v_coach;

  INSERT INTO keystone.app_user (tenant_id, email, display_name, role)
  VALUES (v_tenant, 'm0196-payer@example.invalid', 'M0196 Payer', 'adult_client')
  RETURNING id INTO v_payer;

  -- ★★ F490-ADJACENT FIX [MEASURED 22 Sep 2026]: this used to say `RETURNING id INTO v_invoice`.
  --    §b just rewrote `invoice`'s `tenant_isolation` SELECT policy (line 99-107, above) to
  --    `user_may(current_user_id(), 'invoice', 'view', payer's owner) OR payer_user_id =
  --    current_user_id()` — and `INSERT ... RETURNING` requires the just-inserted row to pass that
  --    SAME SELECT policy before Postgres can hand the id back. At this point `keystone.user_id` is
  --    deliberately still unset (the coach's context is not set until line 264, below), so
  --    `current_user_id()` is NULL, neither disjunct is true, and the row — genuinely inserted,
  --    satisfying the table's WITH CHECK — cannot be RETURNED: "new row violates row-level security
  --    policy for table invoice" ([MEASURED] identical mechanism, same fix, as `0194`'s
  --    `document_instance` probe — see that file's comment at the equivalent INSERT for the full
  --    reproduction). Fixed the same way: generate the id client-side with
  --    `keystone.uuid_generate_v7()` — the column's own DEFAULT (`0001:99` pattern) — and INSERT it
  --    explicitly, so nothing needs to read the row back.
  v_invoice := keystone.uuid_generate_v7();
  INSERT INTO keystone.invoice (id, tenant_id, payer_user_id, amount_minor, currency, status, invoice_number)
  VALUES (v_invoice, v_tenant, v_payer, 5000, 'USD', 'open', 'M0196-0001');

  INSERT INTO keystone.role (tenant_id, key, label, is_builtin)
  VALUES (v_tenant, 'm0196_probe_role', 'M0196 probe role', false) RETURNING id INTO v_role_id;

  -- ★ verb='none'/scope='none' together, per validateGrant's coherence rule (src/permissions/objects.mjs).
  INSERT INTO keystone.role_permission (tenant_id, role_id, object, verb, scope)
  VALUES (v_tenant, v_role_id, 'invoice', 'none', 'none');

  INSERT INTO keystone.user_role (tenant_id, user_id, role_id, granted_by)
  VALUES (v_tenant, v_coach, v_role_id, v_coach);

  PERFORM set_config('keystone.user_id', v_coach::text, true);

  -- ── NEGATIVE — invoice: none sees 0 rows ───────────────────────────────────────────────────────
  SELECT count(*) INTO v_seen FROM keystone.invoice WHERE id = v_invoice;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION '0196: a coach holding invoice:none saw % invoice row(s), expected 0', v_seen;
  END IF;

  -- ── POSITIVE CONTROL — the SAME identity, now invoice: view/everything, sees the seeded one ────
  PERFORM set_config('keystone.user_id', '', true);
  UPDATE keystone.role_permission SET verb = 'view', scope = 'everything'
   WHERE tenant_id = v_tenant AND role_id = v_role_id AND object = 'invoice';
  PERFORM set_config('keystone.user_id', v_coach::text, true);

  SELECT count(*) INTO v_seen FROM keystone.invoice WHERE id = v_invoice;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION '0196: a coach holding invoice:view/everything saw % invoice row(s), expected 1 (the seeded one)', v_seen;
  END IF;

  -- ── cleanup — the coach can now see the row it made, so it does the deleting ────────────────────
  DELETE FROM keystone.invoice WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.user_id', '', true);
  DELETE FROM keystone.user_role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role_permission WHERE tenant_id = v_tenant;
  DELETE FROM keystone.role WHERE tenant_id = v_tenant;
  DELETE FROM keystone.app_user WHERE tenant_id = v_tenant;
  PERFORM set_config('keystone.tenant_id', '', true);
  DELETE FROM keystone.tenant WHERE id = v_tenant;

  RAISE NOTICE '0196: a coach holding invoice:none saw 0 invoice row(s) (negative); the SAME identity, holding invoice:view/everything, saw 1 — the seeded row (positive control). Probe tenant % removed.', v_tenant;
END
$invoice_visibility_check$;

ALTER TABLE keystone.tenant FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON — 0018's own reasoning, verbatim: leaving it off would silently disable
--    tenant isolation on the root table of the whole schema, and every later migration and gate
--    would still pass.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.tenant'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0196: FORCE ROW LEVEL SECURITY was not restored on keystone.tenant';
  END IF;
END $$;
