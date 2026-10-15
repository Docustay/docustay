-- 0285_calendar_watched_calendar
-- Spec 03a (calendar and sync) task 3a.1 · §3 — WHICH OF A CONNECTED ACCOUNT'S CALENDARS COUNT AS
-- BUSY (MOCKUPS:287, plural — a coach may have more than one Google calendar).
--
-- New table, same FORCE RLS bracket 0013 uses for calendar_connection/calendar_event_map: ENABLE +
-- FORCE, tenant_isolation (USING tenant_id = current_tenant_id()) + tenant_insert (WITH CHECK
-- tenant_id = require_tenant_id()), GRANT SELECT/INSERT/UPDATE/DELETE to app_rw — the exact loop
-- 0013:291-305 runs, reused here rather than hand-written a second time.
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.

CREATE TABLE keystone.calendar_watched_calendar (
  id                  uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,
  connection_id       uuid NOT NULL REFERENCES keystone.calendar_connection(id) ON DELETE CASCADE,
  external_calendar_id text NOT NULL,
  display_name        text,          -- ★ the CALENDAR's name (e.g. "Personal"), never an event title
  counts_as_busy       boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, external_calendar_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendar_watched_calendar'] LOOP
    EXECUTE format('ALTER TABLE keystone.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE keystone.%I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON keystone.%I
                      USING (tenant_id = keystone.current_tenant_id())$f$, t);
    EXECUTE format($f$CREATE POLICY tenant_insert ON keystone.%I
                      FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id())$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.%I TO app_rw', t);
  END LOOP;
END $$;

COMMENT ON TABLE keystone.calendar_watched_calendar IS
  'Spec 03a §3, task 3a.1. Which of a connected Google/Outlook account''s own calendars count as '
  'busy when Workbench checks availability (MOCKUPS:287) — a coach may watch more than one. '
  'display_name is the CALENDAR''s own name ("Personal", "Work"), never an event title.';
