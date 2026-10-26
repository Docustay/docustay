-- 0343_every_practice_is_a_shape
-- PART 4.1 [TY, RULED 23 Sep 2026] — account shape replaces per-feature hiding. Every practice is
-- one of three shapes: 'crm' (people/engagements/money/documents/items), 'run' (accounts/network/
-- growth/reports) or 'both' (everything). This supersedes the group-gating mechanism migration
-- 0341's WORKSTREAM 12 was built on (`nav.groups_off`, `tenant_intake.coaching_type`'s sibling
-- `needs` field) — no more hiding individual sections one at a time.
--
-- ★ DEFAULT 'both' MEANS NOTHING MIGRATES. Every existing tenant (GLRS, every test practice — see
--   CLAUDE.md's PRODUCTION STATE note, 22 Sep 2026: nothing else on production is real) keeps
--   every section it already sees; the narrower shapes are something a person chooses going
--   forward, never something sprung on a row that never answered the question.
ALTER TABLE keystone.tenant ADD COLUMN shape text NOT NULL DEFAULT 'both'
  CHECK (shape IN ('crm', 'run', 'both'));

COMMENT ON COLUMN keystone.tenant.shape IS
  'Which of the product''s two halves this practice uses: ''crm'' (people, engagements, money, '
  'documents, items), ''run'' (accounts, network, growth, reports) or ''both'' (everything). '
  'Settings and Platform always show regardless. Replaces the nav.groups_off/GROUP_SECTIONS '
  'per-section-group hiding mechanism (src/nav/groups.mjs) — see Part 4, 23 Sep 2026.';
