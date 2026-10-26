-- 0033_template_body
-- P15C.2 — ★★★ WHAT A TEMPLATE *IS*. THE COLUMN THAT DID NOT EXIST.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- [MEASURED] `keystone.document_template` (0009) has EIGHT columns — id, tenant_id, builder, name,
-- version, active, created_at, updated_at — and **NOT ONE OF THEM HOLDS A DOCUMENT.** No body, no
-- content, no jsonb. A "template" was a NAME and a VERSION with nothing inside it, and every
-- builder item in this phase is unbuildable until that is fixed. So this migration comes first.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ DECISION 1 — ONE COLUMN, NOT TWO. AND THE PAIRING IS A DATABASE FACT.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The obvious alternative is `contract_body jsonb` + `form_body jsonb`, both nullable. Rejected:
--   · it makes "which one is real?" a RUNTIME question at every read site;
--   · it permits a row with BOTH (two documents in one template) and a row with NEITHER (a template
--     that is not a template) — two states that have no meaning and cannot be rendered.
-- ★★ ONE `body` column plus a CHECK that `body->>'kind'` EQUALS `builder` makes the pairing
--    unrepresentable rather than merely discouraged: a contract template cannot hold a form tree,
--    and §A5's "SEPARATE tools with SEPARATE template sets" is then true in the data, not only in
--    the routing. §Z3.15's discipline, one domain over.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ DECISION 2 — WHAT EACH BODY IS. TWO DIFFERENT SHAPES, ON PURPOSE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★ A CONTRACT is PROSE IN SECTIONS. Each section has an OWNER (the party it belongs to) and says
--   whether it requires that party's signature. Its blocks are prose, variables and signature slots.
--       { kind:"contract", schema_version:1,
--         sections:[ { key, title, owner, requires_signature, blocks:[ {type,…} ] } ] }
--
-- ★ A FORM is A FIELD TREE, AND **IT IS RECURSIVE** — container fields nest children.
--       { kind:"form", schema_version:1,
--         fields:[ { key, type, label, children:[ …fields… ] } ] }
--
-- ★★ THEY DO NOT SHARE A SHAPE BECAUSE THEY ARE NOT THE SAME OBJECT. Forcing one schema over both
--    is how the legacy system arrived at THREE storage dialects inside one product and a 1,006-line
--    reader to reconcile them. The `kind` discriminator is what keeps them apart.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ DECISION 3 — THE RECURSION IS COUNTED BY THE DATABASE, AND THAT IS THE POINT OF THIS ITEM.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P15C.2's red-first: store a template whose questions sit TWO containers deep and read it back
-- with a NON-recursive reader; it must report FEWER fields than were stored.
--   ★★ CORROBORATED IN THE SYSTEM BEING REPLACED: a flat walk over three screenings found **155**
--      questions where a recursive walk found **198**. "A mapper that does not recurse silently
--      loses 43 of them and still looks complete."
--   ★★★ So the AUTHORITATIVE count lives HERE, in SQL, as `keystone.form_field_count(jsonb)`. A
--       JS reader can then be checked against it. **If the count lived only in JS, the flat-walk
--       defect would be invisible to anything except another JS walker written by the same person
--       on the same day.** That is the shape of the original failure.

ALTER TABLE keystone.document_template
  -- ★ NULL is permitted ONLY for rows that already exist. There are none in any environment
  --   ([MEASURED] 0 rows in both databases), so this column is NOT NULL from birth — a nullable
  --   body would mean "a template with no document in it" is representable again.
  ADD COLUMN body jsonb NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════
-- THE SHAPE CONSTRAINTS. Cheap, and they refuse the states that have no meaning.
-- ═════════════════════════════════════════════════════════════════════════════
-- ★★★ THE DISCRIMINATOR MUST MATCH THE COLUMN. This is the whole of DECISION 1.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_kind_matches_builder
  CHECK (body->>'kind' = builder);

-- ★ A version on the SHAPE, distinct from `version` on the TEMPLATE. The first is "how this JSON is
--   laid out"; the second is "which revision of this document". Conflating them would mean a
--   storage-format change looked like a new contract revision to every reader.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_schema_version
  CHECK ((body->>'schema_version')::int = 1);

-- ★★ EACH KIND CARRIES ITS OWN ARRAY, AND ONLY ITS OWN. A contract with a `fields` array is a form
--    wearing a contract's label, which is exactly what the kind check exists to stop — so the array
--    NAME is constrained too, not just its presence.
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_array_matches_kind
  CHECK (
    (builder = 'contract' AND jsonb_typeof(body->'sections') = 'array' AND NOT body ? 'fields')
    OR
    (builder = 'form'     AND jsonb_typeof(body->'fields')   = 'array' AND NOT body ? 'sections')
  );

-- ★★★ AND AN EMPTY DOCUMENT IS NOT A DOCUMENT. A template with zero sections renders as a blank
--     page a client could be asked to sign. [The same failure shape as F6/U30: the page loads, it
--     is simply empty, and nothing anywhere says so.]
ALTER TABLE keystone.document_template
  ADD CONSTRAINT template_body_not_empty
  CHECK (
    CASE builder
      WHEN 'contract' THEN jsonb_array_length(body->'sections') > 0
      WHEN 'form'     THEN jsonb_array_length(body->'fields')   > 0
    END
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- ★★★ THE RECURSIVE COUNT — THE AUTHORITY A FLAT READER IS MEASURED AGAINST.
-- ═════════════════════════════════════════════════════════════════════════════
-- Counts LEAF fields at any depth. A container (a field with a `children` array) is NOT itself a
-- question and is not counted; its children are, however deep they go.
--   ★ `SET search_path = ''` and fully-qualified everything, per the standing rule that every
--     SECURITY DEFINER-adjacent function pins its path. This one is not DEFINER — it is IMMUTABLE
--     and touches no table — but the habit is the guard, and P21A.6 asserts it across the board.
CREATE OR REPLACE FUNCTION keystone.form_field_count(fields jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = ''
AS $fn$
DECLARE
  f     jsonb;
  total integer := 0;
BEGIN
  IF fields IS NULL OR jsonb_typeof(fields) <> 'array' THEN
    RETURN 0;
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(fields) LOOP
    IF jsonb_typeof(f->'children') = 'array' THEN
      -- ★★ A CONTAINER IS NOT A QUESTION. Counting it would inflate the total and mask the very
      --    loss this function exists to detect: a flat reader that skips children but counts
      --    containers can land on the right number for the wrong reason.
      total := total + keystone.form_field_count(f->'children');
    ELSE
      total := total + 1;
    END IF;
  END LOOP;
  RETURN total;
END;
$fn$;

COMMENT ON FUNCTION keystone.form_field_count(jsonb) IS
  'P15C.2 — the AUTHORITATIVE leaf-field count for a form body, recursive to any depth. It exists '
  'in SQL rather than only in JS because the defect it guards against (a non-recursive walker that '
  'silently reports fewer fields than were stored, and still looks complete) is invisible to a '
  'second JS walker written the same way. Measured in the system being replaced: a flat walk found '
  '155 questions where a recursive walk found 198.';

-- ★ The same question for a contract: how many SIGNATURE slots does this body contain, across all
--   sections? P15C.7 needs it to know how many signature rows an instrument should have, and it is
--   the same "do not trust a flat read" argument.
CREATE OR REPLACE FUNCTION keystone.contract_signature_slot_count(sections jsonb)
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  SET search_path = ''
AS $fn$
  SELECT COALESCE(count(*)::int, 0)
    FROM jsonb_array_elements(COALESCE(sections, '[]'::jsonb)) AS s
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s->'blocks', '[]'::jsonb)) AS b
   WHERE b->>'type' = 'signature';
$fn$;

COMMENT ON COLUMN keystone.document_template.body IS
  'P15C.2. ONE column for both builders, with body->>''kind'' CHECKed equal to `builder` so a '
  'contract template cannot hold a form tree. A contract body is prose in owned sections; a form '
  'body is a RECURSIVE field tree. They are different shapes on purpose — forcing one schema over '
  'both is how the legacy system ended up with three dialects and a 1,006-line reconciler.';
