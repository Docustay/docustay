-- 0345_the_sidebar_remembers_how_it_was_left
-- D6 [TY, RULED 23 Sep 2026] — icon-collapse for the sidebar. This is the ONE thing that makes the
-- state persist across a reload and across devices: whether THIS person collapsed the sidebar to
-- its icon rail. Per-person, not per-tenant — two staff in the same practice can leave it in
-- different states, same as any other chrome preference nobody else's screen should inherit.
--
-- ★ SUPERSEDES THE "NOT an icon rail — U1" COMMENT IN Sidebar.svelte. That comment recorded a real
--   ruling at the time it was written; CLAUDE.md's "a new ruling beats a code comment" rule (23 Sep
--   2026) is what makes today's instruction the one that governs now. See D6's close note in
--   TOUCHUP-GROUP-A-TRACKER.md.
ALTER TABLE keystone.app_user ADD COLUMN sidebar_collapsed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN keystone.app_user.sidebar_collapsed IS
  'Whether this person left the sidebar collapsed to its icon rail. A UI preference, not a business '
  'fact — no event is emitted when it changes. Read into GET /api/nav''s me.sidebarCollapsed, '
  'written by POST /api/me/sidebar-collapsed.';
