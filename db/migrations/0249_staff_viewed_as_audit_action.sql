-- 0249_staff_viewed_as_audit_action.sql — Task 1.4 (01-team-and-roles.md §3, CT-107).
--
-- Seeds the `staff.viewed_as` audit action into `keystone.audit_action` — the fourth of CT-107's
-- four new audit actions; the other three (spec 11's PlatViewingAs half) are seeded by spec 11's
-- own migration/PR, with its own `ON CONFLICT (key) DO NOTHING` row, so the two migrations never
-- conflict and neither assumes it is the only writer.
--
-- Same bracket idiom as 0218_feature_flag_seed.sql: `keystone.audit_action` is ENABLE+FORCE with
-- exactly one policy (`audit_action_read`, SELECT only, 0183:101-107) and no INSERT policy/grant
-- for `app_owner` (the role every migration runs as), so FORCE is suspended, the row is seeded,
-- and FORCE is restored and proven back on before this migration ends.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.

ALTER TABLE keystone.audit_action NO FORCE ROW LEVEL SECURITY;

INSERT INTO keystone.audit_action (key) VALUES ('staff.viewed_as') ON CONFLICT (key) DO NOTHING;

ALTER TABLE keystone.audit_action FORCE ROW LEVEL SECURITY;

-- ★★ PROVE FORCE IS BACK ON, and the row is readably present — 0218's own two assertions, mirrored.
DO $$
DECLARE forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO forced FROM pg_class WHERE oid = 'keystone.audit_action'::regclass;
  IF NOT forced THEN
    RAISE EXCEPTION '0249: FORCE ROW LEVEL SECURITY was not restored on keystone.audit_action';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM keystone.audit_action WHERE key = 'staff.viewed_as') THEN
    RAISE EXCEPTION '0249: staff.viewed_as was not seeded into keystone.audit_action';
  END IF;
END $$;
