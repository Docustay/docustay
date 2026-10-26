-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P8.7 — RETIRE `price_minor`. THE CONTRACT HALF OF 0015, RUN AT LAST.
--
-- ★★★ MIGRATION 0015 RAN THE EXPAND. It copied `service.price_minor`, `package.price_minor` and
--     `plan.price_minor` into `keystone.price` (0015:388-394) and pointed every read at
--     `current_price()`. **The contract never ran.** The columns stayed, stayed NOT NULL, and so
--     kept being WRITTEN — one value at creation, never updated again.
--
-- ★★★ AND THE RECORDED FINDING HAS THE DIRECTION BACKWARDS, WHICH IS WHY THIS SAT SO LONG.
--     `F76` calls this "superseded but STILL READ". [MEASURED 2026-09-15, grep over the whole tree]
--     **There is not one read of `price_minor` in `src/`.** Every mention in `src/` is a COMMENT
--     saying "not this column" — `records/queries.mjs:205`, `records/lists/items.mjs:64`,
--     `records/shell.mjs:343`, `routes/index.mjs:604`. The three real touches are INSERTs
--     (`items/writes.mjs:152,198,243`). **Superseded and still WRITTEN — the opposite defect, and
--     the opposite fix.** A read that was never there could not be repointed; the write had to stop.
--
-- ★★ THE HARM IS NOT TODAY'S SNAPSHOT, IT IS THE SECOND WRITE THAT NEVER COMES. [MEASURED against
--    the deployed database 2026-09-15] all 3 services, 3 packages and 3 plans have a price row, none
--    would lose a price, and **none disagree right now**. But re-pricing writes a NEW `price` row and
--    deliberately does not touch the column — `db/gates/p6_items_section.mjs:672-675` asserted
--    exactly that, calling it "stale by design". So the two numbers differ the moment anybody changes
--    a price, and the column's value is then a price nobody charges. **One price change is all it
--    takes**, which is why the fix is structural and not a data repair.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THIS MIGRATION IS DDL ONLY, AND THAT IS `F143`, NOT TIDINESS.
--
--     The first draft of this file did the whole job in SQL: backfill any row missing a price row,
--     then `UPDATE … SET price_minor = NULL`. **Both statements would have reported success and
--     changed nothing.** `db/migrate.mjs:93` runs migrations as `app_owner`, FORCE ROW LEVEL
--     SECURITY applies to the table owner, and a migration sets no `keystone.tenant_id` — so every
--     row is invisible and `UPDATE 0` is not an error. 0071 and 0072 both shipped that way; 0072's
--     own guard passed because before and after were counted under the same blindness.
--   ★★ And the obvious workaround is also dead: looping `SELECT id FROM keystone.tenant` iterates
--      **zero times**, because `tenant` is isolated by the same rule.
--   ★ So the DML lives in `scripts/retire-price-minor.mjs`, connected as the superuser — the shape
--     `backfill-roles.mjs` and `backfill-ownership.mjs` already use. **The DDL below is safe here
--     precisely because DDL is not row-level.**
--
-- ★★ THE COLUMN IS NOT DROPPED, AND THAT IS SEQUENCING, NOT TIMIDITY. Migrations are run BY HAND;
--    nothing runs them at boot. The bundle deployed right now still names `price_minor` in three
--    INSERTs, so a `DROP COLUMN` before the next deploy breaks service, package and plan creation on
--    the live site for the length of that window. This migration is safe under BOTH bundles at once —
--    the old one supplies a value the column still accepts, the new one omits a column that is now
--    nullable. **That overlap is the whole point of expand/contract.** The drop is recorded in
--    HANDOFF.md with its exact command, to run once no deployed bundle names it.
--
-- ★ The `price_minor >= 0` CHECKs from 0009 are left alone: a CHECK is not violated by NULL, so they
--   neither refuse the null-out nor constrain anything afterwards. Removing them would be a second
--   schema change for no behavioural gain.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.service ALTER COLUMN price_minor DROP NOT NULL;
ALTER TABLE keystone.package ALTER COLUMN price_minor DROP NOT NULL;
ALTER TABLE keystone.plan    ALTER COLUMN price_minor DROP NOT NULL;

COMMENT ON COLUMN keystone.service.price_minor IS
  'RETIRED 2026-09-15 (P8.7, migration 0109). Holds no price. The price is in keystone.price, read through current_price(). Nulled by scripts/retire-price-minor.mjs; scheduled for DROP COLUMN once no deployed bundle names it.';
COMMENT ON COLUMN keystone.package.price_minor IS
  'RETIRED 2026-09-15 (P8.7, migration 0109). Holds no price. The price is in keystone.price, read through current_price(). Nulled by scripts/retire-price-minor.mjs; scheduled for DROP COLUMN once no deployed bundle names it.';
COMMENT ON COLUMN keystone.plan.price_minor IS
  'RETIRED 2026-09-15 (P8.7, migration 0109). Holds no price. The price is in keystone.price, read through current_price(). Nulled by scripts/retire-price-minor.mjs; scheduled for DROP COLUMN once no deployed bundle names it.';
