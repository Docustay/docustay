-- 0150 — A NEW OUTBOX SECTION: `settings`. STAGE 4 TASK 4, AND IT CLOSES F505.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DEFECT. [MEASURED, F505, write-census] spec 02 §5 lists a NEW section `settings`
--     (setting.changed · terminology.changed · automation.changed · notification_rule.changed ·
--     data.export_requested · data.export_ready · data.person_export_requested ·
--     data.person_removal_completed · import.completed) and names "Settings" as an audit source —
--     but Stage 3's plan carried no task for it, and `src/routes/settings.mjs:577` UPDATEs
--     `keystone.tenant.slug` (a practice's own web address) with no event at all. A slug change is
--     silent; the audit screen cannot show who changed a setting or the practice's address.
--
-- ★★★ WHY THIS IS A MIGRATION AND NOT A STRING. Unchanged since 0016, restated by 0023/0054/0064:
--         event_topic_check       CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$')       ← a SHAPE
--         event_emitted_by_check  CHECK (emitted_by = ANY (ARRAY[... names ...]))    ← a LIST
--     Adding a TOPIC inside an existing section is an edit to `TOPICS` in `src/events/topics.mjs`.
--     **Adding a SECTION is a database change**, because the list is an enumerated CHECK.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★ THE SECTION DECISION. `settings` is the tenant's own configuration surface — practice name,
--    slug, booking rules, terminology, automations, notification rules, and the data export/import
--    tools — the same reasoning 0054 used for `forms`/`run` and 0064 used for `developer`: it is a
--    fact about the tenant's own settings screens, not a fact that fits inside any of the 14
--    existing sections without reaching across a section boundary (§X4: sections never call each
--    other).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.event DROP CONSTRAINT event_emitted_by_check;

ALTER TABLE keystone.event ADD CONSTRAINT event_emitted_by_check
  CHECK (emitted_by = ANY (ARRAY[
    'documents', 'booking', 'money', 'people', 'accounts', 'items',
    'growth', 'tasks', 'platform', 'provisioning',
    -- ★ 0023. §A1 nav row 15; table `network_party` (0006).
    'network',
    -- ★★ 0054 · P20.3a.
    'forms', 'run',
    -- ★★★ 0064 · P0.6.
    'developer',
    -- ★★★ NEW at 0150 · STAGE 4 TASK 4 · F505.
    --  `settings` — the tenant's own configuration surface: practice/slug, booking rules,
    --                terminology, automations, notification rules, data export/import. Only
    --                `settings.setting.changed` has a producer today (`src/routes/settings.mjs`,
    --                `src/settings/writes.mjs`); the rest are RESERVED in
    --                `db/gates/s3_topic_emitters.mjs` for the screens that will emit them.
    'settings'
  ]));

-- ★★ VALIDATED AGAINST EXISTING ROWS BY DEFAULT — deliberately NOT `NOT VALID`. Every existing row
--    already carries one of the fourteen, so this cannot fail; and a `NOT VALID` constraint that is
--    never validated is a rule nobody is enforcing, which reads as one and is worse than none.
--    (Same reasoning as 0023's, 0054's and 0064's notes.)

COMMENT ON CONSTRAINT event_emitted_by_check ON keystone.event IS
  'The closed SET of outbox sections — FIFTEEN at 0150. A section is a database change because '
  'this is an enumerated CHECK; a TOPIC within a section is not, because event_topic_check '
  'validates only the SHAPE and the closed topic set lives in TOPICS in src/events/topics.mjs. '
  '★ `settings` was added at 0150 for the tenant''s own configuration surface (F505): a practice''s '
  'web-address (slug) change, and every POST /api/settings write, updated the database with no '
  'row in the audit log spec 02 requires. It is the tenant''s OWN settings screens, not `platform` '
  '(the cross-tenant namespace) and not `developer` (the credential/integration surface, 0064).';
