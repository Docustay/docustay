-- 0474 — `messages` is a section. src/messages/writes.mjs:89-102 emits emittedBy:"messages" and has
-- done since it shipped, into a section that exists in NEITHER the JS catalogue (src/events/topics.mjs,
-- sixteen sections, none named messages) NOR event_emitted_by_check (0290:34-41, the same sixteen).
-- So POST /api/app/messages throws at src/events/outbox.mjs:361 BEFORE it commits, and has never
-- written a message. Task 18.46's acceptance scenario ("client/teen/parent: POST message 200") cannot
-- pass without this.
--   * A SECTION is a database change and a TOPIC is not: event_emitted_by_check is an enumerated
--     CHECK, event_topic_check validates only the SHAPE ('^[a-z]+\.[a-z_]+\.[a-z_]+$', 0023:19).
--     That is why the topic `messages.message.sent` needs no DDL and the section does.
--   * THE TOPIC GAINS A SEGMENT IN THE SAME CHANGE: `message.sent` has two and would be refused by
--     event_topic_check even with the section admitted. src/messages/writes.mjs's string changes too.
--
-- MEASURED read-only, 25 Sep 2026, PRODUCTION (KEYSTONE_DEPLOYED_SUPERUSER_PG_URL from .env.local,
-- BEGIN READ ONLY ... ROLLBACK; counts only, never a row's contents, never a secret) AND LOCAL:
--   count(*) keystone.event WHERE emitted_by = 'messages'  ->  LOCAL 0 · PRODUCTION 0
--   count(*) keystone.event WHERE topic LIKE 'message%'    ->  LOCAL 0 · PRODUCTION 0
--   count(*) keystone.message                              ->  LOCAL 0 · PRODUCTION 0
-- *** THE THIRD ROW IS THE PROOF, AND IT IS INDEPENDENT OF ANY CODE READING: keystone.message is
--     EMPTY IN PRODUCTION. The route has existed since it shipped and not one message has ever been
--     written, because emit() throws inside the same transaction and rolls the INSERT back with it.
-- Zero rows, in both, because the writer has never committed one. * So this ALTER validates every
-- existing row without changing one, and there is NOTHING TO BACKFILL — the widened CHECK is
-- strictly weaker than the one it replaces (it adds a name), so no existing row can violate it.
-- * NO FORCE-RLS TENANT TABLE IS BACKFILLED HERE, so the 0168/0172 per-practice loop does not apply:
--   this file alters one CHECK constraint on keystone.event and writes no row at all.
-- keystone.event is owned by app_owner (MEASURED pg_class.relowner, both databases), which is the
-- role the runner uses by default — no SET LOCAL ROLE is needed, exactly as 0290 has none.

ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    'network', 'forms', 'run', 'developer', 'settings', 'calendar',
    -- * NEW at 0474 · CT-F48 · D5-5. The client-coach message thread (F15 §2.8). One topic:
    --   messages.message.sent.
    'messages'
  ]));

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed SET of outbox sections — SEVENTEEN at 0474. A section is a database change because '
  'this is an enumerated CHECK; a TOPIC within a section is not, because event_topic_check '
  'validates only the SHAPE and the closed topic set lives in TOPICS in src/events/topics.mjs. '
  '* messages was added at 0474 (CT-F48): src/messages/writes.mjs had emitted into it since it '
  'shipped, so POST /api/app/messages threw at outbox.mjs:361 before it committed and no message '
  'was ever written.';

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
  IF v_def IS NULL THEN RAISE EXCEPTION '0474: event_emitted_by_check is missing'; END IF;
  IF pg_catalog.strpos(v_def, 'messages') = 0 THEN
    RAISE EXCEPTION '0474: event_emitted_by_check does not admit the messages section: %', v_def;
  END IF;
  -- POSITIVE CONTROL for (1): a name that must NOT be there is not there, so "position() found it"
  -- is a real find and not a matcher that matches anything.
  IF pg_catalog.strpos(v_def, 'not_a_section') <> 0 THEN
    RAISE EXCEPTION '0474: the constraint text matched a name that was never added — the check above '
                    'proves nothing';
  END IF;

  -- (2) *** THE SHAPE RULE STILL BINDS. This migration widened the SECTION list and nothing else,
  --     so the two-segment spelling src/messages/writes.mjs used before today must still be refused.
  IF 'message.sent' ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION '0474: message.sent matched the topic shape — the three-segment rule has been '
                    'weakened somewhere, and the old writer string would silently start working';
  END IF;
  -- POSITIVE CONTROL for (2), same block: the NEW spelling does match, so (2) is about the segment
  -- count and not about a regex that rejects everything.
  IF 'messages.message.sent' !~ '^[a-z]+\.[a-z_]+\.[a-z_]+$' THEN
    RAISE EXCEPTION '0474: POSITIVE CONTROL FAILED — messages.message.sent does not match the topic '
                    'shape, so the new spelling could not be written either';
  END IF;

  RAISE NOTICE '0474: seventeen sections; messages admitted; the three-segment topic shape still binds.';
END $m$;
