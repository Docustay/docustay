-- 0034_template_body_null_safe
-- P15C.2 — ★★★ 0033'S CHECKS PASSED ON A BODY WITH THE KEY MISSING. A CHECK THAT EVALUATES TO NULL
--              IS SATISFIED, AND EVERY ONE OF 0033'S DEPENDED ON A KEY BEING THERE.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT WAS WRONG, MEASURED, ONE MIGRATION LATER — AND THE TEST FOUND IT, NOT A REVIEW.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [EXECUTED] this INSERT SUCCEEDED against 0033:
--     body = {"kind":"form","schema_version":1,"fieldsJson":"[]"}
-- ★ **A form template with no `fields` key at all was storable.** Three separate CHECKs should each
--   have refused it, and all three were SATISFIED, because in SQL a CHECK constraint passes unless it
--   evaluates to FALSE — and `NULL` is not FALSE:
--     · `jsonb_typeof(body->'fields') = 'array'`      → jsonb_typeof(NULL) is NULL → NULL → PASSES
--     · `jsonb_array_length(body->'fields') > 0`       → NULL > 0                 → NULL → PASSES
--     · `(body->>'schema_version')::int = 1`           → fine here, but the same trap one key away
--   [MEASURED] `select jsonb_typeof('{"kind":"form"}'::jsonb->'fields') is null` → **t**
--
-- ★★ SO THE DIALECT 0033 WAS WRITTEN TO REFUSE WAS STORABLE THE WHOLE TIME. The validator in
--    `src/documents/body.mjs` refused it correctly — which is exactly the arrangement that hides this
--    class of bug: the good path is guarded, and the guarantee everyone believes is at the DATABASE
--    is not there at all. The moment anything writes a body without going through the module
--    (a migration, a fix-up script, a future import), the second dialect exists.
--
-- ★★★ THE FIX IS `body ? 'key'` FIRST, EVERY TIME. `?` returns a real boolean for a missing key, so
--     the expression can be FALSE instead of unknown. Stated as a rule because it will recur: **any
--     CHECK over jsonb must assert the key EXISTS before it asserts anything about its value.**

ALTER TABLE keystone.document_template DROP CONSTRAINT template_body_array_matches_kind;
ALTER TABLE keystone.document_template DROP CONSTRAINT template_body_not_empty;
ALTER TABLE keystone.document_template DROP CONSTRAINT template_body_kind_matches_builder;
ALTER TABLE keystone.document_template DROP CONSTRAINT template_body_schema_version;

-- ★ `body ? 'kind'` first: a body with NO kind key must be refused, not silently permitted.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_kind_matches_builder
  CHECK (body ? 'kind' AND body->>'kind' = builder);

ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_schema_version
  CHECK (body ? 'schema_version' AND (body->>'schema_version') = '1');

-- ★★ THE ARRAY MUST EXIST, BE AN ARRAY, AND BE THE RIGHT ONE — and the other kind's array must be
--    ABSENT. All four conditions are now expressible as FALSE rather than unknown.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_array_matches_kind
  CHECK (
    (builder = 'contract'
      AND body ? 'sections' AND jsonb_typeof(body->'sections') = 'array' AND NOT body ? 'fields')
    OR
    (builder = 'form'
      AND body ? 'fields'   AND jsonb_typeof(body->'fields')   = 'array' AND NOT body ? 'sections')
  );

-- ★ And emptiness, guarded the same way. The `CASE` had no ELSE, so an unexpected `builder` also
--   produced NULL — harmless today because `builder` has its own CHECK, but the same silent-pass
--   shape, so it is closed rather than reasoned about.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_not_empty
  CHECK (
    CASE
      WHEN builder = 'contract' AND body ? 'sections' THEN jsonb_array_length(body->'sections') > 0
      WHEN builder = 'form'     AND body ? 'fields'   THEN jsonb_array_length(body->'fields')   > 0
      ELSE false
    END
  );

COMMENT ON CONSTRAINT template_body_array_matches_kind ON keystone.document_template IS
  'P15C.2 / 0034. Each builder carries its OWN array and only its own. Every condition starts with '
  '`body ? key` because a CHECK that evaluates to NULL is SATISFIED — 0033''s version passed on a '
  'body with the key missing entirely, which made the second dialect it was written to refuse '
  'storable. Any future CHECK over jsonb must assert the key exists before asserting about its value.';
