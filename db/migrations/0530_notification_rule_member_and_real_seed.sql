-- 0530 — TWO REAL DEFECTS FOUND AT END CHECKS (27–28 Sep 2026), BOTH IN
-- 0336_a_notification_rule_is_the_practices_own_default.sql, NEITHER EVER ACTUALLY EXERCISED
-- AGAINST REAL DATA BEFORE NOW.
--
-- ★★★ DEFECT 1 — THE SEED NEVER RAN. 0336's own seed used
--     `FOR t IN SELECT id FROM keystone.tenant LOOP` to enumerate every tenant, reasoning (in its
--     own header comment) that this was needed to insert "exactly as the application itself would,
--     under the same policies." That reasoning is right about the INSERT, but misses that the very
--     same FORCE RLS applies to `keystone.tenant` ITSELF — `app_owner` (the role `db/migrate.mjs`
--     runs every migration as) has no tenant context set, so `SELECT id FROM keystone.tenant`
--     returns ZERO rows, the loop body never executes, and the migration reports success having
--     inserted nothing. MEASURED: `SELECT count(*) FROM keystone.notification_rule` — 0, on a
--     database with 7 real tenants. Proven independently: `0017_health_tenant_lister.sql`'s own DO
--     block asserts "a direct read with no tenant context returns 0 tenant(s)" as the CORRECT,
--     intended behaviour of `keystone.tenant`'s RLS — this migration's assumption that reading
--     `keystone.tenant` was safe was simply wrong, the same mistake 0525 (F-BUILD-18) independently
--     made and fixed the same night.
--   ★ FIX HERE uses a DIFFERENT, simpler bypass than 0525's — `ALTER TABLE ... NO FORCE ROW LEVEL
--     SECURITY`, already an established pattern in THIS codebase (0489_sms_consent_type.sql uses the
--     identical idiom on this exact table for a constraint change) — since `app_owner` OWNS
--     `notification_rule` (and `keystone.tenant`, for the read), removing FORCE for the duration of
--     this migration's transaction restores ordinary owner-bypass, letting a single set-based INSERT
--     do the whole seed with no loop and no per-tenant GUC juggling at all.
--
-- ★★★ DEFECT 2 — 'coach' WAS NEVER RENAMED HERE. L13.3 (migration 0525, same night) renamed the
--     STAFF RANK vocabulary `coach` → `member` in `app_user.staff_role` and `keystone.role.key`, but
--     `notification_rule.role`'s own CHECK constraint (`'owner_admin','coach','client_parent'`) was
--     never touched — L13.3's own respec (`specs/de-code/build/respec/L13.md`) never mentions this
--     table at all. MEASURED: `src/notifications/rules.mjs:27` — the application's OWN
--     `NOTIFICATION_ROLES` constant already reads `["owner_admin", "member", "client_parent"]` (from
--     earlier L13.1 work), meaning the app code and the database CHECK constraint have been
--     disagreeing this whole time: any write attempting `role = 'member'` would have been REFUSED by
--     the still-'coach'-only constraint, and any read filtering `role = 'member'` would have matched
--     nothing even if a row existed. Table currently holds 0 rows (defect 1), so no data migration is
--     needed for this half — only the constraint and the seed values.

ALTER TABLE keystone.notification_rule NO FORCE ROW LEVEL SECURITY;

-- ── DEFECT 2's fix: the CHECK constraint, 'coach' → 'member', matching NOTIFICATION_ROLES exactly ──
ALTER TABLE keystone.notification_rule
  DROP CONSTRAINT notification_rule_role_check,
  ADD CONSTRAINT notification_rule_role_check
    CHECK (role IN ('owner_admin', 'member', 'client_parent'));

-- ── Defensive: rename any 'coach' row that might exist despite the count-0 measurement above ──────
UPDATE keystone.notification_rule SET role = 'member' WHERE role = 'coach';

-- ── DEFECT 1's fix: the real seed, one set-based INSERT, no loop needed now FORCE is off ──────────
-- Same seven topics / three roles / three channels as 0336's own body, 'member' in place of 'coach'.
INSERT INTO keystone.notification_rule (tenant_id, topic, role, channel, enabled, locked)
SELECT tenant.id, topics.topic, roles.role, channels.channel,
       (channels.channel <> 'push'),
       topics.locked
  FROM keystone.tenant
  CROSS JOIN (VALUES
    ('booking.booking.created',   true),
    ('booking.booking.cancelled', true),
    ('documents.document.sent',   true),
    ('money.invoice.paid',        true),
    ('booking.booking.reminder',  false),
    ('documents.document.signed', false),
    ('money.invoice.opened',      false)
  ) AS topics(topic, locked)
  CROSS JOIN (VALUES ('owner_admin'), ('member'), ('client_parent')) AS roles(role)
  CROSS JOIN (VALUES ('in_app'), ('email'), ('push')) AS channels(channel)
ON CONFLICT (tenant_id, topic, role, channel) DO NOTHING;

ALTER TABLE keystone.notification_rule FORCE ROW LEVEL SECURITY;

-- ── THE SELF-CHECK. A REAL count, not the same "loop over a table I can't read" mistake. ──────────
DO $the_seed_is_real$
DECLARE
  v_tenants integer;
  v_rows    integer;
  v_coach   integer;
BEGIN
  ALTER TABLE keystone.notification_rule NO FORCE ROW LEVEL SECURITY;

  SELECT count(*) INTO v_tenants FROM keystone.tenant;
  SELECT count(*) INTO v_rows FROM keystone.notification_rule;
  SELECT count(*) INTO v_coach FROM keystone.notification_rule WHERE role = 'coach';

  ALTER TABLE keystone.notification_rule FORCE ROW LEVEL SECURITY;

  IF v_rows <> v_tenants * 63 THEN
    RAISE EXCEPTION
      '0530: expected exactly % rows (% tenant(s) × 63), found %',
      v_tenants * 63, v_tenants, v_rows;
  END IF;
  IF v_coach > 0 THEN
    RAISE EXCEPTION '0530: % notification_rule row(s) still have role = coach', v_coach;
  END IF;

  RAISE NOTICE '0530: % notification_rule row(s) seeded across % tenant(s), 0 leftover coach rows', v_rows, v_tenants;
END
$the_seed_is_real$;
