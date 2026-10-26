-- 0447 — A NEW OUTBOX SECTION: `reports`. STAGE 16 TASK 16.6.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT. Stage 16 declares SEVERAL new `reports.*` event topics, and `reports` was
--     never added to the outbox's closed section list. The live `event_emitted_by_check` CHECK
--     admits exactly sixteen sections — `documents, booking, money, people, accounts, items,
--     growth, tasks, platform, provisioning, network, forms, run, developer, settings, calendar`
--     — and `reports` is not one of them.
--
-- ★★★ WHY THIS IS A MIGRATION AND NOT A STRING. Unchanged since 0016, restated by 0023/0054/0064/
--     0150/0290:
--         event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')       ← a SHAPE
--         event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[... names ...]))    ← a LIST
--     `src/events/topics.mjs:36-43`'s own two-layer rule: `event_topic_check` validates only the
--     topic's SHAPE, but `event_emitted_by_check` is an enumerated CHECK, and a NEW SECTION must
--     change both the JS `TOPICS` map (whose keys `SECTIONS` is derived from, `topics.mjs:287`,
--     `Object.keys(TOPICS)`) and this CHECK together, or `emit('reports....', …)` passes
--     `SECTIONS.includes('reports')` in JS and is then refused by Postgres on the very next line —
--     the exact split-brain failure 0023's own header names. This migration is one half; the
--     matching `reports: [...]` key added to `TOPICS` in `src/events/topics.mjs` (code, not a
--     migration) is the other, shipped as one unit with this file (task 16.6).
--
-- Same idiom as 0150/0290, additive, validated against existing rows by default (every existing
-- row already carries one of the sixteen, so this cannot fail on apply).
--
-- Written during BUILD. NOT APPLIED — the migration runner applies this at step 3 (TEST), never here.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- (REHEARSAL FIX 25 Sep 2026: explicit BEGIN removed — db/migrate.mjs wraps every file in its own transaction; an inner COMMIT would commit half a migration and orphan the runner's bookkeeping.)
ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY['documents','booking','money','people','accounts','items','growth','tasks','platform','provisioning','network','forms','run','developer','settings','calendar','reports']));
-- (REHEARSAL FIX 25 Sep 2026: explicit COMMIT removed — the runner commits.)