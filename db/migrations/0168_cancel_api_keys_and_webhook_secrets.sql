-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0168 — EVERY API KEY AND EVERY WEBHOOK SIGNING SECRET ISSUED BEFORE THE STAGE 5 CONTRACT CHANGE
--        IS CANCELLED. (Spec 03 §10, the 17 Sep 2026 ruling. ★ the maintainer said YES to the production run on
--        21 Sep 2026 — STAGE-5-PLAN.md §5.11.)
--
-- ★★★ NOTHING IS DELETED. Three UPDATEs, never a DELETE: a key keeps its row, its name, its
--     last_four and its history, and gains `revoked_at` + `revoked_reason`. An endpoint keeps its
--     sealed envelope and gains `status='disabled'` + a reason. The record that the credential
--     existed, and why it stopped working, is the point.
--
-- ★★★ EVERY PREDICATE IS A STATE, NOT A ROW LIST — so a key minted between the moment this file was
--     written and the moment it runs on production is caught too, and so a second run changes
--     exactly zero rows.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 21 SEP 2026 · CORRECTED IN PLACE AFTER R-5-16 (F561 — **F283 RECURRING**). THE FIRST ATTEMPT
--     TO APPLY THIS FILE ABORTED AND ROLLED BACK:
--         `FAILED · 0168: 25 API key(s) still have revoked_at IS NULL after the cancel`
--     The two halves of the file disagreed BY CONSTRUCTION:
--       · the cancel ran INSIDE the per-practice loop under `WHERE tenant_id = v_tenant_id`, so it
--         could only ever reach a key whose `keystone.tenant` row still exists;
--       · the closing `$nothing_live_remains$` assertion counts `keystone_auth.api_token`
--         **globally** — as it must, and its strictness is not what changes here.
--     Twenty-five rows sat in that gap: keys minted by gates whose practice was later torn down
--     under `SET session_replication_role = replica` (db/gates/fixtures/suppressTriggers.mjs),
--     which suppresses `api_token.tenant_id`'s `ON DELETE RESTRICT` foreign key (0045:47) along
--     with every other trigger and leaves the token row behind, owned by nobody. That is **F283**
--     (~/example-rebuild/FINDINGS.md:6024-6063) recurring, and this time it stopped a migration
--     instead of merely leaving residue.
--   ★★ THE TENANT PREDICATE BOUGHT NOTHING TO BEGIN WITH. `keystone_auth.api_token` is ENABLE
--      (deliberately **not** FORCE) row level security and `auth_owner` OWNS it, so the role is not
--      filtered by `deny_all` at all: the loop was hand-scoping a write the database never scoped,
--      and paying for it with the rows it could not see.
--   ★★★ SO THE TWO `keystone_auth` UPDATEs RUN **ONCE, GLOBALLY, AS auth_owner** (option (a) of
--       R-5-16: remove the disagreement rather than sweep up after it). The per-practice loop stays
--       for `keystone.webhook_endpoint`, which genuinely needs the tenant GUC (F490 — item 3
--       below), and the owner-notice rule is UNCHANGED: its per-practice numbers now come from
--       counts taken **before** the global UPDATE, so "one notice per practice that lost something,
--       zero for the rest" still holds exactly. An ORPHANED row has no practice left to notify —
--       and `keystone.event.tenant_id` would refuse the row anyway — so orphans are counted and
--       reported in the NOTICE instead.
--   ★ EDITING AN APPLIED FILE, DELIBERATELY AND ONCE. This migration was applied to the LOCAL
--     database on 21 Sep 2026 and has NEVER run on production (head 0164), so nothing immutable on
--     production is being rewritten. `db/migrate.mjs:270-276` refuses an applied file whose
--     checksum changed, so the LOCAL `keystone_meta.schema_migrations` row for
--     `0168_cancel_api_keys_and_webhook_secrets` is deleted before the next `node db/migrate.mjs
--     up` and this file is re-applied — safe precisely because every predicate here is a STATE
--     (see above) and a re-run changes only what is still live. STAGE-5-PLAN.md §5 records it.
--
-- ★★ WHAT IT MEETS ON PRODUCTION: 0 live API keys, 0 inbound webhook sources, 0 webhook endpoints
--    (EXECUTED 2026-09-21, STAGE-5-PLAN.md §5). It destroys nothing today. The owner notice below
--    therefore writes ZERO rows on production, and that is a pass, not a silent failure.
--
-- ★★ NO SECRET IS READ, LOGGED OR PRINTED HERE. `webhook_endpoint.secret_envelope`,
--    `secret_fingerprint` and `kek_version` are NOT touched — disabling the endpoint is what cancels
--    the signing secret. `api_token.secret_hash` is not touched either.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE THREE TABLES ARE PROTECTED THREE DIFFERENT WAYS, SO THIS FILE USES THREE DIFFERENT
--     APPROACHES. `db/migrate.mjs` runs every file as `app_owner` (per-file `SET ROLE`), and a plain
--     `UPDATE` as app_owner would be WRONG on all three counts:
--
--   1 · `keystone_auth.api_token`  — OWNED BY `auth_owner`, ENABLE (deliberately **not** FORCE) row
--       level security with a `deny_all` policy (0045:102-105). app_owner holds **no grant at all**
--       on it, so an UPDATE as app_owner is `42501 permission denied`, not a silent no-op. As the
--       table's OWNER, and because RLS is not FORCEd, `auth_owner` is not filtered by `deny_all` —
--       so the write runs as auth_owner and reaches every practice at once. app_owner is a MEMBER of
--       auth_owner (NOINHERIT since the F484 repair), so `SET LOCAL ROLE auth_owner` is permitted
--       from here — the 0121/0132/0167 pattern.
--     ★ "REACHES EVERY PRACTICE AT ONCE" IS NOW WHAT THE CODE DOES: a single UPDATE outside the
--       loop, with no tenant predicate — see the 21 Sep 2026 note above (R-5-16 / F283).
--   2 · `keystone_auth.webhook_source` — identical treatment (0045:140-141), same role.
--   3 · `keystone.webhook_endpoint` — ★★★ **F490, AND THE PLAN'S "F490 APPLIES TO NONE OF THESE"
--       (STAGE-5-PLAN.md:510) IS WRONG FOR THIS TABLE.** It is `ENABLE + FORCE` RLS under
--       `tenant_isolation`/`tenant_update` (`USING (tenant_id = keystone.current_tenant_id())`,
--       0047:150-161), FORCE applies to the owner too, and this file runs with NO tenant GUC set —
--       so `UPDATE keystone.webhook_endpoint SET status='disabled' WHERE status <> 'disabled'`
--       would match ZERO rows in EVERY practice and COMMIT SUCCESSFULLY having cancelled nothing.
--       That is F490's exact silent-success shape, the fourth sighting.
--     ★ So the 0131/0136 pattern: enumerate every practice as `auth_owner` (it holds
--       `tenant_health_read FOR SELECT USING (true)` on `keystone.tenant`, 0017:56 — app_owner's
--       only read there is `reference_guard_read`, which on production admits nothing), collect the
--       ids into a PL/pgSQL ARRAY (never a temp table: one created as auth_owner is OWNED by
--       auth_owner and a NOINHERIT app_owner could not read it back), then per practice set
--       `keystone.tenant_id` and UPDATE as app_owner under its own policy.
--     ★ And the count it MEANT to change is read under the same GUC and compared with the count it
--       DID change, per practice — the assertion 0131 and 0136 both carry, because "zero rows
--       updated" and "there were zero rows to update" must never be indistinguishable.
--
-- ★ `SET LOCAL ROLE app_owner` to come back, NEVER a bare `RESET ROLE` — the session-level reset
--   that caused F482 (it lands on the connecting superuser and later objects change owner).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $cancel_every_credential$
DECLARE
  -- ★ The two reason strings are written once, here, so the row and the assertion below cannot
  --   disagree about what they say. `disabled_reason` is MANDATORY — 0047:66-68,
  --   `CHECK (status <> 'disabled' OR disabled_reason IS NOT NULL)` — a disabled endpoint with no
  --   reason is refused by the database, and that refusal is the point.
  c_key_reason      constant text :=
    '2026-09-17 ruling: all keys cancelled at the Stage 5 contract change';
  c_endpoint_reason constant text :=
    '2026-09-17 ruling: all webhook signing secrets cancelled at the Stage 5 contract change';

  v_tenant_ids        uuid[];
  v_tenant_count      integer;
  v_tenant_id         uuid;
  -- ★ The per-practice "before" counts, index-aligned with v_tenant_ids, taken BEFORE the global
  --   cancel below — they are what the owner notice is computed from (R-5-16).
  v_keys_before       integer[];
  v_sources_before    integer[];
  v_keys_known        integer;
  v_sources_known     integer;
  v_orphan_keys       integer;
  v_orphan_sources    integer;
  v_keys              integer;
  v_sources           integer;
  v_endpoints         integer;
  v_endpoints_before  integer;
  v_total_keys        integer := 0;
  v_total_sources     integer := 0;
  v_total_endpoints   integer := 0;
  v_notices           integer := 0;
  i                   integer;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 1 · EVERY PRACTICE, ENUMERATED AS auth_owner (F490).
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  -- ★ F490's own rule, restated as an assertion: what was collected equals what was counted, both
  --   read by the role that CAN see practices. A silent truncation of the array here would make
  --   every "cancelled nothing" line below look legitimate.
  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0168: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 2 · WHAT EACH PRACTICE IS ABOUT TO LOSE — COUNTED **BEFORE** ANYTHING IS CANCELLED (R-5-16).
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- ★★★ THIS IS THE HALF THAT KEEPS THE OWNER-NOTICE RULE INTACT NOW THAT THE CANCEL IS GLOBAL.
  --     The notice must say "one row per practice that lost something, zero for the rest", with the
  --     counts — so the per-practice numbers are read here, while the rows are still live, and the
  --     loop below spends them. Reading them AFTER the global UPDATE would return zero for every
  --     practice and write no notice at all: a silent, total loss of the notice rule that no
  --     assertion in this file would have caught.
  -- ★★ Index-aligned with v_tenant_ids by `WITH ORDINALITY`, never by re-sorting — the loop indexes
  --    both arrays with the same `i`, and an alignment that is merely believed is not one.
  -- ★ `count(a.id)` over a LEFT JOIN, so a practice with nothing live scores 0 and keeps its slot.
  SET LOCAL ROLE auth_owner;

  SELECT coalesce(array_agg(x.n ORDER BY x.ord), '{}')
    INTO v_keys_before
    FROM (SELECT t.ord AS ord, count(a.id)::integer AS n
            FROM unnest(v_tenant_ids) WITH ORDINALITY AS t(id, ord)
            LEFT JOIN keystone_auth.api_token a
                   ON a.tenant_id = t.id AND a.revoked_at IS NULL
           GROUP BY t.ord) AS x;

  SELECT coalesce(array_agg(x.n ORDER BY x.ord), '{}')
    INTO v_sources_before
    FROM (SELECT t.ord AS ord, count(s.id)::integer AS n
            FROM unnest(v_tenant_ids) WITH ORDINALITY AS t(id, ord)
            LEFT JOIN keystone_auth.webhook_source s
                   ON s.tenant_id = t.id AND s.retired_at IS NULL
           GROUP BY t.ord) AS x;

  -- ★ The same rule as the enumeration assertion above, for the same reason: an array that does not
  --   cover every practice hands the loop a NULL and turns "this practice lost nothing" into a fact
  --   nobody measured.
  IF coalesce(array_length(v_keys_before, 1), 0) <> v_tenant_count
     OR coalesce(array_length(v_sources_before, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0168: the per-practice before-counts cover % and % practice(s), not % — the owner-notice rule cannot be computed from them',
      coalesce(array_length(v_keys_before, 1), 0), coalesce(array_length(v_sources_before, 1), 0), v_tenant_count;
  END IF;

  SELECT coalesce(sum(t.n), 0)::integer INTO v_keys_known    FROM unnest(v_keys_before)    AS t(n);
  SELECT coalesce(sum(t.n), 0)::integer INTO v_sources_known FROM unnest(v_sources_before) AS t(n);

  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 3 · THE CANCEL ITSELF — ONCE, GLOBALLY, AS auth_owner. **NO TENANT PREDICATE** (R-5-16/F283).
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- ★★★ THE PREDICATE THAT USED TO BE HERE (`tenant_id = v_tenant_id`, inside the loop) is what
  --     made this migration unappliable: it could not reach a key whose practice row had already
  --     been deleted, while the closing assertion counts every row in the table. See the F283 note
  --     in the header. `revoked_at IS NULL` / `retired_at IS NULL` is still the whole predicate —
  --     a state, so a second run changes nothing, and a key minted between now and the deploy is
  --     caught as well.
  UPDATE keystone_auth.api_token
     SET revoked_at     = now(),
         revoked_reason = c_key_reason
   WHERE revoked_at IS NULL;
  GET DIAGNOSTICS v_total_keys = ROW_COUNT;

  -- ★ `webhook_source` holds NO secret (6 columns, EXECUTED 21 Sep 2026; 0045:121-131) — it is
  --   INBOUND routing, and retiring it withdraws a standing grant (Q5-14). The OUTBOUND signing
  --   secret is `keystone.webhook_endpoint`'s, handled at 4a.
  UPDATE keystone_auth.webhook_source
     SET retired_at = now()
   WHERE retired_at IS NULL;
  GET DIAGNOSTICS v_total_sources = ROW_COUNT;

  SET LOCAL ROLE app_owner;

  -- ★★ THE ORPHANS, NAMED AND COUNTED RATHER THAN DISCOVERED BY AN ABORT. The difference between
  --    what the global cancel touched and what the practices accounted for IS the F283 class:
  --    rows whose `keystone.tenant` row no longer exists. They get the same reason string (they
  --    were cancelled by the same ruling) and NO owner notice — there is no owner left to notify,
  --    and `keystone.event.tenant_id` references `keystone.tenant`, so the row could not be
  --    written even if there were.
  v_orphan_keys    := v_total_keys    - v_keys_known;
  v_orphan_sources := v_total_sources - v_sources_known;
  IF v_orphan_keys < 0 OR v_orphan_sources < 0 THEN
    RAISE EXCEPTION '0168: the global cancel revoked % API key(s) and retired % source(s), FEWER than the % and % the per-practice counts saw moments earlier — the two reads disagree and the owner notices below would be wrong',
      v_total_keys, v_total_sources, v_keys_known, v_sources_known;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 4 · PER PRACTICE: DISABLE THE ENDPOINTS, AND WRITE THE OWNER'S NOTICE.
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    -- ★ What this practice lost in section 3, measured before section 3 ran.
    v_keys      := v_keys_before[i];
    v_sources   := v_sources_before[i];

    -- ── 4a · the outbound endpoints, as app_owner under this practice's own GUC (F490) ─────────
    SET LOCAL ROLE app_owner;
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★★★ THE GUC ACTUALLY TOOK EFFECT. This is the anti-F490 assertion proper: if the context were
    --     not set, every count and every UPDATE below would be zero and agree with each other, and
    --     the migration would report a clean run having cancelled nothing.
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0168: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★★ THE `tenant_id = current_tenant_id()` PREDICATE IS REQUIRED HERE AND IS NOT BELT-AND-BRACES.
    --    app_owner's READ of this table is widened by a SECOND permissive policy — `reference_guard_read
    --    FOR SELECT TO app_owner USING (tenant_id IN (SELECT id FROM keystone.tenant WHERE is_reference))`
    --    (0133, on every table carrying the F492 guard, which is every keystone table with a tenant_id).
    --    Permissive policies are OR'd, so a bare count would ALSO see the REFERENCE practice's
    --    endpoints from inside every other practice's iteration — while the UPDATE, governed by
    --    `tenant_isolation`/`tenant_update`, would correctly refuse them. The count and the update
    --    would then disagree and the assertion below would abort a perfectly correct run.
    --  ★ The UPDATE keeps no such predicate: there the policy IS the scoping.
    SELECT count(*) INTO v_endpoints_before
      FROM keystone.webhook_endpoint
     WHERE status <> 'disabled'
       AND tenant_id = keystone.current_tenant_id();

    UPDATE keystone.webhook_endpoint
       SET status          = 'disabled',
           disabled_reason = c_endpoint_reason
     WHERE status <> 'disabled';
    GET DIAGNOSTICS v_endpoints = ROW_COUNT;

    IF v_endpoints <> v_endpoints_before THEN
      RAISE EXCEPTION '0168: practice % — expected to disable % webhook endpoint(s), disabled % — the update did not reach every row it counted (RLS?)',
        v_tenant_id, v_endpoints_before, v_endpoints;
    END IF;

    -- ── 4b · THE OWNER NOTICE (spec 03 §10) — ONE OUTBOX ROW PER PRACTICE THAT LOST SOMETHING ──
    -- ★★★ ONE ROW, NOT ONE PER CREDENTIAL: the practice is told once that its keys and webhook
    --     secrets were cancelled, with the counts. A practice that had nothing to cancel gets
    --     NOTHING — on production that is every practice (0/0/0), so the whole of this branch is
    --     skipped there, and the local test proves both halves.
    -- ★★ THE TOPIC IS THE CATALOGUED `developer.api_key.revoked` (src/events/topics.mjs:231), which
    --    the revoke route already emits (src/routes/developer.mjs:284) — deliberately NOT a new
    --    topic. MEASURED: a topic added to `TOPICS` with no emitter inside `src/` fails
    --    `db/gates/s3_topic_emitters.mjs` §3 ("no reachable producer and not in RESERVED"), and
    --    RESERVED lives in that gate file, which task 5.11 does not own. The catalogue is not
    --    required by the database — `event_topic_check` is a SHAPE check (0016:26), not a list —
    --    so an invented topic would have been legal SQL and an orphan in the product.
    -- ★ `subject_type`/`subject_id` are NULL together (both or neither — the emit() envelope rule):
    --   the notice is about the practice's whole credential set, not about one token row.
    -- ★ `actor = 'system'` — nobody's session did this; a migration did. It is the honest default
    --   and the only one `event_actor_check` (0134:38-40) would accept for a migration.
    -- ★ The payload carries COUNTS and ENUM-SHAPED TOKENS ONLY, so it satisfies the payload privacy
    --   rule (`assertSafePayload`, src/events/outbox.mjs:168) even though the INSERT is direct SQL:
    --   no names, no reasons in prose, nothing typed by a person.
    IF v_keys + v_sources + v_endpoints > 0 THEN
      INSERT INTO keystone.event (tenant_id, topic, emitted_by, subject_type, subject_id, payload, actor)
      VALUES (v_tenant_id,
              'developer.api_key.revoked',
              'developer',
              NULL,
              NULL,
              jsonb_build_object(
                'reason',                     'contract_change_2026_09_17',
                'migration',                  '0168',
                'api_keys_revoked',           v_keys,
                'webhook_sources_retired',    v_sources,
                'webhook_endpoints_disabled', v_endpoints),
              'system');
      v_notices := v_notices + 1;
    END IF;

    -- ★ Only the endpoints accumulate here now: the key and source totals are the ROW_COUNTs of the
    --   two global UPDATEs in section 3, which include the rows no practice accounts for.
    v_total_endpoints := v_total_endpoints + v_endpoints;
  END LOOP;

  -- ★ The GUC is transaction-local (`set_config(..., true)`) and would unwind anyway; cleared
  --   explicitly so nothing later in this transaction runs under the last practice's context.
  PERFORM set_config('keystone.tenant_id', '', true);

  -- ★ THE ORPHAN COUNTS ARE IN THE NOTICE, not only in the totals: "3 keys revoked" and "3 keys
  --   revoked, 2 of them belonging to a practice row that no longer exists" are different facts
  --   about the database, and the second is the one worth carrying into the deploy notes (F283).
  RAISE NOTICE '0168: % practice(s) · % API key(s) revoked (% orphaned — no practice row) · % inbound webhook source(s) retired (% orphaned) · % outbound endpoint(s) disabled · % owner notice(s) written',
    v_tenant_count, v_total_keys, v_orphan_keys, v_total_sources, v_orphan_sources,
    v_total_endpoints, v_notices;
END
$cancel_every_credential$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING ASSERTION — AN INDEPENDENT RE-READ, NOT THE COUNTERS ABOVE. 0131's step 4: "none
--     left" has to be a read that CAN see rows, taken again from scratch, in the role that is not
--     filtered. If the block above had cancelled nothing while reporting success (F490's shape),
--     its own totals would still have read 0; these counts would not.
--   ★ It is also the check that catches a row belonging to a practice the enumeration missed: the
--     api_token / webhook_source reads below are GLOBAL, not per practice.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $nothing_live_remains$
DECLARE
  v_live_keys      integer;
  v_live_sources   integer;
  v_live_endpoints integer := 0;
  v_tenant_ids     uuid[];
  v_n              integer;
  i                integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT count(*) INTO v_live_keys    FROM keystone_auth.api_token      WHERE revoked_at IS NULL;
  SELECT count(*) INTO v_live_sources FROM keystone_auth.webhook_source WHERE retired_at IS NULL;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    PERFORM set_config('keystone.tenant_id', v_tenant_ids[i]::text, true);
    -- ★ Same reason as the count in the block above: `reference_guard_read` (0133) would otherwise
    --   make the reference practice's rows visible from inside every practice's turn and count them
    --   once per practice.
    SELECT count(*) INTO v_n
      FROM keystone.webhook_endpoint
     WHERE status <> 'disabled'
       AND tenant_id = keystone.current_tenant_id();
    v_live_endpoints := v_live_endpoints + v_n;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_live_keys <> 0 THEN
    RAISE EXCEPTION '0168: % API key(s) still have revoked_at IS NULL after the cancel', v_live_keys;
  END IF;
  IF v_live_sources <> 0 THEN
    RAISE EXCEPTION '0168: % inbound webhook source(s) still have retired_at IS NULL after the cancel', v_live_sources;
  END IF;
  IF v_live_endpoints <> 0 THEN
    RAISE EXCEPTION '0168: % webhook endpoint(s) are still not disabled after the cancel', v_live_endpoints;
  END IF;

  RAISE NOTICE '0168: confirmed — 0 live API keys, 0 live inbound webhook sources, 0 enabled webhook endpoints remain';
END
$nothing_live_remains$;
