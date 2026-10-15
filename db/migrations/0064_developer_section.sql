-- 0064 — A NEW OUTBOX SECTION: `developer`. P0.6, AND IT CLOSES F96.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT. [MEASURED 2026-09-14, F96] Creating or revoking an API key — the one action that
--     grants standing programmatic access to a tenant's entire dataset — wrote **nothing** to the
--     audit log built to record exactly that class of action. `src/routes/developer.mjs` had two
--     call sites and no `emit()`. The credential could be minted, used and revoked without leaving
--     a trace in the system whose §A9 surface exists to show a tenant what was done in their name.
--
-- ★★★ WHY THIS IS A MIGRATION AND NOT A STRING. The split is unchanged since 0016 and is restated
--     by 0023 and 0054:
--         event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')       ← a SHAPE
--         event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[... names ...]))    ← a LIST
--     Adding a TOPIC inside an existing section is an edit to `TOPICS` in `src/events/outbox.mjs`.
--     **Adding a SECTION is a database change**, because the list is an enumerated CHECK.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ THE SECTION DECISION, MADE EXPLICITLY RATHER THAN ASSUMED — P0.6 requires it.
--    An API key is not a `people` fact (it is not about a person), not a `documents` fact, and NOT
--    `platform`: platform is the cross-tenant namespace (§A9) and a key belongs to ONE tenant.
--    It is a fact about the tenant's own DEVELOPER surface — the nav section that already owns
--    `/settings/developer/{api-keys,webhooks,embeds,audit-log,sandbox}`. So: a new section,
--    `developer`, on the same reasoning 0054 used to create `forms` and `run` rather than forcing
--    them into a neighbour.
--
-- ★★★ AND ONLY TWO TOPICS ARE ADDED, DELIBERATELY. P0.6 asks the same question of publishable
--     embed keys, webhook endpoint secrets and `kek_version` rotation. The ANSWER for all three is
--     "the same section, `developer`" — but their topics are **NOT declared here**, because
--     nothing emits them yet and [MEASURED, F68] this catalogue already carries **17 topics that
--     are declared and never emitted**. Adding four more would grow the exact defect P8.4 exists
--     to remove. ★ They are declared in the phase that emits them; the section they belong to is
--     settled now so that phase has no decision left to make.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    -- ★ 0023. §A1 nav row 15; table `network_party` (0006).
    'network',
    -- ★ 0054 · P20.3a.
    'forms', 'run',
    -- ★★ NEW at 0064 · P0.6.
    --  `developer` — the tenant's own credential and integration surface. Owns the API-key
    --                lifecycle today; owns embed publishable keys, webhook endpoint secrets and
    --                KEK rotation when those are emitted. ★ Distinct from `platform` on purpose:
    --                platform is CROSS-TENANT (§A9) and these facts belong to one tenant.
    'developer'
  ]));

-- ★★ VALIDATED AGAINST EXISTING ROWS BY DEFAULT — deliberately NOT `NOT VALID`. Every existing row
--    already carries one of the thirteen, so this cannot fail; and a `NOT VALID` constraint that is
--    never validated is a rule nobody is enforcing, which reads as one and is worse than none.
--    (Same reasoning as 0023's and 0054's notes.)

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed SET of outbox sections — FOURTEEN at 0064. A section is a database change because '
  'this is an enumerated CHECK; a TOPIC within a section is not, because event_topic_check '
  'validates only the SHAPE and the closed topic set lives in TOPICS in src/events/outbox.mjs. '
  '★ `developer` was added at 0064 for the credential lifecycle (P0.6, F96): minting an API key '
  'granted standing access to a tenant''s data and wrote nothing to the audit log. It is NOT '
  '`platform`, which is the cross-tenant namespace — a key belongs to exactly one tenant.';
