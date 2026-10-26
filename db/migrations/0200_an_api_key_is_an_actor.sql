-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0200 — A KEY IS AN ACTOR, IN THE DATABASE TOO. (Stage 7 task 7.24.)
--
-- ★★★ DROP + ADD, VALIDATED — 0135:36-38's rule, and it is safe to validate immediately: every
--     existing row's actor already matches the OLD pattern, and the new pattern is a strict
--     superset (one extra alternative). A mistake in the new regex fails HERE, at migration time,
--     not later against a poisoned column.
-- ★★★ NO RESET ROLE. F482. db/migrate.mjs sets app_owner before this file and restores it after.
-- ★ The api_key alternative quotes keystone_auth.api_token.token_id's own CHECK (0045:56) character
--   for character. Two shapes for one id is one shape too many.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.event DROP CONSTRAINT event_actor_check;

ALTER TABLE keystone.event
  ADD CONSTRAINT event_actor_check
  CHECK (actor ~ '^(system|n8n|worker|user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|webhook:(stripe|resend)|api_key:[0-9A-HJKMNP-TV-Z]{26})$');

COMMENT ON COLUMN keystone.event.actor IS
  '02-event-catalogue.md §2 rule 3. Who caused this event: system | n8n | worker | user:<uuid> | '
  'webhook:stripe | webhook:resend | api_key:<token_id>. SHAPE-CHECKED ONLY — this is NOT a foreign '
  'key and nothing verifies the uuid or the token id names a real row. The api_key form carries the '
  'PUBLIC 26-character token id (keystone_auth.api_token.token_id) and NEVER the secret. Written '
  'once at emit() time, never updated.';
