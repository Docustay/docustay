-- 0073 — P1.4 · `ON DELETE SET NULL` ON A COMPOSITE FK NULLS **EVERY** COLUMN IN THE KEY.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 0071 WROTE `FOREIGN KEY (tenant_id, owner_user_id) … ON DELETE SET NULL` AND MEANT "clear the
--     owner". What Postgres does by default is clear **the whole referencing key** — so deleting a
--     coach would try to set `tenant_id = NULL` as well, on every client they owned.
--
--     [EXECUTED] `db/gates/p1_ownership.mjs §5`, offboarding a coach:
--       GATE ERROR: null value in column "tenant_id" of relation "app_user" violates not-null constraint
--
--   ★★ AND NOTE WHICH WAY IT FAILED. `tenant_id` is NOT NULL, so the delete ABORTS — loudly, which
--      is the lucky outcome. **On any table whose tenant_id were nullable, this would have silently
--      detached rows from their tenant**, which is the worst defect this schema can have: a row
--      belonging to no tenant is invisible to RLS in every direction.
--   ★ So the same three words on `account_owner_fkey` are equally wrong and are fixed here too,
--     before anything ever deletes a coach who owns an account.
--
-- ★★ THE FIX IS PER-COLUMN `SET NULL`, which Postgres 15 added and this database (17.11) supports.
--    `ON DELETE SET NULL (owner_user_id)` nulls the owner and leaves the tenant alone — which is what
--    both constraints were always for: when a coach leaves, their clients become UNASSIGNED and
--    appear on the list P1.4 §4 exists to make visible.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.app_user DROP CONSTRAINT app_user_owner_fkey;
ALTER TABLE keystone.app_user ADD CONSTRAINT app_user_owner_fkey
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (owner_user_id);

ALTER TABLE keystone.account DROP CONSTRAINT account_owner_fkey;
ALTER TABLE keystone.account ADD CONSTRAINT account_owner_fkey
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES keystone.app_user (tenant_id, id)
  ON DELETE SET NULL (owner_user_id);
