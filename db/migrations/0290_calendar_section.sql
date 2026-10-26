-- 0290 — A NEW OUTBOX SECTION: `calendar`. SPEC 03a TASK 3a.1, F-5 CORRECTION (22 Sep 2026).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT. [MEASURED, F-5, spot-check] spec 03a §5 declares FOUR new `calendar.*` event
--     topics (`calendar.connection.connected`, `calendar.connection.disconnected`,
--     `calendar.connection.renewal_failed`, `calendar.remote_change.flagged`), and `calendar` was
--     never added to the outbox's closed section list. MEASURED
--     (`db/migrations/0150_settings_have_a_section.sql:29-45`, the last migration to touch this
--     constraint): the live `event_emitted_by_check` CHECK admits exactly fifteen sections —
--     `documents, booking, money, people, accounts, items, growth, tasks, platform, provisioning,
--     network, forms, run, developer, settings` — and `calendar` is not one of them.
--
-- ★★★ WHY THIS IS A MIGRATION AND NOT A STRING. Unchanged since 0016, restated by 0023/0054/0064/
--     0150:
--         event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')       ← a SHAPE
--         event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[... names ...]))    ← a LIST
--     `src/events/topics.mjs:36-43`'s own two-layer rule: `event_topic_check` validates only the
--     topic's SHAPE, but `event_emitted_by_check` is an enumerated CHECK, and a NEW SECTION must
--     change both the JS `TOPICS` map (whose keys `SECTIONS` is derived from, `topics.mjs:287`,
--     `Object.keys(TOPICS)`) and this CHECK together, or `emit('calendar....', …)` passes
--     `SECTIONS.includes('calendar')` in JS and is then refused by Postgres on the very next line —
--     the exact split-brain failure 0023's own header names. This migration is one half; the
--     matching `calendar: [...]` key added to `TOPICS` in `src/events/topics.mjs` (code, not a
--     migration) is the other, shipped as one unit with this file (task 3a.1).
--
-- Same idiom as 0150, additive, validated against existing rows by default (every existing row
-- already carries one of the fifteen, so this cannot fail on apply).
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    'network', 'forms', 'run', 'developer', 'settings',
    -- ★ NEW at 0290 · spec 03a · F-5. The calendar-connection lifecycle: connect/disconnect,
    --   renewal failure, and a remote-change flag on a synced booking (§5).
    'calendar'
  ]));

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed SET of outbox sections — SIXTEEN at 0290. A section is a database change because '
  'this is an enumerated CHECK; a TOPIC within a section is not, because event_topic_check '
  'validates only the SHAPE and the closed topic set lives in TOPICS in src/events/topics.mjs. '
  '★ `calendar` was added at 0290 for spec 03a''s calendar-connection lifecycle (F-5): four new '
  '`calendar.*` topics existed in the spec with no section admitting them at the database layer.';
