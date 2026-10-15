-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0172 — 0165'S BACKFILL, RUN AGAIN WHERE IT CAN ACTUALLY SEE THE ROWS. (Stage 5 step 4, R-5-15.)
--
-- ★★★ WHAT WENT WRONG, MEASURED. `0165_idempotency_redaction.sql` added
--     `keystone.idempotency_key.redacted` and then ran a top-level-keys-only UPDATE over the nine
--     credential names. It applied `ok (15ms)` and matched **ZERO** rows: [MEASURED 21 Sep 2026, as
--     the superuser, on the local database] 38 rows, 0 redacted, at least two of them holding a
--     credential at the top level of `response_body`. **F143** (`~/example-rebuild/FINDINGS.md:1936`)
--     and **F490** (`:12386`), exactly: `db/migrate.mjs:179,317` runs every file as `app_owner`,
--     `keystone.idempotency_key` is ENABLE **+ FORCE** row level security under `tenant_isolation`
--     (`USING (tenant_id = keystone.current_tenant_id())`, 0003:40-48), FORCE applies to the owner
--     too, and a migration sets no tenant GUC — so the UPDATE matched nothing and COMMITTED
--     SILENTLY.
--   ★ NOTHING WAS LOST: `redacted` was a brand-new column, and the rows were already stored the way
--     the application had stored them. What is wrong is the **LABEL** — rows that hold a credential
--     name at the top level assert `redacted = false`, so any later check of the form "no row with
--     `redacted = false` holds a credential" reads a lie. This file makes the label true.
--
-- ★★★ `0165` IS NOT EDITED. It is applied, and `db/migrate.mjs:268-277` checksums every applied
--     file: editing one turns every database into a drift error. The correction is a NEW migration,
--     and the predicate below is COPIED from `0165:20-34` rather than re-derived — the same nine
--     names, the same TOP-LEVEL-KEYS-ONLY rule (CCR-13: `key` is per-route, not global, so it stays
--     out of `NEVER_REPLAYED`; `src/http/idempotency.mjs` is not touched by this file).
--
-- ★★ THE ONE PREDICATE THAT IS NOT 0165'S: `AND k.redacted = false`. It makes this file a STATE, not
--    a row list — a second run changes exactly zero rows — and it keeps the NOTICE honest. A row the
--    RUNTIME already redacted legitimately still HAS a top-level `key`/`secret` NAME (the VALUE is
--    `'[not replayed]'`, `src/http/idempotency.mjs:57,89`); re-writing those would inflate the count
--    with rows that were never wrong. The closing assertion asks the same question this predicate
--    does — "a row whose label says clean while its top level names a credential" — so the two
--    cannot disagree about what "done" means.
--
-- ★★ NOT MARKED `-- keystone:one-way`, deliberately, and for the same reason `0165` is not: the
--    runner REFUSES a one-way file unless KEYSTONE_ALLOW_ONE_WAY=yes (`db/migrate.mjs:291-299`), and
--    step 5 applies this through a plain `node db/migrate.mjs up`. What it overwrites is a stored
--    credential that must not be replayed at all — the thing `0165` existed to remove.
--
-- ★★ NO SECRET IS READ, LOGGED OR PRINTED HERE. The NOTICEs carry COUNTS only — never a key, never a
--    `response_body`, never a row's `key` column.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHO CAN SEE THE ROWS — SETTLED BY READING THE POLICIES AND THE ROLE ATTRIBUTES, BECAUSE THIS
--     IS THE HALF OF F143 THAT MATTERS ("an assertion made through a blind connection is what F143
--     IS"):
--
--   · `keystone.idempotency_key` is owned by `app_owner`, ENABLE + FORCE RLS (0003:40-41). FORCE
--     means the OWNER is filtered too, so `app_owner` with no GUC sees NOTHING.
--   · Its policies are `tenant_isolation` / `tenant_insert` / `tenant_update`, all on
--     `current_tenant_id()` / `require_tenant_id()` (0003:42-48), plus — if this table carries the
--     F492 guard trigger — 0133's `reference_guard_read FOR SELECT TO app_owner USING (tenant_id IN
--     (SELECT id FROM keystone.tenant WHERE is_reference))`. There is NO `USING (true)` policy for
--     any role.
--   · `auth_owner` holds **no grant at all** on this table (0003:77-78 grants to `app_rw` only), so
--     it cannot read it even though it is the role that CAN enumerate practices (F490).
--   · Every role this migration may assume is **NOBYPASSRLS** (`scripts/bootstrap-roles.mjs:163-181`),
--     and the migration must NEVER `RESET ROLE` back to the connecting superuser (F482,
--     0168:53-54).
--   ★★★ THEREFORE A GLOBAL, ALL-PRACTICES VIEW OF THIS TABLE IS IMPOSSIBLE INSIDE A MIGRATION. Unlike
--       `0168`'s closing read of `keystone_auth.api_token` (owned by auth_owner, ENABLE **without**
--       FORCE, so its owner sees everything), the only way to see a row here is to BE app_owner with
--       that row's practice in the GUC. **So the closing assertion loops the practices too and SUMS**
--       — a single global `count(*)` would read 0 rows and pass vacuously, which is precisely the
--       failure this file exists to correct.
--   ★ THE ONE CLASS OF ROW NO ROLE HERE CAN REACH, STATED RATHER THAN DISCOVERED: a row whose
--     practice no longer exists. `tenant_id` is `REFERENCES keystone.tenant(id) ON DELETE RESTRICT`
--     (0003:13), so that can only happen when a teardown deletes a practice under
--     `session_replication_role = 'replica'` (the F283 class, R-5-16). Such a row is invisible to
--     every role this migration may assume, so it is neither redacted nor counted, and the assertion
--     below does not claim otherwise.
--
-- ★ THE ENUMERATION AND THE ROLE SWITCHES ARE `0168:84-88, 101-133`'s, COPIED, NOT RE-DERIVED:
--   enumerate as `auth_owner` (it holds `tenant_health_read FOR SELECT USING (true)` on
--   `keystone.tenant`, 0017:56 — app_owner's only read there is `reference_guard_read`, which on
--   production admits NOTHING: [MEASURED, F490] app_owner → 0 practices, auth_owner → 3), collect
--   into a PL/pgSQL ARRAY (never a temp table — one created as auth_owner is owned by auth_owner and
--   a NOINHERIT app_owner could not read it back), then per practice set `keystone.tenant_id` and
--   write as `app_owner` under its own policy.
-- ★ `SET LOCAL ROLE app_owner` to come back, NEVER a bare `RESET ROLE` (F482). `SET LOCAL` inside a
--   DO block lasts to the end of the TRANSACTION, and `db/migrate.mjs:328-336` wraps each file in
--   its own BEGIN/COMMIT, so neither the role nor the GUC leaks past this migration — and the runner
--   re-asserts `app_owner` before every file anyway (`:317-323`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $idempotency_redaction_backfill$
DECLARE
  v_tenant_ids   uuid[];
  v_tenant_count integer;
  v_tenant_id    uuid;
  v_before       integer;
  v_changed      integer;
  v_total        bigint := 0;
  v_practices    integer := 0;
  i              integer;
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 1 · EVERY PRACTICE, ENUMERATED AS auth_owner (F490) — 0168:84-96.
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}'), count(*)
    INTO v_tenant_ids, v_tenant_count
    FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  -- ★ F490's own rule, restated as an assertion: what was collected equals what was counted, both
  --   read by the role that CAN see practices. A silent truncation of the array here would make the
  --   "0 rows to redact" line below look legitimate.
  IF coalesce(array_length(v_tenant_ids, 1), 0) <> v_tenant_count THEN
    RAISE EXCEPTION '0172: enumerated % practice id(s) but keystone.tenant holds % — the enumeration did not see every practice',
      coalesce(array_length(v_tenant_ids, 1), 0), v_tenant_count;
  END IF;

  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  -- 2 · PER PRACTICE: SET THE GUC, PROVE IT TOOK, COUNT, REDACT, AND COMPARE.
  -- ─────────────────────────────────────────────────────────────────────────────────────────────
  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);

    -- ★★★ THE GUC ACTUALLY TOOK EFFECT (0168:127-133). This is the anti-F490 assertion proper: if
    --     the context were not set, every count and every UPDATE below would be zero and would
    --     agree with each other, and this migration would report a clean run having redacted
    --     nothing — which is exactly what 0165 did.
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0172: the tenant context did not take effect for practice % (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★★ THE `tenant_id = current_tenant_id()` PREDICATE IS REQUIRED ON THE COUNT AND IS NOT
    --    BELT-AND-BRACES (0168:135-143). If this table carries 0133's `reference_guard_read`, that
    --    SECOND permissive SELECT policy is OR'd with `tenant_isolation`, so a bare count would ALSO
    --    see the REFERENCE practice's rows from inside every other practice's iteration — while the
    --    UPDATE, governed by `tenant_update`, would correctly refuse them. The count and the update
    --    would then disagree and the assertion below would abort a perfectly correct run. (If the
    --    table does not carry that policy the predicate is a no-op; it is correct either way.)
    --  ★ The UPDATE keeps no such predicate: there the POLICY is the scoping, and that is what makes
    --    the comparison below an RLS check rather than two copies of one WHERE clause.
    SELECT count(*) INTO v_before
      FROM keystone.idempotency_key k
     WHERE k.tenant_id = keystone.current_tenant_id()
       AND k.redacted = false
       AND jsonb_typeof(k.response_body) = 'object'
       AND EXISTS (
             SELECT 1 FROM jsonb_object_keys(k.response_body) ok
              WHERE ok IN ('key','token','secret','apiKey','api_key',
                           'signingSecret','presented','plaintext','clientSecret'));

    -- ★ 0165:20-34's statement, verbatim apart from `AND k.redacted = false`. BY KEY NAME, exactly
    --   as the runtime walk does, never by value shape — a truncated key, a `whsec_`, or a `secret`
    --   field under an ordinary-looking value must all go. TOP-LEVEL KEYS ONLY, deliberately: the
    --   runtime walk is recursive, this backfill is not, and the difference is stated rather than
    --   discovered (0165:17-19).
    UPDATE keystone.idempotency_key k
       SET response_body = (
             SELECT jsonb_object_agg(
                      e.key,
                      CASE WHEN e.key IN ('key','token','secret','apiKey','api_key',
                                          'signingSecret','presented','plaintext','clientSecret')
                           THEN '"[not replayed]"'::jsonb
                           ELSE e.value END)
               FROM jsonb_each(k.response_body) e),
           redacted = true
     WHERE k.redacted = false
       AND jsonb_typeof(k.response_body) = 'object'
       AND EXISTS (
             SELECT 1 FROM jsonb_object_keys(k.response_body) ok
              WHERE ok IN ('key','token','secret','apiKey','api_key',
                           'signingSecret','presented','plaintext','clientSecret'));
    GET DIAGNOSTICS v_changed = ROW_COUNT;

    -- ★ "Zero rows updated" and "there were zero rows to update" must never be indistinguishable
    --   (0168:49-51). Both numbers are read under the SAME GUC, so this is not a substitute for the
    --   closing assertion — it is the per-practice half of it.
    IF v_changed <> v_before THEN
      RAISE EXCEPTION '0172: practice % — expected to redact % replay row(s), redacted % — the update did not reach every row it counted (RLS?)',
        v_tenant_id, v_before, v_changed;
    END IF;

    IF v_changed > 0 THEN
      v_practices := v_practices + 1;
    END IF;
    v_total := v_total + v_changed;
  END LOOP;

  -- ★ The GUC is transaction-local (`set_config(..., true)`) and would unwind anyway; cleared
  --   explicitly so nothing later in this transaction runs under the last practice's context.
  PERFORM set_config('keystone.tenant_id', '', true);

  RAISE NOTICE '0172: % practice(s) enumerated · % replay row(s) redacted by name · % practice(s) held one',
    v_tenant_count, v_total, v_practices;
END
$idempotency_redaction_backfill$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE CLOSING ASSERTION — AN INDEPENDENT RE-READ, NOT THE COUNTERS ABOVE (0168:210-217). If the
--     block above had redacted nothing while reporting success (F143/F490's shape), its own totals
--     would still have read 0; this one would not, because it enumerates the practices AGAIN as
--     auth_owner and re-reads each one under its own GUC as app_owner.
--   ★★ IT LOOPS AND SUMS BECAUSE IT MUST: as established in the header, no role this migration may
--      assume can see this FORCE-RLS table without a tenant GUC, so a single global `count(*)` would
--      be the vacuous assertion F143's second half is about ("the guard inside it PASSED, because
--      both numbers were computed under the same blindness").
--   ★★ ITS OWN POSITIVE CONTROL, IN THE SAME BLOCK AND IN THE NOTICE: the read also counts the rows
--      it CAN see (`v_seen`) and the rows that now carry `redacted = true` WITH a credential name at
--      the top level (`v_fixed`). A blind re-read prints `0 of 0 row(s) visible` — visibly vacuous —
--      instead of a clean-looking "confirmed". The counts are printed, never a value.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $no_unredacted_credential_row_remains$
DECLARE
  v_tenant_ids uuid[];
  v_tenant_id  uuid;
  v_n          integer;
  v_left       bigint := 0;
  v_seen       bigint := 0;
  v_fixed      bigint := 0;
  i            integer;
BEGIN
  SET LOCAL ROLE auth_owner;
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_tenant_ids FROM keystone.tenant;
  SET LOCAL ROLE app_owner;

  FOR i IN 1 .. coalesce(array_length(v_tenant_ids, 1), 0) LOOP
    v_tenant_id := v_tenant_ids[i];
    PERFORM set_config('keystone.tenant_id', v_tenant_id::text, true);
    IF keystone.current_tenant_id() IS DISTINCT FROM v_tenant_id THEN
      RAISE EXCEPTION '0172: the tenant context did not take effect for practice % during the closing re-read (current_tenant_id() is %)',
        v_tenant_id, keystone.current_tenant_id();
    END IF;

    -- ★ Same reason as the count in the block above: `reference_guard_read` (0133) would otherwise
    --   make the reference practice's rows visible from inside every practice's turn and count them
    --   once per practice.
    SELECT count(*) INTO v_n
      FROM keystone.idempotency_key k
     WHERE k.tenant_id = keystone.current_tenant_id()
       AND k.redacted = false
       AND jsonb_typeof(k.response_body) = 'object'
       AND EXISTS (
             SELECT 1 FROM jsonb_object_keys(k.response_body) ok
              WHERE ok IN ('key','token','secret','apiKey','api_key',
                           'signingSecret','presented','plaintext','clientSecret'));
    v_left := v_left + v_n;

    SELECT count(*) INTO v_n
      FROM keystone.idempotency_key k
     WHERE k.tenant_id = keystone.current_tenant_id();
    v_seen := v_seen + v_n;

    SELECT count(*) INTO v_n
      FROM keystone.idempotency_key k
     WHERE k.tenant_id = keystone.current_tenant_id()
       AND k.redacted = true
       AND jsonb_typeof(k.response_body) = 'object'
       AND EXISTS (
             SELECT 1 FROM jsonb_object_keys(k.response_body) ok
              WHERE ok IN ('key','token','secret','apiKey','api_key',
                           'signingSecret','presented','plaintext','clientSecret'));
    v_fixed := v_fixed + v_n;
  END LOOP;
  PERFORM set_config('keystone.tenant_id', '', true);

  IF v_left <> 0 THEN
    RAISE EXCEPTION '0172: % replay row(s) still say redacted = false while naming a credential at the top level of response_body', v_left;
  END IF;

  RAISE NOTICE '0172: confirmed — 0 of % visible replay row(s) across % practice(s) claim redacted = false while naming a credential; % row(s) name one and are marked redacted',
    v_seen, coalesce(array_length(v_tenant_ids, 1), 0), v_fixed;
END
$no_unredacted_credential_row_remains$;
