-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0383 — PAYER GROUPS BECOME ACCOUNTS: kind, contact, archive, one group per person. (Stage 12,
-- task 12.5, F03.)
--
-- ★★★ WIDENS, DOES NOT CREATE. `keystone.payer_group` and `keystone.payer_group_member` already
--     exist (migration 0360) with FORCE ROW LEVEL SECURITY, the tenant policies, and their grants
--     to `app_rw` (0360:84-107) — the CT-F52 new-tenant-table checklist does not apply here because
--     no new table is created and no new policy is needed; the existing FORCE RLS on both tables
--     already covers the columns this migration adds.
--
-- ★ `kind` classifies the account (family / employer / third_party); `contact_user_id` is the
--   person staff correspond with; `billing_note` is a short free-text note (≤200 chars);
--   `archived_at`/`archived_by` record a soft archive (refused while money is open — enforced in
--   application code, not here). The new unique index enforces ONE payer group per person,
--   tenant-wide — a person may no longer be a member of two different accounts at once; moving them
--   between accounts is `moveMember` (`src/money/payerGroups.mjs`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.payer_group
  ADD COLUMN kind text NOT NULL DEFAULT 'family' CHECK (kind IN ('family','employer','third_party')),
  ADD COLUMN contact_user_id uuid NULL,
  ADD COLUMN billing_note text NULL CHECK (billing_note IS NULL OR char_length(billing_note) <= 200),
  ADD COLUMN archived_at timestamptz NULL,
  ADD COLUMN archived_by uuid NULL;
ALTER TABLE keystone.payer_group ALTER COLUMN kind DROP DEFAULT;   -- every new row states its kind
ALTER TABLE keystone.payer_group ADD CONSTRAINT payer_group_contact_fkey FOREIGN KEY (tenant_id, contact_user_id)
  REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (contact_user_id);
ALTER TABLE keystone.payer_group ADD CONSTRAINT payer_group_archived_by_fkey FOREIGN KEY (tenant_id, archived_by)
  REFERENCES keystone.app_user (tenant_id, id) ON DELETE SET NULL (archived_by);
CREATE UNIQUE INDEX payer_group_member_one_group_per_person
  ON keystone.payer_group_member (tenant_id, person_id) WHERE person_id IS NOT NULL;
-- No new table, no new policy (existing FORCE RLS on both tables, 0360:107-120, covers the columns).
-- Written, not applied.
