-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0554 · two new audit actions for suspending/reactivating a team member (staff.suspended,
-- staff.reactivated) — the "rest of Team" brief (1 Oct 2026) found that suspending a staff member
-- had NO real mechanism at all: keystone.app_user.lifecycle_status already supports an active↔paused
-- transition (setLifecycleStatus, src/people/writes.mjs) and is already used for offboarding staff
-- to 'former', but nothing ever revoked a paused person's live sessions or blocked them from
-- signing back in — a "suspended" coach kept full access until an Owner remembered to fully offboard
-- them. Fixed in code (src/people/offboard.mjs: suspendTeamMember/reactivateTeamMember,
-- src/http/app.mjs's per-request principal load) in the same change that adds this migration; these
-- two actions are their audit trail.
--
-- Bracket idiom: 0522's, verbatim. No BEGIN/COMMIT — db/migrate.mjs owns the transaction (R8).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.audit_action (key) VALUES
  ('staff.suspended'),
  ('staff.reactivated')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;

DO $$
DECLARE forced boolean; k text;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.audit_action'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0554: FORCE ROW LEVEL SECURITY was not restored on keystone.audit_action';
  END IF;
  FOREACH k IN ARRAY ARRAY['staff.suspended','staff.reactivated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = k) THEN
      RAISE EXCEPTION '0554: % was not seeded into keystone.audit_action', k;
    END IF;
  END LOOP;
END $$;
