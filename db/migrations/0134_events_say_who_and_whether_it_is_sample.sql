-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0134 — THE ENVELOPE SAYS WHO, AND WHETHER IT IS SAMPLE (Stage 3, Task 1).
--
-- ★★★ SPEC 02-event-catalogue.md §2 RULE 3: "Every event carries … actor … and sample …".
--     [MEASURED, recon §1] neither column exists on `keystone.event` today — the fact is smuggled
--     into `payload` as `sent_by` / `executed_by` at two call sites and simply absent everywhere
--     else. A column that only sometimes exists, under two different names, inside an untyped JSON
--     blob is not a fact the outbox, History or an auditor can rely on.
--
-- ★★ TWO PLAIN COLUMNS, NOT A NEW TABLE. `actor` is a closed vocabulary
--    (`system | n8n | worker | user:<uuid> | webhook:<provider>`) enforced by a CHECK, the same
--    pattern `event_topic_check` and `event_emitted_by_check` already use on this table — one more
--    string-shaped fact, checked the same way. `sample` is a plain boolean; §2 rule 9 needs it to
--    gate delivery, and that gate is a later task's problem, not this migration's.
--
-- ★ `NOT NULL DEFAULT` ON AN EXISTING TABLE IS A METADATA-ONLY CHANGE ON PG16 (no full-table
--   rewrite, no lock beyond ACCESS EXCLUSIVE for the DDL itself) — existing rows read the default
--   for both columns. History for events emitted before this migration is not rewritten (spec §11:
--   "existing events with typed text in payload are not rewritten in place"; the same rule applies
--   here — an old event silently becomes `actor='system'`, which is the honest default for a fact
--   nobody recorded at the time, not a claim that a human did not cause it).
--
-- ★★★ NO RESET ROLE. F482. `db/migrate.mjs` sets `app_owner` before this file runs and restores it
--     before the next one; a bare `RESET ROLE` here would hand later objects to the connecting
--     superuser instead, invisibly, the way it did before 0065.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.event
  ADD COLUMN actor  text    NOT NULL DEFAULT 'system',
  ADD COLUMN sample boolean NOT NULL DEFAULT false;

-- ★ THE SAME FOUR NON-USER FORMS `emit()` WILL VALIDATE IN JS, PLUS THE ONE PARAMETERISED FORM.
--   Checked again in the database so `emit()` validating in JS is belt, and this is suspenders —
--   the same double-proof `event_topic_check` already gives the topic shape (recon §1).
--   ★★ `[0-9a-f-]{36}` matches a canonical UUID's 36 characters (32 hex + 4 hyphens) without
--      re-deriving the exact 8-4-4-4-12 grouping; a stricter shape is not this migration's job to
--      own twice when `emit()` already refuses anything that does not come from `keystone.app_user`.
ALTER TABLE keystone.event
  ADD CONSTRAINT event_actor_check
  CHECK (actor ~ '^(system|n8n|worker|user:[0-9a-f-]{36}|webhook:[a-z]+)$');

COMMENT ON COLUMN keystone.event.actor IS
  '02-event-catalogue.md §2 rule 3. Who caused this event: system | n8n | worker | user:<uuid> | '
  'webhook:<provider>. Written once at emit() time, never updated.';
COMMENT ON COLUMN keystone.event.sample IS
  '02-event-catalogue.md §2 rule 9. true for sample-client and test-mode events: stored and shown '
  'in History, never delivered to n8n, email, push or outbound webhooks. That delivery gate is a '
  'later task (T1 adds the column only).';
