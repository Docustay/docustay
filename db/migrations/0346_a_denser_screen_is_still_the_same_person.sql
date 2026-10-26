-- 0346_a_denser_screen_is_still_the_same_person
-- D4 [TY, RULED 23 Sep 2026] — the full three-mode density system. Compact / comfortable / spacious,
-- stored per person, same shape as 0345's sidebar_collapsed: a UI preference, not a business fact.
--
-- ★ SUPERSEDES tokens.css:399-404's "numbers only, no toggle (Q10-10, RULED)" comment. Ty confirmed
--   in chat, same day, that his live instruction is current: build the switch. See D4's close note
--   in TOUCHUP-GROUP-A-TRACKER.md.
ALTER TABLE keystone.app_user ADD COLUMN density text NOT NULL DEFAULT 'compact'
  CHECK (density IN ('compact', 'comfortable', 'spacious'));

COMMENT ON COLUMN keystone.app_user.density IS
  'Whether this person left the CRM shell at compact (default), comfortable or spacious row height. '
  'A UI preference, not a business fact — no event is emitted when it changes. Read into GET '
  '/api/nav''s me.density, written by POST /api/me/density.';
