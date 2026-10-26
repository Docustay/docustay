-- 0054 — TWO NEW OUTBOX SECTIONS: `forms` AND `run`. P20.3a, AND IT BLOCKS P20.3.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY THIS IS A MIGRATION AND NOT A PROMPT. ADDENDUM 3's own rule is *"a new topic is a schema
--     change, not a string"* — and ADD3-1 applies that rule to ADDENDUM 3 itself. The split, measured
--     and unchanged since 0016:
--         event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')       ← a SHAPE
--         event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[... names ...]))    ← a LIST
--     So adding a TOPIC within an existing section is an edit to `TOPICS` in src/events/outbox.mjs and
--     nothing more. Adding a SECTION is a database change, because the list is a CHECK. ADD3-1 names
--     three that do not exist — `forms`, `run`, `access` — and this migration adds **two**.
--
-- ★★★ WHY `access` IS **NOT** A THIRD SECTION, WHICH IS A DECISION AND IS RECORDED AS ONE.
--     ADD3-1 lists `access.granted` as an absent closer, and it is tempting to read that as a third
--     section. It is not: ADD3-2 lists **Access as one of the Run SERVICES** ("Search Console · Google
--     Ads · Analytics · Business Profile · Monitoring · **Access** · Reports"). An access grant is a
--     fact about running an account, and a grant being lost is exactly what makes a Run item
--     `not_deliverable_no_grant`. So it is `run.access.granted`, inside `run`.
--   ★ P20.3a's own instruction says "ALTER the emitted_by CHECK to add `forms` and `run`" — two, not
--     three. This note exists so the next reader does not "fix" the apparent omission.
--
-- ★★ AND THE SECTION LIST IS **ELEVEN**, NOT TEN. ADD3-1 says *"SECTIONS holds ten"* and enumerates
--    ten. [MEASURED 2026-09-14] it holds ELEVEN — `network` was added by 0023 after ADDENDUM 3 was
--    written. Re-typing ADDENDUM 3's ten-element list here would have SILENTLY DROPPED `network` and
--    broken every network write, because this is a replace-the-constraint operation, not an append.
--    ★ That is the whole hazard of an enumerated CHECK: the fix for "add one" is "restate all", and a
--      stale restatement is indistinguishable from a deliberate removal.

ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    -- ★ 0023. §A1 nav row 15; table `network_party` (0006).
    'network',
    -- ★★ NEW at 0054 · P20.3a.
    --  `forms`  — a form SUBMISSION is a fact about a form, not about the Documents pipeline. ADD3-1's
    --             first chain starts at `forms.form.submitted` and the section did not exist, so the
    --             chain could not be built at all. ★ Distinct from `documents` on purpose: a form
    --             template and a contract template are separate tools with separate template sets
    --             (P15C.5), and a submission is not an instrument.
    --  `run`    — work done FOR AN ACCOUNT (ADD3-2). It carries the blocked/grant facts that make a
    --             schedule item BILLED AND NOT DELIVERABLE, and `access` lives inside it (see above).
    'forms', 'run'
  ]));

-- ★★ VALIDATED AGAINST EXISTING ROWS BY DEFAULT — deliberately NOT `NOT VALID`. Every existing row
--    already carries one of the eleven, so this cannot fail; and a `NOT VALID` constraint that is
--    never validated is a rule nobody is enforcing, which is worse than no rule because it reads as
--    one. (Same reasoning as 0023's own note.)

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed SET of outbox sections — THIRTEEN at 0054. A section is a database change because this '
  'is an enumerated CHECK; a TOPIC within a section is not, because event_topic_check validates only '
  'the SHAPE and the closed topic set lives in TOPICS in src/events/outbox.mjs. ★ `forms` and `run` '
  'were added by P20.3a because four of ADDENDUM 3''s five task chains could not be expressed without '
  'them. ★★ `access` is NOT a section: ADD3-2 makes Access a Run SERVICE, so it is run.access.granted.';
