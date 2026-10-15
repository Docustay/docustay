-- 0053 — THE TEMPLATE BODY, FROZEN AT SEND. §M0 LAW 3's MISSING HALF.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHAT WAS BROKEN, MEASURED, AND IT HAD BEEN BROKEN SINCE 15C.
--     `executeInstance` builds the LAW 3 snapshot with `template: inst.template_snapshot ?? null`,
--     and its own comment reads *"whatever the instance already carried (a template body, once 15C
--     exists) is preserved rather than replaced"*. **NOTHING EVER POPULATED IT.** 15C built both
--     builders, the versioning and the validator; the one step that copies a template's BODY onto an
--     instrument was missing. So **every executed instrument carried a snapshot with no terms in it.**
--   ★★ AND IT PRESENTED AS NOTHING AT ALL until something tried to RENDER one. Execution succeeded,
--      the state machine was right, and `executed_shape` was satisfied because the snapshot OBJECT is
--      non-null — it merely has a null `template` inside. The only component that could notice was the
--      PDF renderer, which refused:
--        "refusing to render a PDF from a snapshot whose frozen `template` is null. ★ The result would
--         be a titled page with signatures and NO TERMS — indistinguishable from a real agreement to
--         anyone holding it, and impossible to argue with."
--      P18.9 found it because P18.9 is the first thing that ever rendered one.
--
-- ★★★ WHY A NEW COLUMN AND NOT `template_snapshot`, WHICH IS WHERE I TRIED TO PUT IT FIRST.
--     [EXECUTED] writing the body into `template_snapshot` at send was refused by the database:
--         new row for relation "document_instance" violates check constraint "snapshot_is_readable"
--     `snapshot_is_readable` (0035) requires the LAW 3 SHAPE — `law3_version` · `builder` · `title` ·
--     `template_id` · `template` · `terms` · `price` · `disclosure`. A bare body is not that, and it
--     must not be: the snapshot is the instrument's own record, and half of its fields are only
--     knowable at EXECUTE (the price in force, the disclosure the signer accepted).
--   ★★ SO THE TWO THINGS ARE GENUINELY TWO THINGS, AND THE CONSTRAINT IS WHAT TAUGHT ME THAT:
--        · `template_body_snapshot` — THE WORDS, frozen at SEND, because that is the moment a person
--          is shown them. §M0 LAW 3 and P15C.8's rule ("a sent instrument never re-picks up its
--          template") are only true if the body is copied at send.
--        · `template_snapshot`      — THE INSTRUMENT, frozen at EXECUTE, quoting the body above plus
--          the price and the disclosure acceptance.
--   ★ Trying to make one column do both would have meant relaxing `snapshot_is_readable` to accept a
--     shape that is not a snapshot. Hard limit 5: never weaken an assertion to make something pass.

ALTER TABLE keystone.document_instance
  ADD COLUMN template_body_snapshot jsonb;

-- ★★ AND ITS SHAPE IS CONSTRAINED TOO, for exactly the reason 0035 constrains the other one: before
--    0035 the snapshot column's ONLY rule was NOT NULL, and an empty object satisfied it. A body that
--    is an empty object would render a blank agreement — the same defect, one column over.
ALTER TABLE keystone.document_instance
  ADD CONSTRAINT template_body_is_readable
  CHECK (
    template_body_snapshot IS NULL
    OR (
      template_body_snapshot ? 'kind'
      AND template_body_snapshot->>'kind' IN ('contract','form')
      AND template_body_snapshot ? 'schema_version'
      -- ★ `sections` for a contract, `fields` for a form — the two builders are separate tools with
      --   separate shapes (P15C.5), so this asserts the RIGHT one is present for the declared kind
      --   rather than accepting either on both.
      AND (
        (template_body_snapshot->>'kind' = 'contract'
           AND jsonb_typeof(template_body_snapshot->'sections') = 'array'
           AND jsonb_array_length(template_body_snapshot->'sections') > 0)
        OR
        (template_body_snapshot->>'kind' = 'form'
           AND jsonb_typeof(template_body_snapshot->'fields') = 'array')
      )
    )
  );

COMMENT ON COLUMN keystone.document_instance.template_body_snapshot IS
  'P18.9 / §M0 LAW 3 — the template BODY as it stood when this instrument was SENT. Frozen at send '
  'because that is the moment a person is shown the words; P15C.8''s "a sent instrument never '
  're-picks up its template" is only true if the copy happens here. ★ DISTINCT from '
  'template_snapshot, which is the whole instrument (body + price + disclosure) frozen at EXECUTE — '
  'writing a bare body into that column is refused by snapshot_is_readable, which is how the '
  'distinction was found.';

COMMENT ON CONSTRAINT template_body_is_readable ON keystone.document_instance IS
  'A frozen body must be a LEGAL body: a kind, a schema_version, and the array its kind requires — '
  'sections for a contract, fields for a form. ★ An empty object would satisfy a bare NOT NULL and '
  'render a blank agreement, which is the defect 0035 exists to stop one column over.';
