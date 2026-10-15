-- 0481 — `workbench` is a section. src/platform/workbenchAnnouncements.mjs and the sweep_workbench_lifecycle
-- job emit emittedBy:"workbench", into a section that does not exist in event_emitted_by_check.
-- The section exists in src/events/topics.mjs (SECTIONS, which derives from TOPICS.workbench) with eight
-- topics. A section IS a database change — a migration — while a topic within it is not.
--
-- MEASURED read-only, 25 Sep 2026, LOCAL:
--   count(*) keystone.event WHERE emitted_by = 'workbench'  ->  LOCAL 0
--   count(*) keystone.event WHERE topic LIKE 'workbench%'   ->  LOCAL 0
-- Zero rows, because the emitters have never run (the section was missing, so emit() threw BEFORE
-- commit and the write was rolled back). So this ALTER validates every existing row without changing
-- one, and there is NOTHING TO BACKFILL — the widened CHECK is strictly weaker (it adds a name), so
-- no existing row can violate it. NO FORCE-RLS TENANT TABLE IS BACKFILLED HERE (like 0474), and
-- keystone.event is owned by app_owner, the role the runner uses by default — no SET LOCAL ROLE.

ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    'network', 'forms', 'run', 'developer', 'settings', 'calendar',
    'reports', 'messages',
    -- ★ NEW at 0481 · TASK 20.21. The workbench lifecycle sweep and announcements (8 topics).
    'workbench'
  ]));

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed SET of outbox sections — EIGHTEEN at 0481. A section is a database change because '
  'this is an enumerated CHECK; a TOPIC within a section is not, because event_topic_check '
  'validates only the SHAPE and the closed topic set lives in TOPICS in src/events/topics.mjs. '
  '* workbench was added at 0481 (TASK 20.21): sweep_workbench_lifecycle emits subscription/usage/run/onboarding/announcement/promotion/lifecycle topics into it.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- SELF-CHECK — the section is admitted, the shape still binds, and the old spelling still fails.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
DO $m$
DECLARE
  v_def text;
BEGIN
  -- (1) the section is admitted.
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conname = 'event_emitted_by_check'
     AND conrelid = 'keystone.event'::pg_catalog.regclass;
  IF v_def IS NULL THEN RAISE EXCEPTION '0481: event_emitted_by_check is missing'; END IF;
  IF pg_catalog.strpos(v_def, 'workbench') = 0 THEN
    RAISE EXCEPTION '0481: event_emitted_by_check does not admit the workbench section: %', v_def;
  END IF;
  -- POSITIVE CONTROL for (1): a name that must NOT be there is not there.
  IF pg_catalog.strpos(v_def, 'not_a_section') <> 0 THEN
    RAISE EXCEPTION '0481: the constraint text matched a name that was never added — the check above proves nothing';
  END IF;

  -- (2) THE SHAPE RULE STILL BINDS. All workbench topics follow the three-segment format.
  IF 'workbench.subscription.updated' !~ '^[a-z]+\.[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION '0481: workbench.subscription.updated does not match the topic shape';
  END IF;

  RAISE NOTICE '0481: eighteen sections; workbench admitted; the three-segment topic shape still binds.';
END $m$;
