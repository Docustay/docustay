-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0135 — THE ACTOR CHECK NAMES A REAL PERSON OR A KNOWN PROVIDER (Stage 3 Task 1, fix round 1, M1).
--
-- ★★★ WHAT 0134 SHIPPED, EXACTLY. `event_actor_check` (0134) is
--       CHECK (actor ~ '^(system|n8n|worker|user:[0-9a-f-]{36}|webhook:[a-z]+)$')
--     [EXECUTED, review] `user:` followed by ANY 36 characters drawn from `[0-9a-f-]` is accepted —
--     36 hyphens alone passes, because the class allows the hyphen and the count does not check
--     WHERE they fall. And `webhook:` accepts ANY lower-case word — `webhook:notaprovider` passes,
--     so the "provider" half of the vocabulary was not actually a vocabulary.
--   ★★ NEITHER GAP IS EXPLOITABLE TODAY (JS-side callers only ever pass a real `user.id` or a name
--      from `PROVIDERS`), but the CHECK's whole job is to be the backstop for a caller that does not
--      go through `emit()`'s JS guard — a direct INSERT, a future writer, a migration backfill. A
--      backstop that accepts a shape wider than the thing it backstops is not doing that job.
--
-- ★★★ THE FIX, IN BOTH PLACES, IDENTICALLY:
--   · `user:` + a REAL UUID — 8-4-4-4-12 hex, hyphens exactly where a uuid puts them:
--       user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
--   · `webhook:` + a NAME FROM THE PROVIDER ALLOWLIST, not any lower-case word:
--       webhook:(stripe|resend)
--     This SQL list is `src/webhooks/verify.mjs`'s `export const PROVIDERS = ["stripe", "resend"]`,
--     copied by hand because a CHECK constraint cannot import a JS module — there is no shared
--     source at DDL time. `outbox.mjs`'s JS-side `ACTOR_SHAPE` DOES import `PROVIDERS` (see that
--     file), so the two can drift only if this migration's literal list and that file's array
--     diverge; keeping them alongside each other is the best available guard until this project has
--     a single source both a migration and a JS module can read at their own build times.
--
-- ★★ M2 (fix round 1) — CORRECTING 0134'S OWN COMMENT, WITHOUT EDITING 0134. Migration 0134's header
--    said `emit()` "refuses anything that does not come from keystone.app_user" — THAT IS FALSE.
--    `emit()` and both CHECK constraints (0134's and this one) validate SHAPE ONLY: a well-formed
--    `user:<uuid>` is accepted whether or not that uuid names a real row in `keystone.app_user`.
--    Nothing in this project performs that lookup, on either side. 0134 is not edited to say so —
--    ANY byte change to an applied migration file changes its checksum and `db/migrate.mjs` would
--    refuse to proceed past a checksum mismatch — so the correction is recorded here, and in
--    `src/events/outbox.mjs`'s own comment, which no longer repeats the false claim.
--
-- ★ DROP + ADD, VALIDATED (not NOT VALID): every existing row is `actor = 'system'`
--   (0134 shipped everything at its default) or a value written by JS this fix round already tightens
--   to match, so validating immediately cannot fail against live data — and a mistake in the new
--   pattern is caught at migration time, not discovered later against a poisoned column.
-- ★★★ NO RESET ROLE. F482. `db/migrate.mjs` sets `app_owner` before this file and restores it after;
--     a bare `RESET ROLE` here would hand later objects to the connecting superuser instead.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE keystone.event
  DROP CONSTRAINT event_actor_check;

ALTER TABLE keystone.event
  ADD CONSTRAINT event_actor_check
  CHECK (actor ~ '^(system|n8n|worker|user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|webhook:(stripe|resend))$');

COMMENT ON COLUMN keystone.event.actor IS
  '02-event-catalogue.md §2 rule 3. Who caused this event: system | n8n | worker | user:<uuid> | '
  'webhook:stripe | webhook:resend. SHAPE-CHECKED ONLY (uuid syntax, provider name in the allowlist '
  'mirrored from src/webhooks/verify.mjs PROVIDERS) — this is NOT a foreign key and nothing verifies '
  'the uuid names a real keystone.app_user row. Written once at emit() time, never updated.';
