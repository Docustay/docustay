-- 0023_network_section
-- P15B.2 · P15B.3 · P15B.6 — D-15B.3
--
-- ★★★ WHY THIS MIGRATION EXISTS: P15B.2 AND P15B.3 CONTRADICT EACH OTHER, AND ONE OF THEM IS
-- ABOUT A DATABASE CONSTRAINT.
--   · P15B.2 — "EVERY write emits its outbox event in the same transaction. A write with no event
--     is a silent state change."
--   · P15B.3 — "Only the 28 closed TOPICS may be emitted, and only a section's own. A new topic is
--     a schema change, not a string."
-- P15B.6 requires `createNetworkParty` / `updateNetworkParty`. [MEAS 2026-09-13] there is
-- **no `network` section at all** in the ten-element `event_emitted_by_check`, so those two writes
-- can satisfy P15B.2 only by emitting under someone else's section — which is exactly the defect
-- `emit()` was written to refuse:
--     "Money emitting `documents.document.signed` is Money reaching into Documents by another
--      name, and it would be invisible in review because it is just a string."
-- A wrong section is not a labelling problem. It is the thing the guard exists to catch.
--
-- ★★★ AND THE KEY MEASUREMENT, WHICH DECIDES WHAT IS AND IS NOT A MIGRATION:
--     event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')   ← a SHAPE
--     event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[... ten names ...]))  ← a LIST
--   So a NEW TOPIC is NOT a database change — the database validates the shape and the closed SET
--   lives in `TOPICS` in `src/events/outbox.mjs`, enforced by `emit()`. P15B.3's "a new topic is a
--   schema change" is true of THE APPLICATION'S CLOSED SET, and adding one means editing that one
--   frozen object on purpose.
--   ★ A NEW SECTION *IS* a database change. That is this file, and it is the whole of this file.
--
-- ★★ WHY `network` AND NOT A LOOSER CONSTRAINT. Replacing the list with a regex would make every
--    future typo a valid section and delete the guarantee. The list stays closed; it gains exactly
--    one member, for an object §A1 already rules to be first-class — nav row 15, its own
--    `network_party` table (0006), and its own entry in `RECORD_TYPES`.
--
-- ★ NOT ADDED, AND STATED SO THE OMISSION IS A DECISION RATHER THAN AN OVERSIGHT:
--   · `notifications` — a notification PREFERENCE is a fact about a PERSON and emits
--     `people.preference.changed`. A section with one setting behind it and no consumer would be
--     a tenth of a feature welded into a database constraint.
--   · `forms` and `run` — P20.3a adds those, with the six topics its task chains need. This
--     migration deliberately does not reach into Phase 20's work.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · `network` BECOMES THE ELEVENTH SECTION.
-- ─────────────────────────────────────────────────────────────────────────────
-- ★ DROP-then-ADD is the only way to widen a CHECK. The new constraint carries the SAME NAME, so
--   `catalog-conformance` and anything else keyed on the name keeps finding it — a renamed
--   constraint is a silently-missing one.
ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    -- ★ NEW at 0023. §A1 nav row 15; table `network_party` (0006); descriptor `network_party`.
    'network'
  ]));

-- ★★ THE CONSTRAINT IS VALIDATED AGAINST EXISTING ROWS BY DEFAULT (no NOT VALID here), and that is
--    deliberate: this widens the permitted set, so every row that passed the old check passes the
--    new one by construction. There is nothing to grandfather, so nothing is left unvalidated.
--    ★ Contrast `subscription_requires_contract` (0015), which is NOT VALID precisely because it
--      NARROWED and pre-existing rows could not satisfy it. Stating the difference here so a future
--      reader does not copy the wrong pattern from whichever file they happen to open.

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed set of emitting sections. Widened at 0023 to add `network` (D-15B.3). A section may '
  'emit ONLY its own topics — enforced in emit() (src/events/outbox.mjs), not here, because that '
  'is a relationship between two columns and a frozen JS map. Adding a member is a migration; '
  'adding a TOPIC is not, because event_topic_check validates shape rather than membership.';
