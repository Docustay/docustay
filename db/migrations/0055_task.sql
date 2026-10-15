-- 0055 — THE `task` TABLE. P20.3, to ADDENDUM 4 §A4.4.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT THIS TABLE IS FOR, AND THE ONE FAILURE IT MUST NOT HAVE. ADD3-1's closing line is
--     *"a task that outlives its subject is the defect to hunt"* — a Tasks screen that shows work
--     nobody can do is worse than no Tasks screen, because a person learns to stop reading it and
--     then misses the row that mattered. Every constraint below exists to make one of the ways that
--     happens unrepresentable.
--
-- ★★★ WHY THIS IS 0055 AND NOT 0020 AS §A4.4 NAMES IT. §A4.4 is titled ``0020``: Tasks, written when
--     the plan expected these migrations in a different order. [MEASURED 2026-09-14] the tree is at
--     0054 and 0020_* is long since applied to both databases. `db/migrate.mjs` sorts
--     LEXICOGRAPHICALLY by file name and records applied ids, so a new file numbered 0020 would either
--     collide or sort into the past and never run. **The NUMBER in ADDENDUM 4 is a position in a plan,
--     not an instruction.** The SHAPE below is the instruction, and it is followed exactly.
--
-- ★★★ AND IT IS ORDERED AFTER 0054 ON PURPOSE, WHICH §A4.4 ITSELF DEMANDS ("★ **after** the topic
--     migration of P20.3a"). `task.topic` mirrors `event_topic_check`, and four of the five chains it
--     serves emit topics that did not exist before 0054. Creating this table first would have produced
--     a task table whose chains could not fire — a screen with a schema and no possible content.

CREATE TABLE keystone.task (
  id uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE RESTRICT,

  -- ★ MIRRORS `event_topic_check` (0016:26) DELIBERATELY, rather than referencing the event's topic.
  --   A task outlives the event that made it — `created_by_event_id` is NULLABLE for manual tasks —
  --   so the topic has to be a column here, and if it is a column it gets the same shape rule. A task
  --   whose topic is free text cannot be grouped, counted, or closed by a chain.
  topic text NOT NULL CONSTRAINT task_topic_shape
    CHECK (topic ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$'),

  -- ★★ POLYMORPHIC, AND THAT IS THE WHOLE DIFFICULTY OF THIS TABLE. A task can be about a person, an
  --    account, a document, a booking, an entitlement or a Run schedule item — six unrelated tables —
  --    so there is NO foreign key available and no cascade to lean on. P20.4 is the consequence and is
  --    a separate item precisely because the database cannot do it for us here.
  subject_type text NOT NULL CONSTRAINT task_subject_type_check
    CHECK (subject_type IN ('person','account','document','booking','entitlement','run_schedule_item')),
  subject_id uuid NOT NULL,

  -- ★★ THE TASK MUST SAY WHAT TO DO. §A4.4: *"a topic is not a sentence"*. `documents.document.sent`
  --    on a screen tells a coach nothing; "chase the Alvarez signature" tells them everything. NOT NULL
  --    with no default, so a chain that forgets to write one fails loudly at INSERT rather than
  --    rendering a blank row — which is U30's rule arriving one layer earlier than the UI.
  title text NOT NULL CONSTRAINT task_title_nonempty CHECK (btrim(title) <> ''),

  -- ★ SET NULL, not CASCADE: a coach leaving must not delete the practice's outstanding work. The task
  --   becomes unassigned and stays on the team screen, which is the correct outcome.
  assignee_id uuid REFERENCES keystone.app_user(id) ON DELETE SET NULL,
  due_at timestamptz,

  -- ★★★ RESTRICT ON BOTH EVENT FKs, AND THIS IS NOT CAUTION, IT IS THE AUDIT TRAIL. Deleting the event
  --     that created or closed a task destroys the only record of WHY it exists or why it stopped.
  --     `keystone.event` already uses status 'dead' instead of deletion (0016:42-43), so nothing in the
  --     system legitimately deletes an event and RESTRICT costs nothing real.
  --   ★ NULL on `created_by_event_id` means A MANUAL TASK — allowed, per ADD3-1 ("manual tasks are
  --     allowed but are not the point"), and distinguishable from a chain task by exactly this column.
  created_by_event_id uuid REFERENCES keystone.event(id) ON DELETE RESTRICT,

  closed_at timestamptz,
  closed_by_event_id uuid REFERENCES keystone.event(id) ON DELETE RESTRICT,
  closed_reason text CONSTRAINT task_closed_reason_check
    CHECK (closed_reason IN ('event','manual','subject_gone')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- ★★★ WHY IT CLOSED MUST BE ANSWERABLE. A `closed_at` with no reason is a task that VANISHED, and
  --     "it's gone, we don't know why" is indistinguishable from a bug that eats work. The third arm is
  --     the sharp one: `closed_reason = 'event'` REQUIRES the closing event id, so "an event closed it"
  --     can always be resolved to WHICH event. The other two reasons legitimately have no event —
  --     a human closing it, and P20.4's sweeper — so they must NOT be forced to invent one.
  CONSTRAINT task_closed_shape CHECK (
    (closed_at IS NULL     AND closed_by_event_id IS NULL AND closed_reason IS NULL) OR
    (closed_at IS NOT NULL AND closed_reason IS NOT NULL
       AND (closed_reason <> 'event' OR closed_by_event_id IS NOT NULL))),

  -- ★★ AND A CLOSING EVENT CANNOT PREDATE THE TASK. Not in §A4.4 — added because the closed_shape
  --    check above makes "closed by event X" load-bearing, and without this a backfill or a clock skew
  --    could record a closure that happened before the work existed. That reads as a corrupt audit
  --    trail, and the whole point of the two RESTRICT FKs is that this trail is trustworthy.
  CONSTRAINT task_closed_after_created CHECK (closed_at IS NULL OR closed_at >= created_at)
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ ONE OPEN TASK PER (subject, topic). THE SINGLE MOST IMPORTANT LINE IN THIS FILE.
--     Without it, an event chain that fires twice — a graphile-worker RETRY, a webhook REDELIVERY, a
--     replay after the F4 lease expiry that P18.6(a) added — produces two identical rows, and the
--     screen fills with duplicates until nobody reads it. That is the "noise nobody reads" failure,
--     and it arrives through the retry paths this system deliberately has.
--   ★★ PARTIAL, `WHERE closed_at IS NULL`, and it has to be: the same task legitimately recurs. A
--      document is chased, signed, and a year later a new one is sent. A UNIQUE over all rows would
--      forbid the second chase forever — turning a duplicate-suppression rule into a
--      never-ask-again rule, which is the over-correction of the same defect.
--   ★ LEADS WITH tenant_id, per ADDENDUM 4's house style and 0001:135-139: uniqueness checks BYPASS
--     RLS, so a bare UNIQUE (subject_id, topic) would let one tenant detect another tenant's task.
CREATE UNIQUE INDEX task_open_key ON keystone.task (tenant_id, subject_type, subject_id, topic)
  WHERE closed_at IS NULL;

-- ★ The two screens ADD3 names, each partial because each query is partial: /tasks/mine and
--   /tasks/team both show OPEN work only, so an index over closed rows would be dead weight.
CREATE INDEX task_mine ON keystone.task (tenant_id, assignee_id, due_at) WHERE closed_at IS NULL;
CREATE INDEX task_team ON keystone.task (tenant_id, due_at) WHERE closed_at IS NULL;

-- ★★ AND ONE §A4.4 DOES NOT LIST, FOR P20.4's SWEEPER. It has to find open tasks BY SUBJECT across
--    every topic — the opposite access pattern to task_open_key, which leads with subject_type and
--    cannot serve a lookup keyed on the id alone. Without it that sweep is a full scan on every run.
CREATE INDEX task_by_subject ON keystone.task (tenant_id, subject_id) WHERE closed_at IS NULL;

CREATE TRIGGER task_touch BEFORE UPDATE ON keystone.task
  FOR EACH ROW EXECUTE FUNCTION keystone.touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ RLS — ENABLE **AND FORCE**, plus all THREE policies. ADDENDUM 4's own ★ note: 0016 omits
--     `tenant_update` on all five of its tables while 0001 and 0003 have it, and says INCLUDE IT —
--     "do not copy the most recent file". A missing tenant_update means an UPDATE's USING clause comes
--     from tenant_isolation but its WITH CHECK comes from nowhere, so a row can be updated INTO
--     another tenant. Closing a task is an UPDATE, so this table would be exposed on its hottest path.
ALTER TABLE keystone.task ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.task FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON keystone.task
  USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.task
  FOR INSERT WITH CHECK (tenant_id = keystone.require_tenant_id());
CREATE POLICY tenant_update ON keystone.task
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
             WITH CHECK (tenant_id = keystone.require_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON keystone.task TO app_rw;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE keystone.task IS
  'ADD3-1 · P20.3 — work the product knows somebody has to do, created by an outbox event chain and '
  'closed by another event, a human, or P20.4''s subject-gone sweeper. ★ The defect it exists to '
  'avoid is ADD3-1''s own: "a task that outlives its subject is the defect to hunt" — so every '
  'closure records WHY (task_closed_shape) and a retried chain cannot duplicate a row (task_open_key).';

COMMENT ON COLUMN keystone.task.subject_type IS
  'Which of the six kinds of thing this task is about. ★ POLYMORPHIC, so there is NO foreign key on '
  'subject_id and no cascade — which is exactly why P20.4 exists as a separate item and must be a '
  'trigger or a sweeper, not a constraint.';

COMMENT ON COLUMN keystone.task.title IS
  'What to DO, in a sentence. ★ A topic is not a sentence: "documents.document.sent" on a screen tells '
  'a coach nothing. NOT NULL and non-blank so a chain that forgets it fails at INSERT instead of '
  'rendering an empty row (U30, one layer early).';

COMMENT ON COLUMN keystone.task.created_by_event_id IS
  'The outbox event that created this task, or NULL for a MANUAL task — that distinction is this '
  'column''s second job. ★ ON DELETE RESTRICT: deleting it would destroy the only record of why the '
  'task exists, and events are marked ''dead'' rather than deleted anyway (0016:42-43).';

COMMENT ON CONSTRAINT task_closed_shape ON keystone.task IS
  'A closed_at with no reason is a task that VANISHED, which is indistinguishable from a bug that eats '
  'work. ★ closed_reason=''event'' additionally REQUIRES closed_by_event_id, so "an event closed it" '
  'always resolves to WHICH event; ''manual'' and ''subject_gone'' genuinely have no event and are not '
  'forced to invent one.';

COMMENT ON INDEX keystone.task_open_key IS
  'ONE OPEN TASK PER (subject, topic). ★ Stops a retried/redelivered/replayed chain from filling the '
  'screen with duplicates until nobody reads it. ★★ PARTIAL on closed_at IS NULL because the same task '
  'legitimately RECURS — a document chased this year and again next year — so a total UNIQUE would turn '
  'duplicate-suppression into never-ask-again.';
