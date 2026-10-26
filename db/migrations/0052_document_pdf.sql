-- 0052 — THE EXECUTED-INSTRUMENT PDF ARCHIVE. P18.3 + P18.4 FINALLY GET A PRODUCER.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ WHY A TABLE AND NOT A COLUMN ON document_instance, WHICH IS THE OBVIOUS SHAPE AND IS WRONG.
--     U25 / P15C.11: an EXECUTED instrument is immutable, enforced by a database trigger. The PDF is
--     rendered and uploaded AFTER execution (the upload is a network call and must not sit inside the
--     execute transaction), so writing `pdf_object_key` onto the instance would be an UPDATE on an
--     executed row — **which the immutability trigger refuses, correctly.**
--   ★★ The choice is therefore not stylistic. Either the archive is a separate row, or U25 gets a
--      carve-out for "just this one column" — and hard limit 5 forbids weakening a rule to fit a
--      feature. A sibling row records a fact ABOUT the instrument without altering it.
--   ★ This is the same reasoning that put signatures in their own table rather than in a JSON column.
--
-- ★★★ AND IT IS ONE ROW PER DOCUMENT, NOT ONE PER ATTEMPT. The contrast with `webhook_delivery`
--     (0047, deliberately one row per ATTEMPT) is worth stating so the difference does not read as an
--     inconsistency: a webhook attempt is an EVENT whose history matters, and a delivery that failed
--     four times is four facts. An archived PDF is a STATE — the bytes either are in the object store
--     or are not. Re-running the archive for the same executed instrument must converge on one row,
--     because an executed instrument has exactly one true rendering of itself.

CREATE TABLE keystone.document_pdf (
  -- ★ `keystone.uuid_generate_v7()`, SCHEMA-QUALIFIED, which is what all 43 other tables use.
  --   [EXECUTED] my first version wrote bare `uuidv7()` and the migration failed with
  --   `function uuidv7() does not exist` — and rolled back cleanly, which is the runner working.
  --   The qualified name matters beyond spelling: the runner SETs ROLE and does not guarantee
  --   `keystone` is on the search_path.
  id            uuid PRIMARY KEY DEFAULT keystone.uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES keystone.tenant(id) ON DELETE CASCADE,

  -- ★ ON DELETE CASCADE: if a document row is ever removed the archive row is meaningless. Note this
  --   does NOT delete the object from storage — see the comment on `object_key` below.
  instance_id   uuid NOT NULL REFERENCES keystone.document_instance(id) ON DELETE CASCADE,

  -- ★★ THE KEY AS WRITTEN, NOT AS COMPUTED. Storing it (rather than recomputing from tenant + id at
  --    read time) means a later change to the key scheme cannot orphan an existing object: the row
  --    remembers where the bytes actually went. `webhook_delivery.request_url` exists for the same
  --    reason and the same lesson.
  --  ★ Deleting this row does NOT delete the object. That is deliberate: an orphaned object costs
  --    disk, an orphaned REFERENCE to a signed agreement costs the agreement. Reaping is an operator
  --    action with the key in hand, never a cascade.
  object_key    text NOT NULL,
  bucket        text NOT NULL,

  -- ★★★ THE HASH IS THE POINT OF THE WHOLE ROW. Without it "the PDF is stored" is a claim about a
  --     network call that returned 200. With it, a retrieval can be PROVEN to be the same bytes that
  --     were archived — which is what makes the archive evidence rather than a copy.
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size     integer NOT NULL CHECK (byte_size > 0),

  -- ★ The snapshot the PDF was rendered FROM, by reference. §M0 LAW 3: the instrument quotes frozen
  --   terms, so two renderings of the same instrument must be identical; if they ever differ, this is
  --   how you find out which snapshot each came from.
  rendered_from text NOT NULL DEFAULT 'template_snapshot',

  archived_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- ★★ ONE ARCHIVE PER INSTRUMENT PER TENANT. This is what makes the archive task IDEMPOTENT: a
  --    re-run hits the unique index and takes the ON CONFLICT path rather than writing a second row
  --    and a second object. A queue with retries makes re-runs normal, not exceptional.
  CONSTRAINT document_pdf_one_per_instance UNIQUE (tenant_id, instance_id)
);

CREATE INDEX document_pdf_by_instance ON keystone.document_pdf (tenant_id, instance_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- RLS — ENABLED **AND FORCED**, like every other tenant table.
-- ★★ FORCE applies to the table OWNER too, which this project has now measured twice (0008:8-16 and
--    again at 0051 when a SECURITY DEFINER function owned by the owner returned NULL). Stating it
--    here so nobody "fixes" a future empty read by removing FORCE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE keystone.document_pdf ENABLE ROW LEVEL SECURITY;
ALTER TABLE keystone.document_pdf FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON keystone.document_pdf
  FOR SELECT USING (tenant_id = keystone.current_tenant_id());
CREATE POLICY tenant_insert ON keystone.document_pdf
  FOR INSERT WITH CHECK (tenant_id = keystone.current_tenant_id());
-- ★★ UPDATE IS GRANTED, AND ONLY BECAUSE THE ARCHIVE IS IDEMPOTENT. `ON CONFLICT … DO UPDATE` needs
--    it. ★ There is deliberately NO DELETE policy: removing the only record of where a signed
--    agreement's PDF lives is not an application action. An operator with superuser can do it; the
--    app cannot, and that asymmetry is the intent.
CREATE POLICY tenant_update ON keystone.document_pdf
  FOR UPDATE USING (tenant_id = keystone.current_tenant_id())
           WITH CHECK (tenant_id = keystone.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON keystone.document_pdf TO app_rw;
