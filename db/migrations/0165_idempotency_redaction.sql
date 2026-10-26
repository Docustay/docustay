-- 0165_idempotency_redaction
-- Stage 5 task 5.3 · CT-008 (CCR-2: `redacted` only, no expires_at) · CCR-13 · F470.

ALTER TABLE keystone.idempotency_key
  ADD COLUMN redacted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN keystone.idempotency_key.redacted IS
  'true when redactForReplay() removed at least one value from response_body. F470.';

-- F470 backfill. ★ REWRITTEN AT REFRESH PART C: it now redacts BY KEY NAME, exactly as the runtime
-- walk does, instead of by a value-shape regex. The old statement matched only a full-shaped
-- gl_(live|test)_ token in a field named `key`; a truncated key, a `whsec_`, or a `secret` field
-- would have been left in place while the column claimed the row was clean.
-- ★★ The nine names are CT-007's eight PLUS `key`, which is the only extra name any route passes
--    today (src/routes/developer.mjs:204, task 5.11). A route that later passes a tenth name needs
--    its own migration; this one is not edited afterwards.
-- ★ TOP-LEVEL KEYS ONLY, deliberately: MEASURED, every credential-bearing body this table has ever
--   held is flat ({id, key, last_four, shown_once} and {…, secret, shown_once}). The runtime walk is
--   recursive; this backfill is not, and the difference is stated rather than discovered.
UPDATE keystone.idempotency_key k
   SET response_body = (
         SELECT jsonb_object_agg(
                  e.key,
                  CASE WHEN e.key IN ('key','token','secret','apiKey','api_key',
                                      'signingSecret','presented','plaintext','clientSecret')
                       THEN '"[not replayed]"'::jsonb
                       ELSE e.value END)
           FROM jsonb_each(k.response_body) e),
       redacted = true
 WHERE jsonb_typeof(k.response_body) = 'object'
   AND EXISTS (
         SELECT 1 FROM jsonb_object_keys(k.response_body) ok
          WHERE ok IN ('key','token','secret','apiKey','api_key',
                       'signingSecret','presented','plaintext','clientSecret'));

-- No new table, so no new policy: the existing FORCED RLS on keystone.idempotency_key (0003)
-- covers the column.
